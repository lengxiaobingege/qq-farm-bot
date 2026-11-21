#!/usr/bin/env bash
# 为管理面板签发本地 HTTPS 证书（自建 CA + 服务器证书）。
#
# 用途：面板默认走明文 HTTP，密码与 token 在同网段可被嗅探。
#      本脚本生成一套「本地 CA + 服务器证书」，把 CA 导入客户端后浏览器显示绿锁。
#
# 为什么不签 Let's Encrypt：那需要公网可达的域名与 80/443 端口。
# 本机是私网地址（或未备案域名）时无法完成 ACME 验证。
#
# 用法：
#   ./scripts/gen-selfsigned-cert.sh              # 默认输出到 core/data/certs
#   CERT_DIR=/etc/qq-farm-cert ./scripts/gen-selfsigned-cert.sh
#   ./scripts/gen-selfsigned-cert.sh --force      # 已存在则覆盖（会作废旧证书）
#   ./scripts/gen-selfsigned-cert.sh --print-env  # 只打印环境变量，不生成
#
# 生成后启动面板：
#   HTTPS_KEY=<dir>/server.key HTTPS_CERT=<dir>/server.crt \
#   HTTPS_CA=<dir>/ca.crt PORT=3000 node client.js
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$REPO_ROOT/core/data/certs}"
CA_DAYS="${CA_DAYS:-3650}"
SRV_DAYS="${SRV_DAYS:-825}"
FORCE=0

for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        --print-env) PRINT_ENV=1 ;;
        -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "未知参数: $arg" >&2; exit 2 ;;
    esac
done

print_env() {
    cat <<EOF
  export HTTPS_KEY=$CERT_DIR/server.key
  export HTTPS_CERT=$CERT_DIR/server.crt
  export HTTPS_CA=$CERT_DIR/ca.crt
  # 可选：启用 HSTS（确认证书稳定后再开，否则配错难回退）
  # export HTTPS_HSTS=1
EOF
}

if [ "${PRINT_ENV:-0}" = "1" ]; then
    print_env
    exit 0
fi

command -v openssl >/dev/null 2>&1 || { echo "缺少 openssl，无法签发证书" >&2; exit 1; }

if [ -f "$CERT_DIR/server.crt" ] && [ "$FORCE" != "1" ]; then
    echo "证书已存在：$CERT_DIR/server.crt"
    echo "如需重新签发（旧证书立即失效），加 --force"
    exit 0
fi

umask 077
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

# ---- 收集 SAN：回环名、本机名、全部非回环 IPv4 ----
SAN="DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
if [ -n "$HOSTNAME_FQDN" ]; then
    SAN="$SAN,DNS:$HOSTNAME_FQDN"
    SHORT_NAME="${HOSTNAME_FQDN%%.*}"
    [ "$SHORT_NAME" != "$HOSTNAME_FQDN" ] && SAN="$SAN,DNS:$SHORT_NAME"
fi
PRIMARY_IP=""
while read -r ip; do
    [ -z "$ip" ] && continue
    SAN="$SAN,IP:$ip"
    [ -z "$PRIMARY_IP" ] && PRIMARY_IP="$ip"
done < <(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)

CN="${PRIMARY_IP:-localhost}"

echo "证书目录 : $CERT_DIR"
echo "SAN      : $SAN"
echo

# ---- CA ----
if [ ! -f "$CERT_DIR/ca.crt" ] || [ "$FORCE" = "1" ]; then
    openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/ca.key"
    openssl req -x509 -new -key "$CERT_DIR/ca.key" -sha256 -days "$CA_DAYS" \
        -subj "/O=qq-farm-bot/CN=qq-farm-bot Local CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -out "$CERT_DIR/ca.crt"
    echo "[1/3] CA 已生成（有效期 ${CA_DAYS} 天）"
else
    echo "[1/3] 复用已有 CA：$CERT_DIR/ca.crt（换 CA 需重新导入客户端）"
fi

# ---- 服务器私钥与 CSR ----
openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/server.key"
openssl req -new -key "$CERT_DIR/server.key" -subj "/O=qq-farm-bot/CN=$CN" -out "$CERT_DIR/server.csr"
echo "[2/3] 服务器私钥与 CSR 已生成"

# ---- 签发 ----
EXT_FILE="$(mktemp)"
trap 'rm -f "$EXT_FILE" "$CERT_DIR/server.csr"' EXIT
cat > "$EXT_FILE" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$SAN
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

openssl x509 -req -in "$CERT_DIR/server.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -days "$SRV_DAYS" -sha256 -extfile "$EXT_FILE" \
    -out "$CERT_DIR/server.crt" 2>/dev/null
echo "[3/3] 服务器证书已签发（有效期 ${SRV_DAYS} 天）"

chmod 600 "$CERT_DIR/ca.key" "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/ca.crt" "$CERT_DIR/server.crt"

# ---- 自检：链、SAN、配对 ----
echo
echo "===== 自检 ====="
openssl verify -CAfile "$CERT_DIR/ca.crt" "$CERT_DIR/server.crt" || {
    echo "链校验失败，请检查 openssl 版本" >&2; exit 1
}
openssl x509 -in "$CERT_DIR/server.crt" -noout -subject -dates -ext subjectAltName | sed 's/^/  /'

echo
echo "===== 启动面板 ====="
print_env
cat <<EOF

===== 客户端信任（浏览器出绿锁的关键）=====
  Linux/macOS 客户端：把 ca.crt 导入系统/浏览器「受信任的根证书颁发机构」
  macOS:  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERT_DIR/ca.crt
  Windows: certutil -addstore -f Root ca.crt（管理员 PowerShell）
  iOS/Android：把 ca.crt 传到手机后手动安装并启用信任

  不导入也能用，但每次访问都会提示「连接不是私密连接」，需要手动点继续。
  ca.key 是签发根密钥，权限已设 600，请不要外传；泄露者可签发任意站点证书。
EOF

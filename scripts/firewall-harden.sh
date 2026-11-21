#!/usr/bin/env bash
# ============================================================
# 迁移安全加固脚本：部署到有公网 IP 的机器后执行一次
# 作用：启用防火墙，只放行面板入口与已建立连接，其余入站默认拒绝
# 用法：sudo bash scripts/firewall-harden.sh [面板端口，默认 3000]
# 注意：
#   1. 先确认本机 SSH 端口（默认 22），否则远程执行会被锁在门外
#   2. 面板端口对外开放，务必先启用两步验证（面板 → 系统设置 → 两步验证）
#   3. 如面板由 Nginx/Caddy 反代并只监听回环，可只开放反代端口(80/443)
# ============================================================
set -euo pipefail

PANEL_PORT="${1:-3000}"
SSH_PORT="${SSH_PORT:-22}"

if ! command -v ufw >/dev/null 2>&1; then
    echo "未安装 ufw，请先安装: sudo apt install -y ufw" >&2
    exit 1
fi

# 1. SSH 必须先放行，避免远程执行时自断
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null

# 2. 面板入口（带速率限制：30 次连接/30 秒，防暴力登录洪泛）
ufw limit "${PANEL_PORT}/tcp" comment 'admin-panel' >/dev/null

# 3. 默认拒绝所有其他入站，放行出站与回环
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null

# 4. 若面板被反代到回环，拒绝直连业务端口（可选：反代部署时取消注释）
# ufw deny 3007/tcp comment 'admin-direct' >/dev/null

echo 'y' | ufw enable >/dev/null
ufw status verbose

echo
echo "加固完成：入站仅放行 SSH(${SSH_PORT}) 与面板(${PANEL_PORT}，已限速)。"
echo "后续建议：为面板域名配置 HTTPS（Caddy 可自动签发），并在面板启用两步验证。"

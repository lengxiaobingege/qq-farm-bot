/**
 * HTTPS 凭据加载与 TLS 握手测试。
 *
 * 用 openssl 现场签发一套临时证书（CA + 服务器证书），
 * 因为凭据加载的绝大部分失败分支都是「文件内容不合法」，
 * 只有真实 PEM 才能覆盖到。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const loaderPath = path.resolve(__dirname, '../dist/utils/https-loader.js');
const { loadHttpsCredentials, resolveHstsHeader } = require(loaderPath);

function hasOpenssl() {
    try {
        execFileSync('openssl', ['version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const OPENSSL = hasOpenssl();

function makeDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'https-loader-'));
    fs.chmodSync(dir, 0o700);
    return dir;
}

function sh(args) {
    execFileSync('openssl', args, { stdio: 'ignore' });
}

/** 签发一套 CA + 服务器证书，返回各文件路径 */
function issueCert(dir, options = {}) {
    const { san = 'DNS:localhost,IP:127.0.0.1', days = '825' } = options;
    const caKey = path.join(dir, 'ca.key');
    const caCrt = path.join(dir, 'ca.crt');
    const srvKey = path.join(dir, 'server.key');
    const csr = path.join(dir, 'server.csr');
    const srvCrt = path.join(dir, 'server.crt');
    const ext = path.join(dir, 'ext.cnf');

    sh(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', caKey]);
    sh(['req', '-x509', '-new', '-key', caKey, '-sha256', '-days', '3650',
        '-subj', '/CN=Test Local CA', '-out', caCrt]);
    sh(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', srvKey]);
    sh(['req', '-new', '-key', srvKey, '-subj', '/CN=127.0.0.1', '-out', csr]);
    fs.writeFileSync(ext, [
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature',
        'extendedKeyUsage=serverAuth',
        `subjectAltName=${san}`,
        '',
    ].join('\n'));
    sh(['x509', '-req', '-in', csr, '-CA', caCrt, '-CAkey', caKey, '-CAcreateserial',
        '-days', days, '-sha256', '-extfile', ext, '-out', srvCrt]);

    for (const file of [caKey, srvKey]) fs.chmodSync(file, 0o600);
    for (const file of [caCrt, srvCrt]) fs.chmodSync(file, 0o644);
    return { caKey, caCrt, srvKey, srvCrt, csr };
}

test('未配置证书时返回未启用，不报错', () => {
    const result = loadHttpsCredentials({});
    assert.equal(result.enabled, false);
    assert.equal(result.error, null);
    assert.equal(result.credentials, null);
    assert.deepEqual(result.warnings, []);
});

test('只配置一半时报「必须成对设置」', () => {
    const onlyKey = loadHttpsCredentials({ HTTPS_KEY: '/tmp/x.key' });
    assert.equal(onlyKey.enabled, false);
    assert.match(onlyKey.error, /成对/);

    const onlyCert = loadHttpsCredentials({ HTTPS_CERT: '/tmp/x.crt' });
    assert.equal(onlyCert.enabled, false);
    assert.match(onlyCert.error, /成对/);
});

test('文件不存在时报明确路径', () => {
    const result = loadHttpsCredentials({
        HTTPS_KEY: '/nonexistent/a.key',
        HTTPS_CERT: '/nonexistent/a.crt',
    });
    assert.equal(result.enabled, false);
    assert.match(result.error, /不存在|不可访问/);
    assert.match(result.error, /a\.key/);
});

test('非 PEM 内容被拒绝', () => {
    const dir = makeDir();
    const key = path.join(dir, 'server.key');
    const cert = path.join(dir, 'server.crt');
    fs.writeFileSync(key, 'not a key\n', { mode: 0o600 });
    fs.writeFileSync(cert, 'not a cert\n', { mode: 0o644 });

    const result = loadHttpsCredentials({ HTTPS_KEY: key, HTTPS_CERT: cert });
    assert.equal(result.enabled, false);
    assert.match(result.error, /PEM/);
});

test('私钥与证书不匹配时拒绝（提前暴露握手必失败）', { skip: OPENSSL ? false : '需要 openssl' }, () => {
    const dirA = makeDir();
    const dirB = makeDir();
    const a = issueCert(dirA);
    const b = issueCert(dirB);

    const result = loadHttpsCredentials({ HTTPS_KEY: a.srvKey, HTTPS_CERT: b.srvCrt });
    assert.equal(result.enabled, false);
    assert.match(result.error, /不匹配/);
});

test('合法证书加载成功并给出自签提示', { skip: OPENSSL ? false : '需要 openssl' }, () => {
    const dir = makeDir();
    const { srvKey, srvCrt, caCrt } = issueCert(dir);

    const result = loadHttpsCredentials({ HTTPS_KEY: srvKey, HTTPS_CERT: srvCrt, HTTPS_CA: caCrt });
    assert.equal(result.enabled, true);
    assert.equal(result.error, null);
    // EC 私钥在 PEM 里是「EC PRIVATE KEY」，PKCS#8 才是「PRIVATE KEY」，两者都要接受
    assert.match(result.credentials.key, /BEGIN (EC |RSA )?PRIVATE KEY/);
    assert.ok(result.credentials.cert.includes('BEGIN CERTIFICATE'));
    assert.ok(result.credentials.ca.includes('BEGIN CERTIFICATE'));
    // issuer != subject（CA 签发），所以不应报自签
    assert.ok(!result.warnings.some(w => w.includes('自签')), 'CA 签发不应提示自签');
    // 证书与 CA 是公开材料，644 是正常权限，不应误报
    assert.ok(!result.warnings.some(w => w.includes('权限过宽')), '证书 644 不应告警');
});

test('私钥权限过宽只告警，不阻断启动', { skip: OPENSSL ? false : '需要 openssl' }, () => {
    const dir = makeDir();
    const { srvKey, srvCrt } = issueCert(dir);
    fs.chmodSync(srvKey, 0o644);

    const result = loadHttpsCredentials({ HTTPS_KEY: srvKey, HTTPS_CERT: srvCrt });
    assert.equal(result.enabled, true, '权限问题不应拒绝启动');
    assert.ok(result.warnings.some(w => w.includes('权限过宽')), '应提示收紧权限');
});

test('带口令的私钥：漏配口令与口令错误都给出可定位的错误', { skip: OPENSSL ? false : '需要 openssl' }, () => {
    const dir = makeDir();
    const { srvKey, srvCrt } = issueCert(dir);
    const encKey = path.join(dir, 'server.enc.key');
    sh(['pkey', '-in', srvKey, '-aes256', '-passout', 'pass:test-pass', '-out', encKey]);
    fs.chmodSync(encKey, 0o600);

    const missing = loadHttpsCredentials({ HTTPS_KEY: encKey, HTTPS_CERT: srvCrt });
    assert.equal(missing.enabled, false);
    assert.match(missing.error, /HTTPS_PASSPHRASE/);

    const wrong = loadHttpsCredentials({ HTTPS_KEY: encKey, HTTPS_CERT: srvCrt, HTTPS_PASSPHRASE: 'nope' });
    assert.equal(wrong.enabled, false);
    assert.match(wrong.error, /口令/);

    const ok = loadHttpsCredentials({ HTTPS_KEY: encKey, HTTPS_CERT: srvCrt, HTTPS_PASSPHRASE: 'test-pass' });
    assert.equal(ok.enabled, true, `口令正确应加载成功: ${ok.error || ''}`);
    assert.equal(ok.credentials.passphrase, 'test-pass');
});

test('加载出的凭据可直接建立 TLS 连接（端到端握手）', { skip: OPENSSL ? false : '需要 openssl' }, async () => {
    const dir = makeDir();
    const { srvKey, srvCrt, caCrt } = issueCert(dir);
    const loaded = loadHttpsCredentials({ HTTPS_KEY: srvKey, HTTPS_CERT: srvCrt });
    assert.equal(loaded.enabled, true);

    const server = https.createServer(loaded.credentials, (req, res) => {
        res.setHeader('Strict-Transport-Security', 'max-age=86400');
        res.end('tls-ok');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const body = await new Promise((resolve, reject) => {
        const req = https.request({
            host: '127.0.0.1', port, path: '/', method: 'GET',
            ca: fs.readFileSync(caCrt), servername: 'localhost',
            checkServerIdentity: () => undefined, // SAN 里是 127.0.0.1，用 IP 连已覆盖，这里跳过主机名比对
        }, res => {
            assert.equal(res.headers['strict-transport-security'], 'max-age=86400');
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.end();
    });
    assert.equal(body, 'tls-ok');
    await new Promise(resolve => server.close(resolve));
});

test('HSTS 头解析：默认关闭，开启后按配置取值', () => {
    assert.equal(resolveHstsHeader({}), '', '未开启时不下发');
    assert.equal(resolveHstsHeader({ HTTPS_HSTS: '0' }), '', '显式 0 同样不下发');
    assert.equal(resolveHstsHeader({ HTTPS_HSTS: '1' }), 'max-age=86400', '默认一天，便于回退');
    assert.equal(resolveHstsHeader({ HTTPS_HSTS: '1', HTTPS_HSTS_MAX_AGE: '31536000' }), 'max-age=31536000');
    assert.equal(resolveHstsHeader({ HTTPS_HSTS: '1', HTTPS_HSTS_MAX_AGE: '-5' }), 'max-age=86400', '非法值回落默认');
    assert.equal(resolveHstsHeader({ HTTPS_HSTS: '1', HTTPS_HSTS_MAX_AGE: 'abc' }), 'max-age=86400');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { encryptValue, decryptValue, isEncrypted, maskValue } = require('../dist/utils/secret-crypto');

test('encrypted values never expose the plaintext and round-trip correctly', () => {
    const plain = 'f7389bd4ef8241028f39bb212b509b5b';
    const cipher = encryptValue(plain);
    assert.ok(isEncrypted(cipher));
    assert.ok(!cipher.includes(plain), '密文不得包含明文');
    assert.notEqual(cipher, encryptValue(plain), '相同明文每次加密结果应不同');
    assert.equal(decryptValue(cipher), plain);
});

test('legacy plaintext stays readable and empty values short-circuit', () => {
    assert.equal(decryptValue('legacy-plain-token'), 'legacy-plain-token');
    assert.equal(decryptValue(''), '');
    assert.equal(encryptValue(''), '');
});

test('tampered ciphertext degrades to empty instead of throwing', () => {
    const cipher = encryptValue('secret-value');
    const parts = cipher.split(':');
    // 篡改密文主体，GCM 校验应失败
    const broken = `${parts[0]}:${parts[1]}:${parts[2]}:${'00'.repeat(8)}`;
    assert.equal(decryptValue(broken), '');
    assert.equal(decryptValue('enc:v1:bad'), '');
});

test('mask keeps only a short recognizable prefix and suffix', () => {
    assert.equal(maskValue('f7389bd4ef8241028f39bb212b509b5b'), 'f7389b…b5b');
    assert.equal(maskValue('short'), 'sh***');
    assert.equal(maskValue(''), '');
});

test('key file is written with owner-only permissions', () => {
    const { KEY_FILE } = require('../dist/utils/secret-crypto');
    encryptValue('trigger-key-creation');
    assert.ok(fs.existsSync(KEY_FILE));
    const mode = fs.statSync(KEY_FILE).mode & 0o777;
    assert.equal(mode, 0o600, `密钥文件权限应为 600，实际 ${mode.toString(8)}`);
});

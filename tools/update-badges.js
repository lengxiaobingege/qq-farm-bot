#!/usr/bin/env node
/**
 * README 徽章同步：让 version / protocol / tests 徽章与实际代码保持一致，消除文档漂移。
 *
 * 用法：node tools/update-badges.js
 * 数据来源：
 *   version  → core/package.json 的 version 字段
 *   protocol → core/src/config/config.ts 的 DEFAULT_WX_CLIENT_VERSION
 *   tests    → 运行 core 全量测试并解析 "# tests" 输出
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const readmePath = path.join(repoRoot, 'README.md');

function getPackageVersion() {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'core', 'package.json'), 'utf8'));
    return String(pkg.version || '');
}

function getProtocolVersion() {
    const source = fs.readFileSync(path.join(repoRoot, 'core', 'src', 'config', 'config.ts'), 'utf8');
    const m = source.match(/DEFAULT_WX_CLIENT_VERSION\s*=\s*'([^']+)'/);
    if (!m) throw new Error('未找到 DEFAULT_WX_CLIENT_VERSION');
    return m[1];
}

function getTestCount() {
    const out = execSync('node --test tests/*.test.js', { cwd: path.join(repoRoot, 'core'), encoding: 'utf8', timeout: 120000 });
    const m = out.match(/# tests (\d+)/);
    if (!m) throw new Error('无法解析测试总数');
    return Number(m[1]);
}

function badgeUrl(name, value, color) {
    // shields.io 徽章文本：连字符需转义为 --，下划线原样保留
    const label = String(value).replace(/-/g, '--');
    return `https://img.shields.io/badge/${name}-${label}-${color}`;
}

function main() {
    const version = getPackageVersion();
    const protocol = getProtocolVersion();
    const tests = getTestCount();

    let content = fs.readFileSync(readmePath, 'utf8');
    const before = content;

    content = content.replace(
        /(\[!\[version\]\()(https?:\/\/[^)]+)\)/,
        `$1${badgeUrl('version', version, 'green')})`,
    );
    content = content.replace(
        /(\[!\[protocol\]\()(https?:\/\/[^)]+)\)/,
        `$1${badgeUrl('protocol', protocol, 'blue')})`,
    );
    content = content.replace(
        /(\[!\[tests\]\()(https?:\/\/[^)]+)\)/,
        `$1${badgeUrl('tests', `${tests}%20passing`, 'brightgreen')})`,
    );

    if (content !== before) {
        fs.writeFileSync(readmePath, content, 'utf8');
        console.log(`README 徽章已更新: version=${version}, protocol=${protocol}, tests=${tests}`);
    } else {
        console.log(`README 徽章已是一致: version=${version}, protocol=${protocol}, tests=${tests}`);
    }
}

main();

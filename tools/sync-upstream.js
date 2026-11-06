#!/usr/bin/env node
/**
 * 上游同步甄别助手：把「逐提交甄别上游更新」的手工流程固化成报告。
 *
 * 背景：本地仓库与上游 liyangpengs/qq-farm-bot 历史不相关，无法直接 merge/比较，
 * 只能逐提交判断「这个改动本地是否已有」。本脚本自动做三件事：
 *   1. fetch upstream，列出未甄别过的上游提交（已甄别记录存在 tools/.sync-upstream-reviewed.json）
 *   2. 对每个提交做双重甄别：
 *        a. patch-id 精确比对（改动完全一致 → 已存在）
 *        b. 特征行比对：取提交中"有信息量"的新增行（排除 import/注释/纯符号），
 *           在本地对应文件中 grep，按命中率分类
 *   3. 输出三档报告：已存在 / 建议合入 / 待人工确认
 *
 * 用法：
 *   node tools/sync-upstream.js                  # fetch upstream + 输出甄别报告
 *   node tools/sync-upstream.js --limit 30       # 最多甄别最近 30 个提交
 *   node tools/sync-upstream.js --mark-done sha  # 手工确认后标记为已处理
 *   node tools/sync-upstream.js --pick sha       # cherry-pick 指定提交并立即跑全量测试
 *   node tools/sync-upstream.js --show sha       # 查看某提交完整 diff
 *
 * 注意：--pick 只是执行 cherry-pick，遇到冲突会停下并显示状态，绝不自动改代码。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, '.sync-upstream-reviewed.json');
const UPSTREAM_REMOTE = 'upstream';
const UPSTREAM_BRANCH = 'master';

function git(args, opts = {}) {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { reviewed: {} };
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function fetchUpstream() {
    console.log(`正在 fetch ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} ...`);
    try {
        git(['fetch', UPSTREAM_REMOTE, UPSTREAM_BRANCH], { stdio: 'inherit' });
        return true;
    } catch (error) {
        console.error('fetch 失败（可能网络问题），改用本地已有的 upstream 数据');
        return false;
    }
}

function listUpstreamCommits(limit) {
    const out = git(['log', `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`, '-n', String(limit), '--format=%H%x00%h%x00%ad%x00%s', '--date=short']);
    return out.trim().split('\n').filter(Boolean).map(line => {
        const [hash, short, date, subject] = line.split('\0');
        return { hash, short, date, subject };
    });
}

function localPatchIds() {
    // 全部本地提交的 patch-id 集合（历史不相关也能算）
    const lines = git(['log', 'main', '--format=%H', '--max-count=2000']).trim().split('\n').filter(Boolean);
    const ids = new Set();
    for (const hash of lines) {
        try {
            const patchId = git(['show', hash, '--format='], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            const out = execSync('git patch-id --stable', { cwd: repoRoot, input: patchId, encoding: 'utf8' });
            const id = out.split(' ')[0];
            if (id) ids.add(id);
        } catch {
            // 空提交等跳过
        }
    }
    return ids;
}

function isMeaningfulLine(line) {
    const t = line.trim();
    if (t.length < 12) return false;
    if (/^\+import\s/.test(t) || /^\+const .*require\(/.test(t)) return false;
    if (/^(\+)?\s*[{}()/*;,\s]*$/.test(t)) return false;
    if (/^\+\s*(\/\/|\*|\/\*)/.test(t)) return false;
    if (/^\+\s*(interface|type)\s/.test(t) && /=/.test(t) === false) return false;
    return true;
}

function analyzeCommit(commit, localPatchIds) {
    const diff = git(['show', commit.hash, '--format=', '--unified=0']);
    const changedFiles = git(['show', commit.hash, '--format=', '--name-only']).trim().split('\n').filter(Boolean);

    // a. patch-id 精确比对
    try {
        const out = execSync('git patch-id --stable', { cwd: repoRoot, input: diff, encoding: 'utf8' });
        const id = out.split(' ')[0];
        if (id && localPatchIds.has(id)) {
            return { verdict: '已存在(完全一致)', confidence: 1, hitRatio: 1, checked: 0, changedFiles };
        }
    } catch { /* patch-id 失败则走特征行比对 */ }

    // b. 特征行比对
    const lines = diff.split('\n');
    const added = [];
    for (const line of lines) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        if (isMeaningfulLine(line)) added.push(line.slice(1));
    }
    let checked = 0;
    let hit = 0;
    for (const text of added.slice(0, 60)) {
        try {
            const hits = execFileSync('git', ['grep', '-F', '-l', '--', text], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
            checked++;
            if (hits.trim()) hit++;
        } catch {
            checked++; // git grep 无命中以非零退出
        }
    }
    const ratio = checked ? hit / checked : 0;
    let verdict;
    if (checked === 0) verdict = '待人工确认(无可比对特征行，可能全是新文件/格式改动)';
    else if (ratio >= 0.7) verdict = '已存在(疑似,比例高)';
    else if (ratio >= 0.3) verdict = '待人工确认(部分命中)';
    else verdict = '建议合入';
    return { verdict, confidence: ratio, hitRatio: ratio, checked, addedCount: added.length, changedFiles };
}

function doPick(sha) {
    console.log(`cherry-pick ${sha} ...`);
    try {
        git(['cherry-pick', sha], { stdio: 'inherit' });
        console.log('cherry-pick 成功，运行全量测试...');
        const out = execSync('node --test tests/*.test.js', { cwd: path.join(repoRoot, 'core'), encoding: 'utf8', timeout: 300000, stdio: 'pipe' });
        const m = out.match(/# pass (\d+)/);
        const f = out.match(/# fail (\d+)/);
        console.log(`测试结果: pass=${m ? m[1] : '?'} fail=${f ? f[1] : '?'}`);
        if (f && Number(f[1]) > 0) {
            console.log('有测试失败，先看失败详情再决定保留或 `git cherry-pick --skip/abort`');
        }
    } catch (error) {
        console.error('cherry-pick 未完成（可能冲突或测试失败），请人工检查：');
        console.error('  git status / git diff --stat 查看；解决后 git cherry-pick --continue，或 git cherry-pick --abort 放弃');
    }
}

function main() {
    const args = process.argv.slice(2);
    const getArg = (name) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : null;
    };

    if (args.includes('--pick')) return doPick(getArg('--pick'));
    if (args.includes('--show')) {
        console.log(git(['show', getArg('--show')]));
        return;
    }

    const state = loadState();
    if (args.includes('--mark-done')) {
        const sha = getArg('--mark-done');
        state.reviewed[sha] = { markedAt: new Date().toISOString(), by: 'manual' };
        saveState(state);
        console.log(`已标记 ${sha}`);
        return;
    }

    fetchUpstream();
    const limit = Number(getArg('--limit') || 20);
    const commits = listUpstreamCommits(limit);
    const localIds = localPatchIds();

    console.log(`\n上游最近 ${commits.length} 个提交，甄别报告：\n`);
    let pending = 0;
    for (const commit of commits) {
        if (state.reviewed[commit.hash]) continue;
        pending++;
        const report = analyzeCommit(commit, localIds);
        const files = report.changedFiles.map(f => `      ${f}`).join('\n');
        console.log(`[${report.verdict}] ${commit.short} ${commit.date} ${commit.subject}`);
        console.log(`      特征行命中: ${report.hitRatio !== undefined ? Math.round(report.hitRatio * 100) + '%' : '-'} (${report.checked || 0} 行比对)`);
        console.log(`      改动文件:\n${files}`);
        if (report.verdict.startsWith('建议合入')) {
            console.log(`      → 核对后执行: node tools/sync-upstream.js --pick ${commit.short}`);
        }
        console.log('');
    }
    if (pending === 0) console.log('没有新的未甄别提交。');

    console.log('提示：甄别过的提交用 --mark-done sha 记录，下次报告不再出现。');
}

main();

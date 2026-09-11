#!/usr/bin/env node
/**
 * XCimoc 漫画源可用性测试程序。
 *
 * 按 App 的真实调用链（搜索 → 详情 → 章节 → 图片）测试 index.json 中的每个源，
 * 生成状态数据供 GitHub Pages（docs/index.html）展示，也可本地运行排查某个源。
 *
 * 用法：
 *   cd status && npm install          # 安装 cheerio（需 Node >= 18）
 *   node test_sources.mjs             # 测试全部源并写入 ../docs/status.json
 *   node test_sources.mjs --only baozi,copymh --verbose
 *   node test_sources.mjs --json      # 只打印结果 JSON，不写文件
 *
 * 选项：
 *   --only <list>       只测试指定源：type 数字或源文件名（逗号分隔，如 baozi,101）
 *   --exclude <list>    排除指定源（同 --only 格式）
 *   --keyword <kw>      搜索测试关键词（默认「漫画」）
 *   --concurrency <n>   并发测试的源数量（默认 4）
 *   --timeout <ms>      单个 HTTP 请求超时（默认 30000）
 *   --out <file>        状态 JSON 输出路径（默认 ../docs/status.json）
 *   --no-write          只测试不写入文件（适合本地试跑）
 *   --json              打印完整 JSON 到 stdout（不写文件）
 *   --verbose           打印每个源的步骤明细
 *   -h, --help          显示帮助
 *
 * 内部参数（供本程序自身调度，请勿直接使用）：
 *   --single <type>     测试单个源并向 stdout 输出一行 JSON 结果
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSource } from './lib/runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // xcimoc-js-sources/
const INDEX_PATH = join(ROOT, 'index.json');
const SDK_PATH = join(ROOT, 'source_sdk.js');
const DEFAULT_OUT = join(ROOT, 'docs', 'status.json');

const ICON = { ok: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
const LABEL = { ok: '可用', warn: '部分可用', fail: '失败', skip: '跳过' };
const STEP_LABEL = { search: '搜索', info: '详情', chapter: '章节', images: '图片' };

/* Windows 控制台代码页默认可能是 GBK，会把 UTF-8 中文输出显示为乱码；
 * 仅在交互终端里静默切换为 UTF-8（幂等，GitHub Actions / Linux 不受影响）。 */
function ensureUtf8Console() {
    if (process.platform !== 'win32' || !process.stdout.isTTY) return;
    try {
        // 注意：shell + args 数组在 Node 24 已弃用，这里用整条命令字符串
        spawnSync('chcp 65001', { stdio: 'ignore', shell: true, windowsHide: true });
    } catch (e) {
        /* 忽略：未安装 chcp 等异常场景 */
    }
}

/* ---------------- 参数解析 ---------------- */

function parseArgs(argv) {
    const opts = {
        only: [],
        exclude: [],
        keyword: '漫画',
        concurrency: 4,
        timeout: 30000,
        out: DEFAULT_OUT,
        json: false,
        noWrite: false,
        verbose: false,
        single: null,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        switch (a) {
            case '--only': opts.only.push(...String(next() || '').split(',')); break;
            case '--exclude': opts.exclude.push(...String(next() || '').split(',')); break;
            case '--keyword': opts.keyword = String(next() || '漫画'); break;
            case '--concurrency': opts.concurrency = Math.max(1, Number(next()) || 4); break;
            case '--timeout': opts.timeout = Math.max(1000, Number(next()) || 30000); break;
            case '--out': opts.out = String(next() || DEFAULT_OUT); break;
            case '--no-write': opts.noWrite = true; break;
            case '--json': opts.json = true; break;
            case '--verbose': opts.verbose = true; break;
            case '--single': opts.single = String(next() || ''); break;
            case '-h':
            case '--help': opts.help = true; break;
            default:
                if (a.startsWith('--')) console.error('未知参数: ' + a);
                break;
        }
    }
    opts.only = opts.only.map((s) => s.trim()).filter(Boolean);
    opts.exclude = opts.exclude.map((s) => s.trim()).filter(Boolean);
    return opts;
}

function printHelp() {
    const text = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const m = /\/\*\*([\s\S]*?)\*\//.exec(text);
    if (m) {
        console.log(m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
    }
}

/* ---------------- 源筛选 ---------------- */

function matchesToken(entry, token) {
    if (/^\d+$/.test(token)) return entry.type === Number(token);
    const file = entry.url.split('/').pop();
    const stem = file.replace(/\.js$/, '');
    return token === entry.url || token === file || token === stem;
}

function selectEntries(index, opts) {
    let list = index.sources;
    if (opts.only.length > 0) {
        list = list.filter((e) => opts.only.some((t) => matchesToken(e, t)));
    }
    if (opts.exclude.length > 0) {
        list = list.filter((e) => !opts.exclude.some((t) => matchesToken(e, t)));
    }
    return list;
}

/* ---------------- 单源模式（子进程） ---------------- */

function runSingle(opts) {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const entry = index.sources.find((e) => String(e.type) === opts.single)
        || index.sources.find((e) => matchesToken(e, opts.single));

    let result;
    if (!entry) {
        result = {
            type: Number(opts.single),
            title: '未知源',
            version: null,
            url: null,
            status: 'fail',
            error: 'index.json 中不存在该源: ' + opts.single,
            durationMs: 0,
            steps: [],
            logs: [],
        };
    } else {
        const sdk = readFileSync(SDK_PATH, 'utf8');
        try {
            result = testSource({ root: ROOT, sdk, entry, keyword: opts.keyword, timeoutMs: opts.timeout });
        } catch (e) {
            result = {
                type: entry.type,
                title: entry.title,
                version: entry.version || null,
                url: entry.url,
                status: 'fail',
                error: '测试程序异常: ' + ((e && e.stack) || e),
                durationMs: 0,
                steps: [],
                logs: [],
            };
        }
    }
    // 单行 JSON 输出给主进程
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
}

/* ---------------- 主模式：并发调度 ---------------- */

function spawnSingle(entry, opts) {
    return new Promise((resolve) => {
        const args = [
            fileURLToPath(import.meta.url),
            '--single', String(entry.type),
            '--keyword', opts.keyword,
            '--timeout', String(opts.timeout),
        ];
        let child;
        try {
            child = spawn(process.execPath, args, {
                cwd: __dirname,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            return resolve(failResult(entry, '子进程启动失败: ' + e.message));
        }

        const t0 = Date.now();
        let stdout = '';
        let stderr = '';
        let killed = false;
        // 兜底硬超时：单源最多 ~5 次请求 + 引擎开销
        const hardMs = opts.timeout * 8 + 60000;
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (e) { /* 忽略 */ }
        }, hardMs);

        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve(failResult(entry, '子进程错误: ' + e.message));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (killed) {
                return resolve(failResult(entry, '测试超时（>' + Math.round(hardMs / 1000) + 's）', Date.now() - t0));
            }
            const line = stdout.trim().split('\n').pop();
            if (!line) {
                const tail = stderr ? ' :: ' + stderr.trim().split('\n').slice(-3).join(' | ') : '';
                return resolve(failResult(entry, '测试进程无输出（exit=' + code + '）' + tail, Date.now() - t0));
            }
            try {
                resolve(JSON.parse(line));
            } catch (e) {
                resolve(failResult(entry, '结果解析失败: ' + e.message + ' :: ' + line.slice(0, 200), Date.now() - t0));
            }
        });
    });
}

function failResult(entry, error, ms) {
    return {
        type: entry.type,
        title: entry.title,
        version: entry.version || null,
        url: entry.url,
        baseUrl: entry.baseUrl || null,
        status: 'fail',
        error,
        durationMs: ms || 0,
        steps: [],
        logs: [],
    };
}

async function runPool(entries, concurrency, task) {
    const results = new Array(entries.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
        for (; ;) {
            const idx = cursor++;
            if (idx >= entries.length) return;
            results[idx] = await task(entries[idx]);
            console.log(formatLine(results[idx]));
        }
    });
    await Promise.all(workers);
    return results;
}

/* ---------------- 输出 ---------------- */

function formatLine(r) {
    const icon = ICON[r.status] || '❓';
    const time = r.durationMs ? ' ' + (r.durationMs / 1000).toFixed(1) + 's' : '';
    let extra = '';
    if (r.error) extra = ' — ' + r.error;
    else if (r.status === 'ok') extra = ' — 全部步骤通过';
    return icon + ' ' + r.title + ' (type ' + r.type + ')' + time + extra;
}

function formatVerbose(r) {
    const lines = [];
    for (const s of r.steps) {
        const icon = s.status === 'ok' ? '  ✓' : s.status === 'fail' ? '  ✗' : s.status === 'warn' ? '  !' : '  -';
        const parts = [STEP_LABEL[s.name] || s.name, s.status];
        if (s.ms) parts.push(Math.round(s.ms) + 'ms');
        if (s.http) parts.push('HTTP ' + s.http);
        if (s.detail) parts.push(s.detail);
        if (s.error) parts.push(s.error);
        lines.push(icon + ' ' + parts.join(' · '));
    }
    for (const l of r.logs || []) lines.push('    [log] ' + l);
    return lines.join('\n');
}

function summarize(results) {
    const summary = { total: results.length, ok: 0, warn: 0, fail: 0, skip: 0 };
    for (const r of results) {
        if (summary[r.status] !== undefined) summary[r.status]++;
    }
    return summary;
}

/* ---------------- 入口 ---------------- */

async function main() {
    ensureUtf8Console();
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printHelp();
        return 0;
    }
    if (opts.single) {
        return runSingle(opts);
    }
    if (!existsSync(INDEX_PATH)) {
        console.error('未找到 index.json: ' + INDEX_PATH);
        return 1;
    }

    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const entries = selectEntries(index, opts);
    if (entries.length === 0) {
        console.error('没有匹配的源（检查 --only/--exclude）');
        return 1;
    }

    const t0 = Date.now();
    console.log('XCimoc 漫画源状态测试');
    console.log('源数量: ' + entries.length + '，关键词「' + opts.keyword + '」，并发 ' + opts.concurrency
        + '，单请求超时 ' + opts.timeout + 'ms');
    if (entries.length > 0 && opts.only.length + opts.exclude.length > 0) {
        console.log('筛选: ' + entries.map((e) => e.title + '(' + e.type + ')').join(', '));
    }
    console.log('');

    const results = await runPool(entries, opts.concurrency, (entry) => spawnSingle(entry, opts));

    const totalMs = Date.now() - t0;
    const summary = summarize(results);

    /* 按 index.json 顺序（即 type 顺序）排列，便于 diff */
    const ordered = entries.map((e) => results.find((r) => r.type === e.type)).filter(Boolean);

    console.log('');
    console.log('结果: ✅ ' + summary.ok + ' 可用 / ⚠️ ' + summary.warn + ' 部分可用 / ❌ ' + summary.fail
        + ' 失败 / ⏭️ ' + summary.skip + ' 跳过（共 ' + summary.total + '，用时 ' + (totalMs / 1000).toFixed(1) + 's）');

    const failed = ordered.filter((r) => r.status === 'fail' || r.status === 'warn');
    if (opts.verbose) {
        for (const r of ordered) {
            console.log('');
            console.log(ICON[r.status] + ' ' + r.title + ' (type ' + r.type + ')');
            console.log(formatVerbose(r));
        }
    } else if (failed.length > 0) {
        console.log('');
        for (const r of failed) {
            console.log(ICON[r.status] + ' ' + r.title + ': ' + (r.error || '存在未通过的步骤'));
        }
    }

    const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        keyword: opts.keyword,
        runner: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local',
        node: process.version,
        durationMs: totalMs,
        summary,
        sources: ordered,
    };

    if (opts.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        return 0;
    }

    if (opts.noWrite) {
        console.log('');
        console.log('（--no-write：未写入文件）');
        return 0;
    }

    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log('');
    console.log('状态数据已写入: ' + opts.out);
    return 0;
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error('测试程序异常: ' + ((e && e.stack) || e));
        process.exit(1);
    });

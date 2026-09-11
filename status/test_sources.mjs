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
 *   --keyword <kw>      搜索测试关键词（默认「漫画」，可被测试数据文件覆盖）
 *   --data <file>       自定义测试数据文件（默认 status/test_data.json；不存在则按默认流程）
 *   --no-data           禁用自定义测试数据（完全按默认流程）
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
 *   --case <json>       单个源的自定义测试数据（主进程从 --data 文件解析后传入）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSource, normalizeCase } from './lib/runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // xcimoc-js-sources/
const INDEX_PATH = join(ROOT, 'index.json');
const SDK_PATH = join(ROOT, 'source_sdk.js');
const DEFAULT_OUT = join(ROOT, 'docs', 'status.json');
const DEFAULT_DATA = join(__dirname, 'test_data.json');

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
        keyword: null,
        concurrency: 4,
        timeout: 30000,
        out: DEFAULT_OUT,
        data: DEFAULT_DATA,
        dataExplicit: false,
        noData: false,
        caseJson: null,
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
            case '--keyword': opts.keyword = String(next() || '').trim() || null; break;
            case '--data': opts.data = String(next() || DEFAULT_DATA); opts.dataExplicit = true; break;
            case '--no-data': opts.noData = true; break;
            case '--case': opts.caseJson = String(next() || ''); break;
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

/* ---------------- 测试数据（test_data.json） ---------------- */

/**
 * 读取自定义测试数据文件；未提供/不存在（且未显式指定）时返回空配置，
 * 所有源按默认流程测试。
 *
 * 文件结构：
 * {
 *   "defaults": { "keyword": "漫画" },
 *   "sources": {
 *     "0": { "keyword": "海贼王" },
 *     "12": { "cid": "594697", "chapterPath": "46350", "note": "固定测试样章" },
 *     "49": { "skipSearch": true, "cid": "106327" }
 *   }
 * }
 * sources 的键为源 type；字段含义见 lib/runner.mjs 头部注释。
 */
function loadTestData(opts) {
    const empty = { file: null, keyword: null, count: 0, caseOf: () => null };
    if (opts.noData || !opts.data) return empty;
    if (!existsSync(opts.data)) {
        if (opts.dataExplicit) throw new Error('测试数据文件不存在: ' + opts.data);
        return empty;
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(opts.data, 'utf8'));
    } catch (e) {
        throw new Error('测试数据文件解析失败: ' + opts.data + ' :: ' + e.message);
    }
    const sources = (raw && typeof raw.sources === 'object' && raw.sources) || {};
    const cases = new Map();
    for (const key of Object.keys(sources)) {
        const c = normalizeCase(sources[key]);
        if (c) cases.set(String(key).trim(), c);
    }
    const keyword = raw && raw.defaults && typeof raw.defaults.keyword === 'string' && raw.defaults.keyword.trim()
        ? raw.defaults.keyword.trim()
        : null;
    return {
        file: opts.data,
        keyword,
        count: cases.size,
        caseOf(entry) {
            return cases.get(String(entry.type)) || null;
        },
    };
}

/* ---------------- 单源模式（子进程） ---------------- */

function runSingle(opts) {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const entry = index.sources.find((e) => String(e.type) === opts.single)
        || index.sources.find((e) => matchesToken(e, opts.single));

    /* 自定义测试数据由主进程通过 --case 传入（JSON 文本） */
    let testCase = null;
    if (opts.caseJson) {
        try {
            testCase = normalizeCase(JSON.parse(opts.caseJson));
        } catch (e) {
            /* 非法 JSON：按无自定义数据处理 */
        }
    }

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
            case: testCase,
        };
    } else {
        const sdk = readFileSync(SDK_PATH, 'utf8');
        try {
            result = testSource({
                root: ROOT,
                sdk,
                entry,
                keyword: opts.keyword || '漫画',
                timeoutMs: opts.timeout,
                testCase,
            });
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
                case: testCase,
            };
        }
    }
    // 单行 JSON 输出给主进程
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
}

/* ---------------- 主模式：并发调度 ---------------- */

function spawnSingle(entry, opts, testCase) {
    return new Promise((resolve) => {
        /* 统一出口：补上自定义测试数据标记（子进程异常时页面上仍能看到） */
        const done = (r) => {
            if (testCase && !r.case) r.case = testCase;
            resolve(r);
        };
        const args = [
            fileURLToPath(import.meta.url),
            '--single', String(entry.type),
            '--keyword', opts.keyword,
            '--timeout', String(opts.timeout),
        ];
        if (testCase) args.push('--case', JSON.stringify(testCase));
        let child;
        try {
            child = spawn(process.execPath, args, {
                cwd: __dirname,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            return done(failResult(entry, '子进程启动失败: ' + e.message));
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
            done(failResult(entry, '子进程错误: ' + e.message));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (killed) {
                return done(failResult(entry, '测试超时（>' + Math.round(hardMs / 1000) + 's）', Date.now() - t0));
            }
            const line = stdout.trim().split('\n').pop();
            if (!line) {
                const tail = stderr ? ' :: ' + stderr.trim().split('\n').slice(-3).join(' | ') : '';
                return done(failResult(entry, '测试进程无输出（exit=' + code + '）' + tail, Date.now() - t0));
            }
            try {
                done(JSON.parse(line));
            } catch (e) {
                done(failResult(entry, '结果解析失败: ' + e.message + ' :: ' + line.slice(0, 200), Date.now() - t0));
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

    let testData;
    try {
        testData = loadTestData(opts);
    } catch (e) {
        console.error(String((e && e.message) || e));
        return 1;
    }
    const keyword = opts.keyword || testData.keyword || '漫画';
    opts.keyword = keyword;

    const t0 = Date.now();
    console.log('XCimoc 漫画源状态测试');
    console.log('源数量: ' + entries.length + '，关键词「' + keyword + '」，并发 ' + opts.concurrency
        + '，单请求超时 ' + opts.timeout + 'ms');
    if (testData.file) {
        console.log('测试数据: ' + relative(ROOT, testData.file).replace(/\\/g, '/') + '（' + testData.count + ' 个源使用自定义数据）');
    }
    if (entries.length > 0 && opts.only.length + opts.exclude.length > 0) {
        console.log('筛选: ' + entries.map((e) => e.title + '(' + e.type + ')').join(', '));
    }
    console.log('');

    const results = await runPool(entries, opts.concurrency, (entry) => spawnSingle(entry, opts, testData.caseOf(entry)));

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
        keyword,
        dataFile: testData.file ? relative(ROOT, testData.file).replace(/\\/g, '/') : null,
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

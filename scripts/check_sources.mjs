#!/usr/bin/env node
/**
 * 全量检查所有源的方法返回结构是否契合宿主契约（JsMangaParser）。
 * 对「无需 html 的方法」（getXxxRequest/getUrl/getHeader/getCategories/getSettings/
 * getLoginState/getCategoryRequest）在 vm 沙箱真实调用并校验（installSource 已套 schema）；
 * 对「需要 html 的方法」（parseSearch/parseInfo/parseChapter/parseImages/parseCategory）
 * 做源码静态扫描，报告图片项用的是 url（主格式）还是仅 urls，以及是否有明显缺失。
 *
 * 用法: node scripts/check_sources.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_PATH = join(ROOT, 'source_sdk.js');
const SDK = existsSync(SDK_PATH) ? readFileSync(SDK_PATH, 'utf8') : '';

function loadIndex() {
    return JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
}

const sandboxBase = {
    console,
    SOURCE: undefined,
    hostCall: (method) => {
        // 计算类已纯 JS 化；仅需 log/DOM/state 等宿主能力 stub
        switch (method) {
            case 'dom': return JSON.stringify({ id: -1 });
            default: return 'null'; // log/state/setting/login/fetch...
        }
    },
    fetch: () => { throw new Error('fetch stub'); },
};

// 无需 html 即可真实调用的方法，及其代表性参数
const CALLABLE = [
    ['getSearchRequest', ['测试', 1]],
    ['getInfoRequest', ['x']],
    ['getImagesRequest', ['x', 'p']],
    ['getLazyRequest', ['http://x.example/1']],
    ['getCheckRequest', ['x']],
    ['getUrl', ['x']],
    ['getHeader', []],
    ['getCategoryRequest', ['{"subject":"a","page":"1"}', 1]],
    ['getSettings', []],
    ['getLoginState', []],
    ['getCategories', []],
];

// 源码静态扫描 parseXxx 里的图片字段
function scanParseImages(src) {
    const start = src.indexOf('parseImages');
    if (start < 0) return { has: false };
    const seg = src.slice(start, start + 4000);
    const hasUrlField = /(?:push|return)\s*\(\s*\{\s*[^}]*?\burl\s*:/.test(seg);
    const hasUrlsField = /\burls\s*:/.test(seg);
    const hasLazy = /\blazy\s*:/.test(seg);
    return { has: true, hasUrlField, hasUrlsField, hasLazy };
}

let problems = 0;
const index = loadIndex();

for (const entry of index.sources) {
    const file = join(ROOT, entry.url);
    const name = entry.url.split('/').pop();
    if (!existsSync(file)) { console.log(`❌ ${entry.title}: 文件缺失`); problems++; continue; }
    const script = readFileSync(file, 'utf8');
    const ctx = vm.createContext({ ...sandboxBase });
    try {
        vm.runInContext(SDK + '\n' + script, ctx, { filename: name });
    } catch (e) {
        console.log(`❌ ${entry.title} (${name}): 加载失败 ${e.message}`);
        problems++;
        continue;
    }

    const issues = [];
    // 1) 可调用方法：校验返回结构（installSource 已套 schema，null/[] 即表示可能异常）
    for (const [fn, args] of CALLABLE) {
        if (typeof ctx[fn] !== 'function') continue;
        let r;
        try { r = ctx[fn](...args); }
        catch (e) { issues.push(`${fn} 抛异常: ${e.message}`); continue; }
        if (fn === 'getHeader') {
            if (r === null) issues.push('getHeader 返回 null（宿主需容忍，已修）');
        } else if (fn === 'getUrl' || fn === 'getLazyRequest') {
            if (r === null) issues.push(`${fn} 返回 null`);
        } else if (fn.endsWith('Request') || fn === 'getCategoryRequest') {
            if (r === null) issues.push(`${fn} 返回 null`);
            else if (typeof r !== 'object' || !r.url) issues.push(`${fn} 返回缺 url`);
        } else if (fn === 'getCategories') {
            if (r === null) issues.push('getCategories 返回 null');
        } else if (fn === 'getSettings') {
            if (r !== null && !Array.isArray(r)) issues.push('getSettings 非数组');
        } else if (fn === 'getLoginState') {
            if (r !== null && typeof r !== 'object') issues.push('getLoginState 非对象');
        }
    }

    // 2) 静态扫描 parseImages 图片字段
    const img = scanParseImages(script);
    if (img.has && img.hasUrlField === false && img.hasUrlsField === false) {
        issues.push('parseImages 图片项可能缺 url/urls');
    }
    const imgNote = img.has ? (img.hasUrlField ? 'url主' : (img.hasUrlsField ? '仅urls' : '未知')) : '';

    if (issues.length) {
        console.log(`⚠️ ${entry.title} (${name}): ${issues.join('; ')}`);
        problems++;
    } else {
        console.log(`✅ ${entry.title} (${name})  [parseImages: ${imgNote || '无'}]`);
    }
}

console.log(`\n结果: ${problems === 0 ? '全部正常' : problems + ' 个源有待关注'}`);
process.exit(0);

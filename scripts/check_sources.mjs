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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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

// 取源实例上真实覆写方法的源码文本。
// 不走「文本正则找方法边界」：缩进（2 空格/Tab/一行多方法）、注释里同名方法等都会让
// 行首锚定失效；brace 配对又要自己处理字符串/注释/正则里的花括号。
// 这里直接取沙箱中已加载的函数对象再 Function.prototype.toString()：
//   - 不受任何格式化影响；
//   - 必须从 SOURCE 实例取（installSource 暴露到全局的是 schema 包装函数，toString 只有包装层）；
//   - 与基类比对，未覆写（继承 MangaSource 默认空实现）返回 null。
function methodSource(ctx, name) {
    const fn = ctx.SOURCE ? ctx.SOURCE[name] : null;
    if (typeof fn !== 'function') return null;
    const base = ctx.MangaSource && ctx.MangaSource.prototype
        ? ctx.MangaSource.prototype[name] : null;
    if (base === fn) return null; // 未覆写（继承基类空实现）
    return Function.prototype.toString.call(fn);
}

// 源码静态扫描 parseImages 里的图片字段
function scanParseImages(ctx) {
    const seg = methodSource(ctx, 'parseImages');
    if (seg === null) return { has: false };
    // 覆盖常见构造形态：push({...}) / return {...} / return ({...}) / return [{...}] / => [{...}]
    const hasUrlField = /(?:push|return|=>)\s*(?:\(\s*)?(?:\[\s*)?\{[^}]*?\burl\s*:/.test(seg);
    const hasUrlsField = /\burls\s*:/.test(seg);
    const hasLazy = /\blazy\s*:/.test(seg);
    return { has: true, hasUrlField, hasUrlsField, hasLazy };
}

// 检查单个源：加载 → 可调用方法校验 → parseImages 静态扫描。
// 返回 { title, name, missing?, loadError?, issues, img }；CLI 与自测脚本均可复用。
export function checkSource(entry) {
    const file = join(ROOT, entry.url);
    const name = entry.url.split('/').pop();
    if (!existsSync(file)) return { title: entry.title, name, missing: true, issues: [] };
    const script = readFileSync(file, 'utf8');
    const ctx = vm.createContext({ ...sandboxBase });
    try {
        vm.runInContext(SDK + '\n' + script, ctx, { filename: name });
    } catch (e) {
        return { title: entry.title, name, loadError: e.message, issues: [] };
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

    // 2) 静态扫描 parseImages 图片字段（从沙箱里的真实函数对象取源码，见 methodSource）
    const img = scanParseImages(ctx);
    if (img.has && img.hasUrlField === false && img.hasUrlsField === false) {
        issues.push('parseImages 图片项可能缺 url/urls');
    }

    return { title: entry.title, name, issues, img };
}

function main() {
    let problems = 0;
    const index = loadIndex();
    for (const entry of index.sources) {
        const r = checkSource(entry);
        if (r.missing) { console.log(`❌ ${r.title}: 文件缺失`); problems++; continue; }
        if (r.loadError) { console.log(`❌ ${r.title} (${r.name}): 加载失败 ${r.loadError}`); problems++; continue; }
        const imgNote = r.img.has ? (r.img.hasUrlField ? 'url主' : (r.img.hasUrlsField ? '仅urls' : '未知')) : '';
        if (r.issues.length) {
            console.log(`⚠️ ${r.title} (${r.name}): ${r.issues.join('; ')}`);
            problems++;
        } else {
            console.log(`✅ ${r.title} (${r.name})  [parseImages: ${imgNote || '无'}]`);
        }
    }
    console.log(`\n结果: ${problems === 0 ? '全部正常' : problems + ' 个源有待关注'}`);
    return problems;
}

// 直接运行（node scripts/check_sources.mjs）时执行检查；被 import 时只导出函数，便于自测。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
    process.exit(0);
}

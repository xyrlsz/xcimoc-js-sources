#!/usr/bin/env node
/**
 * 校验 source_sdk.js 的「返回结构 Schema 校验」层：
 *   - 对非法/类型不符的返回做纠正（数字→字符串、字符串→布尔）；
 *   - 对无法纠正的返回安全默认值（null / []）；
 *   - 不削弱正常源的输出。
 * 用法: node scripts/check_schema.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = readFileSync(join(ROOT, 'source_sdk.js'), 'utf8');

const sandbox = {
    console,
    SOURCE: undefined,
    hostCall: (method) => {
        // 计算类已纯 JS 化；仅 log 会被校验器触发，返回 'null' 即可。
        switch (method) {
            case 'log':
            case 'state':
            case 'setting':
            case 'login':
            case 'dom':
            default:
                return 'null';
        }
    },
    fetch: () => { throw new Error('fetch stub'); },
};
const ctx = vm.createContext(sandbox);

const script = `
var SOURCE = installSource(new (class extends MangaSource {
    getSearchRequest(){ return { url: 5 }; }               // 缺有效 url
    parseSearch(){ return [ { cid: 123, title: 't', cover: 5 }, { title: 'no cid' }, 'bad' ]; }
    // 图片项主格式为单数 url + lazy；urls 数组是可选扩展。缺 url/urls 的项丢弃。
    parseImages(){ return [ { url: 'http://a', lazy: true }, { urls: ['a', 5] }, { url: 7 }, { foo: 1 }, { urls: [] } ]; }
    // chapters 不逐项强制 title/path（宿主 parseChapter/toChapters 自行处理）
    parseInfo(){ return { title: 123, chapters: [ { title: 'c1' }, { title: 'c2', path: 5 } ] }; }
    // 章节项只要求非空 path；title 可空保留、group 保留
    parseChapter(){ return [ { title: 'c', path: 'p', group: 'g' }, { title: 'no path' }, { path: 'p2' } ]; }
    login(){ return { success: 'yes' }; }                  // success 非布尔
    parseLazy(){ return 123; }                             // 非字符串
    parseCategory(){ return 'nope'; }                      // 非数组
    getHeader(){ return 7; }                               // 非对象
    getSettings(){ return [ { key: 'a' }, 'bad', { label: 'x' } ]; }
})());
`;

vm.runInContext(SDK + '\n' + script, ctx);

let pass = 0, fail = 0;
function eq(actual, expected, label) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log('✅ ' + label); pass++; }
    else { console.log('❌ ' + label + '\n   实际: ' + JSON.stringify(actual) + '\n   期望: ' + JSON.stringify(expected)); fail++; }
}

eq(ctx.getSearchRequest(), null, 'getSearchRequest 缺有效 url → null');

eq(ctx.parseSearch(), [{ cid: '123', title: 't', cover: '5' }],
    'parseSearch 纠正 cid/cover 类型 + 过滤缺 cid 与非法项');

eq(ctx.parseImages(),
    [{ url: 'http://a', lazy: true }, { urls: ['a', '5'] }, { url: '7' }],
    'parseImages 保留单数 url 项 + 纠正 url 类型 + 丢弃缺 url/urls 项');

eq(ctx.parseInfo(), { title: '123', chapters: [{ title: 'c1' }, { title: 'c2', path: 5 }] },
    'parseInfo 纠正 title + chapters 原样保留（不强制 title/path）');

eq(ctx.parseChapter(), [{ title: 'c', path: 'p', group: 'g' }, { path: 'p2' }],
    'parseChapter 保留无 title 但有效 path 的项 + 过滤缺 path 项');

eq(ctx.login(), { success: true }, 'login success 字符串 → 布尔');

eq(ctx.parseLazy(), null, 'parseLazy 非字符串 → null');

eq(ctx.parseCategory(), [], 'parseCategory 非数组 → []');

eq(ctx.getHeader(), null, 'getHeader 非对象 → null');

eq(ctx.getSettings(), [{ key: 'a' }], 'getSettings 过滤缺 key 与非法项');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

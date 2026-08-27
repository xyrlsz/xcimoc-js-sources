#!/usr/bin/env node
/**
 * 调试器核心逻辑自测（无需绑定端口/无需浏览器）：
 *   1. 全部源可加载并调用非网络方法
 *   2. DOM（cheerio 复刻 jsoup）解析路径
 *   3. 真实网络搜索流程（沙箱禁网时会标记失败，不影响 1/2）
 * 用法：cd debug && node selftest.mjs
 */
import { runSource, executeFlow, INDEX } from './server.mjs';

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('✅ ' + name);
  else { console.log('❌ ' + name + (detail ? ' :: ' + detail : '')); fail++; }
}

// 1. 全部源可加载
for (const s of INDEX.sources) {
  let r = runSource(s.url, 'getHeader', []);
  if (!r.ok && r.error && r.error.includes('未实现')) {
    r = runSource(s.url, 'getUrl', ['cid']);
  }
  ok('加载 ' + s.title + ' (type=' + s.type + ')', r.ok, r.error);
}

// 2. DOM 解析
const html = '<ul class="list"><li class="item"><a class="title" href="/a/1">漫画A</a><img src="/img/1.jpg"></li>'
  + '<li class="item"><a class="title" href="/a/2">漫画B</a><img src="/img/2.jpg"></li></ul>';
const domR = runSource('debug/fixtures/domtest.js', 'parseSearch', [html, 1]);
ok('DOM parseSearch 运行', domR.ok, domR.error);
if (domR.ok) {
  const list = domR.result;
  ok('DOM 条数=2', Array.isArray(list) && list.length === 2, JSON.stringify(list));
  ok('DOM 文本/属性提取', !!list[0]
    && list[0].title === '漫画A' && list[0].href === '/a/1' && list[0].src === '/img/1.jpg'
    && list[0].all === '漫画A', JSON.stringify(list && list[0]));
}

// 3. 真实网络搜索（沙箱可能禁网）
try {
  const flow = executeFlow('sources/hotmanga.js', 'search', { keyword: '海贼王', page: 1 });
  const fetchStep = flow.steps && flow.steps.find(s => s.step === 'fetch');
  const parseStep = flow.steps && flow.steps.find(s => s.step === 'parseSearch');
  ok('网络搜索 flow 完成', !!flow, JSON.stringify(flow && flow.error));
  ok('网络 fetch 状态', !!fetchStep && fetchStep.result && (fetchStep.result.status === 200 || fetchStep.result.status === 0),
    'status=' + (fetchStep && fetchStep.result && fetchStep.result.status) + ' err=' + (fetchStep && fetchStep.result && fetchStep.result.error));
  ok('网络 parseSearch 结果', !!parseStep && parseStep.ok,
    parseStep && (parseStep.error || ('count=' + (parseStep.result && parseStep.result.length))));
} catch (e) {
  ok('网络搜索（异常）', false, String((e && e.message) || e));
}

console.log(fail === 0 ? '\n自测全部通过' : '\n' + fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);

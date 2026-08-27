#!/usr/bin/env node
/**
 * XCimoc 动态漫画源 JS 调试器（本地 WebUI）
 *
 * 在 Node 的 vm 沙箱中执行 SDK + 指定源脚本，并用 cheerio（DOM）/ 子进程
 * 同步 fetch / 进程内 Map 复刻 App 的 JsHost（dom / fetch / state / setting /
 * login / log），从而在纯 Node 环境里调用源的 getXxxRequest / parseXxx 并查看
 * 请求、响应与解析结果 —— 便于在不装 APK / 不联网 App 的情况下调试漫画源 JS。
 *
 * 用法：
 *   cd debug
 *   npm install            # 安装 cheerio（需 Node >= 18，原生 fetch）
 *   npm start              # 或 node server.mjs
 *   浏览器打开 http://127.0.0.1:8787
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');        // xcimoc-js-sources/
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8977;
const HOST = process.env.HOST || '127.0.0.1';

const SDK = readFileSync(join(ROOT, 'source_sdk.js'), 'utf8');
const INDEX = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));

/* 跨调用持久态（进程内，按源 type 隔离；等价 App 的 JsHost 状态 / SharedPreferences） */
const stateMap = new Map();
const settingMap = new Map();
const loginMap = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------------- 同步 HTTP（子进程做真实 fetch） ---------------- */
function doFetch(req) {
  const url = req && req.url;
  if (!url) return { status: 0, headers: {}, setCookie: [], body: '', error: '缺少 url' };
  const payload = JSON.stringify({
    url,
    method: req.method || 'GET',
    headers: req.headers || {},
    body: req.body === undefined ? null : req.body,
    contentType: req.contentType || null,
  });
  const helper = join(__dirname, 'fetch-helper.mjs');
  try {
    const raw = execFileSync(process.execPath, [helper], {
      input: payload,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 120000,
    });
    return JSON.parse(raw);
  } catch (e) {
    return { status: 0, headers: {}, setCookie: [], body: '', error: 'fetch 失败: ' + ((e && e.message) || e) };
  }
}

/* ---------------- DOM（cheerio 复刻 jsoup 语义） ---------------- */
function handleDom(args, ctx) {
  const op = args.op;
  if (op === 'create') {
    const $ = cheerio.load(args.html || '');
    const id = ++ctx.nodeSeq;
    ctx.nodeMap.set(id, { $, el: $('body') }); // 对齐 Jsoup.parse(...).body()
    return JSON.stringify({ id });
  }
  const node = ctx.nodeMap.get(args.id);
  if (!node) return 'null';
  const $ = node.$;
  const sel = (args.sel === null || args.sel === undefined) ? null : args.sel;
  switch (op) {
    case 'select': {
      const out = [];
      node.el.find(sel).each((i, elem) => {
        const cid = ++ctx.nodeSeq;
        ctx.nodeMap.set(cid, { $, el: $(elem) });
        out.push(cid);
      });
      return JSON.stringify(out);
    }
    case 'text': {
      const t = sel ? node.el.find(sel).first() : node.el;
      if (t.length === 0) return 'null';
      return JSON.stringify(t.text().trim());
    }
    case 'attr': {
      const t = sel ? node.el.find(sel).first() : node.el;
      if (t.length === 0) return 'null';
      return JSON.stringify((t.attr(args.attr) || '').trim());
    }
    case 'href':
    case 'src': {
      const attr = op === 'href' ? 'href' : 'src';
      const t = sel ? node.el.find(sel).first() : node.el;
      if (t.length === 0) return 'null';
      const v = (t.attr(attr) || '').trim();
      return JSON.stringify(v ? v : null);
    }
    default:
      return 'null';
  }
}

/* ---------------- hostCall（复刻 JsHost.onHostCall） ---------------- */
function makeHostCall(ctx) {
  return function hostCall(name, argsJson) {
    let args = {};
    try { args = JSON.parse(argsJson || '{}'); } catch (e) {}
    switch (name) {
      case 'log':
        ctx.logs.push(String(args.data));
        return 'null';
      case 'dom':
        return handleDom(args, ctx);
      case 'fetch':
        return JSON.stringify(doFetch(args));
      case 'state': {
        const k = String(args.key);
        if (args.op === 'set') { stateMap.set(k, args.value == null ? 'null' : String(args.value)); return 'null'; }
        const v = stateMap.get(k);
        return v == null ? 'null' : v;
      }
      case 'setting': {
        const k = 'setting_' + (args.type | 0) + '_' + args.key;
        if (args.op === 'set') { settingMap.set(k, args.value == null ? 'null' : String(args.value)); return 'null'; }
        const v = settingMap.get(k);
        return v == null ? 'null' : JSON.stringify(v);
      }
      case 'login': {
        const k = 'login_' + (args.type | 0);
        if (args.op === 'set') { loginMap.set(k, args.value == null ? 'null' : String(args.value)); return 'null'; }
        if (args.op === 'clear') { loginMap.delete(k); return 'null'; }
        const v = loginMap.get(k);
        return v == null ? 'null' : JSON.stringify(v);
      }
      default:
        return 'null';
    }
  };
}

/* 源文件 → type（用于 __SOURCE_TYPE，让 setting/login 按源隔离） */
function sourceType(sourceFile) {
  const e = INDEX.sources.find(s => s.url === sourceFile);
  return e ? e.type : -1;
}

/* 在全新沙箱中加载 SDK + 源脚本，并调用一个方法（每次调用新建引擎，对齐 App） */
function runSource(sourceFile, method, args) {
  const file = join(ROOT, sourceFile);
  if (!existsSync(file)) return { ok: false, error: '源文件不存在: ' + sourceFile, logs: [] };
  const script = readFileSync(file, 'utf8');
  const ctx = { logs: [], nodeMap: new Map(), nodeSeq: 0 };
  const sandbox = {
    console: {
      log: (...a) => ctx.logs.push(a.join(' ')),
      info: (...a) => ctx.logs.push(a.join(' ')),
      warn: (...a) => ctx.logs.push('[warn] ' + a.join(' ')),
      error: (...a) => ctx.logs.push('[error] ' + a.join(' ')),
    },
    hostCall: makeHostCall(ctx),
    __SOURCE_TYPE: sourceType(sourceFile),
  };
  sandbox.globalThis = sandbox;
  const vctx = vm.createContext(sandbox);
  try {
    vm.runInContext(SDK + '\n' + script, vctx, { filename: sourceFile });
  } catch (e) {
    return { ok: false, error: '脚本加载失败: ' + ((e && e.message) || e), logs: ctx.logs };
  }
  const src = vctx.SOURCE;
  if (!src) return { ok: false, error: 'SOURCE 未定义（脚本可能未用 installSource）', logs: ctx.logs };
  if (typeof src[method] !== 'function') {
    return { ok: false, error: '方法 ' + method + ' 未实现', logs: ctx.logs };
  }
  try {
    const result = src[method].apply(src, args);
    return {
      ok: true,
      result: result === undefined ? null : result,
      logs: ctx.logs,
      meta: { type: src.type, title: src.title, baseUrl: src.baseUrl, source: sourceFile },
    };
  } catch (e) {
    return {
      ok: false,
      error: (e && e.message) || String(e),
      stack: e && e.stack,
      logs: ctx.logs,
      meta: { type: src.type, title: src.title, baseUrl: src.baseUrl, source: sourceFile },
    };
  }
}

/* 执行引导流程（模拟 App 的 getXxxRequest → fetch → parseXxx） */
function executeFlow(sourceFile, flow, params) {
  const steps = [];
  const P = (m, a) => { const r = runSource(sourceFile, m, a); steps.push({ step: m, ...r }); return r; };
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  try {
    if (flow === 'search') {
      const kw = params.keyword || '';
      const page = num(params.page, 1);
      const req = P('getSearchRequest', [kw, page]);
      if (req.ok && req.result) {
        const resp = doFetch(req.result);
        steps.push({ step: 'fetch', ok: true, result: { url: req.result.url, status: resp.status, body: resp.body, error: resp.error } });
        P('parseSearch', [resp.body, page]);
      }
    } else if (flow === 'info') {
      const cid = params.cid || '';
      const req = P('getInfoRequest', [cid]);
      if (req.ok && req.result) {
        const resp = doFetch(req.result);
        steps.push({ step: 'fetch', ok: true, result: { url: req.result.url, status: resp.status, body: resp.body, error: resp.error } });
        P('parseInfo', [resp.body, cid]);
      }
    } else if (flow === 'chapter') {
      const cid = params.cid || '';
      const req = P('getChapterRequest', [params.html || '', cid]);
      if (req.ok && req.result) {
        const resp = doFetch(req.result);
        steps.push({ step: 'fetch', ok: true, result: { url: req.result.url, status: resp.status, body: resp.body, error: resp.error } });
        P('parseChapter', [resp.body, params.comicJson || '{}']);
      }
    } else if (flow === 'images') {
      const req = P('getImagesRequest', [params.cid || '', params.path || '']);
      if (req.ok && req.result) {
        const resp = doFetch(req.result);
        steps.push({ step: 'fetch', ok: true, result: { url: req.result.url, status: resp.status, body: resp.body, error: resp.error } });
        P('parseImages', [resp.body]);
      }
    } else if (flow === 'category') {
      const cat = P('getCategories', []);
      if (cat.ok && cat.result && cat.result.format) {
        const page = num(params.page, 1);
        const req = P('getCategoryRequest', [params.format || cat.result.format, page]);
        if (req.ok && req.result) {
          const resp = doFetch(req.result);
          steps.push({ step: 'fetch', ok: true, result: { url: req.result.url, status: resp.status, body: resp.body, error: resp.error } });
          P('parseCategory', [resp.body, page]);
        }
      }
    } else if (flow === 'login') {
      P('login', [{ account: params.account || '', password: params.password || '' }]);
      P('getLoginState', []);
    } else {
      // custom：直接调用任意方法（POST /api/run 时走这里）
      const args = Array.isArray(params.args) ? params.args : [];
      P(params.method || 'getSearchRequest', args);
    }
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e), steps };
  }
}

/* ---------------- HTTP ---------------- */
function safeJson(o) {
  try { return JSON.stringify(o); }
  catch (e) { return JSON.stringify({ ok: false, error: '结果无法序列化: ' + e.message }); }
}
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 8e6) { req.destroy(); } });
  req.on('end', () => cb(body));
  req.on('error', () => cb(''));
}

function createServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/' || p === '/index.html') {
      return send(res, 200, readFileSync(join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
    }
    if (p.startsWith('/static/')) {
      const f = join(PUBLIC, p.slice('/static/'.length));
      if (!existsSync(f) || !f.startsWith(PUBLIC)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream');
    }
    if (p === '/api/sources') {
      const list = INDEX.sources.map(s => ({ type: s.type, title: s.title, version: s.version, url: s.url }));
      return send(res, 200, safeJson(list));
    }
    if (p === '/api/script') {
      const f = u.searchParams.get('file');
      const file = join(ROOT, f || '');
      if (!f || !existsSync(file) || !file.startsWith(ROOT)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, readFileSync(file, 'utf8'), 'text/plain; charset=utf-8');
    }
    if (p === '/api/run' && req.method === 'POST') {
      return readBody(req, body => {
        try {
          const o = JSON.parse(body);
          const r = runSource(o.sourceFile, o.method, Array.isArray(o.args) ? o.args : []);
          return send(res, 200, safeJson(r));
        } catch (e) { return send(res, 200, safeJson({ ok: false, error: String((e && e.message) || e) })); }
      });
    }
    if (p === '/api/flow' && req.method === 'POST') {
      return readBody(req, body => {
        try {
          const o = JSON.parse(body);
          const r = executeFlow(o.sourceFile, o.flow, o.params || {});
          return send(res, 200, safeJson(r));
        } catch (e) { return send(res, 200, safeJson({ ok: false, error: String((e && e.message) || e) })); }
      });
    }
    send(res, 404, 'not found', 'text/plain');
  });
  return server;
}

/* 仅当作为主模块运行时才监听端口（便于被测试/复用导入） */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const tryPorts = [...new Set([PORT, 8977, 8978, 8979, 8080, 8899])];
  let idx = 0;
  function attempt() {
    if (idx >= tryPorts.length) {
      console.error('无法绑定任何端口（可能是沙箱/权限限制）。请用环境变量 PORT 指定一个可用端口后重试。');
      process.exit(1);
    }
    const port = tryPorts[idx++];
    const srv = createServer();
    srv.on('error', (e) => {
      if (e && e.code === 'EADDRINUSE') console.log('端口 ' + port + ' 被占用，尝试下一个…');
      else console.error('绑定 ' + HOST + ':' + port + ' 失败 (' + ((e && e.code) || e) + ')，尝试下一个…');
      attempt();
    });
    srv.on('listening', () => {
      console.log('┌──────────────────────────────────────────────┐');
      console.log('│  XCimoc JS 源调试器                          │');
      console.log('│  http://' + HOST + ':' + port + '                        │');
      console.log('│  共 ' + INDEX.sources.length + ' 个源                            │');
      console.log('└──────────────────────────────────────────────┘');
      console.log('按 Ctrl+C 退出。');
    });
    srv.listen(port, HOST);
  }
  attempt();
}

export { runSource, executeFlow, doFetch, createServer, INDEX, SDK };


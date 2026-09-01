#!/usr/bin/env node
/**
 * 同步 HTTP 请求辅助脚本。
 *
 * Node 原生 fetch 是异步的，无法在 vm 沙箱中被源脚本同步调用；这里让调试器
 * 通过 child_process.execFileSync 启动本脚本，用真实的异步 fetch 发请求并把
 * 结果序列化到 stdout，从而在沙箱里得到「同步」的 fetch，行为对齐 App 的
 * JsHost.fetch（返回 {status, headers, setCookie, body}）。
 *
 * 入参：stdin 一行 JSON：{ url, method, headers, body, contentType }
 * 出参：stdout 一行 JSON：{ status, headers, setCookie, body, error? }
 */
import { readFileSync } from 'node:fs';
import { setGlobalDispatcher, Agent } from 'undici';

// 关闭 keep-alive 连接池：否则本脚本经 execFileSync 同步启动、结束时
// process.exit() 会撞上未关闭的连接 handle，Windows 下触发
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" 导致子进程崩溃、
// 调用方（doFetch）收到空 body —— 大响应（如 100KB+ 章节列表）必现。
setGlobalDispatcher(new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 }));

let input = '';
try { input = readFileSync(0, 'utf8'); } catch (e) { }

const out = () => process.stdout.write(JSON.stringify({ status: 0, headers: {}, setCookie: [], body: '', error: '输入无效' }) + '\n');

let req = {};
try { req = JSON.parse(input || '{}'); } catch (e) { out(); process.exit(0); }

const url = req.url;
if (!url) { out(); process.exit(0); }

const method = (req.method || 'GET').toUpperCase();
const opts = { method, headers: { ...(req.headers || {}) }, redirect: 'follow' };

// 有 body 时按内容类型发送（POST/PUT 才带 body，与 App 一致）
const hasBody = (req.body !== null && req.body !== undefined);
if ((method === 'POST' || method === 'PUT') && hasBody) {
  const contentType = (req.contentType || 'application/x-www-form-urlencoded').toLowerCase();
  if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
    opts.headers['Content-Type'] = contentType;
  }
  // 对象 body：按内容类型编码。Node 原生 fetch 不认纯对象，需显式序列化——
  // 默认 form-urlencoded（对齐 App 的 FormBody），contentType=json 时转 JSON 字符串。
  if (typeof req.body === 'object' && req.body !== null && !(req.body instanceof URLSearchParams)) {
    opts.body = contentType.includes('json')
      ? JSON.stringify(req.body)
      : new URLSearchParams(req.body).toString();
  } else {
    opts.body = req.body;
  }
}

let resp;
try {
  resp = await fetch(url, opts);
} catch (e) {
  process.stdout.write(JSON.stringify({ status: 0, headers: {}, setCookie: [], body: '', error: String((e && e.message) || e) }) + '\n');
  process.exit(0);
}

let respBody = '';
try { respBody = await resp.text(); } catch (e) { /* 忽略 */ }

const result = { status: resp.status, headers: {}, setCookie: [], body: respBody };

// 收集全部响应头（重复头只保留一个，set-cookie 单独取数组）
try {
  resp.headers.forEach((v, k) => { result.headers[k] = v; });
} catch (e) { /* 忽略 */ }

try {
  result.setCookie = (typeof resp.headers.getSetCookie === 'function')
    ? resp.headers.getSetCookie()
    : [];
} catch (e) { /* 忽略 */ }

process.stdout.write(JSON.stringify(result) + '\n');
process.exit(0);

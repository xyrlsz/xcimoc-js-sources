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

let input = '';
try { input = readFileSync(0, 'utf8'); } catch (e) {}

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
  opts.body = req.body;
  if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
    opts.headers['Content-Type'] = req.contentType || 'application/x-www-form-urlencoded';
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

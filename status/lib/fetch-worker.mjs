#!/usr/bin/env node
/**
 * 同步 HTTP 请求的辅助进程（由 lib/fetcher.mjs 通过 spawnSync 启动）。
 *
 * 源脚本在 vm 沙箱里以「同步」方式调用 fetch()，而 Node 的网络 API 全部是异步的，
 * 因此主进程启动本脚本执行真实请求、把结果序列化到 stdout，让沙箱获得同步 fetch
 * —— 行为对齐 App 的 JsHost.handleFetch（返回 {status, headers, setCookie, body}）。
 *
 * 与 App（OkHttp）对齐的细节：
 *  - 源未提供 User-Agent 时补与 App 相近的默认 UA；
 *  - 自动协商并解压 gzip / deflate / br（OkHttp 的透明压缩）；
 *  - 跟随重定向（最多 5 跳；303 与 301/302 的 POST 按浏览器语义转 GET）；
 *  - 按 Content-Type charset 解码；未声明时先按 UTF-8 严格解码，失败回退 GB18030；
 *  - 响应超过 maxBytes 时截断并标记 truncated（保护内存与下游）。
 *
 * 入参（stdin，一行 JSON）：
 *   { url, method, headers, body, contentType, timeoutMs, maxBytes }
 * 出参（stdout，一行 JSON）：
 *   { status, headers, setCookie, body, error?, truncated? }
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { readFileSync, writeSync } from 'node:fs';

const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/* 用 writeSync 而非 process.stdout.write：后者对管道是异步的，process.exit 会截断大 JSON */
function emit(obj) {
    try {
        writeSync(1, JSON.stringify(obj) + '\n');
    } catch (e) {
        /* 忽略写入失败 */
    }
}

function fail(error) {
    emit({ status: 0, headers: {}, setCookie: [], body: '', error: String(error) });
}

let req = {};
try {
    req = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch (e) {
    fail('请求参数不是合法 JSON');
    process.exit(0);
}

const startUrl = String(req.url || '').trim();
if (!startUrl) {
    fail('缺少 url');
    process.exit(0);
}

const timeoutMs = Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : DEFAULT_TIMEOUT_MS;
const maxBytes = Number(req.maxBytes) > 0 ? Number(req.maxBytes) : DEFAULT_MAX_BYTES;

/* ---------------- 请求头 ---------------- */

function buildHeaders() {
    const out = {};
    const lower = new Set();
    const src = (req.headers && typeof req.headers === 'object') ? req.headers : {};
    for (const k of Object.keys(src)) {
        const v = src[k];
        if (k && v !== undefined && v !== null) {
            out[k] = String(v);
            lower.add(k.toLowerCase());
        }
    }
    if (!lower.has('user-agent')) out['User-Agent'] = DEFAULT_UA;
    if (!lower.has('accept-encoding')) out['Accept-Encoding'] = 'gzip, deflate, br';
    if (!lower.has('accept')) out['Accept'] = '*/*';
    return out;
}

const headers = buildHeaders();
const method = String(req.method || 'GET').trim().toUpperCase() || 'GET';
const hasBody = req.body !== undefined && req.body !== null && req.body !== '';
const bodyBuf = hasBody ? Buffer.from(String(req.body), 'utf8') : null;
if (bodyBuf && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = String(req.contentType || 'application/x-www-form-urlencoded');
}

/* ---------------- 解压 / 解码 ---------------- */

function tryDecompress(buf, contentEncoding) {
    const enc = String(contentEncoding || '').toLowerCase();
    if (!enc || enc === 'identity') return buf;
    try {
        if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
        if (enc.includes('gzip')) return zlib.gunzipSync(buf);
        if (enc.includes('deflate')) {
            // deflate 有 zlib 包装与 raw 两种形态
            try {
                return zlib.inflateSync(buf);
            } catch (e) {
                return zlib.inflateRawSync(buf);
            }
        }
    } catch (e) {
        /* 站点错误声明编码：原样返回，避免整体失败 */
    }
    return buf;
}

function charsetFrom(contentType) {
    const m = /charset\s*=\s*"?([\w-]+)/i.exec(String(contentType || ''));
    if (!m) return null;
    let cs = m[1].toLowerCase();
    if (cs === 'utf8') cs = 'utf-8';
    // GB2312/GBK 是 GB18030 的子集，统一用最宽的 GB18030 解码
    if (cs === 'gb2312' || cs === 'gbk' || cs === 'gb18030') cs = 'gb18030';
    return cs;
}

function decodeWith(buf, charset) {
    try {
        return new TextDecoder(charset).decode(buf);
    } catch (e) {
        return buf.toString('utf8');
    }
}

function decodeBody(buf, contentType) {
    const cs = charsetFrom(contentType);
    if (cs) return decodeWith(buf, cs);
    // 未声明 charset：先 UTF-8 严格解码，失败（出现非法字节）再回退 GB18030
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
        /* 继续回退 */
    }
    return decodeWith(buf, 'gb18030');
}

function flatHeaders(h) {
    const out = {};
    for (const k of Object.keys(h || {})) {
        const v = h[k];
        out[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
}

/* ---------------- 请求（含重定向） ---------------- */

function doRequest(urlStr, reqMethod, reqBody, depth) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };

        let u;
        try {
            u = new URL(urlStr);
        } catch (e) {
            return done({ status: 0, headers: {}, setCookie: [], body: '', error: 'URL 无效: ' + urlStr });
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return done({ status: 0, headers: {}, setCookie: [], body: '', error: '不支持的协议: ' + u.protocol });
        }

        const mod = u.protocol === 'https:' ? https : http;
        let r;
        try {
            r = mod.request(u, { method: reqMethod, headers, timeout: timeoutMs }, (res) => {
                const chunks = [];
                let total = 0;
                let truncated = false;
                res.on('data', (c) => {
                    total += c.length;
                    if (total <= maxBytes) chunks.push(c);
                    else truncated = true;
                });
                res.on('error', (e) => done({ status: 0, headers: {}, setCookie: [], body: '', error: '响应中断: ' + ((e && e.message) || e) }));
                res.on('end', () => {
                    const status = res.statusCode || 0;
                    const loc = res.headers.location;
                    if (loc && (status === 301 || status === 302 || status === 303 || status === 307 || status === 308)) {
                        if (depth >= MAX_REDIRECTS) {
                            return done({ status, headers: {}, setCookie: [], body: '', error: '重定向次数过多(>' + MAX_REDIRECTS + ')' });
                        }
                        let next;
                        try {
                            next = new URL(loc, urlStr).href;
                        } catch (e) {
                            next = String(loc);
                        }
                        // 浏览器语义：303 一律转 GET；301/302 的非 GET/HEAD 转 GET（丢弃请求体）
                        const dropBody = status === 303 || ((status === 301 || status === 302) && reqMethod !== 'GET' && reqMethod !== 'HEAD');
                        return done(doRequest(next, dropBody ? 'GET' : reqMethod, dropBody ? null : reqBody, depth + 1));
                    }

                    const raw = Buffer.concat(chunks);
                    const body = decodeBody(tryDecompress(raw, res.headers['content-encoding']), res.headers['content-type']);
                    const out = {
                        status,
                        headers: flatHeaders(res.headers),
                        setCookie: res.headers['set-cookie'] || [],
                        body,
                    };
                    if (truncated) out.truncated = true;
                    done(out);
                });
            });
        } catch (e) {
            return done({ status: 0, headers: {}, setCookie: [], body: '', error: String((e && e.message) || e) });
        }

        r.on('timeout', () => r.destroy(new Error('请求超时(' + timeoutMs + 'ms)')));
        r.on('error', (e) => done({ status: 0, headers: {}, setCookie: [], body: '', error: String((e && e.message) || e) }));
        if (reqBody && (reqMethod === 'POST' || reqMethod === 'PUT' || reqMethod === 'PATCH' || reqMethod === 'DELETE')) {
            r.write(reqBody);
        }
        r.end();
    });
}

const result = await doRequest(startUrl, method, bodyBuf, 0);
emit(result);
process.exit(0);

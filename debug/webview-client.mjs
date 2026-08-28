#!/usr/bin/env node
/**
 * 同步渲染客户端。
 *
 * server.mjs 的 executeFlow 是同步的（通过 child_process.execFileSync 调用 helper），
 * 本脚本用于把渲染请求同步地发给常驻的 webview-server.mjs：
 *   stdin 一行 JSON：{ url, method, headers, autoScroll, handleCloudflare,
 *                     cloudflareTimeoutMs, interactiveChallenge }
 *   stdout 一行 JSON：{ status, headers, setCookie, body, finalUrl, cfDetected,
 *                      cfResolved, cfTimeout, interactive, ms, error? }
 *
 * 若 webview-server 尚未就绪（server.mjs 懒启动它），本脚本会连接重试等待，
 * 最多约 20 秒，避免 server.mjs 需要显式轮询等待。
 */
import { readFileSync } from 'node:fs';

const HOST = process.env.WEBVIEW_HOST || '127.0.0.1';
const PORT = process.env.WEBVIEW_PORT || '8976';
const BASE = 'http://' + HOST + ':' + PORT;
const STARTUP_WAIT_MS = 20_000;

let input = '';
try { input = readFileSync(0, 'utf8'); } catch (e) { /* 忽略 */ }

let req = {};
try { req = JSON.parse(input || '{}'); } catch (e) { /* 忽略 */ }

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deadline = Date.now() + STARTUP_WAIT_MS;
  for (;;) {
    try {
      const res = await fetch(BASE + '/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      return out(data);
    } catch (e) {
      if (Date.now() > deadline) {
        return out({
          status: 0, headers: {}, setCookie: [], body: '',
          error: '渲染服务不可用（' + ((e && e.message) || e) + '）。' +
            '请确认已 `npm install` 且 `npx playwright install chromium`；' +
            '若自定义过 WEBVIEW_PORT 需与 webview-server 保持一致。',
        });
      }
      await sleep(300);
    }
  }
}

main();

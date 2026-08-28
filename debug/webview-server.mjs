#!/usr/bin/env node
/**
 * Playwright 渲染服务 —— 为调试器提供「WebView 解析 + Cloudflare 认证」能力。
 *
 * App 真机里，当某解析环节配置了 webConfig.useWebParser=true（如全站 Cloudflare 的
 * ykmh 源）时，会用 WebView 渲染页面再交给 parseXxx。本服务用 Playwright 的 Chromium
 * 复刻这一行为：加载 URL → 等待渲染完成 → （可选）自动处理 Cloudflare 挑战 →
 * （可选）滚动到底部触发懒加载 → 返回渲染后的 document.documentElement.outerHTML。
 *
 * 作为**长驻进程**运行（server.mjs 懒启动它），监听本地 HTTP，供
 * webview-client.mjs 以同步方式调用。这样每次渲染不用冷启动浏览器，性能可接受。
 *
 * 运行：node webview-server.mjs
 * 环境变量：
 *   WEBVIEW_HOST  监听地址（默认 127.0.0.1）
 *   WEBVIEW_PORT  监听端口（默认 8976）
 *   WEBVIEW_HEADFUL=1  有头模式（可人工完成交互式 CF 验证，对应 App 的
 *                       interactiveChallenge=true 把 WebView 挂到前台）
 */
import http from 'node:http';
import { chromium } from 'playwright';

const HOST = process.env.WEBVIEW_HOST || '127.0.0.1';
const PORT = process.env.WEBVIEW_PORT ? parseInt(process.env.WEBVIEW_PORT, 10) : 8976;
const HEADFUL = process.env.WEBVIEW_HEADFUL === '1';

/** Cloudflare 挑战轮询间隔（对齐 App WebParser.CLOUDFLARE_POLL_MS=500） */
const CF_POLL_MS = 500;
/** 默认 CF 挑战等待超时（毫秒） */
const CF_DEFAULT_TIMEOUT = 60_000;
/** 页面加载等待上限 */
const LOAD_TIMEOUT = 60_000;
/** networkidle 等待上限 */
const NETWORK_IDLE_TIMEOUT = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;

/**
 * 检测当前页面是否为 Cloudflare 挑战页。
 * 综合判断：挑战元素 / 标题 / 正文关键词 / URL 中 __cf_chl。
 */
async function isChallengePage(page) {
  try {
    const r = await page.evaluate(() => {
      const t = document.title || '';
      const body = (document.body ? document.body.innerText : '') || '';
      const url = location.href || '';
      const hasEl = !!document.querySelector(
        '#challenge-running, #cf-challenge-running, #challenge-form, ' +
        '[id^="challenge-"], #cf-chl-running, div.cf-challenge'
      );
      const textMatch = /just a moment|verify you are human|attention required|checking your browser|cf-browser-verification/i.test(t + ' ' + body);
      return { hasEl, textMatch, url };
    });
    return !!(r.hasEl || r.textMatch || /__cf_chl/.test(r.url || ''));
  } catch (e) {
    return false;
  }
}

async function scrollToBottom(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const step = () => {
          window.scrollBy(0, window.innerHeight);
          total += window.innerHeight;
          if (total < document.body.scrollHeight) {
            setTimeout(step, 150);
          } else {
            resolve();
          }
        };
        step();
      });
    });
    // 滚动后再给懒加载一点时间
    await sleep(500);
  } catch (e) { /* 忽略 */ }
}

/**
 * 渲染一个 URL，返回对齐 App JsHost.fetch 的结构（{status, headers, setCookie, body}）
 * 并附带渲染元信息（finalUrl / cfDetected / cfResolved / cfTimeout / ms）。
 */
async function render(req) {
  const url = req && req.url;
  if (!url) return { status: 0, headers: {}, setCookie: [], body: '', error: '缺少 url' };

  const method = (req.method || 'GET').toUpperCase();
  const headers = req.headers || {};
  const autoScroll = !!(req.autoScroll);
  const handleCloudflare = req.handleCloudflare !== false; // 默认开启，仅检测到挑战页时生效
  const cloudflareTimeoutMs = req.cloudflareTimeoutMs > 0 ? req.cloudflareTimeoutMs : CF_DEFAULT_TIMEOUT;
  const interactiveChallenge = !!(req.interactiveChallenge);

  const start = Date.now();
  let ctx = null;
  try {
    if (!browser) {
      browser = await chromium.launch({ headless: !HEADFUL });
    }
    ctx = await browser.newContext({
      userAgent: headers['user-agent'] || headers['User-Agent'] || undefined,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();

    // 注入普通请求头（referer / cookie 等；user-agent 已在 context 设置）
    const extra = {};
    for (const [k, v] of Object.entries(headers)) {
      if (!v) continue;
      const lk = k.toLowerCase();
      if (lk === 'user-agent' || lk === 'host' || lk === 'content-length') continue;
      extra[k] = String(v);
    }
    if (Object.keys(extra).length) {
      await page.setExtraHTTPHeaders(extra);
    }

    // 页面加载：先 domcontentloaded，再做 CF 挑战轮询 / networkidle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });

    let cfDetected = false;
    let cfResolved = false;
    let cfTimeout = false;

    if (handleCloudflare) {
      const deadline = Date.now() + cloudflareTimeoutMs;
      // 首次检查是否挑战页；若命中则进入轮询等待通过
      let challenge = await isChallengePage(page);
      while (challenge) {
        cfDetected = true;
        if (Date.now() >= deadline) {
          cfTimeout = true;
          break;
        }
        if (interactiveChallenge && HEADFUL) {
          // 有头模式：留出人工验证时间，持续轮询直到通过/超时
          await sleep(CF_POLL_MS);
        } else {
          // headless：纯 JS 挑战通常会自动通过，轮询检测
          await sleep(CF_POLL_MS);
        }
        challenge = await isChallengePage(page);
      }
      if (cfDetected && !cfTimeout) cfResolved = true;
      // 若从未检测到挑战，给 networkidle 一点时间让懒加载/JS 渲染完成
      if (!cfDetected) {
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT }).catch(() => {});
      }
    } else {
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT }).catch(() => {});
    }

    if (autoScroll) {
      await scrollToBottom(page);
    }

    const body = await page.evaluate(() => document.documentElement.outerHTML);
    const finalUrl = page.url();

    return {
      status: 200,
      headers: {},
      setCookie: [],
      body,
      finalUrl,
      cfDetected,
      cfResolved,
      cfTimeout,
      interactive: interactiveChallenge && HEADFUL,
      ms: Date.now() - start,
    };
  } catch (e) {
    return {
      status: 0,
      headers: {},
      setCookie: [],
      body: '',
      error: '渲染失败: ' + ((e && e.message) || e),
      ms: Date.now() - start,
    };
  } finally {
    if (ctx) {
      try { await ctx.close(); } catch (e) { /* 忽略 */ }
    }
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  if (u.pathname === '/health') {
    return send(200, { ok: true });
  }
  if (u.pathname === '/render' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', async () => {
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch (e) { /* 忽略 */ }
      const r = await render(o);
      send(200, r);
    });
    return;
  }
  send(404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log('[webview] Playwright 渲染服务已启动: http://' + HOST + ':' + PORT + (HEADFUL ? '（有头模式）' : '（headless）'));
});
server.on('error', (e) => {
  console.error('[webview] 服务启动失败: ' + ((e && e.message) || e));
  process.exit(1);
});

// 优雅退出时释放浏览器
process.on('SIGINT', async () => {
  if (browser) { try { await browser.close(); } catch (e) { /* 忽略 */ } }
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

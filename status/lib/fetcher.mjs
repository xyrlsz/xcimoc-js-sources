/**
 * 主进程侧的「同步 fetch」：spawnSync 启动 lib/fetch-worker.mjs 执行真实 HTTP 请求。
 *
 * Node 没有同步网络 API，而源脚本在 vm 沙箱中要求同步返回。
 * 这里每请求启动一个短命子进程（请求完成后立即退出，无连接池/句柄残留问题），
 * 与 debug/ 调试器的做法一致；子进程实现是自带的原生 http/https（见 fetch-worker.mjs），
 * 不依赖任何 npm 包（调试器那份用了 undici，这里避免隐式依赖）。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'fetch-worker.mjs');

function errResult(error) {
    return { status: 0, headers: {}, setCookie: [], body: '', error };
}

/**
 * 同步执行一次 HTTP 请求。
 * @param {{url:string, method?:string, headers?:object, body?:string|null, contentType?:string|null}} request
 * @param {{timeoutMs?:number, maxBytes?:number}} [opts]
 * @returns {{status:number, headers:object, setCookie:string[], body:string, error?:string, truncated?:boolean}}
 */
export function syncFetch(request, opts = {}) {
    const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
    const payload = JSON.stringify({
        url: request.url,
        method: request.method || 'GET',
        headers: request.headers || {},
        body: request.body === undefined ? null : request.body,
        contentType: request.contentType || null,
        timeoutMs,
        maxBytes: opts.maxBytes,
    });

    let r;
    try {
        // encoding: utf8 —— 大响应下 maxBuffer 给足；spawnSync 即使退出码非 0 也保留 stdout
        r = spawnSync(process.execPath, [WORKER], {
            input: payload,
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 512 * 1024 * 1024,
            timeout: timeoutMs + 30000,
        });
    } catch (e) {
        return errResult('fetch 子进程启动失败: ' + ((e && e.message) || e));
    }
    if (r.error) return errResult('fetch 子进程错误: ' + ((r.error && r.error.message) || r.error));

    const raw = (r.stdout || '').trim();
    if (!raw) {
        const tail = r.stderr ? ' :: ' + String(r.stderr).slice(0, 300) : '';
        return errResult('fetch 子进程无输出' + tail);
    }
    const lastLine = raw.split('\n').pop();
    try {
        return JSON.parse(lastLine);
    } catch (e) {
        return errResult('fetch 输出解析失败: ' + ((e && e.message) || e));
    }
}

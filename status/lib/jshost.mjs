/**
 * JsHost 的最小复刻（测试用），把源脚本需要宿主提供的能力在 Node 中实现：
 *
 *   - dom     : cheerio 复刻 jsoup 语义（create/select/text/attr/href/src）
 *   - fetch   : lib/fetcher.mjs 的同步子进程 HTTP（等价 App 的 OkHttp 请求）
 *   - state / setting / login : 进程内 Map（等价 App 的 JsHost 内存态 / SharedPreferences）
 *   - log / toast             : 收集到 ctx.logs（toast 忽略）
 *
 * 调用方通过 createEngine() 得到 { source, call, has, ctx }：
 *   - call(name, ...args) 调用 installSource 暴露的全局函数（带 SDK 的返回结构校验，
 *     与 App 的 callFunction 路径一致）；
 *   - 每次 createEngine() 创建全新沙箱（对齐 App「每次调用新建引擎」的语义；
 *     详情流程可在同一引擎内连续调用，对齐 openSession 的会话复用）。
 */
import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { syncFetch } from './fetcher.mjs';

/* 跨调用持久态（本进程只测一个源，天然隔离；语义对齐 JsHost 按 type 隔离的存储） */
const stateMap = new Map();
const settingMap = new Map();
const loginMap = new Map();

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

function makeHostCall(ctx, timeoutMs) {
    return function hostCall(name, argsJson) {
        let args = {};
        try {
            args = JSON.parse(argsJson || '{}');
        } catch (e) {
            /* 忽略非法参数 */
        }
        switch (name) {
            case 'log':
                ctx.logs.push(String(args.data));
                return 'null';
            case 'toast':
                return 'null';
            case 'dom':
                return handleDom(args, ctx);
            case 'fetch': {
                const t0 = Date.now();
                const resp = syncFetch({
                    url: args.url,
                    method: args.method || 'GET',
                    headers: args.headers || {},
                    body: args.body === undefined ? null : args.body,
                    contentType: args.contentType || null,
                }, { timeoutMs });
                ctx.fetches.push({
                    url: String(args.url || ''),
                    method: String(args.method || 'GET'),
                    status: resp.status,
                    error: resp.error || null,
                    ms: Date.now() - t0,
                });
                return JSON.stringify(resp);
            }
            case 'state': {
                const k = String(args.key);
                if (args.op === 'set') {
                    stateMap.set(k, args.value == null ? 'null' : String(args.value));
                    return 'null';
                }
                const v = stateMap.get(k);
                return v == null ? 'null' : v;
            }
            case 'setting': {
                const k = 'setting_' + (args.type | 0) + '_' + args.key;
                if (args.op === 'set') {
                    settingMap.set(k, args.value == null ? 'null' : String(args.value));
                    return 'null';
                }
                const v = settingMap.get(k);
                return v == null ? 'null' : JSON.stringify(v);
            }
            case 'login': {
                const k = 'login_' + (args.type | 0);
                if (args.op === 'set') {
                    loginMap.set(k, args.value == null ? 'null' : String(args.value));
                    return 'null';
                }
                if (args.op === 'clear') {
                    loginMap.delete(k);
                    return 'null';
                }
                const v = loginMap.get(k);
                return v == null ? 'null' : JSON.stringify(v);
            }
            default:
                return 'null';
        }
    };
}

/* ---------------- 引擎 ---------------- */

/**
 * 创建引擎：在全新 vm 沙箱中加载 SDK + 源脚本。
 * @param {{sdk:string, script:string, type:number, filename?:string, timeoutMs?:number}} options
 */
export function createEngine({ sdk, script, type = -1, filename = 'source.js', timeoutMs = 30000 }) {
    const ctx = {
        logs: [],
        fetches: [],
        nodeMap: new Map(),
        nodeSeq: 0,
    };

    const pushLog = (prefix) => (...a) => ctx.logs.push(prefix + a.map((v) => String(v)).join(' '));
    const sandbox = {
        console: {
            log: pushLog(''),
            info: pushLog(''),
            warn: pushLog('[warn] '),
            error: pushLog('[error] '),
            debug: pushLog('[debug] '),
        },
        hostCall: makeHostCall(ctx, timeoutMs),
        __SOURCE_TYPE: String(type),
    };
    sandbox.globalThis = sandbox;

    const vctx = vm.createContext(sandbox);
    vm.runInContext(sdk + '\n' + script, vctx, { filename });

    return {
        /** 源实例（installSource 挂到全局 SOURCE） */
        source: vctx.SOURCE || null,
        ctx,
        /** 源是否实现了某方法（installSource 只暴露被覆写的方法，语义同 App hasFunction） */
        has(name) {
            return typeof vctx[name] === 'function';
        },
        /** 调用源方法（走 installSource 的 schema 包装，与 App callFunction 一致） */
        call(name, ...args) {
            const fn = vctx[name];
            if (typeof fn !== 'function') throw new Error('源未实现方法: ' + name);
            const r = fn(...args);
            return r === undefined ? null : r;
        },
    };
}

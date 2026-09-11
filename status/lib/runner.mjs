/**
 * 单源可用性测试：严格按 App（JsMangaParser）的真实调用链驱动源脚本。
 *
 *   搜索   getSearchRequest(keyword, 1) → 宿主 fetch → parseSearch(html, 1)
 *   详情   getInfoRequest(cid)          → 宿主 fetch → parseInfo(html, cid)
 *   章节   详情页缓存章节（parseInfo 返回 chapters）优先；
 *          否则 getChapterRequest(详情html, cid) → fetch → parseChapter(html, {cid,title})；
 *          再否则 parseChapter(详情html, {cid,title})
 *   图片   getImagesRequest(cid, path) → 宿主 fetch → parseImages(html, {cid,path,id})
 *
 * 引擎生命周期对齐 App：每阶段独立引擎；详情 + 章节共享同一引擎（对应详情会话）。
 * 宿主请求的 headers = 源请求声明的 headers 覆盖 getHeader() 的返回值（getHeader 兜底）。
 *
 * 自定义测试数据（testCase，来自 status/test_data.json 的 sources[type]，可选）：
 *   keyword      该源专用搜索关键词（覆盖全局关键词）
 *   cid          固定详情 cid（配置后详情/章节/图片均用它；搜索未通过时降级为告警继续）
 *   chapterPath  固定章节 path（图片阶段直接使用；章节解析失败时降级为告警）
 *   skipSearch   跳过搜索步骤（需同时配置 cid）
 *   note         备注（随结果输出，页面展示）
 * 未配置任何字段的源完全按默认流程测试。
 *
 * 状态判定：
 *   ok   关键链路的每个步骤都通过
 *   warn 链路可走通但有告警（搜索无结果、图片项为懒加载、部分步骤需 WebView 被跳过等）
 *   fail 任一步骤失败（脚本加载、请求、解析）
 *   skip 源需要 WebView 渲染（webConfig.useWebParser），自动化环境无法直接验证
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from './jshost.mjs';
import { syncFetch } from './fetcher.mjs';

const STEP_NAMES = ['search', 'info', 'chapter', 'images'];
const MAX_TEXT = 300;

function clip(s) {
    const t = String(s === null || s === undefined ? '' : s);
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
}

/**
 * 规范化自定义测试数据（status/test_data.json → sources[type]）：
 * 仅保留已知字段；全部为空时返回 null（该源按默认流程测试）。
 */
export function normalizeCase(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    if (typeof raw.keyword === 'string' && raw.keyword.trim()) out.keyword = raw.keyword.trim();
    if (raw.cid !== undefined && raw.cid !== null && String(raw.cid).trim()) out.cid = String(raw.cid).trim();
    if (typeof raw.chapterPath === 'string' && raw.chapterPath.trim()) out.chapterPath = raw.chapterPath.trim();
    if (raw.skipSearch === true) out.skipSearch = true;
    if (typeof raw.note === 'string' && raw.note.trim()) out.note = raw.note.trim().slice(0, 200);
    return Object.keys(out).length > 0 ? out : null;
}

function newStep(result, name) {
    const s = { name, status: 'skip', ms: 0, http: null, detail: '', error: null };
    result.steps.push(s);
    return s;
}

function skipSteps(result, names, detail) {
    for (const s of result.steps) {
        if (names.includes(s.name)) {
            s.status = 'skip';
            s.detail = detail;
        }
    }
}

/** 取源 getHeader()（失败返回 null，不视为错误） */
function safeHeader(engine) {
    try {
        return engine.has('getHeader') ? engine.call('getHeader') : null;
    } catch (e) {
        return null;
    }
}

/** 合并请求头：源请求自带头优先，getHeader 兜底 */
function pickHeaders(request, fallback) {
    const out = {};
    if (fallback && typeof fallback === 'object') {
        for (const k of Object.keys(fallback)) out[k] = String(fallback[k]);
    }
    if (request && request.headers && typeof request.headers === 'object') {
        for (const k of Object.keys(request.headers)) out[k] = String(request.headers[k]);
    }
    return out;
}

/** 宿主侧发起请求（等价 App 执行 getXxxRequest 返回的描述对象） */
function hostFetch(request, header, timeoutMs) {
    if (!request || !request.url) {
        return { status: 0, headers: {}, setCookie: [], body: '', error: '未生成有效请求（请求对象为空）' };
    }
    return syncFetch({
        url: String(request.url),
        method: request.method || 'GET',
        headers: pickHeaders(request, header),
        body: request.body === undefined ? null : request.body,
        contentType: request.contentType || null,
    }, { timeoutMs });
}

function finalize(result, t0) {
    result.durationMs = Date.now() - t0;
    const steps = result.steps;
    if (steps.some((s) => s.status === 'fail')) {
        result.status = 'fail';
    } else if (steps.length > 0 && steps.every((s) => s.status === 'skip')) {
        result.status = 'skip';
    } else if (steps.some((s) => s.status === 'skip' || s.status === 'warn')) {
        result.status = 'warn';
    } else {
        result.status = 'ok';
    }
    if (!result.error) {
        const hint = steps.find((s) => s.status === 'fail' && s.error)
            || steps.find((s) => s.status === 'warn' && s.error);
        if (hint) result.error = hint.name + ': ' + hint.error;
    }
    // 日志保留最后 20 条（含 schema 告警与源内诊断 log），便于排查；统一截断过长内容
    result.logs = result.logs.slice(-20).map(clip);
    return result;
}

/**
 * 测试单个源。
 * @param {{root:string, sdk:string, entry:object, keyword:string, timeoutMs:number, testCase?:object|null}} options
 *        testCase 为该源的自定义测试数据（可选，见文件头注释）
 * @returns 结果对象（可直接序列化进 status.json）
 */
export function testSource({ root, sdk, entry, keyword, timeoutMs, testCase = null }) {
    testCase = normalizeCase(testCase);
    const t0 = Date.now();
    const result = {
        type: entry.type,
        title: entry.title,
        version: entry.version || null,
        url: entry.url,
        baseUrl: entry.baseUrl || null,
        status: 'fail',
        error: null,
        durationMs: 0,
        steps: [],
        logs: [],
        case: testCase,
    };
    const logs = [];
    const collect = (engine) => {
        if (engine && engine.ctx && engine.ctx.logs.length) logs.push(...engine.ctx.logs);
    };
    result.logs = logs;

    let script;
    try {
        script = readFileSync(join(root, entry.url), 'utf8');
    } catch (e) {
        result.error = '源文件读取失败: ' + e.message;
        return finalize(result, t0);
    }
    /* 后续各阶段把引擎日志汇总到 result.logs（finalize 时过滤/截断） */

    const sSearch = newStep(result, 'search');
    const sInfo = newStep(result, 'info');
    const sChapter = newStep(result, 'chapter');
    const sImages = newStep(result, 'images');

    /* ---------- 加载脚本（此引擎同时用于搜索阶段） ---------- */
    let engine;
    try {
        engine = createEngine({ sdk, script, type: entry.type, filename: entry.url, timeoutMs });
    } catch (e) {
        sSearch.status = 'fail';
        sSearch.error = '脚本加载失败: ' + e.message;
        result.error = sSearch.error;
        return finalize(result, t0);
    }
    if (!engine.source) {
        sSearch.status = 'fail';
        sSearch.error = 'SOURCE 未定义（脚本未调用 installSource）';
        collect(engine);
        result.error = sSearch.error;
        return finalize(result, t0);
    }

    const webConfig = engine.source.webConfig || null;
    const needsRender = (phase) => !!(webConfig && webConfig[phase] && webConfig[phase].useWebParser);

    if (needsRender('search') || needsRender('info')) {
        const why = '需 WebView 渲染（Cloudflare 等），自动化环境无法验证';
        skipSteps(result, STEP_NAMES, why);
        collect(engine);
        result.error = why;
        return finalize(result, t0);
    }

    /* ---------- 搜索 ---------- */
    const kw = testCase && testCase.keyword ? testCase.keyword : keyword;
    let items = null;
    let tStep = Date.now();

    if (testCase && testCase.skipSearch) {
        sSearch.status = 'skip';
        sSearch.detail = '按测试数据跳过搜索';
    } else {
        let searchReq = null;
        try {
            searchReq = engine.call('getSearchRequest', kw, 1);
        } catch (e) {
            sSearch.status = 'fail';
            sSearch.error = 'getSearchRequest 异常: ' + e.message;
        }
        if (sSearch.status !== 'fail' && (!searchReq || !searchReq.url)) {
            sSearch.status = 'fail';
            sSearch.error = 'getSearchRequest 未返回有效请求';
        }
        if (sSearch.status !== 'fail') {
            const searchResp = hostFetch(searchReq, safeHeader(engine), timeoutMs);
            sSearch.ms = Date.now() - tStep;
            sSearch.http = searchResp.status;
            if (searchResp.error) {
                sSearch.status = 'fail';
                sSearch.error = '请求失败: ' + searchResp.error;
            } else if (!(searchResp.status >= 200 && searchResp.status < 300)) {
                sSearch.status = 'fail';
                sSearch.error = 'HTTP ' + searchResp.status;
            } else {
                try {
                    items = engine.call('parseSearch', searchResp.body, 1);
                } catch (e) {
                    sSearch.status = 'fail';
                    sSearch.error = 'parseSearch 异常: ' + e.message;
                }
                if (sSearch.status !== 'fail') {
                    if (!Array.isArray(items)) {
                        sSearch.status = 'fail';
                        sSearch.error = 'parseSearch 返回非数组';
                    } else if (items.length === 0) {
                        sSearch.status = 'warn';
                        sSearch.error = '搜索「' + kw + '」无结果（接口可达，可能关键词不匹配）';
                    } else {
                        sSearch.status = 'ok';
                        sSearch.detail = '命中 ' + items.length + ' 条，首条「' + (items[0].title || items[0].cid) + '」';
                    }
                }
            }
        }
    }

    /* 搜索未通过时：配置了自定义 cid 则降级为告警继续，否则终止 */
    if (sSearch.status !== 'ok' && sSearch.status !== 'skip') {
        if (testCase && testCase.cid) {
            if (sSearch.status === 'fail') {
                sSearch.status = 'warn';
                sSearch.error = '搜索未通过（' + sSearch.error + '），使用自定义 cid 继续';
            } else {
                sSearch.error = '搜索「' + kw + '」无结果（使用自定义 cid 继续）';
            }
        } else {
            const why = sSearch.status === 'warn' ? '搜索无结果，未继续测试' : '搜索未通过，未继续测试';
            skipSteps(result, ['info', 'chapter', 'images'], why);
            collect(engine);
            result.error = sSearch.error;
            return finalize(result, t0);
        }
    }

    const cid = testCase && testCase.cid
        ? String(testCase.cid)
        : (items && items.length > 0 ? String(items[0].cid) : null);
    if (!cid) {
        const why = '缺少可用 cid（搜索未产出结果且未配置自定义 cid）';
        if (sSearch.status === 'skip') {
            sSearch.status = 'fail';
            sSearch.error = '测试数据要求跳过搜索，但未配置 cid';
        }
        sInfo.status = 'fail';
        sInfo.error = why;
        skipSteps(result, ['chapter', 'images'], why);
        collect(engine);
        result.error = why;
        return finalize(result, t0);
    }

    /* ---------- 详情 + 章节（同一引擎，对齐详情会话） ---------- */
    let infoEngine;
    try {
        infoEngine = createEngine({ sdk, script, type: entry.type, filename: entry.url, timeoutMs });
    } catch (e) {
        sInfo.status = 'fail';
        sInfo.error = '引擎创建失败: ' + e.message;
        skipSteps(result, ['chapter', 'images'], '详情引擎不可用');
        result.error = sInfo.error;
        return finalize(result, t0);
    }

    tStep = Date.now();
    let infoReq;
    try {
        infoReq = infoEngine.call('getInfoRequest', cid);
    } catch (e) {
        sInfo.status = 'fail';
        sInfo.error = 'getInfoRequest 异常: ' + e.message;
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }
    if (!infoReq || !infoReq.url) {
        sInfo.status = 'fail';
        sInfo.error = 'getInfoRequest 未返回有效请求';
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }

    const infoResp = hostFetch(infoReq, safeHeader(infoEngine), timeoutMs);
    sInfo.http = infoResp.status;
    if (infoResp.error) {
        sInfo.status = 'fail';
        sInfo.error = '请求失败: ' + infoResp.error;
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }
    if (!(infoResp.status >= 200 && infoResp.status < 300)) {
        sInfo.status = 'fail';
        sInfo.error = 'HTTP ' + infoResp.status;
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }

    let info;
    try {
        info = infoEngine.call('parseInfo', infoResp.body, cid);
    } catch (e) {
        sInfo.status = 'fail';
        sInfo.error = 'parseInfo 异常: ' + e.message;
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }
    sInfo.ms = Date.now() - tStep;
    if (!info || typeof info !== 'object') {
        sInfo.status = 'fail';
        sInfo.error = 'parseInfo 返回空';
        skipSteps(result, ['chapter', 'images'], '详情不可用');
        collect(infoEngine);
        result.error = sInfo.error;
        return finalize(result, t0);
    }
    if (info.title) {
        sInfo.status = 'ok';
        sInfo.detail = String(info.title);
    } else {
        sInfo.status = 'warn';
        sInfo.error = '未解析到标题';
    }

    const cachedChapters = Array.isArray(info.chapters) ? info.chapters : null;
    let chapters = null;

    if (cachedChapters && cachedChapters.length > 0) {
        chapters = cachedChapters;
        sChapter.status = 'ok';
        sChapter.detail = '详情页返回 ' + chapters.length + ' 话';
    } else if (needsRender('chapter')) {
        sChapter.status = 'skip';
        sChapter.detail = '需 WebView 渲染，已跳过';
    } else {
        tStep = Date.now();
        try {
            if (infoEngine.has('getChapterRequest')) {
                const chReq = infoEngine.call('getChapterRequest', infoResp.body, cid);
                if (chReq && chReq.url) {
                    const chResp = hostFetch(chReq, safeHeader(infoEngine), timeoutMs);
                    sChapter.http = chResp.status;
                    if (chResp.error) throw new Error('请求失败: ' + chResp.error);
                    if (!(chResp.status >= 200 && chResp.status < 300)) throw new Error('HTTP ' + chResp.status);
                    chapters = infoEngine.call('parseChapter', chResp.body, { cid, title: info.title || '' });
                } else {
                    // getChapterRequest 返回 null：宿主直接用详情页 html 解析章节（App 语义）
                    chapters = infoEngine.call('parseChapter', infoResp.body, { cid, title: info.title || '' });
                }
            } else if (infoEngine.has('parseChapter')) {
                chapters = infoEngine.call('parseChapter', infoResp.body, { cid, title: info.title || '' });
            }
            sChapter.ms = Date.now() - tStep;
            if (Array.isArray(chapters) && chapters.length > 0) {
                sChapter.status = 'ok';
                sChapter.detail = chapters.length + ' 话';
            } else if (testCase && testCase.chapterPath) {
                sChapter.status = 'warn';
                sChapter.error = '未解析到章节列表（将使用自定义章节 path 测图片）';
            } else {
                sChapter.status = 'fail';
                sChapter.error = '未解析到章节列表';
            }
        } catch (e) {
            sChapter.ms = Date.now() - tStep;
            if (testCase && testCase.chapterPath) {
                sChapter.status = 'warn';
                sChapter.error = e.message + '（将使用自定义章节 path 测图片）';
            } else {
                sChapter.status = 'fail';
                sChapter.error = e.message;
            }
        }
    }
    collect(infoEngine);

    /* ---------- 图片 ---------- */
    const chapterPath = testCase && testCase.chapterPath
        ? String(testCase.chapterPath)
        : (chapters && chapters.length > 0 ? String(chapters[0].path) : null);
    if (!chapterPath) {
        sImages.status = 'skip';
        sImages.detail = '无可用章节';
    } else if (needsRender('images')) {
        sImages.status = 'skip';
        sImages.detail = '需 WebView 渲染，已跳过';
    } else {
        let imgEngine;
        try {
            imgEngine = createEngine({ sdk, script, type: entry.type, filename: entry.url, timeoutMs });
        } catch (e) {
            sImages.status = 'fail';
            sImages.error = '引擎创建失败: ' + e.message;
            result.error = sImages.error;
            return finalize(result, t0);
        }
        tStep = Date.now();
        try {
            const imgReq = imgEngine.call('getImagesRequest', cid, String(chapterPath));
            if (!imgReq || !imgReq.url) throw new Error('getImagesRequest 未返回有效请求');
            // 与 App 相同：请求构建后在同一引擎内再取一次 getHeader（referer 可能已更新）
            const imgResp = hostFetch(imgReq, safeHeader(imgEngine), timeoutMs);
            sImages.http = imgResp.status;
            if (imgResp.error) throw new Error('请求失败: ' + imgResp.error);
            if (!(imgResp.status >= 200 && imgResp.status < 300)) throw new Error('HTTP ' + imgResp.status);
            const imgs = imgEngine.call('parseImages', imgResp.body, { cid: String(chapterPath), path: String(chapterPath), id: 1 });
            const count = Array.isArray(imgs)
                ? imgs.filter((x) => x && ((Array.isArray(x.urls) && x.urls.length > 0) || x.url)).length
                : 0;
            if (count > 0) {
                sImages.status = 'ok';
                sImages.detail = count + ' 张图片';
                const lazyCount = imgs.filter((x) => x && x.lazy).length;
                if (lazyCount > 0) {
                    sImages.detail += '（' + lazyCount + ' 张为懒加载）';
                }
            } else {
                sImages.status = 'fail';
                sImages.error = '未解析到图片';
            }
        } catch (e) {
            sImages.status = 'fail';
            sImages.error = e.message;
        }
        sImages.ms = Date.now() - tStep;
        collect(imgEngine);
    }

    return finalize(result, t0);
}

/*
 * XCimoc 动态漫画源 SDK
 *
 * 该脚本在每次执行漫画源脚本前被注入到 QuickJS 上下文。它向源脚本暴露一组
 * 宿主能力（DOM 解析、字符串工具、解密、状态、登录、设置），底层统一通过
 * C 层的 hostCall(name, argsJson) 回调到 Java 的 JsHost。
 *
 * 源脚本规范见 docs/js-source.md；本文件 + 源脚本会一起被 evaluate。
 */

/* ---------------- hostCall 工具 ---------------- */

function _call(name, args) {
    var raw = hostCall(name, JSON.stringify(args));
    if (raw === null || raw === undefined || raw === '') return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return raw;
    }
}

/* 打印日志到 Android logcat（tag=JsSource，含源 type）。用于在无法调试 JS 时定位问题。
 * 源脚本里可直接用 log(...) 或 console.log(...)。 */
function log(msg) {
    var type = (typeof __ST !== 'undefined') ? __ST : -1;
    _call('log', { type: type, data: msg == null ? 'undefined' : String(msg) });
}
if (typeof console === 'undefined') {
    globalThis.console = {
        log: function () { log(Array.prototype.join.call(arguments, ' ')); },
        info: function () { log(Array.prototype.join.call(arguments, ' ')); },
        warn: function () { log('[warn] ' + Array.prototype.join.call(arguments, ' ')); },
        error: function () { log('[error] ' + Array.prototype.join.call(arguments, ' ')); }
    };
}

/* 发起一次宿主 HTTP 请求（同步阻塞）。返回 {status, headers, setCookie, body}。
 * 主要用于登录等需要发起请求并读取响应头/响应体的场景；常规解析请用 getXxxRequest。 */
function fetch(url, options) {
    options = options || {};
    return _call('fetch', {
        url: url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body === undefined ? null : options.body,
        contentType: options.contentType || null
    });
}

/* ---------------- 字符串工具 ---------------- */

/* sprintf 简化版：支持 %s / %d 顺序替换 */
function format(fmt) {
    var args = Array.prototype.slice.call(arguments, 1);
    var i = 0;
    return String(fmt).replace(/%[sd]/g, function () {
        var v = args[i++];
        return (v === undefined || v === null) ? '' : String(v);
    });
}

/* 正则匹配，返回指定分组（缺省返回整组）；不匹配返回 null */
function match(regex, str, group) {
    if (str === null || str === undefined) return null;
    var m = new RegExp(regex).exec(String(str));
    if (!m) return null;
    if (group !== undefined && m[group] !== undefined) return m[group];
    return m[0];
}

/* 按分隔符 split，返回指定下标；未指定下标返回整个数组 */
function split(str, sep, index) {
    if (str === null || str === undefined) return null;
    var arr = String(str).split(sep);
    if (index === undefined) return arr;
    return (index >= 0 && index < arr.length) ? arr[index] : null;
}

/* 从 href 提取 cid（对齐 Java Node.splitHref） */
function splitHref(str, index) {
    if (str === null || str === undefined) return null;
    str = String(str).replace(/.*\..*?\//, '');
    str = str.replace(/[\/.=?]/g, ' ');
    str = str.trim();
    return split(str, /\s+/, index);
}

/* ---------------- 通用工具（供源脚本调用） ---------------- */

/* 繁体转简体（宿主 OpenCC/JCC 实现） */
function t2s(str) {
    return _call('t2s', { data: str == null ? '' : String(str) });
}

/* URL 编码 / 解码（宿主实现） */
function urlEncode(str) {
    return _call('urlencode', { data: str == null ? '' : String(str) });
}
function urlDecode(str) {
    return _call('urldecode', { data: str == null ? '' : String(str) });
}

/* 时间戳（秒或毫秒均可）→ YYYY-MM-DD；withTime 为真则追加 HH:MM；非法输入返回空串 */
function formatTimestamp(t, withTime) {
    if (t === null || t === undefined || isNaN(t) || t <= 0) return '';
    var v = Number(t);
    if (v < 100000000000) v *= 1000; // 10 位（秒）→ 毫秒
    var d = new Date(v);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if (withTime) s += ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return s;
}

/* 从字符串提取首个数字（含负号/小数）；无数字返回 null */
function getNumber(str) {
    if (str === null || str === undefined) return null;
    var m = String(str).match(/-?\d+(\.\d+)?/);
    return m ? m[0] : null;
}

/* 全局 substring 助手：等价 String(str).substring(start, end)，end 缺省到末尾。
 * 注意与 String.prototype.substring（方法调用）并存，互不影响。 */
function substring(str, start, end) {
    if (str === null || str === undefined) return '';
    return String(str).substring(start, end === undefined ? undefined : end);
}

/* ---------------- 解密 ---------------- */

/* eval 求值 packed 脚本，返回最后表达式的字符串值 */
function evalDecrypt(code) {
    var result = eval(code);
    return (result === undefined || result === null) ? '' : String(result);
}

function LZ64Decrypt(str) {
    return _call('lz64', { data: str });
}

function md5(str) {
    return _call('md5', { data: str });
}

function base64Encode(str) {
    return _call('base64', { op: 'encode', data: str });
}

function base64Decode(str) {
    return _call('base64', { op: 'decode', data: str });
}

function base64UrlDecode(str) {
    return _call('base64', { op: 'url', data: str });
}

/* AES-CBC 解密；iv 缺省时使用密文前 16 字节作为 IV */
function aesCbcDecrypt(value, key, iv) {
    return _call('aes_cbc', { value: value, key: key, iv: iv || '', ivPrefix: !iv });
}

function aesCbcDecryptWithIvPrefix(value, key) {
    return _call('aes_cbc', { value: value, key: key, iv: '', ivPrefix: true });
}

/* ---------------- DOM 解析 ---------------- */

function DomNode(id) {
    this._id = id;
}

/* 解析一段 HTML，返回根节点包装对象 */
function DOM(html) {
    var d = _call('dom', { op: 'create', html: html });
    return new DomNode(d && d.id != null ? d.id : -1);
}

DomNode.prototype.select = function (sel) {
    var arr = _call('dom', { op: 'select', id: this._id, sel: sel });
    var out = [];
    if (arr) {
        for (var i = 0; i < arr.length; i++) out.push(new DomNode(arr[i]));
    }
    return out;
};

DomNode.prototype.text = function (sel) {
    return _call('dom', { op: 'text', id: this._id, sel: (sel === undefined ? null : sel) });
};

DomNode.prototype.attr = function (a, b) {
    if (b === undefined) {
        return _call('dom', { op: 'attr', id: this._id, sel: null, attr: a });
    }
    return _call('dom', { op: 'attr', id: this._id, sel: a, attr: b });
};

DomNode.prototype.href = function (sel) {
    return _call('dom', { op: 'href', id: this._id, sel: (sel === undefined ? null : sel) });
};

DomNode.prototype.src = function (sel) {
    return _call('dom', { op: 'src', id: this._id, sel: (sel === undefined ? null : sel) });
};

/* ---------------- 状态（跨调用、按源隔离） ---------------- */

var __ST = (typeof globalThis.__SOURCE_TYPE !== 'undefined') ? globalThis.__SOURCE_TYPE : -1;

function _nskey(k) { return String(__ST) + ':' + k; }

function setState(key, value) {
    return _call('state', { op: 'set', key: _nskey(key), value: value });
}

function getState(key) {
    return _call('state', { op: 'get', key: _nskey(key) });
}

/* ---------------- 设置（持久化、按源隔离） ---------------- */

function setSetting(key, value) {
    return _call('setting', { op: 'set', type: __ST, key: key, value: value });
}

function getSetting(key, def) {
    var v = _call('setting', { op: 'get', type: __ST, key: key });
    return (v === null || v === undefined) ? (def === undefined ? null : def) : v;
}

/* ---------------- 登录（持久化、按源隔离） ---------------- */

function getLogin() {
    return _call('login', { op: 'get', type: __ST });
}

function setLogin(value) {
    return _call('login', { op: 'set', type: __ST, value: value });
}

function clearLogin() {
    return _call('login', { op: 'clear', type: __ST });
}

/* ---------------- 漫画源基类 ---------------- */

/* 声明一个漫画源可能用到的全部接口，默认给出空实现（返回 null / 空数组）。
 * 具体源应继承本类（class extends MangaSource）并覆写所需方法：
 *   - 未覆写的方法自动继承基类默认实现（宿主不会暴露成全局函数，
 *     因此 hasFunction/hasLogin 等检测与旧版一致，只对真实实现生效）；
 *   - 覆写的方法会被 installSource() 暴露为全局函数供宿主调用。
 * 元数据（type/title/baseUrl/hosts/cidRegex/webConfig）在构造时经 super(meta) 传入。
 */
function MangaSource(meta) {
    meta = meta || {};
    this.type = meta.type;
    this.title = meta.title;
    this.baseUrl = meta.baseUrl;
    this.hosts = meta.hosts || [];
    this.cidRegex = meta.cidRegex || '';
    this.webConfig = meta.webConfig;
    this.version = meta.version;
}

/* ---- 元数据 ---- */
MangaSource.prototype.getBaseUrl = function () { return this.baseUrl; };

/* ---- 搜索 ---- */
MangaSource.prototype.getSearchRequest = function (keyword, page) { return null; };
MangaSource.prototype.parseSearch = function (html, page) { return []; };

/* ---- 详情 ---- */
MangaSource.prototype.getInfoRequest = function (cid) { return null; };
MangaSource.prototype.parseInfo = function (html, cid) { return null; };

/* ---- 章节 ---- */
MangaSource.prototype.getChapterRequest = function (html, cid) { return null; };
MangaSource.prototype.parseChapter = function (html, comicJson) { return null; };

/* ---- 图片 ---- */
MangaSource.prototype.getImagesRequest = function (cid, path) { return null; };
MangaSource.prototype.parseImages = function (html, chapter) { return []; };

/* ---- 懒加载 ---- */
MangaSource.prototype.getLazyRequest = function (url) { return null; };
MangaSource.prototype.parseLazy = function (html, url) { return null; };

/* ---- 更新检查 ---- */
MangaSource.prototype.getCheckRequest = function (cid) { return null; };
MangaSource.prototype.parseCheck = function (html) { return null; };

/* ---- 分类 ---- */
MangaSource.prototype.getCategories = function () { return null; };
MangaSource.prototype.getCategoryRequest = function (format, page) { return null; };
MangaSource.prototype.parseCategory = function (html, page) { return []; };

/* ---- 请求头（referer 等，可选） ---- */
MangaSource.prototype.getHeader = function () { return null; };

/* ---- 其它工具 ---- */
MangaSource.prototype.getUrl = function (cid) { return null; };

/* ---- 登录 / 设置 ---- */
MangaSource.prototype.login = function (params) { return null; };
MangaSource.prototype.getLoginState = function () { return null; };
MangaSource.prototype.logout = function () {};
MangaSource.prototype.getSettings = function () { return []; };
/* 设置按钮动作（如签到）：type 为 callback 的设置项点击时调用，返回 {success, message} */
MangaSource.prototype.onSettingsAction = function (key) { return null; };

/* 所有可被宿主调用的方法名（也是源脚本需遵守的接口契约） */
var __SOURCE_METHODS = [
    'getUrl', 'getHeader',
    'getSearchRequest', 'parseSearch',
    'getInfoRequest', 'parseInfo',
    'getChapterRequest', 'parseChapter',
    'getImagesRequest', 'parseImages',
    'getLazyRequest', 'parseLazy',
    'getCheckRequest', 'parseCheck',
    'getCategories', 'getCategoryRequest', 'parseCategory',
    'login', 'getLoginState', 'logout', 'getSettings', 'onSettingsAction'
];

/* 把源实例暴露给宿主：
 *   1. 仅把「覆写过的」方法（≠ 基类默认实现）绑定为全局函数，保持 hasFunction 检测正确；
 *   2. 把实例挂到全局 SOURCE（宿主据此读取 type/title/baseUrl/webConfig 等元数据）。 */
function installSource(src) {
    for (var i = 0; i < __SOURCE_METHODS.length; i++) {
        (function (name) {
            var method = src[name];
            if (typeof method === 'function' && method !== MangaSource.prototype[name]) {
                globalThis[name] = function () { return method.apply(src, arguments); };
            }
        })(__SOURCE_METHODS[i]);
    }
    globalThis.SOURCE = src;
    return src;
}

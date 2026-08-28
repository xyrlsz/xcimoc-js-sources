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
 * 主要用于登录等需要发起请求并读取响应头/响应体的场景；常规解析请用 getXxxRequest。
 *
 * 内置「登录过期自动重登」：若响应为 401（登录态失效/被服务端拒绝），
 * 且非登录接口本身、源声明了 login()、本地存有账号密码，则用已保存的凭据
 * 自动重新登录，并重试该请求一次。 */
function fetch(url, options) {
    options = options || {};
    var doReq = function () {
        return _call('fetch', {
            url: url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body === undefined ? null : options.body,
            contentType: options.contentType || null
        });
    };
    var first = doReq();
    if (first && first.status === 401 && !__isLoginRequest(url) && tryRelogin()) {
        log('[fetch] 401 → 已自动重新登录并重试: ' + url);
        return doReq();
    }
    return first;
}

var __reloginLock = false;

/* 判断是否为登录接口本身（避免对登录请求做 401 自动重登 → 死循环） */
function __isLoginRequest(url) {
    return /login|sign_in/i.test(String(url || ''));
}

/* 从宿主登录态读取已保存的账号密码（兼容 account/username 两种键） */
function __readCredentials() {
    try {
        var l = getLogin();
        if (!l) return null;
        var o = JSON.parse(l);
        var account = o.account || o.username || '';
        var password = o.password || '';
        return (account && password) ? { account: account, password: password } : null;
    } catch (e) {
        return null;
    }
}

/* 用已保存的账号密码自动重新登录；成功返回 true。
 * 宿主（App 的 JsMangaParser / 调试工具）在收到 401 后也可直接调用本函数。 */
function tryRelogin() {
    var src = (typeof globalThis.SOURCE !== 'undefined') ? globalThis.SOURCE : null;
    var creds = __readCredentials();
    if (!creds || !src || typeof src.login !== 'function') return false;
    if (__reloginLock) return false;
    __reloginLock = true;
    try {
        var r = src.login(creds);
        return !!(r && r.success);
    } catch (e) {
        log('[relogin] error: ' + e);
        return false;
    } finally {
        __reloginLock = false;
    }
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

/* 正则匹配，返回多个指定分组组成的数组（对齐 Java StringUtils.match(..., g1, g2)）；不匹配返回 null */
function matchArray(regex, str, g1, g2) {
    if (str === null || str === undefined) return null;
    var m = new RegExp(regex).exec(String(str));
    if (!m) return null;
    var out = [];
    if (g1 !== undefined && m[g1] !== undefined) out.push(m[g1]);
    if (g2 !== undefined && m[g2] !== undefined) out.push(m[g2]);
    return out;
}

/* 按分隔符 split，返回指定下标；未指定下标返回整个数组。
 * 对齐 Java StringUtils.split：index 为负时表示从末尾倒数（array.length + index）。 */
function split(str, sep, index) {
    if (str === null || str === undefined) return null;
    var arr = String(str).split(sep);
    if (index === undefined) return arr;
    var pos = index;
    if (pos < 0) pos = arr.length + pos;
    return (pos >= 0 && pos < arr.length) ? arr[pos] : null;
}

/* 从字符串中提取第一个完整合法的 JSON 对象/数组（对齐 Java StringUtils.extractJson）。
 * 用花括号/方括号计数（忽略字符串内的干扰符号），在根级别归零且首尾匹配时返回候选片段。 */
function extractJson(input) {
    if (input === null || input === undefined) return null;
    input = String(input);
    var start = -1, braceCount = 0, bracketCount = 0, inString = false, prev = 0;
    for (var i = 0; i < input.length; i++) {
        var c = input.charAt(i);
        if (start === -1) {
            if (c === '{' || c === '[') {
                start = i;
                if (c === '{') braceCount++; else bracketCount++;
            }
            continue;
        }
        if (c === '"' && prev !== '\\') inString = !inString;
        if (!inString) {
            if (c === '{') braceCount++;
            else if (c === '}') braceCount--;
            else if (c === '[') bracketCount++;
            else if (c === ']') bracketCount--;
        }
        if (braceCount === 0 && bracketCount === 0) {
            var startChar = input.charAt(start);
            if ((startChar === '{' && c === '}') || (startChar === '[' && c === ']')) {
                var candidate = input.substring(start, i + 1);
                try { JSON.parse(candidate); return candidate; }
                catch (e) { return null; }
            }
        }
        prev = c;
    }
    return null;
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

/* URL 编码（宿主优先，失败回退纯 JS；对齐 java.net.URLEncoder：UTF-8，空格→'+'） */
function urlEncode(str) {
    try {
        var h = _call('urlencode', { data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    if (str === null || str === undefined) return '';
    return encodeURIComponent(String(str)).replace(/%20/g, '+');
}

/* URL 解码（宿主优先，失败回退纯 JS；对齐 java.net.URLDecoder：'+'→空格，UTF-8） */
function urlDecode(str) {
    try {
        var h = _call('urldecode', { data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    if (str === null || str === undefined) return '';
    try {
        return decodeURIComponent(String(str).replace(/\+/g, ' '));
    } catch (e) {
        return '';
    }
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

/* eval 求值 packed 脚本，返回其中指定变量（name）的值（对齐 Java DecryptionUtils.evalDecrypt(code, name)） */
function evalDecryptVar(code, name) {
    var result;
    try {
        result = eval(code);
    } catch (e) {
        return '';
    }
    if ((result === undefined || result === null) && name) {
        try { result = eval(name); } catch (e2) { }
    }
    return (result === undefined || result === null) ? '' : String(result);
}

/* ---------- 以下均为纯 JS 实现（不依赖宿主），对齐原 JsHost 的语义 ---------- */

/* ---------------- Base64（对齐 Base64Utils：UTF-8、无换行、容忍无 padding） ---------------- */

var _B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* 字节数组 → 标准 Base64（含 padding，无换行） */
function _bytesToBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i], b1 = (i + 1 < bytes.length) ? bytes[i + 1] : 0, b2 = (i + 2 < bytes.length) ? bytes[i + 2] : 0;
        out += _B64_CHARS.charAt(b0 >> 2);
        out += _B64_CHARS.charAt(((b0 & 3) << 4) | (b1 >> 4));
        out += (i + 1 < bytes.length) ? _B64_CHARS.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=';
        out += (i + 2 < bytes.length) ? _B64_CHARS.charAt(b2 & 63) : '=';
    }
    return out;
}

/* Base64 → 字节数组；urlSafe 为真时按 base64url（-/_）解码。解码失败返回 null。 */
function _base64ToBytes(b64, urlSafe) {
    if (b64 === null || b64 === undefined) return null;
    var str = String(b64).replace(/[\r\n\t \f]/g, '');
    if (urlSafe) str = str.replace(/-/g, '+').replace(/_/g, '/');
    var out = [];
    var n = str.length;
    for (var i = 0; i < n; i += 4) {
        var c0 = _B64_CHARS.indexOf(str.charAt(i));
        var c1 = _B64_CHARS.indexOf(str.charAt(i + 1));
        var c2 = (i + 2 < n) ? _B64_CHARS.indexOf(str.charAt(i + 2)) : -1;
        var c3 = (i + 3 < n) ? _B64_CHARS.indexOf(str.charAt(i + 3)) : -1;
        if (c0 < 0 || c1 < 0) return null;
        var b0 = (c0 << 2) | (c1 >> 4);
        out.push(b0 & 0xff);
        if (c2 >= 0 && str.charAt(i + 2) !== '=') {
            var b1 = ((c1 & 15) << 4) | (c2 >> 2);
            out.push(b1 & 0xff);
            if (c3 >= 0 && str.charAt(i + 3) !== '=') {
                var b2 = ((c2 & 3) << 6) | c3;
                out.push(b2 & 0xff);
            }
        }
    }
    return out;
}

/* 字符串 → 标准 Base64（宿主优先，失败回退纯 JS，对齐 Base64Utils.encodeToString） */
function base64Encode(str) {
    try {
        var h = _call('base64', { op: 'encode', data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    return _bytesToBase64(_strToBytes(str === null || str === undefined ? '' : String(str)));
}

/* 标准 Base64 → UTF-8 字符串（宿主优先，失败回退纯 JS，失败返回 null） */
function base64Decode(str) {
    try {
        var h = _call('base64', { op: 'decode', data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    var bytes = _base64ToBytes(str, false);
    return bytes === null ? null : _bytesToStr(bytes);
}

/* base64url → UTF-8 字符串（宿主优先，失败回退纯 JS，失败返回 null） */
function base64UrlDecode(str) {
    try {
        var h = _call('base64', { op: 'url', data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    var bytes = _base64ToBytes(str, true);
    return bytes === null ? null : _bytesToStr(bytes);
}

/* ---------------- MD5（对齐 HashUtils.MD5：UTF-8，小写 hex） ---------------- */

var _MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

var _MD5_K = [0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391];

function _md5RotateLeft(x, c) {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/* RFC 1321 MD5，输入按 UTF-8 处理，返回小写 hex（宿主优先，失败回退纯 JS） */
function md5(str) {
    try {
        var h = _call('md5', { data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    return _md5(str);
}

function _md5(str) {
    var msg = _strToBytes(str === null || str === undefined ? '' : String(str));
    var bitLenLow = (msg.length << 3) & 0xffffffff;
    var bitLenHigh = Math.floor(msg.length / 0x20000000);
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (var bi = 0; bi < 4; bi++) msg.push((bitLenLow >>> (8 * bi)) & 0xff);
    for (var bj = 0; bj < 4; bj++) msg.push((bitLenHigh >>> (8 * bj)) & 0xff);

    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
    var M = new Array(16);
    for (var offset = 0; offset < msg.length; offset += 64) {
        for (var j = 0; j < 16; j++) {
            M[j] = (msg[offset + j * 4] | (msg[offset + j * 4 + 1] << 8) | (msg[offset + j * 4 + 2] << 16) | (msg[offset + j * 4 + 3] << 24)) >>> 0;
        }
        var A = h0, B = h1, C = h2, D = h3;
        for (var i = 0; i < 64; i++) {
            var F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + _MD5_K[i] + M[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + _md5RotateLeft(F, _MD5_S[i])) >>> 0;
        }
        h0 = (h0 + A) >>> 0;
        h1 = (h1 + B) >>> 0;
        h2 = (h2 + C) >>> 0;
        h3 = (h3 + D) >>> 0;
    }

    function wordToHex(v) {
        var s = '';
        for (var k = 0; k < 4; k++) {
            var b = (v >>> (8 * k)) & 0xff;
            s += (b < 16 ? '0' : '') + b.toString(16);
        }
        return s;
    }
    return wordToHex(h0) + wordToHex(h1) + wordToHex(h2) + wordToHex(h3);
}

/* ---------------- LZ-string Base64 解压（对齐 DecryptionUtils.LZ64Decrypt） ---------------- */

var _LZ_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
var _LZ_BASE64_DICT = null;
function _lzGetBaseValue(alphabet, c) {
    if (!_LZ_BASE64_DICT) {
        _LZ_BASE64_DICT = {};
        for (var i = 0; i < alphabet.length; i++) _LZ_BASE64_DICT[alphabet.charAt(i)] = i;
    }
    return _LZ_BASE64_DICT[c];
}

function _lzDecompress(length, resetValue, getNextValue) {
    var dictionary = [], next, enlargeIn = 4, dictSize = 4, numBits = 3, entry = '', result = [];
    var i, w, bits, resb, maxpower, power, c;
    var data = { val: getNextValue(0), position: resetValue, index: 1 };
    for (i = 0; i < 3; i += 1) dictionary[i] = i;

    bits = 0;
    maxpower = 4;
    power = 1;
    while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
    }
    switch (next = bits) {
        case 0:
            bits = 0; maxpower = 256; power = 1;
            while (power !== maxpower) {
                resb = data.val & data.position; data.position >>= 1;
                if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
                bits |= (resb > 0 ? 1 : 0) * power; power <<= 1;
            }
            c = String.fromCharCode(bits); break;
        case 1:
            bits = 0; maxpower = 65536; power = 1;
            while (power !== maxpower) {
                resb = data.val & data.position; data.position >>= 1;
                if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
                bits |= (resb > 0 ? 1 : 0) * power; power <<= 1;
            }
            c = String.fromCharCode(bits); break;
        case 2:
            return '';
    }
    dictionary[3] = c;
    w = c;
    result.push(c);

    while (true) {
        if (data.index > length) return '';
        bits = 0; maxpower = Math.pow(2, numBits); power = 1;
        while (power !== maxpower) {
            resb = data.val & data.position; data.position >>= 1;
            if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
            bits |= (resb > 0 ? 1 : 0) * power; power <<= 1;
        }
        switch (c = bits) {
            case 0:
                bits = 0; maxpower = 256; power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position; data.position >>= 1;
                    if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
                    bits |= (resb > 0 ? 1 : 0) * power; power <<= 1;
                }
                dictionary[dictSize++] = String.fromCharCode(bits);
                c = dictSize - 1; enlargeIn--; break;
            case 1:
                bits = 0; maxpower = 65536; power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position; data.position >>= 1;
                    if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); }
                    bits |= (resb > 0 ? 1 : 0) * power; power <<= 1;
                }
                dictionary[dictSize++] = String.fromCharCode(bits);
                c = dictSize - 1; enlargeIn--; break;
            case 2:
                return result.join('');
        }
        if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
        if (dictionary[c]) {
            entry = dictionary[c];
        } else {
            if (c === dictSize) entry = w + w.charAt(0);
            else return '';
        }
        result.push(entry);
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;
        w = entry;
        if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
    }
}

/* 对齐 DecryptionUtils.LZ64Decrypt：base64 编码的 LZ-string 压缩串 → 原文（宿主优先，失败回退纯 JS） */
function LZ64Decrypt(str) {
    try {
        var h = _call('lz64', { data: str === null || str === undefined ? '' : String(str) });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    return _lz64Decrypt(str);
}

function _lz64Decrypt(str) {
    if (str === null || str === undefined) return '';
    if (str === '') return '';
    return _lzDecompress(str.length, 32, function (index) {
        return _lzGetBaseValue(_LZ_BASE64, str.charAt(index));
    });
}

/* ---------------- AES-CBC / PKCS7（对齐 Javax.Cipher AES/CBC/PKCS7Padding） ---------------- */

var _AES_SBOX = [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16];

var _AES_RSBOX = [0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
    0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
    0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
    0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
    0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
    0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
    0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
    0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
    0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
    0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
    0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d];

var _AES_RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function _aesGmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}

/* 密钥扩展：返回 (Nr+1)*4 个 32 位字 */
function _aesKeyExpansion(key) {
    var Nk = key.length / 4;
    var Nr = Nk + 6;
    var w = new Array((Nr + 1) * 4);
    var i;
    for (i = 0; i < Nk; i++) {
        w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
    }
    var rcon = 1;
    for (i = Nk; i < (Nr + 1) * 4; i++) {
        var temp = w[i - 1];
        if (i % Nk === 0) {
            temp = ((temp << 8) | (temp >>> 24)) >>> 0; // RotWord
            temp = ((_AES_SBOX[(temp >>> 24) & 0xff] << 24) | (_AES_SBOX[(temp >>> 16) & 0xff] << 16) |
                (_AES_SBOX[(temp >>> 8) & 0xff] << 8) | _AES_SBOX[temp & 0xff]) >>> 0;
            temp = (temp ^ (_AES_RCON[rcon++] << 24)) >>> 0;
        } else if (Nk > 6 && (i % Nk) === 4) {
            temp = ((_AES_SBOX[(temp >>> 24) & 0xff] << 24) | (_AES_SBOX[(temp >>> 16) & 0xff] << 16) |
                (_AES_SBOX[(temp >>> 8) & 0xff] << 8) | _AES_SBOX[temp & 0xff]) >>> 0;
        }
        w[i] = (w[i - Nk] ^ temp) >>> 0;
    }
    return w;
}

function _aesRoundKey(w, r) {
    var out = new Array(16);
    for (var i = 0; i < 4; i++) {
        var word = w[4 * r + i];
        out[4 * i] = (word >>> 24) & 0xff;
        out[4 * i + 1] = (word >>> 16) & 0xff;
        out[4 * i + 2] = (word >>> 8) & 0xff;
        out[4 * i + 3] = word & 0xff;
    }
    return out;
}

function _aesAddRoundKey(s, rk) {
    for (var i = 0; i < 16; i++) s[i] ^= rk[i];
}

function _aesInvShiftRows(s) {
    var t;
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
}

function _aesInvSubBytes(s) {
    for (var i = 0; i < 16; i++) s[i] = _AES_RSBOX[s[i]];
}

function _aesInvMixColumns(s) {
    for (var c = 0; c < 4; c++) {
        var base = 4 * c; // 状态按 s[row + 4*col] 存储，列 c 占 [4c, 4c+3]
        var a = s[base], b = s[base + 1], d = s[base + 2], e = s[base + 3];
        s[base] = _aesGmul(a, 14) ^ _aesGmul(b, 11) ^ _aesGmul(d, 13) ^ _aesGmul(e, 9);
        s[base + 1] = _aesGmul(a, 9) ^ _aesGmul(b, 14) ^ _aesGmul(d, 11) ^ _aesGmul(e, 13);
        s[base + 2] = _aesGmul(a, 13) ^ _aesGmul(b, 9) ^ _aesGmul(d, 14) ^ _aesGmul(e, 11);
        s[base + 3] = _aesGmul(a, 11) ^ _aesGmul(b, 13) ^ _aesGmul(d, 9) ^ _aesGmul(e, 14);
    }
}

function _aesDecryptBlock(inBlock, w, Nr) {
    var s = inBlock.slice();
    var r;
    _aesAddRoundKey(s, _aesRoundKey(w, Nr));
    for (r = Nr - 1; r > 0; r--) {
        _aesInvShiftRows(s);
        _aesInvSubBytes(s);
        _aesAddRoundKey(s, _aesRoundKey(w, r));
        _aesInvMixColumns(s);
    }
    _aesInvShiftRows(s);
    _aesInvSubBytes(s);
    _aesAddRoundKey(s, _aesRoundKey(w, 0));
    return s;
}

/* AES-CBC 解密（key/iv 为 UTF-8 字节），密文长度须为 16 的倍数，PKCS7 去填充 */
function _aesCbcDecryptBytes(cipherBytes, keyBytes, ivBytes) {
    if (!cipherBytes || cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) return null;
    var Nk = keyBytes.length / 4;
    if (Nk !== 4 && Nk !== 6 && Nk !== 8) return null;
    var Nr = Nk + 6;
    var w = _aesKeyExpansion(keyBytes);
    var out = [];
    var prev = ivBytes;
    for (var i = 0; i < cipherBytes.length; i += 16) {
        var block = cipherBytes.slice(i, i + 16);
        var dec = _aesDecryptBlock(block, w, Nr);
        for (var j = 0; j < 16; j++) out.push(dec[j] ^ prev[j]);
        prev = block;
    }
    var pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (var k = out.length - pad; k < out.length; k++) {
        if (out[k] !== pad) return null;
    }
    return out.slice(0, out.length - pad);
}

/* AES-CBC 解密（宿主优先，失败回退纯 JS）；iv 缺省时使用密文前 16 字节作为 IV（对齐宿主 handleAesCbc） */
function aesCbcDecrypt(value, key, iv) {
    try {
        var args = { value: value === null || value === undefined ? '' : String(value), key: key === null || key === undefined ? '' : String(key) };
        if (iv === undefined || iv === null) {
            args.ivPrefix = true;
        } else {
            args.iv = iv;
        }
        var h = _call('aes_cbc', args);
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    return _aesCbcDecrypt(value, key, iv);
}

function aesCbcDecryptWithIvPrefix(value, key) {
    try {
        var h = _call('aes_cbc', { value: value === null || value === undefined ? '' : String(value), key: key === null || key === undefined ? '' : String(key), ivPrefix: true });
        if (h !== null && h !== undefined) return h;
    } catch (e) { }
    return _aesCbcDecryptWithIvPrefix(value, key);
}

function _aesCbcDecrypt(value, key, iv) {
    if (value === null || value === undefined || key === null || key === undefined) return '';
    try {
        var keyBytes = _strToBytes(String(key));
        if (!iv) {
            // ivPrefix 模式：密文为 base64，前 16 字节作 IV，其余为密文
            var all = _base64ToBytes(String(value), false);
            if (!all || all.length <= 16) return '';
            var dec = _aesCbcDecryptBytes(all.slice(16), keyBytes, all.slice(0, 16));
            return dec === null ? '' : _bytesToStr(dec);
        }
        var cipherB64 = String(value);
        // 对齐宿主：hex 密文先转字节再转 base64
        if (/^[0-9a-fA-F]+$/.test(cipherB64) && cipherB64.length % 2 === 0) {
            cipherB64 = _bytesToBase64(hexToBytes(cipherB64));
        }
        var cipherBytes = _base64ToBytes(cipherB64, false);
        if (cipherBytes === null) return '';
        var ivBytes = _strToBytes(String(iv));
        var d = _aesCbcDecryptBytes(cipherBytes, keyBytes, ivBytes);
        return d === null ? '' : _bytesToStr(d);
    } catch (e) {
        return '';
    }
}

function _aesCbcDecryptWithIvPrefix(value, key) {
    return _aesCbcDecrypt(value, key, null);
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
    this.cidQuery = meta.cidQuery || '';
    this.webConfig = meta.webConfig;
    this.version = meta.version;
    // 默认启用状态（缺省为 true）：宿主新增该源时按其默认启/禁用
    this.defaultEnable = meta.defaultEnable !== undefined ? meta.defaultEnable : true;
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

/* ---- 分类 ----
 * getCategories() 返回的分类定义（宿主据此渲染分类下拉与请求 format）：
 *   {
 *     composite: true,                  // true=用 format 模板渲染 URL；false=宿主生成 JSON 参数给 getCategoryRequest
 *     pageSize: 50,                     // 可选，分页每页条数（默认 20），用于填充 {offset}/{limit}
 *     format: 'https://…/list-{subject}-{area}-{progress}-{order}-p{page}',
 *                                       // 含 {subject}/{area}/{reader}/{year}/{progress}/{order}/{page}/{offset}/{limit} 占位符
 *     allValue: 'all',                  // 可选，「全部」哨兵。值为空串时替换为它，避免后端不接受空值。
 *                                       //   可为单个字符串（作用于所有维度）或对象 {subject:'all',area:'all',…}（按维度）。
 *                                       //   不声明则保持空串（后端接受空=全部的源无需声明）。
 *     subject:  [ {title:'全部',value:'all'}, … ],   // 各维度选项（title=显示名，value=填入 format/请求的值）
 *     area:     [ … ], reader: [ … ], year: [ … ],
 *     progress: [ … ], order: [ … ]
 *   }
 * 「全部」的兼容性：不同后端对“全部”的表示不同——有的接受空串，有的需要真实占位值
 * （如 baozi 用 'all'、zaimanhua 用 '0'）。优先直接给「全部」填后端接受的哨兵值；
 * 若后端不接受空值且无法用固定哨兵表达（如 komiic 的 GraphQL 需换查询），则在
 * getCategoryRequest 里显式特判空值（见 sources/komiic.js 的 hotComics 分支）。
 */
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


/* 字节数组 ↔ 字符串（UTF-8）辅助 */
function _strToBytes(str) {
    if (str === null || str === undefined) return [];
    var out = [];
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) {
            out.push(c);
        } else if (c < 0x800) {
            out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
        } else if (c < 0xD800 || c >= 0xE000) {
            out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else {
            // 代理对（两个码元组成一个补充平面字符）
            i++;
            var c2 = str.charCodeAt(i);
            var cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
            out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        }
    }
    return out;
}

function _bytesToStr(bytes) {
    if (!bytes) return '';
    var out = [];
    for (var i = 0; i < bytes.length;) {
        var b = bytes[i];
        if (b < 0x80) {
            out.push(String.fromCharCode(b)); i++;
        } else if (b < 0xE0) {
            out.push(String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F))); i += 2;
        } else if (b < 0xF0) {
            out.push(String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F))); i += 3;
        } else {
            var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
            cp -= 0x10000;
            out.push(String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF))); i += 4;
        }
    }
    return out.join('');
}

/* UTF-8 编解码（返回字符串形态的字节序列） */
function utf8Encode(str) {
    var bytes = _strToBytes(str);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
}
function utf8Decode(s) {
    if (s === null || s === undefined) return '';
    var bytes = [];
    for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    return _bytesToStr(bytes);
}

/* 字节 ↔ hex 字符串 */
function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        out += (h.length === 1 ? '0' : '') + h;
    }
    return out;
}
function hexToBytes(hex) {
    hex = String(hex || '').replace(/\s+/g, '');
    if (hex.length % 2 !== 0) hex = '0' + hex;
    var out = [];
    for (var i = 0; i < hex.length; i += 2) {
        out.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return out;
}
/* 字符串 → UTF-8 字节的 hex */
function hexEncode(str) { return bytesToHex(_strToBytes(str)); }
/* hex → UTF-8 字符串 */
function hexDecode(hex) { return _bytesToStr(hexToBytes(hex)); }

var Convert = {
    encodeUtf8: utf8Encode,
    decodeUtf8: utf8Decode,
    encodeBase64: function (str) { return base64Encode(str); },
    decodeBase64: function (str) { return base64Decode(str); },
    md5: function (str) { return md5(str); },
    hexEncode: hexEncode,
    hexDecode: hexDecode,
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes
};

/* UUID v4 */
function createUuid() {
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return s.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/* 随机整数 [min, max]（含两端） */
function randomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* 随机浮点数 [min, max) */
function randomDouble(min, max) {
    return Math.random() * (max - min) + min;
}

/* 数组/对象实用工具 */
function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
function contains(str, sub) { return str !== null && str !== undefined && String(str).indexOf(sub) >= 0; }
function startsWith(str, prefix) { return str !== null && str !== undefined && String(str).indexOf(prefix) === 0; }
function endsWith(str, suffix) {
    if (str === null || str === undefined) return false;
    str = String(str);
    return str.indexOf(suffix, str.length - suffix.length) >= 0;
}

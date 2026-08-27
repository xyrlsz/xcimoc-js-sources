// G社漫畫 (GoDaManHua) — 由 Java 源 port（自定义解密算法 + _mid 跨调用状态）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://m.g-mh.org';
const picBaseUrl = 'https://t40-1-4.g-mh.online';
const apiBaseUrl = 'https://api-get-v3.mgsearcher.com';

// ---- 原 DecryptUtil（GoDaManHua.java 内嵌） ----
const GDM_PREFIX = 'J7r';
const GDM_SUFFIX = 'nQ';
const GDM_MAGIC = 'W4s';
const GDM_SEP = 'kD';
const GDM_TABLE1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const GDM_TABLE2 = '_-9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GDM_CHUNK = 7;

// 工具函数（模块级，不暴露为源接口）
function gdmDecrypt(input) {
    if (!input || input.indexOf(GDM_PREFIX) !== 0 || !input.endsWith(GDM_SUFFIX)) return '';
    var body = input.substring(GDM_PREFIX.length, input.length - GDM_SUFFIX.length);
    var totalLen = body.length;
    var effectiveLen = totalLen - GDM_SEP.length - GDM_MAGIC.length;
    var a = Math.floor(effectiveLen / 3);
    var b = Math.ceil((effectiveLen - a) / 2);
    var c = effectiveLen - a - b;
    var part1 = body.substring(0, b);
    var part2 = body.substring(b, b + GDM_SEP.length);
    var part3 = body.substring(b + GDM_SEP.length, b + GDM_SEP.length + c);
    var part4 = body.substring(b + GDM_SEP.length + c, b + GDM_SEP.length + c + GDM_MAGIC.length);
    var part5 = body.substring(b + GDM_SEP.length + c + GDM_MAGIC.length);
    if (part2 !== GDM_SEP || part4 !== GDM_MAGIC || part5.length !== a) return '';
    var merged = part5 + part1 + part3;
    var reversed = '';
    var idx = 0;
    for (var i = 0; i < merged.length; i += GDM_CHUNK, idx++) {
        var chunk = merged.substring(i, Math.min(i + GDM_CHUNK, merged.length));
        if (idx % 2 === 1) chunk = chunk.split('').reverse().join('');
        reversed += chunk;
    }
    var mapped = '';
    for (var j = 0; j < reversed.length; j++) {
        var t = GDM_TABLE2.indexOf(reversed.charAt(j));
        if (t === -1) return '';
        mapped += GDM_TABLE1.charAt(t);
    }
    // 补齐 base64url padding
    while (mapped.length % 4 !== 0) mapped += '=';
    try {
        return base64UrlDecode(mapped);
    } catch (e) {
        return '';
    }
}

// 原 Java 用 SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") + 默认时区解析，
// 'Z' 是字面量，输出保持墙上时间
function formatIsoLocal(s) {
    var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (!m) return s;
    return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 108,
            title: 'G社漫畫',
            baseUrl: 'https://m.g-mh.org',
            hosts: ['manhuafree.com', 'm.g-mh.org'],
            cidRegex: 'manga/([\\w\\-]+)'
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: baseUrl + '/s/' + keyword };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('.cardlist > div.pb-2');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.href('a') || '';
            var parts = href.split('/');
            list.push({
                cid: parts.length > 2 ? parts[2] : href,
                title: node.text('.cardtitle'),
                cover: node.src('.text-center > div > img'),
                update: '',
                author: ''
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: baseUrl + '/manga/' + cid };
    }

    parseInfo(html, cid) {
        var json = match('<script type="application/ld\\+json">(.*?)</script>', html, 1);
        var result = { finish: false };
        if (json) {
            var data = JSON.parse(json);
            var author = '';
            for (var i = 0; i < (data.author || []).length; i++) {
                author += data.author[i].name;
                if (i < data.author.length - 1) author += ',';
            }
            var update = '';
            if (data.hasPart && data.hasPart.datePublished) {
                update = formatIsoLocal(data.hasPart.datePublished);
            }
            result = {
                title: data.name,
                cover: data.image,
                update: update,
                author: author,
                intro: data.description,
                finish: isFinishText(data.creativeWorkStatus)
            };
        }
        var mEls = DOM(html).select('#bookmarkData');
        if (mEls.length) {
            var mid = mEls[0].attr('data-mid') || '';
            setState('mid:' + cid, mid);
        }
        return result;
    }

    getChapterRequest(html, cid) {
        var mid = getState('mid:' + cid);
        if (!mid) {
            var mEls = DOM(html).select('#bookmarkData');
            if (mEls.length) mid = mEls[0].attr('data-mid') || '';
        }
        return {
            url: format('%s/api/v2/manga/get?mid=%s&mode=all', apiBaseUrl, mid),
            headers: { referer: baseUrl + '/' }
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var jsonObject = JSON.parse(html);
        var chapters = jsonObject.data.chapters;
        for (var i = 0; i < chapters.length; i++) {
            list.push({
                title: chapters[i].attributes.title,
                path: String(chapters[i].id)
            });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        var mid = getState('mid:' + cid);
        return {
            url: format('%s/api/v2/chapter/getinfo?m=%s&c=%s', apiBaseUrl, mid, path),
            headers: {
                referer: baseUrl + '/',
                Accept: 'application/json',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
            }
        };
    }

    parseImages(html) {
        var list = [];
        var m = /\{.*\}/.exec(html);
        if (!m) return list;
        try {
            var imagesData = JSON.parse(m[0]).data.info.images.images;
            var json = gdmDecrypt(imagesData);
            if (!json) return list;
            var images = JSON.parse(json);
            for (var i = 1; i <= images.length; i++) {
                list.push({ url: picBaseUrl + images[i - 1].url, lazy: false });
            }
        } catch (e) { /* ignore */ }
        return list;
    }

    getUrl(cid) {
        return format('%s/manga/%s', baseUrl, cid);
    }

    getHeader() {
        return {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            referer: baseUrl + '/'
        };
    }
})());

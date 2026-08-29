// G社漫畫 (GoDaManHua) — 由 Java 源 port（_mid 跨调用状态 + 章节页 WebView 解析图片）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://m.g-mh.org';
const apiBaseUrl = 'https://v2.apikk.top';

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
            cidRegex: 'manga/([\\w\\-]+)',
            webConfig: {
                images: { useWebParser: true }
            }
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
                path: chapters[i].attributes.slug
            });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: format('%s/manga/%s/%s', baseUrl, cid, path)
        };
    }

    parseImages(html) {
        var list = [];
        var imgs = DOM(html).select('div#chapcontent > div > img');
        for (var i = 0; i < imgs.length; i++) {
            var url = imgs[i].attr('data-src');
            if (!url) url = imgs[i].attr('src');
            if (!url) continue;
            list.push({ url: url, lazy: false });
        }
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

// 优酷漫画 (YKMH) — 由 Java 源 port（全站 Cloudflare，需 WebView 渲染）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const mHost = 'https://m.ykmh.net/';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// 工具函数（模块级，不暴露为源接口）
function extractDomainFromPageImage(html) {
    var m = /var pageImage\s*=\s*"([^"]+)"/.exec(html);
    if (m) {
        try {
            var u = new URL(m[1]);
            return u.protocol + '//' + u.host;
        } catch (e) { /* ignore */ }
    }
    return null;
}

function resolveUrl(baseDomain, url) {
    if (!baseDomain) return url;
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0 || url.indexOf('//') === 0) {
        return url;
    }
    return url.indexOf('/') === 0 ? baseDomain + url : baseDomain + '/' + url;
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 91,
            title: '优酷漫画',
            baseUrl: 'https://m.ykmh.net/',
            hosts: ['m.ykmh.net'],
            cidRegex: 'manhua/(\\w.+)',
            webConfig: {
                search: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
                info: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
                chapter: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
                images: { useWebParser: true, autoScroll: false, interactiveChallenge: true }
            }
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: mHost + 'search/?keywords=' + keyword + '&page=' + page,
            headers: { referer: mHost + '/', 'user-agent': UA }
        };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('#update_list > div.UpdateList > div');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var titleNs = node.select('div.itemTxt > a');
            if (!titleNs.length) continue;
            var href = titleNs[0].href() || '';
            list.push({
                cid: href.substring(href.lastIndexOf('/') + 1),
                title: titleNs[0].text(),
                cover: node.attr('div.itemImg > a > img', 'src'),
                update: node.text('p.txtItme > span.date'),
                author: node.text('p > a')
            });
        }
        return list;
    }

    getUrl(cid) {
        return mHost + 'manhua/' + cid + '/';
    }

    getInfoRequest(cid) {
        return {
            url: mHost + 'manhua/' + cid + '/',
            headers: { referer: mHost + '/', 'user-agent': UA }
        };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var info = body.select('div.Introduct_Sub')[0];
        var coverEls = info.select('div#Cover > *');
        var txtItme = info.text('p.txtItme');
        return {
            title: body.text('div#comicName'),
            cover: coverEls.length ? coverEls[0].src() : '',
            update: info.text('p.txtItme > span.date'),
            author: txtItme,
            intro: (body.text('p#full-des') || '').replace('展开', ''),
            finish: txtItme.indexOf('完结') >= 0
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var body = DOM(html);
        var types = body.select('div.comic-chapters > div > div > span.Title');
        var groups = body.select('div.chapter-body');
        for (var j = 0; j < types.length; j++) {
            var type = types[j].text();
            var group = groups[j];
            var nodes = group.select('div.chapter-warp ul.Drama > li > a');
            for (var i = 0; i < nodes.length; i++) {
                var href = nodes[i].href() || '';
                list.push({
                    title: nodes[i].text(),
                    path: href.length > 1 ? href.substring(1) : href,
                    group: type
                });
            }
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: mHost + path,
            headers: { referer: mHost + '/', 'user-agent': UA }
        };
    }

    parseImages(html) {
        var list = [];
        var baseDomain = extractDomainFromPageImage(html) || '';
        var m = /var chapterImages\s*=\s*(\[[\s\S]*?]);/.exec(html);
        if (!m) return list;
        try {
            var array = JSON.parse(m[1]);
            for (var i = 0; i < array.length; i++) {
                var url = String(array[i]);
                var urlDomain = extractDomainFromPageImage(url);
                var fullUrl = urlDomain ? url : resolveUrl(baseDomain, url);
                list.push({ url: fullUrl, lazy: false });
            }
        } catch (e) {
            // ignore
        }
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    getHeader() {
        return { Referer: mHost + '/', 'user-agent': UA };
    }
})());

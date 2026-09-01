// 漫画之家 (ManHuaZhiJia) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://www.manhuahome.com';

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 119,
            title: '漫画之家',
            baseUrl: 'https://www.manhuahome.com',
            hosts: ['manhuahome.com'],
            cidRegex: '(/book/\\d+\\.html)'
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: 'https://www.manhuahome.com/search.html?wd=' + keyword + '&page=' + page };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('div.mg-search-item');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cov = node.attr('.mg-search-thumb', 'data-original');
            list.push({
                cid: node.href('.mg-search-name > a'),
                title: node.text('.mg-search-name'),
                cover: cov ? baseUrl + cov : null,
                update: '',
                author: ''
            });
        }
        return list;
    }

    getUrl(cid) {
        return baseUrl + cid;
    }

    getInfoRequest(cid) {
        if (cid.indexOf('/') !== 0) {
            cid = '/' + cid;
        }
        return { url: this.getUrl(cid) };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = null;
        var update = '';
        var metas = body.select('.mg-detail-meta> li');
        for (var i = 0; i < metas.length; i++) {
            var tmp = metas[i].text() || '';
            if (tmp.indexOf('作者') >= 0) {
                author = tmp.replace('作者：', '').trim();
            } else if (tmp.indexOf('上架时间') >= 0) {
                update = tmp.replace('上架时间：', '').trim();
            }
        }
        var cov = body.src('.mg-banner-cover');
        return {
            title: body.text('.mg-detail-title'),
            cover: cov ? baseUrl + cov : null,
            update: update,
            author: author,
            intro: body.text('.mg-blurb-text'),
            finish: false
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var nodes = DOM(html).select('.mg-chapter-list > li');
        for (var i = 0; i < nodes.length; i++) {
            list.push({ title: nodes[i].text(), path: nodes[i].href('a') });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: baseUrl + path };
    }

    parseImages(html, chapterJson) {
        var list = [];
        // chapterJson 可能是 JS 对象（宿主传入）或 JSON 字符串，兼容两种
        var chapter = chapterJson;
        if (typeof chapter === 'string') {
            try { chapter = JSON.parse(chapter) || {}; } catch (e) { chapter = {}; }
        }
        chapter = chapter || {};
        var m = /"url"\s*:\s*"(\/[^"]+\.jpg(?:\|\|\|\/[^"]+)*?)"/s.exec(html);
        if (!m) return list;
        var urlValue = m[1];
        if (!urlValue) return list;
        var imageList = urlValue.split('|||');
        for (var i = 0; i < imageList.length; i++) {
            var img = imageList[i].trim();
            if (!img) continue;
            if (img.indexOf('/') === 0) {
                img = baseUrl + img;
            }
            list.push({
                url: img,
                lazy: false,
                headers: { Referer: baseUrl + (chapter.path || '') }
            });
        }
        return list;
    }
})());

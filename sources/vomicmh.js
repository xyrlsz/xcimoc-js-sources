// vomic漫 (Vomicmh) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
// 说明：原 Java 需要登录 cookie（SharedPreferences）才能取图；JS 版无登录入口，
// getImagesRequest 返回 null（与 Java 未登录时行为一致），搜索/详情/章节可用。
var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 110,
            title: 'vomic漫',
            baseUrl: 'https://www.vomicmh.com',
            hosts: ['www.vomicmh.com']
        });
        this.baseUrl = 'https://www.vomicmh.com';
    }

    getUrl(cid) {
        return this.baseUrl + '/detail/' + cid;
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: format('%s/so/key/%s/1', this.baseUrl, keyword) };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('div.justify-between > a');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.href() || '';
            var parts = href.split('/');
            var title = node.text('.title');
            if (title.indexOf('&amp;') >= 0) title = title.replace(/&amp;/g, '&');
            list.push({
                cid: parts.length > 2 ? parts[2] : href,
                title: title,
                cover: node.attr('img', 'src'),
                update: null,
                author: null
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: this.baseUrl + '/detail/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var title = (body.text('div.detail > div > div > div') || '').replace(/&amp;/g, '&');
        var author = '', intro = '';
        var nodes = body.select('div.detail > div > div');
        for (var i = 0; i < nodes.length; i++) {
            var text = nodes[i].text() || '';
            if (text.indexOf('作者：') >= 0) {
                author = text.replace('作者：', '').replace(/&amp;/g, '&');
            }
            if (text.indexOf('简介：') >= 0) {
                intro = text.replace('简介：', '').replace(/&amp;/g, '&');
            }
        }
        return {
            title: title,
            cover: body.src('.cover-img > div > img'),
            update: '',
            author: author,
            intro: intro,
            finish: false
        };
    }

    parseChapter(html, comicJson) {
        var nodes = DOM(html).select('div > a.chapter');
        if (!nodes.length) return null;
        var list = [];
        for (var i = 0; i < nodes.length; i++) {
            list.push({ title: nodes[i].text(), path: nodes[i].href() });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        // JS 无登录 cookie，返回 null（Java 未登录时同样返回 null）
        return null;
    }

    parseImages(html) {
        var list = [];
        var nodes = DOM(html).select('#myscroll > img.myimage');
        if (!nodes.length) return null;
        for (var i = 1; i <= nodes.length; i++) {
            list.push({ url: nodes[i - 1].src(), lazy: false });
        }
        return list;
    }

    getHeader() {
        return {
            referer: this.baseUrl + '/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0'
        };
    }
})());

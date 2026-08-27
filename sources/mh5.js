// 漫画屋 (MH5) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://mh5.app';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 116,
            title: '漫画屋',
            baseUrl: 'https://mh5.app',
            hosts: ['mh5.app'],
            cidRegex: '([a-zA-Z0-9]+)',
            webConfig: {
                images: { useWebParser: true }
            }
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: baseUrl + '/index.php/search?key=' + keyword, headers: { 'user-agent': UA } };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('ul.list-comic-book > li');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            list.push({
                cid: (node.href('a') || '').replace(/\//g, ''),
                title: node.text('.comic-info > h2'),
                cover: node.attr('.comic-book > img', 'data-src'),
                update: node.text('.comic-book > p.heat'),
                author: ''
            });
        }
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/' + cid;
    }

    getInfoRequest(cid) {
        return { url: this.getUrl(cid), headers: { 'user-agent': UA } };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var statusText = '';
        var metas = DOM(html).select('meta[property=og:novel:status]');
        if (metas.length) statusText = metas[0].attr('content');
        return {
            title: body.text('.detail-title'),
            cover: body.attr('.banner-img > img', 'data-src'),
            author: body.text('p.author'),
            intro: body.text('.detail-desc'),
            update: body.text('.detail-info-btips .tips:nth-child(1) b'),
            finish: isFinishText(statusText)
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var nodes = DOM(html).select('.chapter-list > .item > a').reverse();
        for (var i = 0; i < nodes.length; i++) {
            list.push({ title: nodes[i].text(), path: nodes[i].href() });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: format('%s/%s', baseUrl, path), headers: { 'user-agent': UA } };
    }

    parseImages(html) {
        var list = [];
        var nodes = DOM(html).select('img.lazy-read');
        for (var i = 1; i <= nodes.length; i++) {
            list.push({ url: nodes[i - 1].attr('data-src'), lazy: false });
        }
        return list;
    }

    getHeader() {
        return { Referer: baseUrl + '/', 'user-agent': UA };
    }
})());

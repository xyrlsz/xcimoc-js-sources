// 古风漫画 (GFMH) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
const baseUrl = 'https://www.gfmh.app';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 114,
            title: '古风漫画',
            baseUrl: 'https://www.gfmh.app',
            hosts: ['www.gfmh.app'],
            webConfig: {
                images: { useWebParser: true }
            }
        });
    }

    getUrl(cid) {
        return baseUrl + '/' + cid + '.html';
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: baseUrl + '/index.php/search?key=' + keyword,
            headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' }
        };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('ul.flex > li.searchresult');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.href('div > a') || '';
            list.push({
                cid: href.substring(1).replace('.html', ''),
                title: node.text('div > a > h3'),
                cover: node.attr('.img_span > a > img', 'data-original'),
                update: '',
                author: ''
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: baseUrl + '/' + cid + '.html' };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        return {
            title: body.text('.novel_info_title > h1'),
            cover: body.src('.novel_info_main > img'),
            author: (body.text('.novel_info_title > i') || '').replace('作者：', ''),
            update: body.text('em.s_gray'),
            intro: body.text('.intro'),
            finish: isFinishText(html)
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var nodes = DOM(html).select('ul#ul_all_chapters > li > a').reverse();
        for (var i = 0; i < nodes.length; i++) {
            var href = nodes[i].href() || '';
            var parts = href.split('/');
            list.push({
                title: nodes[i].text(),
                path: parts.length > 2 ? parts[2].replace('.html', '') : href
            });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: format('%s/%s/%s.html', baseUrl, cid, path) };
    }

    parseImages(html) {
        var list = [];
        var nodes = DOM(html).select('#contents > .lazy-read');
        for (var i = 1; i <= nodes.length; i++) {
            list.push({ url: nodes[i - 1].attr('data-src'), lazy: false });
        }
        return list;
    }

    getHeader() {
        return { referer: baseUrl + '/' };
    }
})());

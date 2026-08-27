// 腾讯动漫 (Tencent) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

// 工具函数（模块级，不暴露为源接口）
function splice(str, from, length) {
    return str.substring(0, from) + str.substring(from + length, str.length);
}

function decodeData(str, nonce) {
    nonce = evalDecrypt(nonce);
    var matches = String(nonce).match(/\d+[a-zA-Z]+/g) || [];
    var len = matches.length;
    while (len-- !== 0) {
        var m = matches[len];
        var off = parseInt(match('^\\d+', m, 0), 10) & 255;
        var del = m.replace(/\d+/g, '').length;
        str = splice(str, off, del);
    }
    return str;
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 51,
            title: '腾讯动漫',
            baseUrl: 'https://m.ac.qq.com/',
            hosts: ['ac.qq.com', 'm.ac.qq.com']
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        // 修正原 Java 的 %s 未替换 bug
        return { url: 'https://m.ac.qq.com/search/result?word=' + keyword };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('.comic-item');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.attr('a', 'href') || '';
            list.push({
                cid: href.indexOf('/comic/index/id/') >= 0 ? href.substring('/comic/index/id/'.length) : href,
                title: node.text('.comic-title'),
                cover: node.attr('.cover-image', 'src'),
                update: node.text('.comic-update'),
                author: ''
            });
        }
        return list;
    }

    getUrl(cid) {
        return 'http://ac.qq.com/Comic/ComicInfo/id/' + cid;
    }

    getInfoRequest(cid) {
        return { url: 'https://m.ac.qq.com/comic/index/id/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        // 对齐原 Java：status = !html.contains("连载中")，即页面不含"连载中"视为已完结
        var finish = html.indexOf('连载中') === -1;
        return {
            title: body.text('div.head-title-tags > h1'),
            cover: body.src('div.head-banner > img'),
            update: '',
            author: body.text('li.author-wr'),
            intro: body.text('div.head-info-desc'),
            finish: finish
        };
    }

    getChapterRequest(html, cid) {
        return { url: 'https://m.ac.qq.com/comic/chapterList/id/' + cid };
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.normal > li.chapter-item');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.href('a') || '';
            // 原 Java 剥离 "/chapter/index/id/518333/cid/" 整段只留路径；
            // 这里按 "/cid/" 定位，兼容不同长度的 cid，避免路径残留 cid 前缀。
            var path = href;
            var ci = href.indexOf('/cid/');
            if (ci >= 0) {
                path = href.substring(ci + '/cid/'.length);
            } else if (href.indexOf('/chapter/index/id/') >= 0) {
                path = href.substring('/chapter/index/id/'.length);
            }
            list.push({
                title: node.text('a'),
                path: path
            });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: format('https://m.ac.qq.com/chapter/index/id/%s/cid/%s', cid, path) };
    }

    parseImages(html) {
        var list = [];
        var str = match("data:\\s*'(.*)?',", html, 1);
        if (!str) return list;
        try {
            var nonce = match('<script>window.*?=(.*?)<\\/script>', html, 1);
            str = decodeData(str, nonce);
            var decoded = base64Decode(str);
            var object = JSON.parse(decoded);
            var picture = object.picture;
            for (var i = 0; i < picture.length; i++) {
                list.push({ url: picture[i].url, lazy: false });
            }
        } catch (e) {
            // ignore
        }
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        return DOM(html).text('div.book-detail > div.cont-list > dl:eq(2) > dd');
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('li > a');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            list.push({
                cid: splitHref(node.href(), 1),
                title: node.text('h3'),
                cover: node.attr('div > img', 'data-src'),
                update: node.text('dl:eq(5) > dd'),
                author: node.text('dl:eq(2) > dd')
            });
        }
        return list;
    }

    getHeader() {
        // 对齐原 Java：Referer + user-agent
        return {
            Referer: 'https://m.ac.qq.com',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
        };
    }
})());

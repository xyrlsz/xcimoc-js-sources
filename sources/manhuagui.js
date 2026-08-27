// 漫画柜 (ManHuaGui) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
let referer = 'https://tw.manhuagui.com/';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 0,
            title: '漫画柜',
            baseUrl: 'https://www.manhuagui.com',
            hosts: ['www.manhuagui.com', 'tw.manhuagui.com', 'm.manhuagui.com'],
            cidRegex: '([\\w\\-]+)'
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: format('https://www.manhuagui.com/s/%s_p%d.html', keyword, page),
            headers: { 'User-Agent': UA }
        };
    }

    parseSearch(html, page) {
        var body = DOM(html);
        var list = [];
        var nodes = body.select('li.cf');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var bcover = node.select('a.bcover');
            var cover = node.attr('a.bcover > img', 'src');
            if (cover) cover = 'https:' + cover;
            list.push({
                cid: bcover.length ? splitHref(bcover[0].href(), 1) : null,
                title: node.text('.book-detail > dl > dt > a'),
                cover: cover,
                update: '',
                author: ''
            });
        }
        return list;
    }

    getUrl(cid) {
        return 'https://tw.manhuagui.com/comic/' + cid;
    }

    getInfoRequest(cid) {
        return {
            url: 'https://tw.manhuagui.com/comic/' + cid + '/',
            headers: { 'User-Agent': UA }
        };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var cover = body.src('p.hcover > img');
        if (cover) cover = 'https:' + cover;
        return {
            title: body.text('div.book-title > h1'),
            cover: cover,
            update: body.text('div.chapter-bar > span.fr > span:eq(1)'),
            author: body.attr('ul.detail-list > li:eq(1) > span:eq(1) > a', 'title'),
            intro: body.text('#intro-cut'),
            finish: isFinishText(body.text('div.chapter-bar > span.fr > span:eq(0)'))
        };
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);
        var groups = body.select('div.chapter-list');
        for (var g = 0; g < groups.length; g++) {
            var uls = groups[g].select('ul').reverse();
            for (var u = 0; u < uls.length; u++) {
                var lis = uls[u].select('li > a');
                for (var l = 0; l < lis.length; l++) {
                    list.push({
                        title: lis[l].attr('title'),
                        path: splitHref(lis[l].href(), 2)
                    });
                }
            }
        }
        return list;
    }

    getImagesRequest(cid, path) {
        var url = format('https://tw.manhuagui.com/comic/%s/%s.html', cid, path);
        referer = url;
        return { url: url, headers: { 'User-Agent': UA } };
    }

    parseImages(html) {
        var list = [];
        var packed = match('\\(function\\(p,a,c,k,e,d\\).*?0,\\{\\}\\)\\)', html, 0);
        if (!packed) return list;
        try {
            var replaceable = split(packed, ',', -3);
            var fake = split(replaceable, "'", 1);
            var real = LZ64Decrypt(fake);
            packed = packed.replace(replaceable, "'" + real + "'.split('|')");
            var result = evalDecrypt(packed);
            var jsonString = extractJson(result);
            var object = JSON.parse(jsonString);
            var path = object.path;
            var e = object.sl.e;
            var m = object.sl.m;
            var files = object.files;
            for (var i = 0; i < files.length; i++) {
                list.push({
                    url: format('https://i.hamreus.com%s%s?e=%s&m=%s', path, files[i], e, m),
                    lazy: false
                });
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
        return DOM(html).text('div.chapter-bar > span.fr > span:eq(1)');
    }

    getHeader() {
        return { Referer: referer, 'User-Agent': UA };
    }
})());

// YY漫画 (YYManHua) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://www.yymanhua.com';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 111,
            title: 'YY漫画',
            baseUrl: 'https://www.yymanhua.com',
            hosts: ['yymanhua.com'],
            cidRegex: '(\\w.+)'
        });
    }

    getUrl(cid) {
        return baseUrl + '/' + cid + '/';
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: baseUrl + '/search?title=' + keyword };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('ul.mh-list > li');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            list.push({
                cid: (node.href('a') || '').replace(/\//g, ''),
                title: node.text('h2.title'),
                cover: node.src('img.mh-cover'),
                update: null,
                author: null
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: this.getUrl(cid) };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = (body.text('p.detail-info-tip > span:nth-child(1)') || '')
            .replace('作者：', '').replace(/ /g, ',');
        return {
            title: body.text('p.detail-info-title'),
            cover: body.src('img.detail-info-cover'),
            update: match('\\d+-\\d+-\\d+', body.text('div.detail-list-form-title'), 0),
            author: author,
            intro: body.text('p.detail-info-content'),
            finish: isFinishText(html)
        };
    }

    parseChapter(html, comicJson) {
        var nodes = DOM(html).select('#chapterlistload > a');
        if (!nodes.length) return null;
        var list = [];
        for (var i = 0; i < nodes.length; i++) {
            list.push({
                title: nodes[i].text(),
                path: (nodes[i].href() || '').replace(/\//g, '')
            });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: baseUrl + '/' + path };
    }

    parseImages(html) {
        var list = [];
        var cid = match('var YYMANHUA_CID\\s*=\\s*(\\d+);', html, 1);
        var mid = match('var YYMANHUA_MID\\s*=\\s*(\\d+);', html, 1);
        var dt = match('var YYMANHUA_VIEWSIGN_DT\\s*=\\s*"(.*?)";', html, 1);
        var sign = match('var YYMANHUA_VIEWSIGN\\s*=\\s*"(.*?)";', html, 1);
        var imgCount = parseInt(match('var YYMANHUA_IMAGE_COUNT\\s*=\\s*(\\d+);', html, 1), 10);
        for (var i = 1; i <= imgCount; i++) {
            var url = baseUrl + '/m' + cid + '/chapterimage.ashx?cid=' + cid + '&page=' + i +
                '&key=&_cid=' + cid + '&_mid=' + mid + '&_dt=' + dt + '&_sign=' + sign;
            list.push({
                url: url,
                lazy: true,
                headers: { Referer: baseUrl + '/' }
            });
        }
        return list;
    }

    getLazyRequest(url) {
        return { url: url, headers: { Referer: baseUrl } };
    }

    parseLazy(html, url) {
        var result = evalDecrypt(html);
        if (result !== undefined && result !== null) {
            return String(result).split(',')[0];
        }
        return null;
    }
})());

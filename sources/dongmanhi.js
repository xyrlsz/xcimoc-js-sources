// 动漫嗨 (DongManHi) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
const baseUrl = 'https://www.dongmanhi.com';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 118,
            title: '动漫嗨',
            baseUrl: 'https://www.dongmanhi.com',
            hosts: ['www.dongmanhi.com']
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: baseUrl + '/search?page=' + page + '&title=' + keyword,
            headers: this.getHeader()
        };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('ul.mh-list > li > div.mh-item');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            list.push({
                cid: getNumber(node.attr('a', 'href')),
                title: node.text('.mh-item-detali > .title'),
                cover: node.src('.mh-cover'),
                update: '',
                author: ''
            });
        }
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/manhua/' + cid + '/';
    }

    getInfoRequest(cid) {
        return { url: this.getUrl(cid), headers: this.getHeader() };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = '';
        var status = false;
        var nodes = body.select('.detail-info-tip > span');
        for (var i = 0; i < nodes.length; i++) {
            var text = nodes[i].text() || '';
            if (text.indexOf('作者：') >= 0) {
                author = text.replace('作者：', '');
            }
            if (text.indexOf('状态：') >= 0) {
                status = isFinishText(text.replace('状态：', ''));
            }
        }
        return {
            title: body.text('.detail-info-title'),
            cover: body.src('.detail-info-cover'),
            update: '',
            author: author,
            intro: body.text('.detail-info-content'),
            finish: status
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var nodes = DOM(html).select('li.detail-list-form-item');
        for (var i = 0; i < nodes.length; i++) {
            list.push({
                title: nodes[i].text('a'),
                path: nodes[i].attr('a', 'href')
            });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: path, headers: this.getHeader() };
    }

    parseImages(html) {
        var list = [];
        var nodes = DOM(html).select('#cp_img > div');
        var i = 1;
        for (var j = 0; j < nodes.length; j++) {
            var url = nodes[j].attr('img', 'data-original');
            if (!url) url = nodes[j].attr('img', 'src');
            if (url) {
                list.push({ url: url, lazy: false });
                i++;
            }
        }
        return list;
    }

    getHeader() {
        return {
            referer: baseUrl + '/',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
        };
    }
})());

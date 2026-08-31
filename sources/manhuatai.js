// 漫画台 (Manhuatai) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 49,
            title: '漫画台',
            baseUrl: 'https://www.kanman.com',
            hosts: ['www.kanman.com', 'm.kanman.com'],
            cidRegex: '(\\d+)'
        });
    }

    getSearchRequest(keyword, page) {
        return {
            url: format('%s/api/getsortlist/?product_id=2&productname=mht&platformname=wap&orderby=click&search_key=%s&page=%d&size=48',
                this.baseUrl, encodeURIComponent(keyword), page)
        };
    }

    parseSearch(html, page) {
        var list = [];
        var data = JSON.parse(html).data.data;
        for (var i = 0; i < data.length; i++) {
            var object = data[i];
            list.push({
                cid: String(object.comic_id),
                title: object.comic_name,
                cover: 'https://image.yqmh.com/mh/' + object.comic_id + '.jpg-300x400.webp',
                // update_time 本身是毫秒（13 位），不能再 *1000；formatTimestamp 会自动识别秒/毫秒
                update: formatTimestamp(object.update_time, true),
                author: object.comic_author
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: 'https://www.kanman.com/' + cid + '/' };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = body.text("div.introduce-box[data-index='0'] .username a");
        var index = author.indexOf('|');
        if (index > 0) {
            author = author.substring(0, index - 1);
        }
        var update = (body.text('.hd > span') || '').replace('更新至', '').trim();
        update = update.substring(0, Math.min(10, update.length));
        return {
            title: body.attr('h1.title', 'title'),
            cover: 'https://image.yqmh.com/mh/' + cid + '.jpg-300x400.webp',
            update: update,
            author: author,
            intro: body.text('.introduce .content'),
            finish: false
        };
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ol#j_chapter_list > li > a');
        for (var i = 0; i < nodes.length; i++) {
            list.push({
                title: nodes[i].attr('title'),
                path: splitHref(nodes[i].href(), 1)
            });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: format('https://www.kanman.com/%s/%s.html', cid, path) };
    }

    parseImages(html) {
        var list = [];
        try {
            // 真实页面 window.comicInfo 是 JS 对象字面量（键未加引号、含 !0 等），
            // JSON.parse 会抛错，故直接提取所需字段；chapter_img_list 本身是合法 JSON 数组。
            var imgUrl = JSON.parse(match('chapter_img_list\\s*:\\s*(\\[[\\s\\S]*?\\])(?:,|\\})', html, 1) || '[]');
            var start = parseInt(match('start_num\\s*:\\s*(\\d+)', html, 1), 10);
            var end = parseInt(match('end_num\\s*:\\s*(\\d+)', html, 1), 10);
            for (var index = start; index <= end; index++) {
                list.push({ url: imgUrl[index - 1], lazy: false });
            }
        } catch (e) {
            // ignore
        }
        return list;
    }

    getUrl(cid) {
        return 'https://www.kanman.com/' + cid;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        var update = DOM(html).text('span.update');
        return update ? update.substring(0, 10) : '';
    }

    getHeader() {
        return { Referer: 'https://www.kanman.com' };
    }

})());

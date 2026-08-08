// 漫画台 (Manhuatai) — 由 Java 源 port
var SOURCE = {
    type: 49,
    title: '漫画台',
    baseUrl: 'https://www.kanman.com',
    hosts: ['www.kanman.com', 'm.kanman.com']
};

function getSearchRequest(keyword, page) {
    return {
        url: format('%s/api/getsortlist/?product_id=2&productname=mht&platformname=wap&orderby=click&search_key=%s&page=%d&size=48',
            SOURCE.baseUrl, urlEncode(keyword), page)
    };
}

function parseSearch(html, page) {
    var list = [];
    var data = JSON.parse(html).data.data;
    for (var i = 0; i < data.length; i++) {
        var object = data[i];
        list.push({
            cid: String(object.comic_id),
            title: object.comic_name,
            cover: 'https://image.yqmh.com/mh/' + object.comic_id + '.jpg-300x400.webp',
            update: formatTimestamp(object.update_time * 1000),
            author: object.comic_author
        });
    }
    return list;
}

function getInfoRequest(cid) {
    return { url: 'https://www.kanman.com/' + cid + '/' };
}

function parseInfo(html, cid) {
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

function parseChapter(html) {
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

function getImagesRequest(cid, path) {
    return { url: format('https://www.kanman.com/%s/%s.html', cid, path) };
}

function parseImages(html) {
    var list = [];
    try {
        var m = new RegExp('window\\.comicInfo\\s*=\\s*\\{.*?current_chapter\\s*:\\s*(\\{.*?\\})(?:,|\\})', 's').exec(html);
        if (!m) return null;
        var currChapter = JSON.parse(m[1]);
        var imgUrl = currChapter.chapter_img_list;
        var start = currChapter.start_num, end = currChapter.end_num;
        for (var index = start; index <= end; index++) {
            list.push({ url: imgUrl[index - 1], lazy: false });
        }
    } catch (e) {
        // ignore
    }
    return list;
}

function getUrl(cid) {
    return 'https://www.kanman.com/' + cid;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function parseCheck(html) {
    var update = DOM(html).text('span.update');
    return update ? update.substring(0, 10) : '';
}

function parseCategory(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('a.sdiv');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var cid = splitHref(node.href(), 0);
        var cover = '';
        var imgs = node.select('img');
        if (imgs.length) cover = imgs[0].attr('data-url');
        var author = null, update = null;
        if (!cover || !cid) {
            // 与 Java 一致：必要时请求详情页补全封面/作者/更新
            try {
                var infoHtml = fetch('https://www.kanman.com/' + cid + '/').body;
                var infoBody = DOM(infoHtml);
                var c = infoBody.src('#offlinebtn-container > img');
                if (c) cover = c;
                author = substring(infoBody.text('div.jshtml > ul > li:nth-child(3)'), 3);
                update = substring(infoBody.text('div.jshtml > ul > li:nth-child(5)'), 3);
            } catch (e) { /* ignore */ }
        }
        list.push({ cid: cid, title: node.attr('title'), cover: cover, update: update, author: author });
    }
    return list;
}

function getHeader() {
    return { Referer: 'https://www.kanman.com' };
}

function getCategories() {
    return {
        composite: true,
        format: 'https://www.kanman.com/{subject}_p{page}.html',
        subject: [
            { title: '全部漫画', value: 'all' },
            { title: '知音漫客', value: 'zhiyinmanke' },
            { title: '神漫', value: 'shenman' },
            { title: '风炫漫画', value: 'fengxuanmanhua' },
            { title: '漫画周刊', value: 'manhuazhoukan' },
            { title: '飒漫乐画', value: 'samanlehua' },
            { title: '飒漫画', value: 'samanhua' },
            { title: '漫画世界', value: 'manhuashijie' }
        ]
    };
}

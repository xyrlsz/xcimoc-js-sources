// 腾讯动漫 (Tencent) — 由 Java 源 port
var SOURCE = {
    type: 51,
    title: '腾讯动漫',
    baseUrl: 'https://m.ac.qq.com/',
    hosts: ['ac.qq.com', 'm.ac.qq.com']
};

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    // 修正原 Java 的 %s 未替换 bug
    return { url: 'https://m.ac.qq.com/search/result?word=' + keyword };
}

function parseSearch(html, page) {
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

function getUrl(cid) {
    return 'http://ac.qq.com/Comic/ComicInfo/id/' + cid;
}

function getInfoRequest(cid) {
    return { url: 'https://m.ac.qq.com/comic/index/id/' + cid };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    return {
        title: body.text('div.head-title-tags > h1'),
        cover: body.src('div.head-banner > img'),
        update: '',
        author: body.text('li.author-wr'),
        intro: body.text('div.head-info-desc'),
        finish: false // 原 Java 写死 isFinish("连载中")
    };
}

function getChapterRequest(html, cid) {
    return { url: 'https://m.ac.qq.com/comic/chapterList/id/' + cid };
}

function parseChapter(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('ul.normal > li.chapter-item');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var href = node.href('a') || '';
        list.push({
            title: node.text('a'),
            path: href.indexOf('/chapter/index/id/') >= 0 ? href.substring('/chapter/index/id/'.length) : href
        });
    }
    list.reverse();
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('https://m.ac.qq.com/chapter/index/id/%s/cid/%s', cid, path) };
}

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

function parseImages(html) {
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

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function parseCheck(html) {
    return DOM(html).text('div.book-detail > div.cont-list > dl:eq(2) > dd');
}

function parseCategory(html, page) {
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

function getHeader() {
    return { Referer: 'https://m.ac.qq.com' };
}

// 漫画之家 (ManHuaZhiJia) — 由 Java 源 port
var SOURCE = {
    type: 119,
    title: '漫画之家',
    baseUrl: 'https://www.manhuahome.com',
    hosts: ['manhuahome.com'],
    cidRegex: '(/book/\\d+\\.html)'
};

const baseUrl = 'https://www.manhuahome.com';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return { url: 'https://www.manhuahome.com/search.html?wd=' + keyword + '&page=' + page };
}

function parseSearch(html, page) {
    var list = [];
    var nodes = DOM(html).select('div.mg-search-item');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        list.push({
            cid: node.href('.mg-search-name > a'),
            title: node.text('.mg-search-name'),
            cover: baseUrl + node.attr('.mg-search-thumb', 'data-original'),
            update: '',
            author: ''
        });
    }
    return list;
}

function getUrl(cid) {
    return baseUrl + cid;
}

function getInfoRequest(cid) {
    if (cid.indexOf('/') !== 0) {
        cid = '/' + cid;
    }
    return { url: getUrl(cid) };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var author = null;
    var update = '';
    var metas = body.select('.mg-detail-meta> li');
    for (var i = 0; i < metas.length; i++) {
        var tmp = metas[i].text() || '';
        if (tmp.indexOf('作者') >= 0) {
            author = tmp.replace('作者：', '').trim();
        } else if (tmp.indexOf('上架时间') >= 0) {
            update = tmp.replace('上架时间：', '').trim();
        }
    }
    return {
        title: body.text('.mg-detail-title'),
        cover: baseUrl + body.src('.mg-banner-cover'),
        update: update,
        author: author,
        intro: body.text('.mg-blurb-text'),
        finish: false
    };
}

function parseChapter(html, comicJson) {
    var list = [];
    var nodes = DOM(html).select('.mg-chapter-list > li');
    for (var i = 0; i < nodes.length; i++) {
        list.push({ title: nodes[i].text(), path: nodes[i].href('a') });
    }
    list.reverse();
    return list;
}

function getImagesRequest(cid, path) {
    return { url: baseUrl + path };
}

function parseImages(html, chapterJson) {
    var list = [];
    var chapter = JSON.parse(chapterJson || '{}');
    var m = /"url"\s*:\s*"(\/[^"]+\.jpg(?:\|\|\|\/[^"]+)*?)"/s.exec(html);
    if (!m) return list;
    var urlValue = m[1];
    if (!urlValue) return list;
    var imageList = urlValue.split('|||');
    for (var i = 0; i < imageList.length; i++) {
        var img = imageList[i].trim();
        if (!img) continue;
        if (img.indexOf('/') === 0) {
            img = baseUrl + img;
        }
        list.push({
            url: img,
            lazy: false,
            headers: { Referer: baseUrl + (chapter.path || '') }
        });
    }
    return list;
}

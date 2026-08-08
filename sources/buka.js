// 布卡漫画 (BuKa) — 由 Java 源 port
var SOURCE = {
    type: 52,
    title: '布卡漫画',
    baseUrl: 'https://www.bukamh.com',
    hosts: ['www.bukamh.com'],
    webConfig: {
        images: { useWebParser: true }
    }
};

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

function getSearchRequest(keyword, page) {
    var url;
    if (page === 1) {
        url = format('%s/index.php/search?key=%s', SOURCE.baseUrl, keyword);
    } else {
        url = format('%s/search/%s/%d', SOURCE.baseUrl, keyword, page);
    }
    return { url: url, headers: getHeader() };
}

function parseSearch(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.u_list> li');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var author = '', update = '';
        var ps = node.select('.neirong > p');
        if (ps.length > 0) author = ps[0].text();
        if (ps.length > 2) update = ps[2].text();
        list.push({
            cid: (node.href('.neirong > .name') || '').replace(/\//g, ''),
            title: node.text('.neirong > .name'),
            cover: node.src('.pic > a >img'),
            update: update,
            author: author
        });
    }
    return list;
}

function getUrl(cid) {
    return SOURCE.baseUrl + '/' + cid;
}

function getInfoRequest(cid) {
    return { url: SOURCE.baseUrl + '/' + cid, headers: getHeader() };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var author = '', update = '';
    var tages = body.select('.infobox > .info > .tage');
    for (var i = 0; i < tages.length; i++) {
        var tmp = tages[i].text();
        if (tmp.indexOf('作者：') >= 0) {
            author = tmp.substring(3).trim();
        }
        if (tmp.indexOf('更新于：') >= 0) {
            update = tmp.substring(4).trim();
        }
    }
    return {
        title: body.text('.infobox > .title'),
        cover: body.src('.infobox > .info > .img > img'),
        update: update,
        author: author,
        intro: body.text('.infocomic > .text'),
        finish: false
    };
}

function parseChapter(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.listbox > .list > li > a');
    for (var i = 0; i < nodes.length; i++) {
        list.push({ title: nodes[i].text(), path: nodes[i].href() });
    }
    list.reverse();
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('%s/%s', SOURCE.baseUrl, path), headers: getHeader() };
}

function parseImages(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.chapterbox >#manga-imgs > .pic > img');
    for (var i = 0; i < nodes.length; i++) {
        list.push({ url: nodes[i].attr('data-src'), lazy: false });
    }
    return list;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function getHeader() {
    return { Referer: 'https://www.bukamh.com', 'user-agent': UA };
}

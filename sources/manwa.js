// 漫蛙 (ManWa) — 由 Java 源 port
var SOURCE = {
    type: 115,
    title: '漫蛙',
    baseUrl: 'https://manwawang.com',
    hosts: ['manwawang.com'],
    webConfig: {
        images: { useWebParser: true }
    }
};

const baseUrl = 'https://manwawang.com';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return { url: baseUrl + '/search?key=' + keyword, headers: { 'user-agent': UA } };
}

function parseSearch(html, page) {
    var list = [];
    var nodes = DOM(html).select('.manga-i-list-item');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var href = node.href('a') || '';
        list.push({
            cid: href.replace('/comic/', '').replace(/\//g, ''),
            title: node.text('.manga-i-list-title'),
            cover: node.src('.manga-i-cover'),
            update: '',
            author: ''
        });
    }
    return list;
}

function getUrl(cid) {
    return baseUrl + '/comic/' + cid;
}

function getInfoRequest(cid) {
    return { url: getUrl(cid), headers: { 'user-agent': UA } };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var author = '';
    var infoList = body.select('.detail-main-subtitle > span');
    for (var i = 0; i < infoList.length; i++) {
        var text = infoList[i].text() || '';
        if (text.indexOf('作者') >= 0) {
            author = text.split('：')[1] ? text.split('：')[1].trim() : '';
        }
    }
    return {
        title: body.text('.detail-main-title'),
        cover: body.src('.detail-bar-img'),
        update: '',
        author: author,
        intro: body.text('.detail-main-content'),
        finish: isFinishText(html)
    };
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function parseChapter(html, comicJson) {
    var list = [];
    var nodes = DOM(html).select('.detail-list > .detail-list-item > a');
    for (var i = 0; i < nodes.length; i++) {
        list.push({ title: nodes[i].text(), path: nodes[i].href() });
    }
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('%s/%s', baseUrl, path), headers: { 'user-agent': UA } };
}

function parseImages(html) {
    var list = [];
    var nodes = DOM(html).select('#chapterPic > img');
    for (var i = 1; i <= nodes.length; i++) {
        list.push({ url: nodes[i - 1].attr('data-src'), lazy: false });
    }
    return list;
}

function getHeader() {
    return { Referer: baseUrl + '/', 'user-agent': UA };
}

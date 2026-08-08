// 漫本 (ManBen) — 由 Java 源 port
var SOURCE = {
    type: 113,
    title: '漫本',
    baseUrl: 'https://www.manben.com',
    hosts: ['manben.com', 'www.manben.com'],
    cidRegex: '([\\w-]+)',
    webConfig: {
        images: { useWebParser: true }
    }
};

const baseUrl = 'https://www.manben.com';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return { url: baseUrl + '/search?title=' + keyword, headers: { 'user-agent': UA } };
}

function parseSearch(html, page) {
    var list = [];
    var nodes = DOM(html).select('.searchResultList > li');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        list.push({
            cid: node.href('a'),
            title: node.text('.title'),
            cover: node.src('img'),
            update: '',
            author: node.text('.author')
        });
    }
    return list;
}

function getUrl(cid) {
    return baseUrl + '/' + cid;
}

function getInfoRequest(cid) {
    return { url: getUrl(cid), headers: { 'user-agent': UA } };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var title = body.text('.info > .title');
    if (!title) title = body.text('.title');
    var cover = body.src('.content > .cover');
    if (!cover) cover = body.attr('.content .cover', 'src');
    var infoList = body.select('.info > .subtitle');
    if (!infoList.length) infoList = body.select('.subtitle');
    var author = '';
    for (var i = 0; i < infoList.length; i++) {
        var text = infoList[i].text() || '';
        if (text.indexOf('作者') >= 0) {
            author = text.split('：')[1] ? text.split('：')[1].trim() : '';
        }
    }
    return {
        title: title,
        cover: cover,
        update: body.text('.chapter > .top > span'),
        author: author,
        intro: body.text('.detailContent  > p'),
        finish: isFinishText(html)
    };
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function parseChapter(html, comicJson) {
    var list = [];
    var body = DOM(html);
    var chapterTypes = body.select('.detailSelectBar > li');
    var chapterTypeNodes = body.select('.chapterList');
    for (var i = 0; i < chapterTypeNodes.length; i++) {
        var type = i < chapterTypes.length ? chapterTypes[i].text() : '';
        var chapterNodes = chapterTypeNodes[i].select('li > a');
        for (var j = 0; j < chapterNodes.length; j++) {
            var href = chapterNodes[j].href() || '';
            var parts = href.split('/');
            list.push({
                title: chapterNodes[j].text(),
                path: parts.length > 1 ? parts[1] : href,
                group: type
            });
        }
    }
    list.reverse();
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('%s/%s/', baseUrl, path), headers: { 'user-agent': UA } };
}

function parseImages(html) {
    var list = [];
    var nodes = DOM(html).select('#cp_img > img');
    for (var i = 1; i <= nodes.length; i++) {
        list.push({ url: nodes[i - 1].attr('data-src'), lazy: false });
    }
    return list;
}

function getHeader() {
    return { Referer: baseUrl, 'user-agent': UA };
}

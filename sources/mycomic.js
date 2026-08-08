// MYCOMIC — 由 Java 源 port（需 WebView 渲染）
var SOURCE = {
    type: 103,
    title: 'MYCOMIC',
    baseUrl: 'https://mycomic.com',
    hosts: ['mycomic.com'],
    webConfig: {
        search: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
        info: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
        chapter: { useWebParser: true, autoScroll: false, interactiveChallenge: true },
        images: { useWebParser: true, autoScroll: false, interactiveChallenge: true }
    }
};

const baseUrl = 'https://mycomic.com';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return {
        url: baseUrl + '/comics?q=' + keyword + '&page=' + page,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0'
        }
    };
}

function parseSearch(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.grid > .group');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var href = node.href('div > a') || '';
        var parts = href.split('/');
        var cover = node.attr('div > a > img', 'data-src');
        if (!cover) cover = node.src('div > a > img');
        list.push({
            cid: parts[parts.length - 1],
            title: node.text('[data-flux-subheading]'),
            cover: cover,
            update: '',
            author: ''
        });
    }
    return list;
}

function getUrl(cid) {
    return baseUrl + '/comics/' + cid;
}

function getInfoRequest(cid) {
    return { url: getUrl(cid), headers: { Referer: baseUrl + '/' } };
}

function parseInfo(html, cid) {
    var cards = DOM(html).select('[data-flux-card]');
    var body = cards.length ? cards[0] : DOM(html);
    return {
        title: body.text('[data-flux-heading]'),
        cover: body.src('div > img'),
        author: body.text('.grow > div > div > span'),
        intro: body.text('.grow > div:nth-child(5)'),
        update: body.attr('time', 'datetime'),
        finish: isFinishText(body.text('[data-flux-badge]'))
    };
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function unescapeJava(s) {
    return String(s)
        .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseChapter(html, comicJson) {
    var list = [];
    var body = DOM(html);
    var chapterNodes = body.select("[x-data*='chapters:']");
    var chapterTypes = body.select("[x-data*='chapters:'] > [data-flux-subheading] > div");
    for (var k = 0; k < chapterTypes.length && k < chapterNodes.length; k++) {
        var type = chapterTypes[k].text();
        var xdata = chapterNodes[k].attr('x-data') || '';
        var chaptersJson = match('chapters:\\s*(\\[.*?\\])', xdata, 1);
        if (!chaptersJson) continue;
        try {
            var chaptersData = JSON.parse(chaptersJson);
            for (var j = 0; j < chaptersData.length; j++) {
                list.push({
                    title: unescapeJava(chaptersData[j].title),
                    path: chaptersData[j].id,
                    group: type
                });
            }
        } catch (e) { /* ignore */ }
    }
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('%s/chapters/%s', baseUrl, path), headers: { Referer: baseUrl + '/' } };
}

function parseImages(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('div > div > div > img[x-ref^=page-]');
    for (var i = 1; i <= nodes.length; i++) {
        var imgUrl = nodes[i - 1].src();
        if (!imgUrl) imgUrl = nodes[i - 1].attr('data-src');
        list.push({ url: imgUrl, lazy: false });
    }
    return list;
}

function getHeader() {
    return { referer: baseUrl + '/' };
}

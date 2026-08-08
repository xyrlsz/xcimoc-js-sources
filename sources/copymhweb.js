// 拷贝漫画Web (CopyMHWeb) — 由 Java 源 port
var SOURCE = {
    type: 27,
    title: '拷贝漫画Web',
    baseUrl: 'https://www.copy3000.com',
    hosts: [
        'www.mangacopy.com', 'www.copy20.com', 'www.2025copy.com',
        'www.2026copy.com', 'www.copy3000.com'
    ],
    cidRegex: 'comic/(\\w+)',
    webConfig: {
        info: {
            useWebParser: true,
            injectJs: "javascript:(function() { var btns = document.getElementsByClassName('next-all'); for(var i = 0; i < btns.length; i++) { btns[i].click(); } })()"
        },
        images: { useWebParser: true }
    }
};

const website = 'https://www.copy3000.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0';
const SEARCH_API = '/api/kb/web/searchci/comics';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return {
        url: website + SEARCH_API + '?offset=0&platform=2&limit=12&q=' + keyword + '&q_type=',
        headers: getHeader()
    };
}

function parseSearch(html, page) {
    var list = [];
    var data = JSON.parse(html).results.list;
    for (var i = 0; i < data.length; i++) {
        var object = data[i];
        var author = '';
        for (var j = 0; j < (object.author || []).length; j++) {
            author += String(object.author[j].name || '').trim();
            if (j < object.author.length - 1) author += ',';
        }
        list.push({
            cid: object.path_word,
            title: object.name,
            cover: object.cover,
            update: null,
            author: author
        });
    }
    return list;
}

function getUrl(cid) {
    return website + '/comic/' + cid;
}

function getInfoRequest(cid) {
    return { url: getUrl(cid), headers: getHeader() };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var update = body.text("div.comicParticulars-title-right ul li:contains(最後更新：) span.comicParticulars-right-txt");
    if (!update) {
        update = body.text("div.comicParticulars-title-right ul li:contains(最后更新：) span.comicParticulars-right-txt");
    }
    var authorNodes = body.select("div.comicParticulars-title-right ul li:contains(作者：) a");
    var author = '';
    for (var i = 0; i < authorNodes.length; i++) {
        author += authorNodes[i].text();
        if (i < authorNodes.length - 1) author += ',';
    }
    return {
        title: body.text('div.comicParticulars-title-right > ul > li > h6'),
        cover: body.attr('div.comicParticulars-left-img > img', 'data-src'),
        update: update,
        author: author,
        intro: body.text('p.intro'),
        finish: isFinishText(html)
    };
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function parseChapter(html) {
    var list = [];
    var body = DOM(html);
    var tabGroups = body.select('.table-default-box');
    var groupNames = body.select('.upLoop > span');
    for (var i = 0; i < tabGroups.length; i++) {
        var panes = tabGroups[i].select('.tab-content > .tab-pane');
        if (!panes.length) continue;
        var chapterNodes = panes[0].select('ul > a').reverse();
        for (var j = 0; j < chapterNodes.length; j++) {
            var node = chapterNodes[j];
            var title = node.attr('title');
            if (!title) {
                title = node.text('li').trim();
            }
            if (title) {
                list.push({
                    title: title,
                    path: node.href(),
                    group: i < groupNames.length ? groupNames[i].text() : ''
                });
            }
        }
    }
    return list;
}

function getImagesRequest(cid, path) {
    return { url: website + path, headers: getHeader() };
}

function parseImages(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('ul.comicContent-list > li');
    for (var i = 1; i <= nodes.length; i++) {
        var imgs = nodes[i - 1].select('img');
        if (!imgs.length) continue;
        var imgUrl = imgs[0].attr('data-src');
        imgUrl = imgUrl.replace(/c\d+x\.[a-zA-Z]+$/, 'c1500x.webp');
        list.push({ url: imgUrl, lazy: false });
    }
    return list;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function parseCheck(html) {
    var res = DOM(html).text("div.comicParticulars-title-right ul li:contains(最後更新：) span.comicParticulars-right-txt");
    if (!res) {
        res = DOM(html).text("div.comicParticulars-title-right ul li:contains(最后更新：) span.comicParticulars-right-txt");
    }
    return res;
}

function getHeader() {
    return { 'user-agent': UA };
}

// 读漫屋 (DuManWu) — 由 Java 源 port
var SOURCE = {
    type: 104,
    title: '读漫屋',
    baseUrl: 'http://dumanwu1.com',
    hosts: ['dumanwu.com', 'dumanwu1.com'],
    webConfig: {
        images: { useWebParser: true }
    }
};

const baseUrl = 'http://dumanwu1.com';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    var index = Math.min(keyword.length, 12);
    return {
        url: baseUrl + '/s',
        method: 'POST',
        body: 'k=' + keyword.substring(0, index)
    };
}

function parseSearch(html, page) {
    var object = JSON.parse(html);
    if (object.data === null || object.data === undefined) return [];
    var data;
    if (Array.isArray(object.data)) {
        data = object.data;
    } else if (typeof object.data === 'string') {
        try {
            data = JSON.parse(object.data);
        } catch (e) {
            return [];
        }
    } else {
        return [];
    }
    var list = [];
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        list.push({
            cid: String(item.id),
            title: item.name,
            cover: item.imgurl,
            update: item.remarks,
            author: ''
        });
    }
    return list;
}

function getUrl(cid) {
    return baseUrl + '/' + cid;
}

function getInfoRequest(cid) {
    return { url: baseUrl + '/' + cid };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    var tmp = (body.text('.author') || '').split(' ');
    var author = '';
    var update = '';
    for (var i = 0; i < tmp.length; i++) {
        var data = tmp[i];
        if (data.indexOf('作者') >= 0) {
            author = data.replace('作者：', '');
        } else if (data.indexOf('月') >= 0 && data.indexOf('日') >= 0) {
            update = data;
        } else if (data.indexOf('同步') < 0) {
            author += ',' + data;
        }
    }
    return {
        title: body.text('.banner-title'),
        cover: body.attr('.banner-pic', 'data-src'),
        update: update,
        author: author,
        intro: body.text('.introduction'),
        finish: false
    };
}

function parseChapter(html, comicJson) {
    var list = [];
    var comic = JSON.parse(comicJson || '{}');
    var body = DOM(html);
    var chapterNodes = body.select('.chaplist-box > ul > li > a');
    for (var i = 0; i < chapterNodes.length; i++) {
        var href = chapterNodes[i].href() || '';
        var parts = href.split('/');
        var path = parts.length > 2 ? parts[2].replace('.html', '') : '';
        list.push({ title: chapterNodes[i].text(), path: path });
    }
    if (html.indexOf('chaplist-more') >= 0) {
        try {
            var resp = fetch(baseUrl + '/morechapter', {
                method: 'POST',
                body: 'id=' + (comic.cid || '')
            });
            var data = JSON.parse(resp.body).data;
            for (var j = 0; j < data.length; j++) {
                list.push({ title: data[j].chaptername, path: data[j].chapterid });
            }
        } catch (e) { /* ignore */ }
    }
    return list;
}

function getImagesRequest(cid, path) {
    return { url: format('%s/%s/%s.html', baseUrl, cid, path) };
}

function parseImages(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.main_img > .chapter-img-box');
    for (var i = 1; i <= nodes.length; i++) {
        list.push({ url: nodes[i - 1].attr('img', 'data-src'), lazy: false });
    }
    return list;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function getHeader() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36'
    };
}

// 咚漫漫画 (DongManManHua) — 由 Java 源 port
var SOURCE = {
    type: 11,
    title: '咚漫漫画',
    baseUrl: 'https://www.dongmanmanhua.cn',
    hosts: ['www.dongmanmanhua.cn']
};

// cid 来自查询参数 title_no（原 UrlFilterWithCidQueryKey）
const SOURCE_CID_QUERY_KEY = 'title_no';

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return {
        url: SOURCE.baseUrl + '/search/?keyword=' + keyword,
        headers: { Referer: 'www.dongmanmanhua.cn' }
    };
}

function parseSearch(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.card_wrap.search > .card_lst > li > a');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        list.push({
            cid: splitHref(node.href(), -1),
            title: node.text('div.info > p.subj'),
            cover: node.src('img'),
            author: node.text('div.info > p.author')
        });
    }
    return list;
}

function getUrl(cid) {
    return SOURCE.baseUrl + '/episodeList?titleNo=' + cid;
}

function getInfoRequest(cid) {
    return { url: getUrl(cid), headers: { Referer: 'www.dongmanmanhua.cn' } };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    return {
        title: body.text('.detail_header > .info > h1.subj'),
        cover: body.src('ul#_listUl > li:eq(0) > a > span.thmb > img'),
        update: (body.text('ul#_listUl > li:eq(0) > a > span.date') || '').trim(),
        author: body.text('.detail_header > div.info > span.author'),
        intro: body.text('#_asideDetail > p.summary'),
        finish: isFinishText(body.text('#_asideDetail > p.day_info'))
    };
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function collectChapters(bodyHtml, list) {
    var body = DOM(bodyHtml);
    var nodes = body.select('ul#_listUl > li > a');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var title = (node.text('span.subj > span') || '') + ' ' + (node.text('span.tx') || '');
        list.push({ title: title, path: 'https:' + node.href() });
    }
}

function parseChapter(html, comicJson) {
    var list = [];
    var visited = {};
    function walk(pageHtml, pageUrl) {
        if (visited[pageUrl]) return;
        visited[pageUrl] = true;
        collectChapters(pageHtml, list);
        var body = DOM(pageHtml);
        var links = body.select('div.detail_lst > div.paginate > a');
        for (var i = 0; i < links.length; i++) {
            var href = links[i].href() || '#';
            var cls = links[i].attr('class') || '';
            var url = null;
            if (href === '#' && cls === '') {
                continue; // 当前页已解析
            } else if (cls === '' || cls === 'pg_next') {
                url = SOURCE.baseUrl + href;
            }
            if (url && !visited[url]) {
                try {
                    var resp = fetch(url, { headers: { Referer: 'www.dongmanmanhua.cn' } });
                    walk(resp.body, url);
                } catch (e) { /* ignore */ }
            }
        }
    }
    walk(html, '');
    return list;
}

function getImagesRequest(cid, path) {
    return { url: path, headers: { Referer: 'www.dongmanmanhua.cn' } };
}

function parseImages(html) {
    var list = [];
    var body = DOM(html);
    var imgs = body.select('div#_imageList > img');
    var i = 1;
    for (var j = 0; j < imgs.length; j++) {
        var u = imgs[j].attr('data-url');
        if (u) list.push({ url: u, lazy: false });
        i++;
    }
    if (list.length) return list;

    var docUrl = match("documentURL:.*?'(.*?)'", html, 0);
    var motiontoonPath = match("jpg:.*?'(.*?)\\{", html, 0);
    try {
        if (!docUrl) return list;
        var html1 = fetch(docUrl, { headers: { Referer: 'www.dongmanmanhua.cn' } }).body;
        var motiontoonJson = JSON.parse(html1).assets.image;
        var keys = Object.keys(motiontoonJson);
        for (var k = 0; k < keys.length; k++) {
            if (keys[k].indexOf('layer') >= 0) {
                list.push({ url: motiontoonPath + motiontoonJson[keys[k]], lazy: false });
            }
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
    return (DOM(html).text('ul#_listUl > li:eq(0) > a > span.date') || '').trim();
}

function getCategoryRequest(format, page) {
    if (page !== 1) return null;
    return { url: format, headers: { Referer: 'https://m.webtoons.com' } };
}

function parseCategory(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('#ct > ul > li > a');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var style = node.attr('div.pic', 'style') || '';
        list.push({
            cid: splitHref(node.href(), -1),
            title: node.text('div.info > p.subj > span'),
            cover: match('\\((.*?)\\)', style, 1)
        });
    }
    return list;
}

function getHeader() {
    return { Referer: SOURCE.baseUrl };
}

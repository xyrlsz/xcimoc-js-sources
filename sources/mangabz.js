// MangaBZ — 由 Java 源 port
var SOURCE = {
    type: 82,
    title: 'MangaBZ',
    baseUrl: 'http://www.mangabz.com/',
    hosts: ['www.mangabz.com']
};

function getSearchRequest(keyword, page) {
    return { url: 'http://www.mangabz.com/search?title=' + keyword + '&page=' + page };
}

function parseSearch(html, page) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('.mh-item');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        list.push({
            cid: (node.attr('a', 'href') || '').trim().replace(/\//g, ''),
            title: node.text('.title'),
            cover: node.attr('.mh-cover', 'src'),
            update: node.text('.chapter > a'),
            author: ''
        });
    }
    return list;
}

function getUrl(cid) {
    return 'http://www.mangabz.com/' + cid + '/';
}

function getInfoRequest(cid) {
    return { url: 'http://www.mangabz.com/' + cid + '/' };
}

function parseInfo(html, cid) {
    var body = DOM(html);
    return {
        title: body.text('.detail-info-title'),
        cover: body.src('.detail-info-cover'),
        update: match('(..月..號 | ....-..-..)', body.text('.detail-list-form-title'), 1),
        author: body.text('.detail-info-tip > span > a'),
        intro: body.text('.detail-info-content'),
        finish: false // 原 Java isFinish(".detail-list-form-title") 恒为 false
    };
}

function parseChapter(html) {
    var list = [];
    var body = DOM(html);
    var nodes = body.select('#chapterlistload > a');
    for (var i = 0; i < nodes.length; i++) {
        var title = nodes[i].attr('title');
        if (!title) title = nodes[i].text();
        list.push({
            title: title,
            path: (nodes[i].href() || '').trim().replace(/\//g, '')
        });
    }
    return list;
}

function getImagesRequest(cid, path) {
    return { url: 'http://www.mangabz.com/' + path + '/' };
}

function getValFromRegex(html, keyword, searchfor) {
    var m = new RegExp('var\\s+' + keyword + '\\s*=\\s*' + searchfor + '\\s*;').exec(html);
    return m ? m[1] : null;
}

function parseImages(html, chapterJson) {
    var list = [];
    var chapter = JSON.parse(chapterJson || '{}');
    try {
        var mid = getValFromRegex(html, 'MANGABZ_MID', '(\\w+)');
        var cid = getValFromRegex(html, 'MANGABZ_CID', '(\\w+)');
        var sign = getValFromRegex(html, 'MANGABZ_VIEWSIGN', '"(\\w+)"');
        var pageCount = parseInt(getValFromRegex(html, 'MANGABZ_IMAGE_COUNT', '(\\d+)'), 10);
        var path = chapter.path || '';
        for (var i = 1; i <= pageCount; i++) {
            var url = 'http://www.mangabz.com/' + path + '/chapterimage.ashx?cid=' + cid +
                '&page=' + i + '&key=&_cid=' + cid + '&_mid=' + mid +
                '&_sign=' + sign + '&_dt=';
            list.push({ url: url, lazy: true });
        }
    } catch (e) {
        // ignore
    }
    return list;
}

function getLazyRequest(url) {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    var dateStr = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        '+' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    var path = match('mangabz\\.com/([^/]+)/chapterimage', url, 1);
    return {
        url: url + dateStr,
        headers: {
            Referer: 'http://www.mangabz.com/' + (path ? path : '') + '/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36'
        }
    };
}

function parseLazy(html, url) {
    var image = String(evalDecrypt(html)).split(',')[0];
    return image;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function parseCheck(html) {
    return match('(..月..號 | ....-..-..)', DOM(html).text('.detail-list-form-title'), 1);
}

function getHeader() {
    return { Referer: 'http://www.mangabz.com/' };
}

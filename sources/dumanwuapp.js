// 读漫屋app (DuManWuApp) — 由 Java 源 port
// MD5 签名 + AES-CBC 解密（密钥 g8bh4z 自动补 0 到 16 字节）+ multipart POST
var SOURCE = {
    type: 117,
    title: '读漫屋app',
    baseUrl: 'https://d9zfb53b.lstool.xyz',
    webConfig: {
        images: { useWebParser: true }
    }
};

const MH_BASE_URL = 'https://d9zfb53b.lstool.xyz';
const QUANSE = 'ok37hy';
const G8BH4Z = 'g8bh4z';
const REF = '8';
const VERSION = '3.1.05';
const LNUM = 0;
const OPEN_ADD_TIME = Date.now();

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    var index = Math.min(keyword.length, 12);
    var time = Date.now();
    return {
        url: MH_BASE_URL + '/search',
        method: 'POST',
        body: { multipart: [['key', keyword.substring(0, index)]] },
        headers: {
            time: String(time),
            sgin: md5(String(time - 59852) + REF + QUANSE),
            ref: REF,
            version: VERSION
        }
    };
}

function parseSearch(html, page) {
    var data = JSON.parse(html);
    var decrypted = aesCbcDecryptWithIvPrefix(data.responseData, G8BH4Z);
    if (!decrypted) return null;
    var list = [];
    try {
        var searchData = JSON.parse(decrypted).updata;
        for (var i = 0; i < searchData.length; i++) {
            var object = searchData[i];
            list.push({
                cid: String(object.acId),
                cover: object.acPic,
                author: object.authorName,
                title: object.bookName,
                update: object.latestChapterName
            });
        }
    } catch (e) { /* ignore */ }
    return list;
}

function getInfoRequest(cid) {
    var time = Date.now();
    return {
        url: MH_BASE_URL + '/comic3/' + cid,
        headers: {
            time: String(time),
            sgin: md5(String(time - 59852) + REF + QUANSE + cid),
            ref: REF,
            version: VERSION
        }
    };
}

function parseInfo(html, cid) {
    var data = JSON.parse(html);
    var decrypted = aesCbcDecryptWithIvPrefix(data.responseData, G8BH4Z);
    if (!decrypted) return null;
    var bookDetail = JSON.parse(decrypted).bookdetailed;
    return {
        title: bookDetail.bookName,
        cover: bookDetail.coverPic,
        update: formatTimestamp(bookDetail.latestChapterTime),
        author: bookDetail.authorName,
        intro: bookDetail.intro,
        finish: false
    };
}

function getChapterRequest(html, cid) {
    var time = Date.now();
    return {
        url: MH_BASE_URL + '/chapterlist/' + cid,
        headers: {
            time: String(time),
            sgin: md5(String(time - 59852) + REF + QUANSE + cid),
            ref: REF,
            version: VERSION
        }
    };
}

function parseChapter(html, comicJson) {
    var list = [];
    try {
        var data = JSON.parse(html);
        var decrypted = aesCbcDecryptWithIvPrefix(data.responseData, G8BH4Z);
        if (!decrypted) return list;
        var chapList = JSON.parse(decrypted).chaplist;
        for (var i = 0; i < chapList.length; i++) {
            list.push({ title: chapList[i].chaptername, path: chapList[i].chapterid });
        }
        list.reverse();
    } catch (e) { /* ignore */ }
    return list;
}

function getImagesRequest(cid, path) {
    var time = Date.now();
    return {
        url: format('%s/readcomic/%s/%s', MH_BASE_URL, cid, path),
        method: 'POST',
        body: { multipart: [['otime', String(OPEN_ADD_TIME)], ['lnum', String(LNUM)]] },
        headers: {
            time: String(time),
            sgin: md5(String(time - 59852) + REF + QUANSE + cid + path),
            ref: REF,
            version: VERSION
        }
    };
}

function parseImages(html) {
    var list = [];
    try {
        var text = html;
        if (text.indexOf('<html>') >= 0) {
            // 与 Java Jsoup.parse(html).body().text() 等价：取 body 文本
            text = (DOM(text).text('') || '').trim();
            if (text.indexOf('"') === 0) {
                text = text.substring(1, text.length - 1);
            }
        }
        var data = JSON.parse(text);
        var decrypted = aesCbcDecryptWithIvPrefix(data.responseData, G8BH4Z);
        if (!decrypted) return list;
        var imgList = JSON.parse(decrypted).piclist;
        for (var i = 1; i <= imgList.length; i++) {
            list.push({ url: imgList[i - 1], lazy: false });
        }
    } catch (e) { /* ignore */ }
    return list;
}

function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '');
}

function getHeader() {
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    };
}

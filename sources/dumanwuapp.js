// 读漫屋app (DuManWuApp) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
// MD5 签名 + AES-CBC 解密（密钥 g8bh4z 自动补 0 到 16 字节）+ multipart POST

const MH_BASE_URL = 'https://d9zfb53b.lstool.xyz';
const QUANSE = 'ok37hy';
const G8BH4Z = 'g8bh4z';
const REF = '8';
const VERSION = '3.1.05';
const LNUM = 0;
const OPEN_ADD_TIME = Date.now();

// 工具函数（模块级，不暴露为源接口）
function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '');
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 117,
            title: '读漫屋app',
            baseUrl: 'https://d9zfb53b.lstool.xyz',
            webConfig: {
                images: { useWebParser: true }
            }
        });
    }

    getSearchRequest(keyword, page) {
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

    parseSearch(html, page) {
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

    getInfoRequest(cid) {
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

    parseInfo(html, cid) {
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

    getChapterRequest(html, cid) {
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

    parseChapter(html, comicJson) {
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

    getImagesRequest(cid, path) {
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

    parseImages(html) {
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

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        };
    }
})());

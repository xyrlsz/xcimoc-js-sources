// 漫画鱼 (Manhuayu) — 由 Java 源 port（AES-CBC 解密，IV 为密文前 16 字节）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

const baseUrl = 'https://www.manhuayu88.com';
const AES_KEY = '5V&RoR%Jf@pJPydF';

// 工具函数（模块级，不暴露为源接口）
function extractParams(html) {
    var m = /params\s*=\s*'([^'\\]*(?:\\.[^'\\]*)*)'/.exec(html);
    return m ? m[1] : null;
}

function buildImageUrl(path, host, useBase64) {
    if (!path) return '';
    if (useBase64) {
        return host + '/' + base64Encode(path);
    } else if (!/^(https?:)?\/\//.test(path)) {
        return host + (path.indexOf('/') === 0 ? path : '/' + path);
    } else {
        return path;
    }
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 107,
            title: '漫画鱼',
            baseUrl: 'https://www.manhuayu88.com',
            hosts: ['manhuayu.com', 'manhuayu8.com', 'manhuayu88.com', 'manhuayu5.com']
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: baseUrl + '/search?q=' + keyword };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('div.media');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            list.push({
                cid: (node.href('.media-content > a.title') || '').replace(/\//g, ''),
                title: node.text('.media-content > a.title'),
                cover: node.attr('.media-left > a', 'data-original'),
                update: '',
                author: ''
            });
        }
        return list;
    }

    getInfoRequest(cid) {
        return { url: baseUrl + '/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = null;
        var status = true;
        var metas = body.select('.metas-body > .author');
        for (var i = 0; i < metas.length; i++) {
            var tmp = metas[i].text();
            if (tmp.indexOf('作者') >= 0) {
                author = tmp.replace('作者：', '').trim();
            } else if (tmp.indexOf('连载') >= 0) {
                status = false;
            }
        }
        return {
            title: body.text('.metas-title'),
            cover: body.src('.metas-image > img'),
            update: body.text('.has-text-danger'),
            author: author,
            intro: body.text('.metas-desc > p'),
            finish: status
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.comic-chapters > li > a');
        for (var i = 0; i < nodes.length; i++) {
            var href = nodes[i].href() || '';
            var parts = href.split('/');
            var path = parts.length > 2 ? parts[2].replace('.html', '') : '';
            list.push({ title: nodes[i].text(), path: path });
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: format('%s/%s/%s.html', baseUrl, cid, path) };
    }

    // 对齐原 Java getHeader()：图片防盗链需要 referer + user-agent（否则 403）。
    // 宿主 parseImages 会把此头附加到每个 ImageUrl 上。
    getHeader() {
        return {
            referer: baseUrl + '/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0'
        };
    }

    parseImages(html) {
        var list = [];
        var encryptedParams = extractParams(html);
        if (!encryptedParams) return list;
        try {
            var decryptedJson = aesCbcDecryptWithIvPrefix(encryptedParams, AES_KEY);
            if (!decryptedJson) return list;
            var params = JSON.parse(decryptedJson);
            var chapterImages = params.chapter_images || [];
            var imagesHosts = params.images_hosts || [];
            var imagesBase64 = !!params.images_base64;
            var imageHost = imagesHosts.length ? imagesHosts[0] : '';
            for (var i = 0; i < chapterImages.length; i++) {
                var path = chapterImages[i];
                if (!path) continue;
                list.push({ url: buildImageUrl(path, imageHost, imagesBase64), lazy: false });
            }
        } catch (e) { /* ignore */ }
        return list;
    }
})());

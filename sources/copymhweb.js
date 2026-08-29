// 拷贝漫画Web (CopyMHWeb) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
// 站点经常更换域名/接口：默认值 + 从设置读取（可持久化，换域名时用「重新探测接口」更新）
const DEFAULT_WEBSITE = 'https://www.copy4000.com';
const DEFAULT_SEARCH_API = '/api/kb/web/searchci/comics';
const CANDIDATE_DOMAINS = [
    'https://www.copy4000.com',
    'https://www.copy3000.com',
    'https://www.2026copy.com',
    'https://www.2025copy.com',
    'https://www.copy20.com',
    'https://www.mangacopy.com'
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0';
var website = getSetting('website') || DEFAULT_WEBSITE;
var SEARCH_API = getSetting('search_api') || DEFAULT_SEARCH_API;

// 依次探测候选域名，找到能返回正常搜索结果的接口并持久化
function probeSearchApi() {
    for (var i = 0; i < CANDIDATE_DOMAINS.length; i++) {
        var dom = CANDIDATE_DOMAINS[i];
        var url = dom + DEFAULT_SEARCH_API + '?offset=0&platform=2&limit=1&q=a&q_type=';
        try {
            var res = fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
            if (res && res.status === 200 && res.body) {
                var json = JSON.parse(res.body);
                if (json && json.results && json.results.list) {
                    setSetting('website', dom);
                    setSetting('search_api', DEFAULT_SEARCH_API);
                    website = dom;
                    log('[copy] probe OK: ' + dom);
                    return { success: true, message: '接口可用: ' + dom };
                }
            }
        } catch (e) { /* 该域名不通，试下一个 */ }
    }
    return { success: false, message: '未探测到可用接口（' + CANDIDATE_DOMAINS.length + ' 个域名均失败）' };
}

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 27,
            title: '拷贝漫画Web',
            baseUrl: 'https://www.copy4000.com',
            hosts: [
                'www.mangacopy.com', 'www.copy20.com', 'www.2025copy.com',
                'www.2026copy.com', 'www.copy3000.com'
            ],
            cidRegex: 'comic/(\\w+)',
            webConfig: {
                info: {
                    useWebParser: true,
                    autoScroll: false,
                    injectJs: "javascript:(function() { var btns = document.getElementsByClassName('next-all'); for(var i = 0; i < btns.length; i++) { btns[i].click(); } })()"
                },
                images: {
                    useWebParser: true,
                    autoScroll: true
                }
            }
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: website + SEARCH_API + '?offset=0&platform=2&limit=12&q=' + keyword + '&q_type=',
            headers: this.getHeader()
        };
    }

    parseSearch(html, page) {
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

    getUrl(cid) {
        return website + '/comic/' + cid;
    }

    getInfoRequest(cid) {
        return { url: this.getUrl(cid), headers: this.getHeader() };
    }

    parseInfo(html, cid) {
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

    parseChapter(html) {
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
        log('[copy] parseChapter: total=' + list.length + ' chapters');
        for (var k = 0; k < list.length; k++) {
            log('[copy] chapter[' + k + '] title=' + list[k].title
                    + ' path=' + list[k].path + ' group=' + list[k].group);
        }
        return list;
    }

    getImagesRequest(cid, path) {
        var url = website + path;
        log('[copy] getImagesRequest: url=' + url);
        return { url: url, headers: this.getHeader() };
    }

    parseImages(html) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.comicContent-list > li');
        for (var i = 1; i <= nodes.length; i++) {
            var imgs = nodes[i - 1].select('img');
            if (!imgs.length) continue;
            // data-src 是懒加载地址，懒加载未触发时可能为 null，回退到 src 并跳过空值
            var imgUrl = imgs[0].attr('data-src') || imgs[0].attr('src');
            if (!imgUrl) continue;
            imgUrl = imgUrl.replace(/c\d+x\.[a-zA-Z]+$/, 'c1500x.webp');
            list.push({ url: imgUrl, lazy: false });
        }
        log('[copy] parseImages: nodes=' + nodes.length + ' total=' + list.length + ' images');
        log('[copy] parseImages: html head=' + (html || '').substring(0, 120));
        for (var k = 0; k < list.length; k++) {
            log('[copy] image[' + k + ']=' + list[k].url);
        }
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        var res = DOM(html).text("div.comicParticulars-title-right ul li:contains(最後更新：) span.comicParticulars-right-txt");
        if (!res) {
            res = DOM(html).text("div.comicParticulars-title-right ul li:contains(最后更新：) span.comicParticulars-right-txt");
        }
        return res;
    }

    getHeader() {
        return { 'user-agent': UA };
    }

    getSettings() {
        return [
            { key: 'probe', label: '搜索接口', type: 'callback', buttonText: '重新探测接口' }
        ];
    }

    onSettingsAction(key) {
        if (key === 'probe') {
            return probeSearchApi();
        }
        return { success: false, message: '未知操作' };
    }
})());

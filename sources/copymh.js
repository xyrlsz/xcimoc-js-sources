// 拷贝漫画 (CopyMH) — 由 Java 源 port（CopyMHBase + CopyMH）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
const website = 'https://www.copy3000.com';
// 原 Java 会异步探测并持久化 searchApi，这里使用默认值
const SEARCH_API = '/api/kb/web/searchci/comics';

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

function extractVar(html, name) {
    var patterns = [
        '(?:var|let|const)\\s+' + name + '\\s*=\\s*[\'"]([^\'"]+)[\'"]',
        'window\\.' + name + '\\s*=\\s*[\'"]([^\'"]+)[\'"]',
        name + '\\s*=\\s*[\'"]([^\'"]+)[\'"]'
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = new RegExp(patterns[i]).exec(html);
        if (m && m[1]) return m[1];
    }
    return '';
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 26,
            title: '拷贝漫画',
            baseUrl: 'https://www.copy3000.com',
            hosts: [
                'www.mangacopy.com', 'www.copy20.com', 'www.2025copy.com',
                'www.2026copy.com', 'www.copy3000.com'
            ],
            cidRegex: 'comic/(\\w+)'
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

    parseChapter(html, cid) {
        var list = [];
        var ccz = extractVar(html, 'ccz');
        var dnt = '';
        var dntEls = DOM(html).select('#dnt');
        if (dntEls.length) dnt = dntEls[0].attr('value') || '';
        if (!ccz || !dnt) return list;
        try {
            var headers = this.getHeader();
            headers['Accept'] = 'application/json, text/plain, */*';
            headers['Referer'] = website + '/comic/' + cid;
            headers['dnts'] = dnt;
            var resp = fetch(website + '/comicdetail/' + cid + '/chapters?format=json', { headers: headers });
            var rootObject = JSON.parse(resp.body);
            if (rootObject.code === 200 && rootObject.results) {
                var encrypted = String(rootObject.results).trim();
                if (encrypted.length > 16) {
                    var ivStr = encrypted.substring(0, 16);
                    var cipherStr = encrypted.substring(16);
                    var plainText = aesCbcDecrypt(cipherStr, ccz, ivStr);
                    if (!plainText) return list;
                    var parsed = JSON.parse(plainText);
                    var groups = parsed.groups || {};
                    var keys = Object.keys(groups);
                    for (var g = 0; g < keys.length; g++) {
                        var gKey = keys[g];
                        var group = groups[gKey];
                        var groupName = group.name || gKey;
                        var chapters = group.chapters || [];
                        for (var c = 0; c < chapters.length; c++) {
                            list.push({
                                title: chapters[c].name,
                                path: chapters[c].id,
                                group: groupName
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: format('%s/comic/%s/chapter/%s', website, cid, path),
            headers: this.getHeader()
        };
    }

    parseImages(html) {
        var list = [];
        var contentKey = extractVar(html, 'contentKey');
        var cct = extractVar(html, 'cct');
        if (!contentKey || !cct || contentKey.length <= 16) return list;
        try {
            var ivStr = contentKey.substring(0, 16);
            var cipherStr = contentKey.substring(16);
            var plainText = aesCbcDecrypt(cipherStr, cct, ivStr);
            if (!plainText) return list;
            var m = new RegExp('\\[.*]', 's').exec(plainText);
            if (!m) return list;
            var urls = JSON.parse(m[0]);
            for (var i = 0; i < urls.length; i++) {
                var imgUrl = urls[i].url;
                imgUrl = imgUrl.replace(/c\d+x\.[a-zA-Z]+$/, 'c1500x.webp');
                list.push({ url: imgUrl, lazy: false });
            }
        } catch (e) {
            // ignore
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

    getCategoryRequest(format, page) {
        return {
            url: format,
            headers: this.getHeader()
        };
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);
        var target = body.select('div.row.exemptComic-box');
        if (target.length) {
            var listAttr = (target[0].attr('list') || '')
                .replace(/&#x27;/g, '"')
                .replace(/&quot;/g, '"');
            try {
                var array = JSON.parse(listAttr);
                for (var i = 0; i < array.length; i++) {
                    list.push({
                        cid: array[i].path_word,
                        title: array[i].name,
                        cover: array[i].cover
                    });
                }
            } catch (e) { /* ignore */ }
        }
        return list;
    }

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            platform: '2'
        };
    }

    getCategories() {
        return {
            composite: true,
            pageSize: 50,
            format: website + '/comics?theme={subject}&status={progress}&region={area}&ordering={order}&offset={offset}&limit=50',
            subject: [
                { title: '全部', value: '' }, { title: '愛情', value: 'aiqing' },
                { title: '歡樂向', value: 'huanlexiang' }, { title: '冒險', value: 'maoxian' },
                { title: '奇幻', value: 'qihuan' }, { title: '百合', value: 'baihe' },
                { title: '校园', value: 'xiaoyuan' }, { title: '科幻', value: 'kehuan' },
                { title: '東方', value: 'dongfang' }, { title: '耽美', value: 'danmei' },
                { title: '生活', value: 'shenghuo' }, { title: '格鬥', value: 'gedou' },
                { title: '轻小说', value: 'qingxiaoshuo' }, { title: '悬疑', value: 'xuanyi' },
                { title: '其他', value: 'qita' }, { title: '神鬼', value: 'shengui' },
                { title: '职场', value: 'zhichang' }, { title: 'TL', value: 'teenslove' },
                { title: '萌系', value: 'mengxi' }, { title: '治愈', value: 'zhiyu' },
                { title: '長條', value: 'changtiao' }, { title: '四格', value: 'sige' },
                { title: '节操', value: 'jiecao' }, { title: '舰娘', value: 'jianniang' },
                { title: '竞技', value: 'jingji' }, { title: '搞笑', value: 'gaoxiao' },
                { title: '伪娘', value: 'weiniang' }, { title: '热血', value: 'rexue' },
                { title: '励志', value: 'lizhi' }, { title: '性转换', value: 'xingzhuanhuan' },
                { title: '彩色', value: 'COLOR' }, { title: '後宮', value: 'hougong' },
                { title: '美食', value: 'meishi' }, { title: '侦探', value: 'zhentan' },
                { title: 'AA', value: 'aa' }, { title: '音乐舞蹈', value: 'yinyuewudao' },
                { title: '魔幻', value: 'mohuan' }, { title: '战争', value: 'zhanzheng' },
                { title: '历史', value: 'lishi' }, { title: '异世界', value: 'yishijie' },
                { title: '惊悚', value: 'jingsong' }, { title: '机战', value: 'jizhan' },
                { title: '都市', value: 'dushi' }, { title: '穿越', value: 'chuanyue' },
                { title: '恐怖', value: 'kongbu' }, { title: 'C100', value: 'comiket100' },
                { title: '重生', value: 'chongsheng' }, { title: 'C99', value: 'comiket99' },
                { title: 'C101', value: 'comiket101' }, { title: 'C97', value: 'comiket97' },
                { title: 'C96', value: 'comiket96' }, { title: '生存', value: 'shengcun' },
                { title: '宅系', value: 'zhaixi' }, { title: '武侠', value: 'wuxia' },
                { title: 'C98', value: 'C98' }, { title: 'C95', value: 'comiket95' },
                { title: 'FATE', value: 'fate' }, { title: '转生', value: 'zhuansheng' },
                { title: '無修正', value: 'Uncensored' }, { title: '仙侠', value: 'xianxia' },
                { title: 'LoveLive', value: 'loveLive' }
            ],
            area: [
                { title: '全部', value: '' }, { title: '日漫', value: '0' },
                { title: '韩漫', value: '1' }, { title: '美漫', value: '2' }
            ],
            progress: [
                { title: '全部', value: '' }, { title: '连载中', value: '0' },
                { title: '已完结', value: '1' }, { title: '短篇', value: '2' }
            ],
            order: [
                { title: '更新時間（倒序）', value: '-datetime_updated' },
                { title: '熱度（倒序）', value: '-popular' },
                { title: '更新時間', value: 'datetime_updated' },
                { title: '熱度', value: 'popular' }
            ]
        };
    }
})());

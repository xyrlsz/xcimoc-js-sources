// 拷贝漫画 (CopyMH) — 由 Java 源 port（CopyMHBase + CopyMH）
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
var website = getSetting('website') || DEFAULT_WEBSITE;
var SEARCH_API = getSetting('search_api') || DEFAULT_SEARCH_API;

// 依次探测候选域名，找到能返回正常搜索结果的接口并持久化（对齐原 Java 的 searchApi 探测）
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
            baseUrl: 'https://www.copy4000.com',
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

    parseChapter(html, comic) {
        var list = [];
        // host 传入的第二个参数是 comic 对象 {cid, title}（见 JsMangaParser.parseChapter），
        // 兼容直接传字符串 cid 的情况。
        var cid = (comic && typeof comic === 'object') ? (comic.cid || '') : comic;
        var ccz = extractVar(html, 'ccz');
        var dnt = '';
        var dntEls = DOM(html).select('#dnt');
        if (dntEls.length) dnt = dntEls[0].attr('value') || '';
        log('[copy] parseChapter cid=' + cid + ' ccz=' + (ccz ? ccz.length : 0)
            + ' dnt=' + (dnt ? dnt.length : 0));
        if (!ccz || !dnt) return list;
        try {
            var headers = this.getHeader();
            headers['Accept'] = 'application/json, text/plain, */*';
            headers['Referer'] = website + '/comic/' + cid;
            headers['dnts'] = dnt;
            var resp = fetch(website + '/comicdetail/' + cid + '/chapters?format=json', { headers: headers });
            log('[copy] chapters resp status=' + (resp && resp.status) + ' len=' + (resp && resp.body ? resp.body.length : 0));
            if (!resp || resp.status !== 200 || !resp.body) return list;
            var rootObject = JSON.parse(resp.body);
            if (rootObject.code === 200 && rootObject.results) {
                var encrypted = String(rootObject.results).trim();
                if (encrypted.length > 16) {
                    var ivStr = encrypted.substring(0, 16);
                    var cipherStr = encrypted.substring(16);
                    var plainText = aesCbcDecrypt(cipherStr, ccz, ivStr);
                    log('[copy] decrypt ok=' + (!!plainText) + ' len=' + (plainText ? plainText.length : 0));
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
            log('[copy] parseChapter error: ' + e);
        }
        log('[copy] parsed ' + list.length + ' chapters');
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
            // 图片画质档位：把结尾 c\d+x 统一替换成所选宽度（800/1200/1500）
            var quality = getSetting('img_quality', '1500') || '1500';
            for (var i = 0; i < urls.length; i++) {
                var imgUrl = urls[i].url;
                imgUrl = imgUrl.replace(/c\d+x\.[a-zA-Z]+$/, 'c' + quality + 'x.webp');
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
        log('[category] req page=' + page + ' url=' + format);
        return {
            url: format,
            headers: this.getHeader()
        };
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);
        var target = body.select('div.row.exemptComic-box');
        log('[category] htmlLen=' + (html ? html.length : 0)
            + ' exemptComicBox=' + target.length);
        if (target.length) {
            var listAttr = (target[0].attr('list') || '')
                .replace(/&#x27;/g, '"')
                .replace(/&quot;/g, '"')
                .replace(/'/g, '"'); // jsoup 可能已把 &#x27; 解码成单引号，一并转成双引号
            log('[category] listAttr head=' + listAttr.slice(0, 200));
            try {
                var array = JSON.parse(listAttr);
                for (var i = 0; i < array.length; i++) {
                    list.push({
                        cid: array[i].path_word,
                        title: array[i].name,
                        cover: array[i].cover
                    });
                }
                log('[category] parsed ' + list.length + ' comics');
            } catch (e) {
                log('[category] list attr parse error: ' + e);
            }
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

    getSettings() {
        return [
            {
                key: 'img_quality', label: '图片画质', type: 'select', default: '1500',
                options: [
                    { label: '流畅（800px）', value: '800' },
                    { label: '清晰（1200px）', value: '1200' },
                    { label: '高清（1500px）', value: '1500' }
                ]
            },
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

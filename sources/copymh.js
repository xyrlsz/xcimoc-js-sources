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

// 默认分类（探测失败或未持久化时回退使用）
const DEFAULT_CATEGORIES = {
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
        { title: 'C100', value: 'comiket100' }, { title: '重生', value: 'chongsheng' },
        { title: 'C99', value: 'comiket99' }, { title: 'C101', value: 'comiket101' },
        { title: 'C97', value: 'comiket97' }, { title: 'C96', value: 'comiket96' },
        { title: '生存', value: 'shengcun' }, { title: '宅系', value: 'zhaixi' },
        { title: '武侠', value: 'wuxia' }, { title: 'C98', value: 'C98' },
        { title: 'C95', value: 'comiket95' }, { title: 'FATE', value: 'fate' },
        { title: '转生', value: 'zhuansheng' }, { title: '無修正', value: 'Uncensored' },
        { title: '仙侠', value: 'xianxia' }, { title: 'LoveLive', value: 'loveLive' }
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

var website = getSetting('website') || DEFAULT_WEBSITE;
var SEARCH_API = getSetting('search_api') || DEFAULT_SEARCH_API;
const DEFAULT_API_BASE = 'https://api.copy4000.com';
var apiBase = getSetting('api_base') || DEFAULT_API_BASE;

// network21 探测请求头：platform/region/version/webp 等参数会影响返回的域名列表
// 缺少这些头时服务器可能返回错误的 share/api（例如缺 region 会拿到非大陆线路）
function networkHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'platform': '1',
        'region': '1',
        'version': '2026.08.24',
        'webp': '1',
        'Origin': website,
        'Referer': website + '/'
    };
}

// 通过 /api/v3/system/network21 探测当前可用的 baseurl(share) 和 api baseurl(api)，持久化
// 候选 api 域名：已保存的 apiBase 优先，再由 CANDIDATE_DOMAINS 将 www. 替换为 api. 派生
function probeNetwork() {
    var candidates = [apiBase];
    for (var i = 0; i < CANDIDATE_DOMAINS.length; i++) {
        var d = CANDIDATE_DOMAINS[i].replace('://www.', '://api.');
        if (candidates.indexOf(d) < 0) candidates.push(d);
    }
    for (var i = 0; i < candidates.length; i++) {
        var apiDom = candidates[i];
        var url = apiDom + '/api/v3/system/network21?platform=1';
        try {
            var res = fetch(url, { headers: networkHeaders() });
            if (!res || res.status !== 200 || !res.body) continue;
            var data = JSON.parse(res.body);
            if (!data || data.code !== 200 || !data.results) continue;
            var r = data.results;
            // share[0] → website（web 域，用于 /comics、/comic/{cid}、搜索 API）
            var share = (r.share && r.share.length) ? r.share[0] : '';
            // api[0][0] → apiBase（API 域，用于分类、章节等接口）
            var api = (r.api && r.api.length && r.api[0].length) ? r.api[0][0] : '';
            if (!share && !api) continue;
            if (share) {
                var newWebsite = 'https://' + share;
                if (newWebsite !== website) {
                    website = newWebsite;
                    setSetting('website', newWebsite);
                }
            }
            if (api) {
                var newApiBase = 'https://' + api;
                if (newApiBase !== apiBase) {
                    apiBase = newApiBase;
                    setSetting('api_base', newApiBase);
                }
            }
            log('[copy] probeNetwork OK: website=' + website + ' apiBase=' + apiBase);
            return { success: true, message: '探测成功: ' + website + ' / ' + apiBase };
        } catch (e) { /* 该域名不通，试下一个 */ }
    }
    return { success: false, message: '未探测到可用接口（' + candidates.length + ' 个域名均失败）' };
}

// 「重新探测接口」按钮入口：先 probeNetwork 拿当前域名，
// 再从搜索页 HTML 用正则提取 countApi 路径，最后实测搜索接口
function probeSearchApi() {
    var net = probeNetwork();
    if (!net.success) return net;
    var ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    // 1. 从 /search?q=a 页面提取 const countApi = "..." 路径
    var newApi = SEARCH_API;
    try {
        var pageRes = fetch(website + '/search?q=a', { headers: { 'User-Agent': ua } });
        if (pageRes && pageRes.status === 200 && pageRes.body) {
            var m = /countApi\s*=\s*["']([^"']+)["']/.exec(pageRes.body);
            if (m && m[1]) {
                newApi = m[1];
                log('[copy] countApi extracted: ' + newApi + ' (was ' + SEARCH_API + ')');
            }
        }
    } catch (e) { /* 解析失败用当前 SEARCH_API */ }
    // 2. 用提取到的路径实测搜索接口，确认能返回 results.list
    try {
        var url = website + newApi + '?offset=0&platform=2&limit=1&q=a&q_type=';
        var res = fetch(url, { headers: { 'User-Agent': ua, 'platform': '2' } });
        if (res && res.status === 200 && res.body) {
            var json = JSON.parse(res.body);
            if (json && json.results && json.results.list) {
                SEARCH_API = newApi;
                setSetting('search_api', newApi);
                log('[copy] searchApi OK: ' + website + newApi);
                return { success: true, message: '搜索接口可用: ' + website + newApi };
            }
        }
        return { success: false, message: '域名探测成功但搜索接口无数据: ' + website + newApi };
    } catch (e) {
        return { success: false, message: '搜索接口测试失败: ' + e };
    }
}

// 分类 API 端点（相对路径，拼接在 api.xxx 域名下）
const CATEGORIES_API = '/api/v3/h5/filter/comic/tags?type=1';

// 从分类 API 的 JSON 响应解析分类选项
// theme → subject（path_word 与 /comics?theme= 一致，可直接用）
// ordering → order（path_word 与 /comics?ordering= 一致，生成正序+倒序）
// top → 地区(japan/korea/west)+状态(finish)，但 path_word 与 /comics 的 region=/status= 数值不一致，
//        且 API 不返回 連載中/短篇，故 area/progress 保持默认值（稳定不变）
function parseCategoriesFromApi(jsonStr) {
    var data = JSON.parse(jsonStr);
    if (!data || data.code !== 200 || !data.results) return null;
    var r = data.results;
    var result = { subject: [], area: [], progress: [], order: [] };

    // theme → subject
    result.subject.push({ title: '全部', value: '' });
    if (r.theme) {
        for (var i = 0; i < r.theme.length; i++) {
            if (r.theme[i].path_word) {
                result.subject.push({ title: r.theme[i].name, value: r.theme[i].path_word });
            }
        }
    }

    // area / progress：API 的 top 值(japan/korea/west/finish)与 /comics 的 region=/status= 不匹配，
    // 保持默认值（这些数值 0/1/2 稳定不变）
    result.area = DEFAULT_CATEGORIES.area;
    result.progress = DEFAULT_CATEGORIES.progress;

    // ordering → order（生成正序 + 倒序）
    if (r.ordering) {
        for (var j = 0; j < r.ordering.length; j++) {
            var pw = r.ordering[j].path_word;
            var nm = r.ordering[j].name;
            if (!pw) continue;
            result.order.push({ title: nm + '（倒序）', value: '-' + pw });
            result.order.push({ title: nm, value: pw });
        }
    }

    return result;
}

// 拉取分类 API，解析并持久化；每次 app 初始化时调用一次
function probeCategories() {
    try {
        var apiUrl = (apiBase || website.replace('://www.', '://api.')) + CATEGORIES_API;
        var res = fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
        if (!res || res.status !== 200 || !res.body) {
            log('[copy] probeCategories: fetch failed status=' + (res && res.status));
            return;
        }
        var parsed = parseCategoriesFromApi(res.body);
        if (!parsed || !parsed.subject.length) {
            log('[copy] probeCategories: parsed empty, keep existing');
            return;
        }
        setSetting('categories', JSON.stringify(parsed));
        log('[copy] probeCategories: saved subject=' + parsed.subject.length
            + ' order=' + parsed.order.length);
    } catch (e) {
        log('[copy] probeCategories error: ' + e);
    }
}

// app 初始化时先探测域名（更新 website + apiBase），再探测分类
// 不能在脚本顶层直接调用——JsMangaParser.createEngine() 在 evaluate 时会执行顶层代码，
// 若此时处于主线程（如 getCategory 被 UI 触发），fetch 会触发
// "Network request not allowed on main thread"。
// 改为 class 方法 init()，由 installSource 注册成全局函数，宿主在后台线程调用。

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

// 适配旧版 APK（source_sdk.js 里还没有 fixJsonQuotes 的情况）：
// SDK 已定义则直接用，否则用本地状态机实现。新版 APK 升级后 SDK 的版本会自动覆盖。
// 作用：把 HTML 属性里用单引号 / &#x27; 包裹的 JSON 转成标准双引号 JSON，
// 同时保留值内部的单引号（撇号），避免 .replace(/'/g, '"') 破坏含撇号的字符串。
if (typeof fixJsonQuotes !== 'function') {
    function fixJsonQuotes(str) {
        if (str == null) return str;
        var out = '';
        var inDq = false;
        var inSq = false;
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (inDq) {
                if (c === '\\' && i + 1 < str.length) {
                    out += c + str[i + 1];
                    i++;
                } else if (c === '"') {
                    inDq = false;
                    out += c;
                } else {
                    out += c;
                }
            } else if (inSq) {
                if (c === '\\' && i + 1 < str.length) {
                    var next = str[i + 1];
                    if (next === "'") {
                        out += "'";
                    } else if (next === '"') {
                        out += '\\"';
                    } else if (next === '\\') {
                        out += '\\\\';
                    } else {
                        out += '\\' + next;
                    }
                    i++;
                } else if (c === "'") {
                    inSq = false;
                    out += '"';
                } else if (c === '"') {
                    out += '\\"';
                } else {
                    out += c;
                }
            } else {
                if (c === '"') {
                    inDq = true;
                    out += c;
                } else if (c === "'") {
                    inSq = true;
                    out += '"';
                } else {
                    out += c;
                }
            }
        }
        return out;
    }
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

    init() {
        probeNetwork();
        probeCategories();
        probeSearchApi();
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
            var listAttr = fixJsonQuotes(target[0].attr('list') || '');
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
        // 从持久化设置读取分类（probeCategories 在 app 初始化时更新），无则回退到默认
        var cats = DEFAULT_CATEGORIES;
        var saved = getSetting('categories');
        if (saved) {
            try {
                var parsed = JSON.parse(saved);
                if (parsed && parsed.subject && parsed.subject.length) cats = parsed;
            } catch (e) { /* 解析失败用默认 */ }
        }
        return {
            composite: true,
            pageSize: 50,
            format: website + '/comics?theme={subject}&status={progress}&region={area}&ordering={order}&offset={offset}&limit=50',
            subject: cats.subject || DEFAULT_CATEGORIES.subject,
            area: cats.area || DEFAULT_CATEGORIES.area,
            progress: cats.progress || DEFAULT_CATEGORIES.progress,
            order: cats.order && cats.order.length ? cats.order : DEFAULT_CATEGORIES.order
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

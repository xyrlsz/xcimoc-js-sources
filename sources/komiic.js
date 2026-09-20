// 线路可从设置切换（komiic.com / komiic.cc）；网络不通时登录/查询会自动回退另一线路
var KOMIIC_LINES = ['https://komiic.com', 'https://komiic.cc'];
var baseUrl = (getSetting('line') === 'komiic.cc') ? KOMIIC_LINES[1] : KOMIIC_LINES[0];
function otherBase() {
    return baseUrl === KOMIIC_LINES[0] ? KOMIIC_LINES[1] : KOMIIC_LINES[0];
}

const Q_SEARCH = 'query searchComicAndAuthorQuery($keyword: String!) {\n  searchComicsAndAuthors(keyword: $keyword) {\n    comics {\n      id title status year imageUrl\n      authors { id name __typename }\n      categories { id name __typename }\n      dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate __typename\n    }\n    authors { id name chName enName wikiLink comicCount views __typename }\n    __typename\n  }\n}';

const Q_INFO = 'query comicById($comicId: ID!) {\n  comicById(comicId: $comicId) {\n    description id title status year imageUrl\n    authors { id name __typename }\n    categories { id name __typename }\n    dateCreated dateUpdated views favoriteCount lastBookUpdate lastChapterUpdate __typename\n  }\n}';

const Q_CHAPTERS = 'query chapterByComicId($comicId: ID!) {\n  chaptersByComicId(comicId: $comicId) {\n    id serial type dateCreated dateUpdated size __typename\n  }\n}';

const Q_IMAGES = 'query imagesByChapterId($chapterId: ID!) {\n  imagesByChapterId(chapterId: $chapterId) {\n    id kid height width __typename\n  }\n}';

const Q_ALL_CATEGORY = 'query allCategory {\n  allCategory {\n    id name group comicCount __typename\n  }\n}';

// 宿主 buildRequest 用 optString 读 body，因此必须返回 JSON 字符串；
// 各 GraphQL 请求需显式 contentType='application/json'。
function jsonBody(operationName, variables, query) {
    return JSON.stringify({ operationName: operationName, variables: variables, query: query });
}

function formatKomiicTime(t) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return t;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ---- 登录工具 ----
// 解析 Set-Cookie 响应头数组 → "name=value; name2=value2"（同名保留最后一个，忽略 Path/Domain 等）
function parseSetCookies(setCookieArr) {
    var map = {};
    var order = [];
    if (!setCookieArr) return '';
    for (var i = 0; i < setCookieArr.length; i++) {
        var h = String(setCookieArr[i] || '');
        if (!h) continue;
        var nv = h;
        var idx = h.indexOf(';');
        if (idx > 0) nv = h.substring(0, idx);
        nv = nv.trim();
        var eq = nv.indexOf('=');
        if (eq > 0) {
            var k = nv.substring(0, eq).trim();
            var v = nv.substring(eq + 1).trim();
            if (k && !(k in map)) order.push(k);
            map[k] = v;
        }
    }
    var out = [];
    for (var j = 0; j < order.length; j++) out.push(order[j] + '=' + map[order[j]]);
    return out.join('; ');
}

// 宿主登录态中的 cookie
function loginCookie() {
    var l = getLogin();
    if (!l) return '';
    try { var o = JSON.parse(l); return o.cookie || ''; } catch (e) { return ''; }
}

// 带登录 cookie 的请求头
function authHeaders() {
    if (checkExpired()) {
        refreshLogin();
    }
    var h = { referer: baseUrl + '/' };
    var c = loginCookie();
    if (c) h['cookie'] = c;
    return h;
}

// ---- 登录过期检查 / token(cookie 内 JWT) 刷新 / 自动重登 ----
function getExpFromJwt(cookieStr) {
    if (!cookieStr) return -1;
    var m = /([A-Za-z0-9\-_]+)\.([A-Za-z0-9\-_]+)\.([A-Za-z0-9\-_]+)/.exec(cookieStr);
    if (!m) return -1;
    try {
        var payload = base64UrlDecode(m[2]);
        var obj = JSON.parse(payload);
        if (obj && obj.exp !== undefined) return Number(obj.exp);
    } catch (e) { /* ignore */ }
    return -1;
}

function toTimestamp(t) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return -1;
    return Math.floor(d.getTime() / 1000);
}

function checkExpired() {
    var l = getLogin();
    if (!l) return true;
    var o = {};
    try { o = JSON.parse(l); } catch (e) { return true; }
    var cookies = o.cookie || '';
    if (!cookies) return true;
    var expired = getExpFromJwt(cookies);
    if (expired === -1) expired = Number(o.exp || -1);
    if (expired === -1) return false;
    return Math.floor(Date.now() / 1000) >= expired;
}

function relogin() {
    var l = getLogin();
    if (!l) return false;
    var o = {};
    try { o = JSON.parse(l); } catch (e) { return false; }
    var u = o.username || o.account || '';
    var p = o.password || '';
    if (!u || !p) return false;
    var r = SOURCE.login({ account: u, password: p });
    return !!(r && r.success);
}

function refreshLogin() {
    var cookies = loginCookie();
    if (!cookies) return false;
    var res = fetch(baseUrl + '/auth/refresh', {
        method: 'POST',
        contentType: 'application/json',
        headers: { 'Content-Type': 'application/json', cookie: cookies, Referer: baseUrl + '/' }
    });
    if (res && res.status === 200 && res.setCookie && res.setCookie.length) {
        var newCookie = parseSetCookies(res.setCookie);
        var exp = getExpFromJwt(newCookie);
        var cur = {};
        try { cur = JSON.parse(getLogin()); } catch (e) { /* ignore */ }
        cur.cookie = newCookie;
        if (exp !== -1) cur.exp = exp;
        setLogin(JSON.stringify(cur));
        log('[komiic] token refreshed, exp=' + exp);
        return true;
    }
    return relogin();
}

// 查询剩余可看页数
function getImageLimitInfo() {
    var query = 'query getImageLimit {\n  getImageLimit {\n    limit\n    usage\n    resetInSeconds\n    __typename\n  }\n}';
    var lines = [baseUrl];
    var alt = otherBase();
    if (alt !== baseUrl) lines.push(alt);
    var lastMsg = '网络错误';
    for (var i = 0; i < lines.length; i++) {
        var res = fetch(lines[i] + '/api/query', {
            method: 'POST',
            contentType: 'application/json',
            headers: Object.assign({}, authHeaders(), {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
            }),
            body: JSON.stringify({ operationName: 'getImageLimit', variables: {}, query: query })
        });
        if (res && res.status === 200 && res.body) {
            try {
                var data = JSON.parse(res.body).data;
                if (data && data.getImageLimit) {
                    var limit = data.getImageLimit.limit;
                    var usage = Math.max(data.getImageLimit.usage || 0, 0);
                    var remaining = Math.max(limit - usage, 0);
                    var logged = !!loginCookie();
                    log('[limit] ok on ' + lines[i] + ' remaining=' + remaining);
                    return { success: true, message: (logged ? '已登录剩余可看 ' : '游客剩余可看 ') + remaining + ' 页', remaining: remaining };
                }
            } catch (e) { /* ignore */ }
        }
        if (res && res.status) lastMsg = '查询失败(' + res.status + ')';
    }
    return { success: false, message: lastMsg };
}

// ---- 分类自动更新 / 持久化 ----
// allCategory 返回的分类带 group（genre/relationship/setting/subject/mood/audience/format），
// 输出时按固定分组顺序排列、组内保持接口顺序，未知分组（站点新增）追加到尾部。
var CATEGORY_GROUP_ORDER = ['genre', 'relationship', 'setting', 'subject', 'mood', 'audience', 'format'];
var CATEGORY_KEY = 'categories';
var CATEGORY_TIME_KEY = 'categories_updated';

// 内置默认分类（繁体，取自旧 komiic.com 数据）：init() 首次更新成功前 / 离线时兜底
var DEFAULT_CATEGORIES = [
    { id: '1', name: '愛情' }, { id: '2', name: '後宮' }, { id: '3', name: '神鬼' }, { id: '4', name: '校園' },
    { id: '5', name: '搞笑' }, { id: '6', name: '生活' }, { id: '7', name: '懸疑' }, { id: '8', name: '冒險' },
    { id: '9', name: '恐怖' }, { id: '10', name: '職場' }, { id: '11', name: '魔幻' }, { id: '12', name: '魔法' },
    { id: '13', name: '格鬥' }, { id: '14', name: '宅男' }, { id: '15', name: '勵志' }, { id: '16', name: '耽美' },
    { id: '17', name: '科幻' }, { id: '18', name: '百合' }, { id: '19', name: '治癒' }, { id: '20', name: '萌系' },
    { id: '21', name: '熱血' }, { id: '22', name: '競技' }, { id: '23', name: '推理' }, { id: '24', name: '雜誌' },
    { id: '25', name: '偵探' }, { id: '26', name: '偽娘' }, { id: '27', name: '美食' }, { id: '28', name: '四格' },
    { id: '31', name: '社會' }, { id: '32', name: '歷史' }, { id: '33', name: '戰爭' }, { id: '34', name: '舞蹈' },
    { id: '35', name: '武俠' }, { id: '36', name: '機戰' }, { id: '37', name: '音樂' }, { id: '40', name: '體育' },
    { id: '42', name: '黑道' }, { id: '46', name: '腐女' }, { id: '47', name: '異世界' }, { id: '48', name: '驚悚' },
    { id: '51', name: '成人' }, { id: '54', name: '戰鬥' }, { id: '55', name: '復仇' }, { id: '56', name: '轉生' },
    { id: '57', name: '黑暗奇幻' }, { id: '58', name: '戲劇' }, { id: '59', name: '生存' }, { id: '60', name: '策略' },
    { id: '61', name: '政治' }, { id: '62', name: '黑暗' }, { id: '64', name: '動作' }, { id: '70', name: '性轉換' },
    { id: '78', name: '日常' }, { id: '81', name: '青春' }, { id: '85', name: '醫療' }, { id: '86', name: '致鬱' },
    { id: '87', name: '心理' }, { id: '88', name: '穿越' }, { id: '92', name: '友情' }, { id: '93', name: '犯罪' },
    { id: '97', name: '劇情' }, { id: '113', name: '少女' }, { id: '114', name: '賭博' }, { id: '123', name: '女性向' },
    { id: '129', name: '溫馨' }, { id: '164', name: '同人' }, { id: '183', name: '幻想' }, { id: '184', name: '成長' },
    { id: '185', name: '心裡' }, { id: '186', name: '溫暖' }, { id: '187', name: '戀愛' }, { id: '189', name: '奇幻' },
    { id: '204', name: '驚愕' }, { id: '214', name: '懷疑' }, { id: '219', name: '驚訝' }, { id: '222', name: '同性' },
    { id: '223', name: '驚奇' }, { id: '227', name: '博彩' }, { id: '232', name: '末世' }, { id: '247', name: '親情' },
    { id: '246', name: '青年' }, { id: '255', name: '宮廷' }, { id: '276', name: '家庭' }, { id: '277', name: '賽博龐克' }
];

// 规范化分类数组 [{id,name,group?}]：非法项跳过，字段统一为字符串
function normalizeCategoryItems(arr) {
    var list = [];
    if (!isArray(arr)) return list;
    for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (!it || it.id === undefined || it.id === null || String(it.id) === '') continue;
        var name = String(it.name === undefined || it.name === null ? '' : it.name).trim();
        if (!name) continue;
        list.push({ id: String(it.id), name: name, group: String(it.group || '') });
    }
    return list;
}

// 解析 allCategory 响应体 → [{id,name,group}]
function parseAllCategory(body) {
    var arr = [];
    try { arr = JSON.parse(body).data.allCategory || []; } catch (e) { /* ignore */ }
    return normalizeCategoryItems(arr);
}

// 按分组固定顺序重排（组内保持原顺序；无 group 的内置默认项原样保留）
function orderCategories(items) {
    var out = [];
    var g, i;
    for (g = 0; g < CATEGORY_GROUP_ORDER.length; g++) {
        for (i = 0; i < items.length; i++) {
            if (items[i].group === CATEGORY_GROUP_ORDER[g]) out.push(items[i]);
        }
    }
    for (i = 0; i < items.length; i++) {
        if (CATEGORY_GROUP_ORDER.indexOf(items[i].group) < 0) out.push(items[i]);
    }
    return out;
}

// 请求 allCategory（主线路不通自动回退另一线路），成功返回 [{id,name,group}]，失败返回 []
function fetchCategories() {
    var lines = [baseUrl];
    var alt = otherBase();
    if (alt !== baseUrl) lines.push(alt);
    for (var i = 0; i < lines.length; i++) {
        var res = fetch(lines[i] + '/api/query', {
            method: 'POST',
            contentType: 'application/json',
            headers: Object.assign({}, authHeaders(), {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
            }),
            body: jsonBody('allCategory', {}, Q_ALL_CATEGORY)
        });
        if (res && res.status === 200 && res.body) {
            var list = parseAllCategory(res.body);
            if (list.length) {
                log('[category] fetched ' + list.length + ' categories from ' + lines[i]);
                return list;
            }
        }
        log('[category] fetch failed on ' + lines[i] + ' status=' + (res ? res.status : 'null'));
    }
    return [];
}

// 自动更新分类并持久化（供 init() 调用）：拉取失败时保留上次数据，不覆盖
function updateCategories() {
    var list = fetchCategories();
    if (!list.length) {
        log('[category] update failed, keep stored categories');
        return false;
    }
    setSetting(CATEGORY_KEY, JSON.stringify(list));
    var now = Math.floor(Date.now() / 1000);
    setSetting(CATEGORY_TIME_KEY, String(now));
    log('[category] stored ' + list.length + ' categories, updatedAt=' + now);
    return true;
}

// 读取持久化分类：无数据/损坏返回 null（调用方回退 DEFAULT_CATEGORIES）
function loadStoredCategories() {
    var raw = getSetting(CATEGORY_KEY, '');
    if (!raw) return null;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { return null; }
    var list = normalizeCategoryItems(arr);
    return list.length ? list : null;
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 106,
            title: 'komiic',
            baseUrl: 'https://komiic.com',
            hosts: ['komiic.com', 'komiic.cc'],
            cidRegex: '(\\d+)'
        });
    }

    init() {
        updateCategories();
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: baseUrl + '/api/query',
            method: 'POST',
            contentType: 'application/json',
            headers: authHeaders(),
            body: jsonBody('searchComicAndAuthorQuery', { keyword: keyword }, Q_SEARCH)
        };
    }

    parseSearch(html, page) {
        var list = [];
        try {
            var comics = JSON.parse(html).data.searchComicsAndAuthors.comics;
            for (var i = 0; i < comics.length; i++) {
                var object = comics[i];
                var author = '';
                for (var j = 0; j < (object.authors || []).length; j++) {
                    author += object.authors[j].name;
                    if (j < object.authors.length - 1) author += ',';
                }
                list.push({
                    cid: object.id,
                    title: object.title,
                    cover: object.imageUrl,
                    update: formatKomiicTime(object.dateUpdated),
                    author: author
                });
            }
        } catch (e) { /* ignore */ }
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/comic/' + cid;
    }

    getInfoRequest(cid) {
        return {
            url: baseUrl + '/api/query',
            method: 'POST',
            contentType: 'application/json',
            headers: authHeaders(),
            body: jsonBody('comicById', { comicId: cid }, Q_INFO)
        };
    }

    parseInfo(html, cid) {
        var comicObject = JSON.parse(html).data.comicById;
        var author = '';
        for (var j = 0; j < (comicObject.authors || []).length; j++) {
            author += comicObject.authors[j].name;
            if (j < comicObject.authors.length - 1) author += ',';
        }
        return {
            title: comicObject.title,
            cover: comicObject.imageUrl,
            update: formatKomiicTime(comicObject.dateUpdated),
            author: author,
            intro: comicObject.description,
            finish: comicObject.status !== 'ONGOING'
        };
    }

    getChapterRequest(html, cid) {
        return {
            url: baseUrl + '/api/query',
            method: 'POST',
            contentType: 'application/json',
            headers: authHeaders(),
            body: jsonBody('chapterByComicId', { comicId: cid }, Q_CHAPTERS)
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        try {
            var data = JSON.parse(html).data;
            if (!data.chaptersByComicId) return list;
            var chapters = data.chaptersByComicId;
            chapters.sort(function (a, b) {
                return String(a.type).localeCompare(String(b.type));
            });
            for (var i = 0; i < chapters.length; i++) {
                var type = chapters[i].type;
                if (type === 'chapter') type = '话';
                else if (type === 'book') type = '卷';
                list.push({
                    title: chapters[i].serial,
                    path: chapters[i].id,
                    group: type
                });
            }
            list.reverse();
        } catch (e) { /* ignore */ }
        return list;
    }

    getImagesRequest(cid, path) {
        if (cid) setState('cid', String(cid));
        var c = loginCookie();
        if (!c) {
            showToast('未登录，Komiic可能使用受限');
        }
        return {
            url: baseUrl + '/api/query',
            method: 'POST',
            contentType: 'application/json',
            headers: authHeaders(),
            body: jsonBody('imagesByChapterId', { chapterId: path }, Q_IMAGES)
        };
    }

    parseImages(html, chapterJson) {
        var list = [];
        var chapter = chapterJson;
        if (typeof chapter === 'string') {
            try { chapter = JSON.parse(chapter) || {}; } catch (e) { chapter = {}; }
        }
        chapter = chapter || {};
        var comicCid = getState('cid') || chapter.cid || chapter.path || '';

        // ---- 新增：登录额度用完时自动切换游客请求 ----
        var cookie = loginCookie();
        if (cookie) {
            var limitInfo = getImageLimitInfo(); // 查询当前登录账号的剩余额度
            if (limitInfo && limitInfo.success && limitInfo.remaining <= 0) {
                // 登录账号图片余额已用完，清空 cookie，以游客身份请求图片
                cookie = '';
                log('[komiic] 登录额度已用完，自动切换为游客请求');
            }
        }
        // ------------------------------------------

        try {
            var images = JSON.parse(html).data.imagesByChapterId;
            for (var i = 1; i <= images.length; i++) {
                var imgUrl = baseUrl + '/api/image/' + images[i - 1].kid;
                list.push({
                    url: imgUrl,
                    lazy: false,
                    headers: {
                        referer: format('%s/comic/%s/chapter/%s', baseUrl, comicCid, chapter.path || ''),
                        cookie: cookie
                    }
                });
            }
        } catch (e) { /* ignore */ }
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    getHeader() {
        return { referer: baseUrl + '/', cookie: loginCookie() };
    }

    getRegisterUrl() {
        return "https://komiic.cc/register";
    }

    login(params) {
        var username = (params && params.account) || '';
        var password = (params && params.password) || '';
        log('[login] account=' + username + ' hasPassword=' + (password ? 'yes' : 'no'));
        if (!username || !password) return { success: false, message: '请输入账号和密码' };
        var lines = [baseUrl];
        var alt = otherBase();
        if (alt !== baseUrl) lines.push(alt);
        var lastMsg = '网络错误';
        for (var i = 0; i < lines.length; i++) {
            var u = lines[i] + '/api/login';
            var res = fetch(u, {
                method: 'POST',
                contentType: 'application/json',
                headers: {
                    'Referer': lines[i] + '/login',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
                },
                body: JSON.stringify({ email: username, password: password })
            });
            log('[login] try ' + lines[i] + ' status=' + (res ? res.status : 'null')
                + ' setCookie=' + ((res && res.setCookie && res.setCookie.length) ? res.setCookie.length : 0));
            if (res && res.status === 200 && res.setCookie && res.setCookie.length > 0) {
                var cookie = parseSetCookies(res.setCookie);
                var exp = getExpFromJwt(cookie);
                if (exp === -1) {
                    try {
                        var loginJson = JSON.parse(res.body);
                        if (loginJson && loginJson.expire) exp = toTimestamp(loginJson.expire);
                    } catch (e) { /* ignore */ }
                }
                var saved = { cookie: cookie, username: username, password: password };
                if (exp !== -1) saved.exp = exp;
                setLogin(JSON.stringify(saved));
                if (lines[i] !== baseUrl) {
                    setSetting('line', lines[i] === KOMIIC_LINES[1] ? 'komiic.cc' : 'komiic.com');
                    log('[login] switched line to ' + lines[i]);
                }
                log('[login] success on ' + lines[i] + ', cookie len=' + cookie.length + ' exp=' + exp);
                return { success: true, message: '登录成功' };
            }
            if (res && res.status) lastMsg = '登录失败(' + res.status + ')';
        }
        return { success: false, message: lastMsg };
    }

    getLoginState() {
        var l = getLogin();
        if (l) {
            try { var o = JSON.parse(l); return { loggedIn: !!(o.cookie || o.token) }; } catch (e) { }
        }
        return { loggedIn: false };
    }

    logout() {
        clearLogin();
    }

    getSettings() {
        return [
            {
                key: 'line', label: '线路', type: 'select', default: 'komiic.com', options: [
                    { label: 'komiic.com', value: 'komiic.com' },
                    { label: 'komiic.cc', value: 'komiic.cc' }
                ]
            },
            { key: 'image_limit', label: '剩余可看页数', type: 'callback', buttonText: '查询剩余额度' }
        ];
    }

    onSettingsAction(key) {
        if (key === 'image_limit') {
            return getImageLimitInfo();
        }
        return { success: false, message: '未知操作' };
    }

    getCategories() {
        // 优先使用 init() 自动更新并持久化的分类（随站点 allCategory 变化）；
        // 尚未更新成功（首次启动/接口异常）时回退内置默认列表。
        var items = loadStoredCategories() || DEFAULT_CATEGORIES;
        var ordered = orderCategories(items);
        var subject = [{ title: '全部', value: '' }];
        for (var i = 0; i < ordered.length; i++) {
            subject.push({ title: ordered[i].name, value: ordered[i].id });
        }
        return {
            composite: true,
            format: '{"subject":"{subject}","progress":"{progress}","order":"{order}","page":"{page}"}',
            subject: subject,
            progress: [
                { title: '全部', value: '' },
                { title: '連載', value: 'ONGOING' },
                { title: '完結', value: 'END' }
            ],
            order: [
                { title: '更新', value: 'DATE_UPDATED' },
                { title: '觀看數', value: 'VIEWS' },
                { title: '喜愛數', value: 'FAVORITE_COUNT' }
            ]
        };
    }

    getCategoryRequest(format, page) {
        var opts = JSON.parse(format || '{}');
        var subject = opts.subject || '';
        var progress = opts.progress || '';
        var order = opts.order || '';
        var pagination = {
            limit: 30,
            offset: (page - 1) * 30,
            orderBy: order,
            asc: false,
            status: progress
        };

        // 全部使用 comicByCategories（传入空数组表示全部）
        var variables = {
            categoryId: subject ? [subject] : [],
            pagination: pagination
        };
        var query = `query comicByCategories($categoryId: [ID!]!, $pagination: Pagination!) {
            comicByCategories(categoryId: $categoryId, pagination: $pagination) {
                id
                title
                status
                year
                imageUrl
                authors { id name __typename }
                categories { id name __typename }
                dateUpdated
                monthViews
                views
                favoriteCount
                recommendationCount
                lastBookUpdate
                lastChapterUpdate
                contentType
                imageCount
                isFavorite
                warnings
                __typename
            }
        }`;

        log('[category] comicByCategories subject=' + (subject || '全部') + ' order=' + order + ' page=' + page);
        return {
            url: baseUrl + '/api/query',
            method: 'POST',
            contentType: 'application/json',
            headers: authHeaders(),
            body: jsonBody('comicByCategories', variables, query)
        };
    }

    parseCategory(html, page) {
        var list = [];
        try {
            var data = JSON.parse(html).data || {};
            var comics = data.comicByCategories || [];
            for (var i = 0; i < comics.length; i++) {
                list.push({
                    cid: comics[i].id,
                    title: comics[i].title,
                    cover: comics[i].imageUrl
                });
            }
        } catch (e) {
            return list;
        }
        return list;
    }
})());
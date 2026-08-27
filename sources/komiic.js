// komiic — 由 Java 源 port（GraphQL API）
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
// 说明：原 Java 支持 komiic.com / komiic.cc 双线路自动探测与登录 cookie；
// JS 版无本地持久化，固定使用 komiic.com，cookie 为空（未登录内容可能受限）。

// 线路可从设置切换（komiic.com / komiic.cc）
var baseUrl = (getSetting('line') === 'komiic.cc') ? 'https://komiic.cc' : 'https://komiic.com';

const Q_SEARCH = 'query searchComicAndAuthorQuery($keyword: String!) {\n  searchComicsAndAuthors(keyword: $keyword) {\n    comics {\n      id title status year imageUrl\n      authors { id name __typename }\n      categories { id name __typename }\n      dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate __typename\n    }\n    authors { id name chName enName wikiLink comicCount views __typename }\n    __typename\n  }\n}';

const Q_INFO = 'query comicById($comicId: ID!) {\n  comicById(comicId: $comicId) {\n    description id title status year imageUrl\n    authors { id name __typename }\n    categories { id name __typename }\n    dateCreated dateUpdated views favoriteCount lastBookUpdate lastChapterUpdate __typename\n  }\n}';

const Q_CHAPTERS = 'query chapterByComicId($comicId: ID!) {\n  chaptersByComicId(comicId: $comicId) {\n    id serial type dateCreated dateUpdated size __typename\n  }\n}';

const Q_IMAGES = 'query imagesByChapterId($chapterId: ID!) {\n  imagesByChapterId(chapterId: $chapterId) {\n    id kid height width __typename\n  }\n}';

// 工具函数（模块级，不暴露为源接口）
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
    var h = { referer: baseUrl + '/' };
    var c = loginCookie();
    if (c) h['cookie'] = c;
    return h;
}

// 查询剩余可看页数（对齐 Java KomiicUtils.getImageLimit）
function getImageLimitInfo() {
    var query = 'query getImageLimit {\n  getImageLimit {\n    limit\n    usage\n    resetInSeconds\n    __typename\n  }\n}';
    var res = fetch(baseUrl + '/api/query', {
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
                return { success: true, message: (logged ? '已登录剩余可看 ' : '游客剩余可看 ') + remaining + ' 页', remaining: remaining };
            }
        } catch (e) { /* ignore */ }
    }
    return { success: false, message: res && res.status ? ('查询失败(' + res.status + ')') : '网络错误' };
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 106,
            title: 'komiic',
            baseUrl: 'https://komiic.com',
            hosts: ['komiic.com', 'komiic.cc']
        });
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
        var chapter = JSON.parse(chapterJson || '{}');
        try {
            var images = JSON.parse(html).data.imagesByChapterId;
            for (var i = 1; i <= images.length; i++) {
                var imgUrl = baseUrl + '/api/image/' + images[i - 1].kid;
                list.push({
                    url: imgUrl,
                    lazy: false,
                    headers: {
                        referer: format('%s/comic/%s/chapter/%s', baseUrl, chapter.cid, chapter.path),
                        cookie: loginCookie()
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

    login(params) {
        var username = (params && params.account) || '';
        var password = (params && params.password) || '';
        log('[login] account=' + username + ' hasPassword=' + (password ? 'yes' : 'no'));
        if (!username || !password) return { success: false, message: '请输入账号和密码' };
        var res = fetch(baseUrl + '/api/login', {
            method: 'POST',
            contentType: 'application/json',
            headers: {
                'Referer': baseUrl + '/login',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
            },
            body: JSON.stringify({ email: username, password: password })
        });
        log('[login] http status=' + (res ? res.status : 'null')
            + ' setCookie=' + ((res && res.setCookie && res.setCookie.length) ? res.setCookie.length : 0));
        if (res && res.status === 200 && res.setCookie && res.setCookie.length > 0) {
            var cookie = parseSetCookies(res.setCookie);
            setLogin(JSON.stringify({ cookie: cookie, username: username, password: password }));
            log('[login] success, cookie saved len=' + cookie.length);
            return { success: true, message: '登录成功' };
        }
        return { success: false, message: res && res.status ? ('登录失败(' + res.status + ')') : '网络错误' };
    }

    getLoginState() {
        var l = getLogin();
        if (l) {
            try { var o = JSON.parse(l); return { loggedIn: !!(o.cookie || o.token) }; } catch (e) {}
        }
        return { loggedIn: false };
    }

    logout() {
        clearLogin();
    }

    getSettings() {
        return [
            { key: 'line', label: '线路', type: 'select', default: 'komiic.com', options: [
                { label: 'komiic.com', value: 'komiic.com' },
                { label: 'komiic.cc', value: 'komiic.cc' }
            ] },
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
        return {
            composite: true,
            // 分类为 POST GraphQL，format 携带所选值（JSON），由 getCategoryRequest 使用
            format: '{"subject":"{subject}","progress":"{progress}","order":"{order}","page":"{page}"}',
            subject: [
                { title: '全部', value: '' }, { title: '愛情', value: '1' },
                { title: '神鬼', value: '3' }, { title: '校園', value: '4' },
                { title: '搞笑', value: '5' }, { title: '生活', value: '6' },
                { title: '懸疑', value: '7' }, { title: '冒險', value: '8' },
                { title: '恐怖', value: '9' }, { title: '職場', value: '10' },
                { title: '魔幻', value: '11' }, { title: '後宮', value: '2' },
                { title: '魔法', value: '12' }, { title: '格鬥', value: '13' },
                { title: '宅男', value: '14' }, { title: '勵志', value: '15' },
                { title: '耽美', value: '16' }, { title: '科幻', value: '17' },
                { title: '百合', value: '18' }, { title: '治癒', value: '19' },
                { title: '萌系', value: '20' }, { title: '熱血', value: '21' },
                { title: '競技', value: '22' }, { title: '推理', value: '23' },
                { title: '雜誌', value: '24' }, { title: '偵探', value: '25' },
                { title: '偽娘', value: '26' }, { title: '美食', value: '27' },
                { title: '四格', value: '28' }, { title: '社會', value: '31' },
                { title: '歷史', value: '32' }, { title: '戰爭', value: '33' },
                { title: '舞蹈', value: '34' }, { title: '武俠', value: '35' },
                { title: '機戰', value: '36' }
            ],
            progress: [
                { title: '全部', value: '' }, { title: '连载中', value: 'ONGOING' },
                { title: '已完结', value: 'COMPLETED' }, { title: '未开始', value: 'UPCOMING' }
            ],
            order: [
                { title: '更新', value: '-date_updated' },
                { title: '人气', value: '-views' },
                { title: '评分', value: '-rating' }
            ]
        };
    }

    getCategoryRequest(format, page) {
        // 宿主已把 getCategories() 的 format 模板 {"subject":"{subject}","progress":"{progress}",
        // "order":"{order}","page":"{page}"} 中的命名占位符替换为所选值，这里按名称解析。
        var opts = JSON.parse(format || '{}');
        var subject = opts.subject || '';
        var progress = opts.progress || '';
        var order = opts.order || '';
        var variables = {
            categoryId: [subject],
            pagination: {
                limit: 30,
                offset: (page - 1) * 30,
                orderBy: order,
                asc: false,
                status: progress
            }
        };
        var query = 'query comicByCategories($categoryId: [ID!]!, $pagination: Pagination!) {\n  comicByCategories(categoryId: $categoryId, pagination: $pagination) {\n    id title status year imageUrl\n    authors { id name __typename }\n    categories { id name __typename }\n    dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate __typename\n  }\n}';
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
            var comics = JSON.parse(html).data.comicByCategories;
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

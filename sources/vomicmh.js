const baseUrl = 'https://www.vomicmh.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';

function vomicHeaders(referer) {
    return {
        'user-agent': UA,
        'referer': referer || (baseUrl + '/')
    };
}

function decodeText(text) {
    return text ? String(text).replace(/&amp;/g, '&') : text;
}

function vomicCid(href) {
    return match('detail/([^/?#]+)', href, 1);
}

function loginCookie() {
    var l = getLogin();
    if (!l) return '';
    try { var o = JSON.parse(l); return o.cookie || ''; } catch (e) { return ''; }
}

function showLoginToastOnce() {
    var now = Date.now();
    var last = Number(getState('loginToastAt') || 0);
    if (now - last < 5000) return;
    setState('loginToastAt', now);
    showToast('请先登录 vomic漫 账号');
}

function parseChapterList(html) {
    var list = [];
    var nodes = DOM(html).select('div > a.chapter');
    for (var i = 0; i < nodes.length; i++) {
        var path = nodes[i].href();
        if (!path) continue;
        list.push({ title: nodes[i].text(), path: path });
    }
    list.reverse();
    log('[chapter] vomic parsed ' + list.length + ' chapters');
    return list;
}

// ========== 分类持久化 ==========
var VOMIC_CATEGORY_KEY = 'vomic_categories';
var VOMIC_CATEGORY_TIME_KEY = 'vomic_categories_updated';

// 内置默认分类（首次更新成功前 / 离线时兜底）
var DEFAULT_VOMIC_CATEGORIES = [
    { title: '冒险', value: '4' },
    { title: '搞笑', value: '5' },
    { title: '动作', value: '6' },
    { title: '科幻', value: '7' },
    { title: '爱情', value: '8' },
    { title: '侦探', value: '9' },
    { title: '竞技', value: '10' },
    { title: '魔法', value: '11' },
    { title: '校园', value: '12' },
    { title: '百合', value: '13' },
    { title: '耽美', value: '14' },
    { title: '历史', value: '15' },
    { title: '战争', value: '16' },
    { title: '宅系', value: '17' },
    { title: '治愈', value: '18' },
    { title: '武侠', value: '20' },
    { title: '职场', value: '21' },
    { title: '神鬼', value: '22' },
    { title: '奇幻', value: '23' },
    { title: '生活', value: '24' },
    { title: '其他', value: '25' },
    { title: '热血', value: '26' },
    { title: '古风', value: '27' },
    { title: '悬疑', value: '28' },
    { title: '都市', value: '29' },
    { title: '架空', value: '30' },
    { title: '青春', value: '31' },
    { title: '剧情', value: '32' },
    { title: '犯罪', value: '34' },
    { title: '致郁', value: '35' },
    { title: '纯爱', value: '36' },
    { title: '恋爱', value: '37' },
    { title: '体育', value: '38' },
    { title: '末世', value: '39' },
    { title: '少女', value: '40' },
    { title: '重生', value: '41' },
    { title: '美食', value: '43' }
];

// 从首页 HTML 解析分类标签
function parseCategoriesFromHome(html) {
    var list = [];
    var nodes = DOM(html).select('div.flex.mt-1 ul a.tag');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var href = node.href();
        var title = node.text();
        if (!href || !title) continue;
        // href 形如 /so/cate/4/1
        var parts = href.split('/');
        var value = parts[3] || '';  // /so/cate/4/1 → parts[3] = "4"
        if (!value) continue;
        list.push({ title: decodeText(title.trim()), value: value });
    }
    return list;
}

// 校验分类数据
function isValidVomicCategories(list) {
    return !!(list && list.length > 5);
}

// 读取持久化分类；无数据/损坏返回 null
function loadStoredVomicCategories() {
    var raw = getSetting(VOMIC_CATEGORY_KEY, '');
    if (!raw) return null;
    try {
        var obj = JSON.parse(raw);
        if (isValidVomicCategories(obj)) return obj;
    } catch (e) { /* ignore */ }
    return null;
}

// 自动更新分类并持久化（供 init 调用）
function updateVomicCategories() {
    try {
        var res = fetch(baseUrl + '/', { headers: vomicHeaders() });
        if (!res || res.status !== 200 || !res.body) {
            log('[category] vomic fetch home failed status=' + (res ? res.status : 'null'));
            return false;
        }
        var list = parseCategoriesFromHome(res.body);
        if (!isValidVomicCategories(list)) {
            log('[category] vomic parse empty, keep stored categories');
            return false;
        }
        setSetting(VOMIC_CATEGORY_KEY, JSON.stringify(list));
        var now = Math.floor(Date.now() / 1000);
        setSetting(VOMIC_CATEGORY_TIME_KEY, String(now));
        log('[category] vomic stored ' + list.length + ' categories, updatedAt=' + now);
        return true;
    } catch (e) {
        log('[category] vomic update error: ' + e);
        return false;
    }
}

// 判断是否需要更新（首次或超过 24 小时）
function shouldUpdateVomicCategories() {
    var last = Number(getSetting(VOMIC_CATEGORY_TIME_KEY, '0'));
    if (!last) return true;
    var now = Math.floor(Date.now() / 1000);
    return (now - last) > 86400;  // 24 小时
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 110,
            title: 'vomic漫',
            baseUrl: 'https://www.vomicmh.com',
            hosts: ['vomicmh.com'],
            cidRegex: 'detail/([\\w\\-]+)'
        });
    }

    // ========== 分类功能 ==========
    getCategories() {
        var stored = loadStoredVomicCategories();
        var subject = stored || DEFAULT_VOMIC_CATEGORIES;
        return {
            composite: true,
            pageSize: 12,
            format: baseUrl + '/so/cate/{subject}/{page}',
            subject: subject
        };
    }

    parseCategory(html, page) {
        var list = [];
        var nodes = DOM(html).select('div.justify-between > a');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = vomicCid(node.href());
            if (!cid) continue;
            list.push({
                cid: cid,
                title: decodeText(node.text('.title')) || '',
                cover: node.attr('img', 'src')
            });
        }
        log('[category] vomic parsed ' + list.length + ' items for page ' + page);
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/detail/' + cid;
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: baseUrl + '/so/key/' + encodeURIComponent(keyword) + '/1',
            headers: vomicHeaders()
        };
    }

    parseSearch(html, page) {
        var list = [];
        var nodes = DOM(html).select('div.justify-between > a');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = vomicCid(node.href());
            if (!cid) continue;
            list.push({
                cid: cid,
                title: decodeText(node.text('.title')) || '',
                cover: node.attr('img', 'src')
            });
        }
        log('[search] vomic parsed ' + list.length + ' items');
        return list;
    }

    getInfoRequest(cid) {
        return { url: this.getUrl(cid), headers: vomicHeaders() };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var author = '';
        var intro = '';
        var tags = [];

        // 提取作者和简介
        var nodes = body.select('div.detail > div > div');
        for (var i = 0; i < nodes.length; i++) {
            var text = nodes[i].text();
            if (!text) continue;
            if (text.indexOf('作者：') >= 0) author = decodeText(text.replace(/作者：/g, ''));
            if (text.indexOf('简介：') >= 0) intro = decodeText(text.replace(/简介：/g, ''));
        }

        // 提取分类标签（可能多个）
        var tagNodes = body.select('div.detail a[href^="/so/cate/"]');
        for (var j = 0; j < tagNodes.length; j++) {
            var tagText = tagNodes[j].text();
            if (tagText) tags.push(decodeText(tagText.trim()));
        }

        return {
            title: decodeText(body.text('div.detail > div > div > div')),
            cover: body.src('.cover-img > div > img'),
            author: author,
            intro: intro,
            tags: tags,
            chapters: parseChapterList(html)
        };
    }

    parseChapter(html, comicJson) {
        return parseChapterList(html);
    }

    getImagesRequest(cid, path) {
        var cookie = loginCookie();
        if (!cookie) {
            showLoginToastOnce();
            log('[images] vomic 未登录，取消图片页请求');
            return null;
        }
        var url = path.indexOf('http') === 0 ? path : (baseUrl + path);
        return {
            url: url,
            headers: Object.assign(vomicHeaders(url), { cookie: cookie })
        };
    }

    parseImages(html, chapter) {
        var list = [];
        var nodes = DOM(html).select('#myscroll > img.myimage');
        for (var i = 0; i < nodes.length; i++) {
            var src = nodes[i].src();
            if (!src) src = nodes[i].attr('data-src');
            if (!src) continue;
            list.push({ url: src, lazy: false });
        }
        log('[images] vomic parsed ' + list.length + ' images');
        return list;
    }

    getHeader() {
        return {
            'referer': baseUrl + '/',
            'user-agent': UA
        };
    }

    getRegisterUrl() {
        return baseUrl + '/';
    }


    init() {
        if (shouldUpdateVomicCategories()) {
            log('[init] vomic 分类需要更新，开始拉取首页...');
            updateVomicCategories();
        } else {
            log('[init] vomic 分类仍在缓存有效期内，跳过更新');
        }
    }

    login(params) {
        var username = (params && params.account) || '';
        var password = (params && params.password) || '';
        if (!username || !password) return { success: false, message: '请输入账号和密码' };
        log('[login] account=' + username + ' hasPassword=' + (password ? 'yes' : 'no'));
        var res = fetch('https://api.vomicmh.com/pics/login', {
            method: 'POST',
            contentType: 'application/json',
            headers: { 'referer': baseUrl + '/', 'user-agent': UA },
            body: JSON.stringify({ email: username, password: password })
        });
        log('[login] http status=' + (res ? res.status : 'null') + ' bodyLen=' + ((res && res.body) ? res.body.length : 0));
        if (res && res.status >= 200 && res.status < 300 && res.body) {
            try {
                var json = JSON.parse(res.body);
                var token = json && (json.token || (json.data && json.data.token));
                if (token) {
                    setLogin(JSON.stringify({ cookie: '_token=' + token, username: username, password: password }));
                    log('[login] success, token saved');
                    return { success: true, message: '登录成功' };
                }
                log('[login] response no token');
            } catch (e) {
                log('[login] parse error: ' + e);
            }
        }
        return { success: false, message: res && res.status ? ('登录失败(' + res.status + ')') : '网络错误' };
    }

    getLoginState() {
        return { loggedIn: !!loginCookie() };
    }

    logout() {
        clearLogin();
    }
})());
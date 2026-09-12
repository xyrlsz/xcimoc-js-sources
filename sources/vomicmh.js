const baseUrl = 'https://www.vomicmh.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';

function vomicHeaders(referer) {
    return {
        'user-agent': UA,
        'referer': referer || (baseUrl + '/')
    };
}

// 标题/作者/简介里常带 &amp; 实体
function decodeText(text) {
    return text ? String(text).replace(/&amp;/g, '&') : text;
}

// 从链接提取 cid（对齐 Java 的 href.split("/")[2]，同时兼容绝对链接）
function vomicCid(href) {
    return match('detail/([^/?#]+)', href, 1);
}

// 登录态中的 cookie（_token=xxx）
function loginCookie() {
    var l = getLogin();
    if (!l) return '';
    try { var o = JSON.parse(l); return o.cookie || ''; } catch (e) { return ''; }
}

// 未登录提示做去重：图片请求失败后宿主会立即重试一次，避免弹两次
function showLoginToastOnce() {
    var now = Date.now();
    var last = Number(getState('loginToastAt') || 0);
    if (now - last < 5000) return;
    setState('loginToastAt', now);
    showToast('请先登录 vomic漫 账号');
}

// 章节列表在详情页内（div > a.chapter），对齐 Java：反转成最新在前
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

    getUrl(cid) {
        return baseUrl + '/detail/' + cid;
    }

    getSearchRequest(keyword, page) {
        // 站点搜索只有第一页
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
        var nodes = body.select('div.detail > div > div');
        for (var i = 0; i < nodes.length; i++) {
            var text = nodes[i].text();
            if (!text) continue;
            if (text.indexOf('作者：') >= 0) author = decodeText(text.replace(/作者：/g, ''));
            if (text.indexOf('简介：') >= 0) intro = decodeText(text.replace(/简介：/g, ''));
        }
        return {
            title: decodeText(body.text('div.detail > div > div > div')),
            cover: body.src('.cover-img > div > img'),
            author: author,
            intro: intro,
            chapters: parseChapterList(html)
        };
    }

    parseChapter(html, comicJson) {
        return parseChapterList(html);
    }

    getImagesRequest(cid, path) {
        var cookie = loginCookie();
        if (!cookie) {
            // 对齐 Java：图片页需要登录 cookie，未登录直接放弃
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
        // 对齐 Java：注册走官网首页
        return baseUrl + '/';
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
                    // 存 password 以便登录失效(401)时 SDK 自动重新登录
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

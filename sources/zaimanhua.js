// 再漫画 (ZaiManhua) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
// 说明：原 Java 需要登录 token（SharedPreferences）；JS 版无登录入口，
// authorization 使用空 Bearer，未登录可能无法阅读部分漫画。

const apiBaseUrl = 'https://v4api.zaimanhua.com';
const pcBaseUrl = 'https://manhua.zaimanhua.com';

// ---- 登录工具 ----
// 从宿主登录态读取 token
function loginToken() {
    var l = getLogin();
    if (!l) return '';
    try { var o = JSON.parse(l); return o.token || ''; } catch (e) { return ''; }
}
// 带 Bearer token 的请求头
function authHeaders() {
    var h = { 'User-Agent': 'Dart/3.6 (dart:io)', platform: 'android' };
    var t = loginToken();
    if (t) h['authorization'] = 'Bearer ' + t;
    return h;
}

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 12,
            title: '再漫画',
            baseUrl: 'https://m.zaimanhua.com',
            hosts: ['zaimanhua.com']
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: format('%s/app/v1/search/index?keyword=%s&source=0&page=1&size=24&platform=android&_v=2.2.4&_c=101_01_01_000', apiBaseUrl, keyword),
            headers: authHeaders()
        };
    }

    parseSearch(html, page) {
        var list = [];
        try {
            var arr = JSON.parse(html).data.list;
            for (var i = 0; i < arr.length; i++) {
                var object = arr[i];
                list.push({
                    cid: String(object.id),
                    title: object.title,
                    cover: object.cover,
                    update: null,
                    author: object.authors
                });
            }
        } catch (e) { /* ignore */ }
        return list;
    }

    getUrl(cid) {
        return 'https://m.zaimanhua.com/pages/comic/detail?id=' + cid;
    }

    getInfoRequest(cid) {
        return {
            url: format('%s/app/v1/comic/detail/%s?_v=2.2.4&platform=android&_v=2.2.4&_c=101_01_01_000', apiBaseUrl, cid),
            headers: authHeaders()
        };
    }

    parseInfo(html, cid) {
        try {
            var data = JSON.parse(html).data.data;
            var author = '';
            for (var j = 0; j < (data.authors || []).length; j++) {
                author += data.authors[j].tag_name;
                if (j < data.authors.length - 1) author += ',';
            }
            return {
                title: data.title,
                cover: data.cover,
                update: formatTimestamp(data.last_updatetime),
                author: author,
                intro: data.description,
                finish: isFinishText(html)
            };
        } catch (e) { /* ignore */ }
        return null;
    }

    parseChapter(html, comicJson) {
        var list = [];
        try {
            var allJsonArray = JSON.parse(html).data.data.chapters;
            for (var i = 0; i < allJsonArray.length; i++) {
                var tag = allJsonArray[i].title;
                var chapters = allJsonArray[i].data;
                for (var j = 0; j < chapters.length; j++) {
                    list.push({
                        title: chapters[j].chapter_title,
                        path: chapters[j].chapter_id,
                        group: tag
                    });
                }
            }
            log('[chapter] parsed ' + list.length + ' chapters');
        } catch (e) {
            log('[chapter] parse error: ' + e + ' htmlLen=' + (html ? html.length : 0));
        }
        return list;
    }

    getImagesRequest(cid, path) {
        var url = format('%s/app/v1/comic/chapter/%s/%s?platform=android&_v=2.2.4&_c=101_01_01_000', pcBaseUrl, cid, path);
        var t = loginToken();
        log('[images] req cid=' + cid + ' path=' + path + ' hasToken=' + (t ? 'yes' : 'NO'));
        return {
            url: url,
            headers: authHeaders()
        };
    }

    parseImages(html) {
        var list = [];
        try {
            var array = JSON.parse(html).data.data.page_url;
            for (var i = 0; i < array.length; i++) {
                list.push({ url: array[i], lazy: false });
            }
            log('[images] parsed ' + list.length + ' urls, first=' + (list[0] ? list[0].url : 'none')
                + (list[0] ? ' jsonLen=' + html.length : ''));
        } catch (e) {
            log('[images] parse error: ' + e + ' jsonLen=' + (html ? html.length : 0));
        }
        return list;
    }

    getHeader() {
        var h = {
            Referer: 'https://manhua.zaimanhua.com/',
            'user-agent': 'Dalvik/2.1.0 (Linux; U; Android 12; SM-N9700 Build/SP1A.210812.016);'
        };
        var t = loginToken();
        if (t) h['authorization'] = 'Bearer ' + t;
        return h;
    }

    login(params) {
        var username = (params && params.account) || '';
        var password = (params && params.password) || '';
        log('[login] account=' + username + ' hasPassword=' + (password ? 'yes' : 'no'));
        if (!username || !password) return { success: false, message: '请输入账号和密码' };
        var passwdMd5 = md5(password);
        var res = fetch('https://i.zaimanhua.com/lpi/v1/login/passwd?username=' + encodeURIComponent(username) + '&passwd=' + passwdMd5, {
            method: 'POST',
            headers: { 'Referer': 'https://i.zaimanhua.com/login' }
        });
        log('[login] http status=' + (res ? res.status : 'null') + ' bodyLen=' + ((res && res.body) ? res.body.length : 0));
        if (res && res.status === 200 && res.body) {
            try {
                var json = JSON.parse(res.body);
                var data = json && json.data;
                if (data && data.user && data.user.token) {
                    var user = data.user;
                    setLogin(JSON.stringify({ token: user.token, uid: String(user.uid), username: username }));
                    log('[login] success, token saved, uid=' + user.uid);
                    return { success: true, message: '登录成功' };
                }
                log('[login] response no token');
                return { success: false, message: '登录失败' };
            } catch (e) {
                log('[login] parse error: ' + e);
                return { success: false, message: '登录失败' };
            }
        }
        return { success: false, message: res && res.status ? ('登录失败(' + res.status + ')') : '网络错误' };
    }

    getLoginState() {
        var l = getLogin();
        if (l) {
            try { var o = JSON.parse(l); return { loggedIn: !!o.token }; } catch (e) {}
        }
        return { loggedIn: false };
    }

    logout() {
        clearLogin();
    }

    getSettings() {
        return [
            { key: 'auto_sign', label: '自动签到', type: 'bool', default: 'false' },
            { key: 'sign_in', label: '签到', type: 'callback', buttonText: '立即签到' }
        ];
    }

    onSettingsAction(key) {
        if (key === 'sign_in') {
            var token = loginToken();
            if (!token) return { success: false, message: '请先登录' };
            var res = fetch('https://m.zaimanhua.com/lpi/v1/task/sign_in?_v=15', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Referer': 'https://m.zaimanhua.com/pages/signIn/index?from=app'
                }
            });
            if (res && res.status === 200) {
                return { success: true, message: '签到成功' };
            }
            return { success: false, message: res && res.status ? ('签到失败(' + res.status + ')') : '网络错误' };
        }
        return { success: false, message: '未知操作' };
    }

    parseCategory(html, page) {
        var list = [];
        try {
            var comics = JSON.parse(html).data.comicList;
            for (var i = 0; i < comics.length; i++) {
                list.push({
                    cid: String(comics[i].id),
                    title: comics[i].name,
                    cover: comics[i].cover
                });
            }
        } catch (e) {
            return list;
        }
        return list;
    }

    getCategories() {
        return {
            composite: true,
            pageSize: 20,
            format: apiBaseUrl + '/app/v1/comic/filter/list?page={page}&sortType={order}&theme={subject}&cate={reader}&status={progress}&zone={area}&size=20',
            subject: [
                { title: '全部', value: '0' }, { title: '冒险', value: '4' },
                { title: '欢乐向', value: '5' }, { title: '格斗', value: '6' },
                { title: '科幻', value: '7' }, { title: '爱情', value: '8' },
                { title: '侦探', value: '9' }, { title: '竞技', value: '10' },
                { title: '魔法', value: '11' }, { title: '神鬼', value: '12' },
                { title: '校园', value: '13' }, { title: '惊悚', value: '14' },
                { title: '其他', value: '16' }, { title: '四格', value: '17' },
                { title: '亲情', value: '3242' }, { title: 'ゆり', value: '3243' },
                { title: '秀吉', value: '3244' }, { title: '悬疑', value: '3245' },
                { title: '纯爱', value: '3246' }, { title: '热血', value: '3248' },
                { title: '泛爱', value: '3249' }, { title: '历史', value: '3250' },
                { title: '战争', value: '3251' }, { title: '萌系', value: '3252' },
                { title: '宅系', value: '3253' }, { title: '治愈', value: '3254' },
                { title: '励志', value: '3255' }, { title: '武侠', value: '3324' },
                { title: '机战', value: '3325' }, { title: '音乐舞蹈', value: '3326' },
                { title: '美食', value: '3327' }, { title: '职场', value: '3328' },
                { title: '西方魔幻', value: '3365' }, { title: '高清单行', value: '4459' },
                { title: 'TS', value: '4518' }, { title: '东方', value: '5077' },
                { title: '魔幻', value: '5806' }, { title: '奇幻', value: '5848' },
                { title: '节操', value: '6219' }, { title: '轻小说', value: '6316' },
                { title: '颜艺', value: '6437' }, { title: '搞笑', value: '7568' },
                { title: '仙侠', value: '7900' }, { title: '舰娘', value: '13627' },
                { title: '动画', value: '17192' }, { title: 'AA', value: '18522' },
                { title: '福瑞', value: '23323' }, { title: '生存', value: '23388' },
                { title: '日常', value: '30788' }, { title: '画集', value: '31137' },
                { title: '2025冬', value: '34093' }
            ],
            area: [
                { title: '全部', value: '0' }, { title: '日本', value: '2304' },
                { title: '韩国', value: '2305' }, { title: '欧美', value: '2306' },
                { title: '港台', value: '2307' }, { title: '内地', value: '2308' },
                { title: '其他', value: '8435' }
            ],
            progress: [
                { title: '全部', value: '0' }, { title: '连载中', value: '2309' },
                { title: '已完结', value: '2310' }, { title: '短篇', value: '29205' }
            ],
            reader: [
                { title: '全部', value: '0' }, { title: '少年漫画', value: '3262' },
                { title: '少女漫画', value: '3263' }, { title: '青年漫画', value: '3264' },
                { title: '女青漫画', value: '13626' }
            ],
            order: [
                { title: '更新', value: '1' }, { title: '人气', value: '2' }
            ]
        };
    }
})());

const baseUrlCN = 'https://appcn2.bzmgapp.com/baozimhapp';
const baseUrlGlobal = 'https://appgb3.bzmgapp.com/baozimhapp';

function getBaseUrl() {
    return getSetting('use_global', true) ? baseUrlGlobal : baseUrlCN;
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

// ============================================================
// 更新时间处理
// ============================================================
// 补零
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 时间格式化：yyyy-MM-dd HH:mm
function formatDateTime(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
        + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 日期格式化：yyyy-MM-dd
function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 清洗「更新时间」文本：去括号、去尾部「更新 / 更新于 / 更新至」等修饰
function cleanUpdateText(text) {
    if (!text) return '';
    var s = String(text).trim();
    s = s.replace(/[\(\)（）\[\]【】]/g, '').trim();
    s = s.replace(/\s*(更新于|更新至|更新)\s*$/g, '').trim();
    return s;
}

// 相对时间 → 具体日期时间；非相对时间原样返回清洗结果
// 支持：刚刚 / 今天 / 昨天 / 前天 / N秒前 / N分钟前 / N小时前 / N天前 / N周前 / N个月前 / N年前（含繁体）
function relativeToDate(text) {
    var s = cleanUpdateText(text);
    if (!s) return '';

    // 已是绝对日期，直接返回
    var abs = s.match(/\d{4}年\d{1,2}月\d{1,2}日/);
    if (abs) return abs[0];

    // 「刚刚」
    if (/刚刚|剛剛/.test(s)) return formatDateTime(new Date());

    // 「今天 / 昨天 / 前天」（只精确到日）
    if (/今天|今日/.test(s)) return formatDate(new Date());
    if (/昨天|昨日/.test(s)) return formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (/前天|前日/.test(s)) return formatDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    // N 单位前
    var m = s.match(/(\d+)\s*(秒|分|小時|小时|時|时|天|日|週|周|個月|个月|月|年)\s*前/);
    if (!m) return s;

    var n = parseInt(m[1], 10);
    var unit = m[2];
    var ms;
    if (/秒/.test(unit)) ms = n * 1000;
    else if (/分/.test(unit)) ms = n * 60 * 1000;
    else if (/[時时]/.test(unit)) ms = n * 60 * 60 * 1000;
    else if (/[天日]/.test(unit)) ms = n * 24 * 60 * 60 * 1000;
    else if (/[週周]/.test(unit)) ms = n * 7 * 24 * 60 * 60 * 1000;
    else if (/月/.test(unit)) ms = n * 30 * 24 * 60 * 60 * 1000;
    else if (/年/.test(unit)) ms = n * 365 * 24 * 60 * 60 * 1000;
    else return s;

    return formatDateTime(new Date(Date.now() - ms));
}

// ============================================================
// 分类自动更新 / 持久化
// ============================================================
var CATEGORY_KEY = 'classify_filters';
var CATEGORY_TIME_KEY = 'classify_filters_updated';

// 内置默认分类（源自 /classify 页面快照，首次更新成功前 / 离线时兜底）
var DEFAULT_FILTERS = {
    subject: [
        { title: '全部', value: 'all' }, { title: '戀愛', value: 'lianai' },
        { title: '純愛', value: 'chunai' }, { title: '古風', value: 'gufeng' },
        { title: '異能', value: 'yineng' }, { title: '懸疑', value: 'xuanyi' },
        { title: '劇情', value: 'juqing' }, { title: '科幻', value: 'kehuan' },
        { title: '奇幻', value: 'qihuan' }, { title: '玄幻', value: 'xuanhuan' },
        { title: '穿越', value: 'chuanyue' }, { title: '冒險', value: 'mouxian' },
        { title: '推理', value: 'tuili' }, { title: '武俠', value: 'wuxia' },
        { title: '格鬥', value: 'gedou' }, { title: '戰爭', value: 'zhanzheng' },
        { title: '熱血', value: 'rexie' }, { title: '搞笑', value: 'gaoxiao' },
        { title: '大女主', value: 'danuzhu' }, { title: '都市', value: 'dushi' },
        { title: '總裁', value: 'zongcai' }, { title: '後宮', value: 'hougong' },
        { title: '日常', value: 'richang' }, { title: '韓漫', value: 'hanman' },
        { title: '少年', value: 'shaonian' }, { title: '其它', value: 'qita' }
    ],
    area: [
        { title: '全部', value: 'all' }, { title: '國漫', value: 'cn' },
        { title: '日本', value: 'jp' }, { title: '韓國', value: 'kr' },
        { title: '歐美', value: 'en' }
    ],
    progress: [
        { title: '全部', value: 'all' }, { title: '連載中', value: 'serial' },
        { title: '已完結', value: 'pub' }
    ],
    order: [
        { title: '全部', value: '*' }, { title: 'ABCD', value: 'ABCD' },
        { title: 'EFGH', value: 'EFGH' }, { title: 'IJKL', value: 'IJKL' },
        { title: 'MNOP', value: 'MNOP' }, { title: 'QRST', value: 'QRST' },
        { title: 'UVW', value: 'UVW' }, { title: 'XYZ', value: 'XYZ' },
        { title: '0-9', value: '0-9' }
    ]
};

// 页面分组名 → 返回结构键名
var CLASSIFY_KEY_MAP = { type: 'subject', region: 'area', state: 'progress', filter: 'order' };

// 从 /classify 页面 HTML 中解析筛选组
function parseClassifyFilters(html) {
    var result = { subject: [], area: [], progress: [], order: [] };
    if (!html) return result;
    // 形如：onclick="handle_change_filters(this, 'region', 'all')" ...> 全部 </div>
    var re = /handle_change_filters\(this,\s*'([^']+)',\s*'([^']+)'\)[^>]*>\s*([^<]+?)\s*</g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var group = m[1];
        var value = m[2];
        var title = (m[3] || '').trim();
        if (!title) continue;
        var key = CLASSIFY_KEY_MAP[group];
        if (!key) continue;
        result[key].push({ title: title, value: value });
    }
    return result;
}

// 校验是否为可用分类数据（四组都非空）
function isValidFilters(f) {
    return !!(f
        && f.subject && f.subject.length
        && f.area && f.area.length
        && f.progress && f.progress.length
        && f.order && f.order.length);
}

// 拉取 /classify 页面并解析；失败返回 null
function fetchClassifyFilters() {
    var res = fetch(getBaseUrl() + '/classify', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36',
            'Referer': getBaseUrl() + '/'
        }
    });
    if (res && res.status === 200 && res.body) {
        var filters = parseClassifyFilters(res.body);
        if (isValidFilters(filters)) return filters;
        log('[category] baozi parse empty, check page structure');
    } else {
        log('[category] baozi fetch failed status=' + (res ? res.status : 'null'));
    }
    return null;
}

// 自动更新分类并持久化（供 init 调用）；失败时保留上次数据
function updateCategories() {
    try {
        var filters = fetchClassifyFilters();
        if (!filters) {
            log('[category] baozi update failed, keep stored categories');
            return false;
        }
        setSetting(CATEGORY_KEY, JSON.stringify(filters));
        var now = Math.floor(Date.now() / 1000);
        setSetting(CATEGORY_TIME_KEY, String(now));
        log('[category] baozi stored subject=' + filters.subject.length
            + ' area=' + filters.area.length
            + ' progress=' + filters.progress.length
            + ' order=' + filters.order.length
            + ' updatedAt=' + now);
        return true;
    } catch (e) {
        log('[category] baozi update error: ' + e);
        return false;
    }
}

// 读取持久化分类；无数据/损坏返回 null
function loadStoredCategories() {
    var raw = getSetting(CATEGORY_KEY, '');
    if (!raw) return null;
    try {
        var obj = JSON.parse(raw);
        if (isValidFilters(obj)) return obj;
    } catch (e) { /* ignore */ }
    return null;
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 101,
            title: '包子漫画',
            baseUrl: 'https://www.baozimh.com',
            hosts: ['baozimhcn.com', 'baozimh.com', 'bzmgcn.com'],
            cidRegex: 'comic/([\\w\\-]+)',
        });
    }

    init() {
        updateCategories();
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        var url = getBaseUrl() + '/search?q=' + keyword;
        return { url: url };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('.comics-card');

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var onclick = node.attr('.comics-card__poster', 'onclick') || '';
            var m = onclick.match(/\[\s*['"]comic['"]\s*,\s*['"]([^'"]+)['"]\s*\]/);
            var cid = m ? m[1] : '';

            if (!cid) {
                var href = node.href('.comics-card__info') || '';
                var parts = href.split('/');
                cid = parts.length > 2 ? parts[2] : href;
            }

            list.push({
                cid: cid,
                title: node.attr('.comics-card__poster', 'title') || node.text('.comics-card__info > div > h3'),
                cover: node.attr('div.img-box > img', 'data-src'),
                update: null,
                author: node.text('.comics-card__info > small')
            });
        }
        return list;
    }

    getUrl(cid) {
        return this.baseUrl + '/comic/' + cid;
    }

    getInfoRequest(cid) {
        return { url: getBaseUrl() + '/comic/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);

        var tagNodes = body.select('.tag-list .tag');
        var tagList = [];
        for (var i = 0; i < tagNodes.length; i++) {
            var t = (tagNodes[i].text() || '').trim();
            if (t) tagList.push(t);
        }

        var statusText = tagList.length ? tagList[0] : '';
        var finish = isFinishText(statusText);
        var realTags = tagList.slice(1);

        var bgStyle = body.attr('.de-info__bg', 'style') || '';
        var m = bgStyle.match(/url\(['"]?([^'")]+)['"]?\)/);
        var cover = m ? m[1] : '';

        var updateText = body.text('.comics-detail__info em') || body.text('div > span > em');
        // 优先取绝对日期；拿不到时把「今天/昨天/7小时前」等换算成具体日期时间
        var dateMatch = updateText.match(/\d{4}年\d{1,2}月\d{1,2}日/);
        var update = dateMatch ? dateMatch[0] : relativeToDate(updateText);

        return {
            title: body.text('.comics-detail__title'),
            cover: cover,
            author: body.text('.comics-detail__author'),
            intro: body.text('.comics-detail__desc'),
            update: update,
            finish: finish,
            tags: realTags
        };
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);
        var chapterNodes = body.select('.comics-chapters');
        if (html.indexOf('章节目录') >= 0 || html.indexOf('章節目錄') >= 0) {
            chapterNodes = chapterNodes.reverse();
        }
        var pathSet = {};
        for (var i = 0; i < chapterNodes.length; i++) {
            var node = chapterNodes[i];

            var onclick = node.attr('.comics-chapters__item', 'onclick') || '';
            var m = onclick.match(/\[\s*['"]chapter['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);

            var cid = '';
            var path = '';
            if (m) {
                cid = m[1];
                path = m[2] + '_' + m[3];
            } else {
                var href = node.href('a') || '';
                path = href.split('chapter_slot=')[1] || '';
            }

            if (!path || pathSet[path]) continue;
            pathSet[path] = true;
            list.push({
                title: node.text('div > span'),
                cid: cid,
                path: path
            });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: format('%s/comic/chapter/%s/0_%s.html', getBaseUrl(), cid, path),
            headers: {
                referer: getBaseUrl() + '/',
            }
        };
    }

    parseImages(html) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('.comic-contain > .chapter-img');
        log('[images] baozi htmlLen=' + (html ? html.length : 0) + ' nodes=' + nodes.length);
        var imgQuality = (getSetting('img_quality', 'w640') === 'w640') ? '/w640' : '';
        for (var i = 1; i <= nodes.length; i++) {
            var imgUrl = nodes[i - 1].attr('.comic-contain__item', 'data-src');
            var m = /^(https?:\/\/)?([^\/\s:]+)(:\d+)?(\/[a-z]comic\/.*)/.exec(imgUrl || '');
            if (m) {
                imgUrl = m[1] + m[2] + imgQuality + m[4];
            }
            list.push({ url: imgUrl, lazy: false });
        }
        log('[images] baozi parsed ' + list.length + ', first=' + (list[0] ? list[0].url : 'none'));
        return list;
    }

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36',
            Referer: getBaseUrl()
        };
    }

    parseCategory(html, page) {
        var list = [];
        try {
            var comics = JSON.parse(html).items;
            for (var i = 0; i < comics.length; i++) {
                var object = comics[i];
                list.push({
                    cid: String(object.comic_id),
                    title: object.name,
                    cover: format('https://%s/cover/%s?w=285&h=375&q=100', 's.baozicdn.com', object.topic_img)
                });
            }
            log('[category] baozi parsed ' + list.length + ' comics');
        } catch (e) {
            log('[category] baozi parse error: ' + e + ' jsonLen=' + (html ? html.length : 0));
        }
        return list;
    }

    getCategories() {
        // 优先使用 init() 自动更新并持久化的分类（随站点 /classify 变化）；
        // 尚未更新成功（首次启动/接口异常）时回退内置默认列表。
        var f = loadStoredCategories() || DEFAULT_FILTERS;
        return {
            composite: true,
            format: getBaseUrl() + '/api/bzmhq/amp_comic_list?type={subject}&region={area}&state={progress}&filter={order}&page={page}&limit=36&language=cn',
            subject: f.subject,
            area: f.area,
            progress: f.progress,
            order: f.order
        };
    }

    getSettings() {
        return [
            {
                key: 'img_quality', label: '图片画质', type: 'select', default: 'w640',
                options: [
                    { label: '省流（w640）', value: 'w640' },
                    { label: '原图（高清）', value: 'orig' }
                ]
            }, {
                key: 'use_global', label: '使用海外源', type: 'bool', default: true,
            }
        ];
    }
})());
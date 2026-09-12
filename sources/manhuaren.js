// 移动端 UA（对齐 Venera 源；站点会按 UA 输出移动布局）
function mhrUa() {
    return 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
}

function mhrBase() {
    return 'https://www.manhuaren.com';
}

// 统一请求头：移动端 UA + Referer（缺省用首页）
function mhrHeaders(referer) {
    return {
        'User-Agent': mhrUa(),
        'Referer': referer || (mhrBase() + '/')
    };
}

// 取图片地址：优先 src，回退懒加载 data-src
function mhrImg(node, sel) {
    var src = node.src(sel);
    if (!src) src = node.attr(sel, 'data-src');
    return src;
}

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 更新时间归一化（对齐 dm5.js 风格：今天/分钟前/昨天/前天/N天前/日期）
function normalizeUpdate(update) {
    if (!update) return null;
    var d = new Date();
    if (update.indexOf('分钟') >= 0 || update.indexOf('刚刚') >= 0) {
        return ymd(d);
    }
    var daysAgo = match('(\\d+)天前', update, 1);
    if (daysAgo) {
        d.setDate(d.getDate() - parseInt(daysAgo, 10));
        return ymd(d);
    }
    if (update.indexOf('今天') >= 0) {
        return ymd(d);
    } else if (update.indexOf('昨天') >= 0) {
        d.setDate(d.getDate() - 1);
        return ymd(d);
    } else if (update.indexOf('前天') >= 0) {
        d.setDate(d.getDate() - 2);
        return ymd(d);
    } else {
        var result = match('\\d+-\\d+-\\d+', update, 0);
        if (!result) {
            var rs = matchArray('(\\d+)月(\\d+)号', update, 1, 2);
            if (rs) {
                result = d.getFullYear() + '-' + rs[0] + '-' + rs[1];
            }
        }
        return result;
    }
}

// 解析详情页的章节列表：按站点分组收集，组内按 App 约定倒序（最新在前）。
// 站点默认「正序」排列（第 1 回在前）；若页面已显示「倒序」则保持原顺序。
function parseChapterList(html) {
    var list = [];
    var body = DOM(html);
    var groups = [];
    var selectors = body.select('a.detail-selector-item');
    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        // onclick 形如 titleSelect(this, 'detail-list-select', 'detail-list-select-1');
        // 评论等其它 tab（titleCommentSelect）不匹配，自然跳过。
        var listId = match('titleSelect\\([^,]*,\\s*[^,]*,\\s*[\'"]([^\'"]+)[\'"]\\)', sel.attr('onclick'), 1);
        if (!listId) continue;
        var ul = body.select('ul#' + listId);
        if (!ul.length) continue;
        var as = ul[0].select('li > a.chapteritem');
        var items = [];
        for (var j = 0; j < as.length; j++) {
            var a = as[j];
            var path = splitHref(a.href(), 0);
            if (!path) continue;
            // 两种章节项结构：长篇用 p.detail-list-2-info-title（副标题为日期），
            // 短篇直接把标题作为 a 的文本，故取不到 p 时回退整段文本。
            var title = a.text('p.detail-list-2-info-title');
            if (!title) title = a.text();
            items.push({
                title: title,
                path: path,
                group: sel.text()
            });
        }
        if (items.length) groups.push(items);
    }
    var orderText = body.text('.detail-list-title-right');
    var needReverse = !(orderText && orderText.indexOf('倒序') >= 0);
    for (var g = 0; g < groups.length; g++) {
        var arr = groups[g];
        if (needReverse) arr.reverse();
        for (var k = 0; k < arr.length; k++) {
            list.push(arr[k]);
        }
    }
    log('[chapter] manhuaren parsed ' + list.length + ' chapters, groups=' + groups.length
        + ', reverse=' + needReverse);
    return list;
}

function isFinishText(text) {
    return text !== null && text !== undefined && text.indexOf('完结') >= 0;
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 121,
            title: '漫画人',
            baseUrl: 'https://www.manhuaren.com',
            hosts: ['www.manhuaren.com', 'manhuaren.com'],
            cidRegex: '(manhua-[\\w\\-]+)'
        });
    }

    getUrl(cid) {
        return mhrBase() + '/' + cid + '/';
    }

    getHeader() {
        return mhrHeaders();
    }

    /* ---------------- 搜索 ---------------- */

    getSearchRequest(keyword, page) {
        return {
            url: mhrBase() + '/search?title=' + encodeURIComponent(keyword) + '&language=1&page=' + page,
            headers: mhrHeaders()
        };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.book-list > li');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = match('(manhua-[\\w\\-]+)', node.href('a'), 1);
            if (!cid) continue;
            list.push({
                cid: cid,
                title: node.text('p.book-list-info-title'),
                cover: mhrImg(node, 'img.book-list-cover-img')
            });
        }
        log('[search] manhuaren htmlLen=' + (html ? html.length : 0) + ' items=' + list.length);
        return list;
    }

    /* ---------------- 详情 ---------------- */

    getInfoRequest(cid) {
        return { url: mhrBase() + '/' + cid + '/', headers: mhrHeaders() };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var cover = mhrImg(body, '.detail-main-cover img');
        var author = body.text('.detail-main-info-author a');
        if (!author) {
            // 无作者链接时回退整段文本并去掉「作者：」前缀
            author = body.text('.detail-main-info-author');
            if (author && author.indexOf('作者：') === 0) {
                author = author.substring(3);
            }
        }
        var intro = body.text('.detail-desc');
        if (intro) {
            intro = intro.replace(/\[\+展开\]/g, '').replace(/\[-折叠\]/g, '').trim();
        }
        return {
            title: body.text('.detail-main-info-title'),
            cover: cover,
            update: normalizeUpdate(body.text('.detail-list-title-3')),
            author: author,
            intro: intro,
            finish: isFinishText(body.text('.detail-list-title-1')),
            // 章节在详情页内联，直接一并返回：宿主会缓存到 comic.note 供 parseChapter 消费
            chapters: parseChapterList(html)
        };
    }

    // 宿主未实现 getChapterRequest 时会用详情页 html 调用本方法（先消费 parseInfo 的缓存）
    parseChapter(html, comic) {
        return parseChapterList(html);
    }

    /* ---------------- 图片 ---------------- */

    getImagesRequest(cid, path) {
        var url = mhrBase() + '/' + path + '/';
        return { url: url, headers: mhrHeaders(url) };
    }

    parseImages(html, chapterJson) {
        var list = [];
        // 章节图片藏在 eval(function(p,a,c,k,e,d){…}('…',N,N,'…'.split('|'),0,{})) 打包脚本中
        var script = match('eval\\(function\\(p,a,c,k,e,d\\)[\\s\\S]*?0,\\{\\}\\)\\)', html, 0);
        if (!script) script = match('eval\\(.*\\)', html, 0);
        if (!script) {
            // 下架/收费章节没有图片数据
            log('[images] manhuaren no packed script (removed or paywalled?), htmlLen='
                + (html ? html.length : 0));
            return list;
        }
        var result = null;
        try {
            result = evalDecryptVar(script, 'newImgs');
            if (!result) result = evalDecrypt(script);
        } catch (e) {
            log('[images] manhuaren decode failed: ' + e);
            return list;
        }
        if (!result) return list;
        var array = String(result).split(',');
        var path = (chapterJson && (chapterJson.path || chapterJson.cid)) || '';
        var referer = mhrBase() + '/' + path + '/';
        for (var i = 0; i < array.length; i++) {
            var url = array[i];
            if (!url || url.indexOf('http') !== 0) continue;
            list.push({
                url: url,
                lazy: false,
                // 图片防盗链：必须携带章节页 Referer
                headers: { Referer: referer, 'User-Agent': mhrUa() }
            });
        }
        log('[images] manhuaren parsed ' + list.length + ' images');
        return list;
    }

    // 更新检查（复用详情请求）
    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        return normalizeUpdate(DOM(html).text('.detail-list-title-3'));
    }

    /* ---------------- 分类 ---------------- */

    getCategories() {
        return {
            composite: true,
            format: 'https://www.manhuaren.com/manhua-list-{subject} {progress} {order}-p{page}',
            subject: [
                { title: '全部', value: '' }, { title: '热血', value: 'tag31' },
                { title: '恋爱', value: 'tag26' }, { title: '校园', value: 'tag1' },
                { title: '伪娘', value: 'tag5' }, { title: '冒险', value: 'tag2' },
                { title: '职场', value: 'tag6' }, { title: '后宫', value: 'tag8' },
                { title: '治愈', value: 'tag9' }, { title: '科幻', value: 'tag25' },
                { title: '轻小说', value: 'tag156' }, { title: '励志', value: 'tag10' },
                { title: '生活', value: 'tag11' }, { title: '战争', value: 'tag12' },
                { title: '悬疑', value: 'tag17' }, { title: '推理', value: 'tag33' },
                { title: '搞笑', value: 'tag37' }, { title: '奇幻', value: 'tag14' },
                { title: '魔法', value: 'tag15' }, { title: '神鬼', value: 'tag20' },
                { title: '萌系', value: 'tag21' }, { title: '历史', value: 'tag4' },
                { title: '美食', value: 'tag7' }, { title: '同人', value: 'tag30' },
                { title: '运动', value: 'tag34' }, { title: '绅士', value: 'tag36' },
                { title: '机甲', value: 'tag40' }, { title: '百合', value: 'tag3' }
            ],
            progress: [
                { title: '全部', value: '' }, { title: '连载', value: 'st1' },
                { title: '完结', value: 'st2' }
            ],
            order: [
                { title: '更新', value: 's2' }, { title: '人气', value: '' },
                { title: '新品上架', value: 's18' }
            ]
        };
    }

    getCategoryRequest(format, page) {
        // 把 subject/progress/order 之间的连续空白折叠为连字符，并合并多余连字符
        // （{page} 已被宿主替换为页码）：例如 "manhua-list-  -p1" → "manhua-list-p1"
        var url = String(format).replace(/\s+/g, '-').replace(/-{2,}/g, '-');
        log('[category] manhuaren req url=' + url);
        return { url: url, headers: mhrHeaders() };
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.manga-list-2 > li');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = match('(manhua-[\\w\\-]+)', node.href('.manga-list-2-title a'), 1);
            if (!cid) continue;
            list.push({
                cid: cid,
                title: node.text('.manga-list-2-title a'),
                cover: mhrImg(node, '.manga-list-2-cover-img')
            });
        }
        log('[category] manhuaren htmlLen=' + (html ? html.length : 0) + ' items=' + list.length);
        return list;
    }
})());

// 动漫屋 (DM5) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。

// 工具函数（模块级，不暴露为源接口）
function normalizeUpdate(update) {
    if (!update) return null;
    var d = new Date();
    if (update.indexOf('今天') >= 0 || update.indexOf('分钟前') >= 0) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    } else if (update.indexOf('昨天') >= 0) {
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    } else if (update.indexOf('前天') >= 0) {
        d.setDate(d.getDate() - 2);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
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

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 5,
            title: '动漫屋',
            baseUrl: 'https://m.dm5.com',
            hosts: ['www.dm5.com', 'tel.dm5.com', 'm.dm5.com'],
            cidRegex: '([\\w\\-]+)'
        });
    }

    getSearchRequest(keyword, page) {
        return {
            url: 'https://m.dm5.com/pagerdata.ashx',
            method: 'POST',
            body: { t: '7', pageindex: String(page), title: keyword },
            headers: { Referer: 'http://m.dm5.com' }
        };
    }

    parseSearch(html, page) {
        var list = [];
        var array = JSON.parse(html);
        for (var i = 0; i < array.length; i++) {
            var object = array[i];
            var author = '';
            if (object.Author) {
                for (var j = 0; j < object.Author.length; j++) {
                    author += object.Author[j];
                }
            }
            list.push({
                cid: String(object.Url).split('/')[1],
                title: object.Title,
                cover: object.Pic,
                update: object.LastPartTime,
                author: author
            });
        }
        return list;
    }

    getUrl(cid) {
        return 'https://www.dm5.com/' + cid;
    }

    getInfoRequest(cid) {
        return { url: 'https://www.dm5.com/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var titleInfo = (body.text('div.banner_detail_form > div.info > p.title') || '').split(' ');
        var title = '';
        for (var i = 0; i < titleInfo.length - 1; i++) {
            title += titleInfo[i] + ' ';
        }
        var intro = body.text('div.banner_detail_form > div.info > p.content');
        if (intro) {
            intro = intro.replace(/\[\+展开\]/g, '').replace(/\[-折叠\]/g, '');
        }
        return {
            title: title.trim(),
            cover: body.src('div.banner_detail_form > div.cover > img'),
            update: normalizeUpdate(body.text('#tempc > div.detail-list-title > span.s > span')),
            author: body.text('div.banner_detail_form > div.info > p.subtitle > a'),
            intro: intro,
            finish: isFinishText(body.text('div.banner_detail_form > div.info > p.tip > span:eq(0)'))
        };
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);
        var chapterTypes = body.select('.detail-list-title > a');
        var chapterGroups = body.select('#chapterlistload > ul');
        for (var i = 0; i < chapterGroups.length; i++) {
            var type = chapterTypes[i].text();
            var num = chapterTypes[i].text('span');
            if (num) type = type.replace(num, '').trim();
            var lis = chapterGroups[i].select('li > a');
            for (var j = 0; j < lis.length; j++) {
                var title = split(lis[j].text(), ' ', 0);
                list.push({
                    title: title,
                    path: splitHref(lis[j].href(), 0),
                    group: type
                });
            }
        }
        var orderText = body.text('a.order');
        if (orderText && orderText.indexOf('正序') >= 0) {
            list.reverse();
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: 'https://m.dm5.com/' + path,
            headers: { Referer: 'https://m.dm5.com/' + path }
        };
    }

    parseImages(html) {
        var list = [];
        var str = match('eval\\(.*\\)', html, 0);
        if (!str) return list;
        try {
            var result = evalDecryptVar(str, 'newImgs');
            if (!result) result = evalDecrypt(str);
            var array = String(result).split(',');
            for (var i = 0; i < array.length; i++) {
                list.push({ url: array[i], lazy: false });
            }
        } catch (e) {
            // ignore
        }
        return list;
    }

    getLazyRequest(url) {
        return { url: url, headers: { Referer: 'https://www.dm5.com' } };
    }

    parseLazy(html, url) {
        var result = evalDecrypt(html);
        if (result) {
            return String(result).split(',')[0];
        }
        return null;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        return normalizeUpdate(DOM(html).text('#tempc > div.detail-list-title > span.s > span'));
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('ul.mh-list > li > div.mh-item');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cover = match('\\((.*?)\\)', node.attr('p.mh-cover', 'style'), 1);
            list.push({
                cid: splitHref(node.href('div > h2.title > a'), 0),
                title: node.text('div > h2.title > a'),
                cover: cover,
                author: substring(node.text('p.author'), 3)
            });
        }
        return list;
    }

    getHeader() {
        return null;
    }

    getCategories() {
        return {
            composite: true,
            format: 'https://www.dm5.com/manhua-list-{subject} {area} {progress} {order}-p{page}',
            subject: [
                { title: '全部', value: '' }, { title: '热血', value: 'tag31' },
                { title: '恋爱', value: 'tag26' }, { title: '校园', value: 'tag1' },
                { title: '百合', value: 'tag3' }, { title: '耽美', value: 'tag27' },
                { title: '冒险', value: 'tag2' }, { title: '后宫', value: 'tag8' },
                { title: '科幻', value: 'tag25' }, { title: '战争', value: 'tag12' },
                { title: '悬疑', value: 'tag17' }, { title: '推理', value: 'tag33' },
                { title: '搞笑', value: 'tag37' }, { title: '奇幻', value: 'tag14' },
                { title: '魔法', value: 'tag15' }, { title: '恐怖', value: 'tag29' },
                { title: '神鬼', value: 'tag20' }, { title: '历史', value: 'tag4' },
                { title: '同人', value: 'tag30' }, { title: '运动', value: 'tag34' },
                { title: '绅士', value: 'tag36' }, { title: '机战', value: 'tag40' }
            ],
            area: [
                { title: '全部', value: '' }, { title: '港台', value: 'area35' },
                { title: '日韩', value: 'area36' }, { title: '内地', value: 'area37' },
                { title: '欧美', value: 'area38' }
            ],
            progress: [
                { title: '全部', value: '' }, { title: '连载', value: 'serial' },
                { title: '完结', value: 'finished' }
            ],
            order: [
                { title: '更新', value: 'update' }, { title: '发布', value: 'index' },
                { title: '人气', value: 'view' }, { title: '评分', value: 'rate' }
            ]
        };
    }
})());

// 工具函数（模块级，不暴露为源接口）：为特定 URL 构造请求头
function getHeaderForUrl(url) {
    var cid = match('cid=(\\d+)', url, 1);
    return { Referer: 'https://m.dm5.com/m' + (cid ? cid : '') };
}

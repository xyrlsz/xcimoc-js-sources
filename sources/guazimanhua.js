// 包子漫画 (Baozi) — 由 Java 源 port
const baseUrl = 'https://www.guazimanhua.com';


function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 120,
            title: '瓜子漫画',
            baseUrl: 'https://www.guazimanhua.com',
            hosts: ['guazimanhua.com'],
            cidQuery: 'id'
        });
    }

    getSearchRequest(keyword, page) {
        return { url: baseUrl + '/category.php?keyword=' + keyword + '&page=' + page, headers: { Referer: baseUrl + '/' } };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);

        // 搜索页的 ld+json 结构化数据是可靠来源：给出每项 name 与 comic.php?id=xxx
        var items = [];
        try {
            var json = body.text('script[type="application/ld+json"]');
            if (json) {
                var data = JSON.parse(json);
                items = (data && data.mainEntity && data.mainEntity.itemListElement) || [];
            }
        } catch (e) {
            log('[search] guazi json parse error: ' + e);
        }

        var nodes = body.select('.grid > .card');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = '';
            var title = '';
            var m = /[?&]id=(\d+)/.exec(node.href('.cover-wrap') || '');
            if (m) cid = m[1];
            title = node.text('h3 a');

            // 兜底：按索引从 ld+json 补齐 cid / 标题
            if ((!cid || !title) && i < items.length) {
                var it = items[i] || {};
                var m2 = /[?&]id=(\d+)/.exec(it.url || '');
                if (!cid && m2) cid = m2[1];
                if (!title) title = it.name;
            }
            if (!cid) continue;

            list.push({
                cid: cid,
                title: title,
                cover: node.src('.cover-wrap .cover'),
                update: null,
                author: node.text('.meta')
            });
        }
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/comic.php?id=' + cid;
    }

    getInfoRequest(cid) {
        return { url: baseUrl + '/comic.php?id=' + cid, headers: { Referer: baseUrl + '/' } };
    }

    parseInfo(html, cid) {
        var body = DOM(html);

        // 连载状态（已完结/连载）从 HTML 多处提取
        var status = body.text('.mobile-comic-meta')
            + ' ' + body.text('.cinema-info .meta')
            + ' ' + body.text('.side-card .desc');

        var info = { title: '', cover: '', author: '', intro: '', update: '', finish: isFinishText(status) };

        // 详情页 ld+json 的 @graph 含 ComicStory：name/author/genre/image/description/dateModified
        try {
            var json = body.text('script[type="application/ld+json"]');
            if (json) {
                var data = JSON.parse(json);
                var graph = (data && data['@graph']) ? data['@graph'] : [];
                for (var g = 0; g < graph.length; g++) {
                    var node = graph[g];
                    if (!node || node['@type'] !== 'ComicStory') continue;
                    var author = (node.author && node.author.name) ? node.author.name : '';
                    info.title = node.name || '';
                    info.cover = node.image || '';
                    info.author = author;
                    info.intro = node.description || '';
                    info.update = node.dateModified || '';
                    break;
                }
            }
        } catch (e) {
            log('[info] guazi json parse error: ' + e);
        }

        // 兜底：JSON-LD 未命中时从 HTML 结构解析（mobile + desktop）
        if (!info.title) {
            info.title = body.text('.mobile-comic-title') || body.text('#cinema-title');
            info.cover = body.src('.mobile-comic-cover') || body.src('.cinema-cover');
            info.intro = body.text('.mobile-comic-desc') || body.text('.cinema-info > p');
            var desc = body.text('.side-card .desc');
            var mUpdate = /更新时间[:：]\s*(\d{4}-\d{2}-\d{2})/.exec(desc || '');
            info.update = mUpdate ? mUpdate[1] : (desc || '');
            var authorNodes = body.select('.cinema-strip > div');
            for (var i = 0; i < authorNodes.length; i++) {
                if (authorNodes[i].text('span') === '作者') {
                    info.author = authorNodes[i].text('b a');
                    break;
                }
            }
        }

        return info;
    }

    parseChapter(html) {
        var list = [];
        var body = DOM(html);

        // 详情页 ld+json 的 @graph 里含「章节目录」ItemList，按阅读顺序（第一章在前）给出章节 id 与标题
        try {
            var json = body.text('script[type="application/ld+json"]');
            if (json) {
                var data = JSON.parse(json);
                var graph = (data && data['@graph']) ? data['@graph'] : [];
                for (var g = 0; g < graph.length; g++) {
                    var node = graph[g];
                    if (!node || node['@type'] !== 'ItemList' || !node.itemListElement) continue;
                    var items = node.itemListElement;
                    for (var i = 0; i < items.length; i++) {
                        var it = items[i] || {};
                        var m = /[?&]id=(\d+)/.exec(it.url || '');
                        if (!m) continue;
                        list.push({
                            title: it.name,
                            path: m[1]
                        });
                    }
                    break;
                }
            }
        } catch (e) {
            log('[chapter] guazi json parse error: ' + e);
        }

        // 兜底：从 HTML 章节网格解析（[data-chapter-list] > a，倒序=最新在前，需反转成阅读顺序）
        if (list.length === 0) {
            var nodes = body.select('[data-chapter-list] > a');
            for (var j = nodes.length - 1; j >= 0; j--) {
                var m2 = /[?&]id=(\d+)/.exec(nodes[j].href() || '');
                if (!m2) continue;
                list.push({
                    title: nodes[j].text(),
                    path: m2[1]
                });
            }
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return { url: baseUrl + '/chapter.php?id=' + path, headers: { Referer: baseUrl + '/' } };
    }

    parseImages(html) {
        var list = [];
        var body = DOM(html);

        // 主要来源：阅读页 .reading-image 图片的 src
        var nodes = body.select('.reader-images > img.reading-image');
        for (var i = 0; i < nodes.length; i++) {
            var src = nodes[i].attr('src');
            if (src) list.push({ url: src, lazy: false });
        }

        // 兜底：从 ld+json 的「图片列表」ItemList 解析
        if (list.length === 0) {
            try {
                var json = body.text('script[type="application/ld+json"]');
                if (json) {
                    var data = JSON.parse(json);
                    var graph = (data && data['@graph']) ? data['@graph'] : [];
                    for (var g = 0; g < graph.length; g++) {
                        var node = graph[g];
                        if (!node || node['@type'] !== 'ItemList' || !node.itemListElement) continue;
                        var items = node.itemListElement;
                        for (var j = 0; j < items.length; j++) {
                            var img = (items[j] && items[j].item) || {};
                            if (img.url) list.push({ url: img.url, lazy: false });
                        }
                        break;
                    }
                }
            } catch (e) {
                log('[images] guazi json parse error: ' + e);
            }
        }

        log('[images] guazi parsed ' + list.length + ', first=' + (list[0] ? list[0].url : 'none'));
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36',
            Referer: baseUrl + '/'
        };
    }

    parseCategory(html, page) {
        var list = [];
        var body = DOM(html);

        // 分类页 ld+json 的 mainEntity.itemListElement 给出 name 与 comic.php?id=xxx
        var items = [];
        try {
            var json = body.text('script[type="application/ld+json"]');
            if (json) {
                var data = JSON.parse(json);
                items = (data && data.mainEntity && data.mainEntity.itemListElement) || [];
            }
        } catch (e) {
            log('[category] guazi json parse error: ' + e);
        }

        var nodes = body.select('.grid > .card');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var cid = '';
            var title = '';
            var m = /[?&]id=(\d+)/.exec(node.href('.cover-wrap') || '');
            if (m) cid = m[1];
            title = node.text('h3 a');

            // 兜底：按索引从 ld+json 补齐 cid / 标题
            if ((!cid || !title) && i < items.length) {
                var it = items[i] || {};
                var m2 = /[?&]id=(\d+)/.exec(it.url || '');
                if (!cid && m2) cid = m2[1];
                if (!title) title = it.name;
            }
            if (!cid) continue;

            list.push({
                cid: cid,
                title: title,
                cover: node.src('.cover-wrap .cover'),
                update: null,
                author: node.text('.meta')
            });
        }
        log('[category] guazi parsed ' + list.length);
        return list;
    }

    getCategories() {
        return {
            composite: true,
            pageSize: 36,
            // 分类为 GET category.php，format 携带所选值（JSON），由 getCategoryRequest 组装 URL
            format: '{"subject":"{subject}","area":"{area}","reader":"{reader}","progress":"{progress}","order":"{order}","page":"{page}"}',
            subject: [
                { title: '全部', value: '' }, { title: '耽美', value: '41' },
                { title: '恋爱', value: '9' }, { title: '校园', value: '29' },
                { title: '霸总', value: '5' }, { title: '都市', value: '42' },
                { title: '穿越', value: '8' }, { title: '古风', value: '23' },
                { title: '玄幻', value: '25' }, { title: '奇幻', value: '31' },
                { title: '科幻', value: '22' }, { title: '灵异', value: '21' },
                { title: '动作', value: '54' }, { title: '悬疑', value: '11' },
                { title: '冒险', value: '30' }, { title: '搞笑', value: '15' },
                { title: '热血', value: '13' }, { title: '恐怖', value: '14' },
                { title: '系统', value: '148' }, { title: '逆袭', value: '97' },
                { title: '脑洞', value: '55' }, { title: '复仇', value: '61' },
                { title: '真人', value: '17' }, { title: '其它', value: '27' }
            ],
            area: [
                { title: '全部', value: '' }, { title: '大陆', value: '42' },
                { title: '欧美', value: '43' }, { title: '港台', value: '77' },
                { title: '日韩', value: '78' }, { title: '国漫', value: '338' }
            ],
            reader: [
                { title: '全部', value: '' }, { title: '男频', value: '1' },
                { title: '女频', value: '2' }
            ],
            progress: [
                { title: '全部', value: '' }, { title: '连载中', value: '2' },
                { title: '已完结', value: '1' }
            ],
            order: [
                { title: '全部', value: '' }, { title: '今日热门', value: 'daily' },
                { title: '人气', value: 'hits' }, { title: '更新', value: 'update' },
                { title: '评分', value: 'score' }
            ]
        };
    }

    getCategoryRequest(format, page) {
        // 宿主已把 format 模板的命名占位符替换为所选值（JSON 字符串），这里按名称解析
        var opts = {};
        try {
            opts = JSON.parse(format || '{}');
        } catch (e) {
            log('[category] guazi format parse error: ' + e);
        }
        var params = [];
        if (opts.subject) params.push('cid=' + opts.subject);
        if (opts.area) params.push('city=' + opts.area);
        if (opts.reader) params.push('audience=' + opts.reader);
        if (opts.progress) params.push('is_end=' + opts.progress);
        if (opts.order) params.push('sort=' + opts.order);
        if (page > 1) params.push('page=' + page);
        var qs = params.length > 0 ? '?' + params.join('&') : '';
        log('[category] guazi page=' + page + ' qs=' + qs);
        return { url: baseUrl + '/category.php' + qs, headers: { Referer: baseUrl + '/' } };
    }
})());

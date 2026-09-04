// 包子漫画 (Baozi) — 由 Java 源 port
const baseUrl = 'https://www.baozimh.com';
// 图片画质（默认 w640）：在 parseImages 中按 getSetting('img_quality') 决定是否加 /w640 后缀

// 工具函数（模块级，不暴露为源接口）
function isFinishText(text) {
    return text !== null && (text.indexOf('完结') >= 0 || text.indexOf('Completed') >= 0 || text.indexOf('完結') >= 0);
}

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 101,
            title: '包子漫画',
            baseUrl: 'https://www.baozimh.com',
            hosts: ['baozimhcn.com', 'baozimh.com', 'bzmgcn.com'],
            cidRegex: 'comic/([\\w\\-]+)'
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return { url: baseUrl + '/search?q=' + keyword };
    }

    parseSearch(html, page) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('.comics-card');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var href = node.href('.comics-card__info') || '';
            var parts = href.split('/');
            list.push({
                cid: parts.length > 2 ? parts[2] : href,
                title: node.text('.comics-card__info > div > h3'),
                cover: node.src('.comics-card > a > amp-img'),
                update: null,
                author: node.text('.comics-card__info > small')
            });
        }
        return list;
    }

    getUrl(cid) {
        return baseUrl + '/comic/' + cid;
    }

    getInfoRequest(cid) {
        return { url: baseUrl + '/comic/' + cid };
    }

    parseInfo(html, cid) {
        var body = DOM(html);
        var tags = body.text('.tag-list');
        return {
            title: body.text('.comics-detail__title'),
            cover: body.src('div > amp-img'),
            author: body.text('.comics-detail__author'),
            intro: body.text('.comics-detail__desc'),
            update: body.text('div > span > em'),
            finish: isFinishText(tags)
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
            var href = node.href('a') || '';
            var path = href.split('chapter_slot=')[1];
            if (!path || pathSet[path]) continue;
            pathSet[path] = true;
            list.push({
                title: node.text('div > span'),
                path: path
            });
        }
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: format('https://appcn.baozimh.com/baozimhapp/comic/chapter/%s/0_%s.html', cid, path),
            headers: {
                referer: 'https://appcn.baozimh.com/',
                'user-agent': 'baozimh_android/1.0.29/cn/adset'
            }
        };
    }

    parseImages(html) {
        var list = [];
        var body = DOM(html);
        var nodes = body.select('.comic-contain > .chapter-img');
        log('[images] baozi htmlLen=' + (html ? html.length : 0) + ' nodes=' + nodes.length);
        // 图片画质：w640 加 /w640 后缀（省流），orig 原图不加后缀
        var imgQuality = (getSetting('img_quality', 'w640') === 'w640') ? '/w640' : '';
        for (var i = 1; i <= nodes.length; i++) {
            var imgUrl = nodes[i - 1].attr('.comic-contain__item', 'data-src');
            var m = /^(https?:\/\/)?([^\/\s:]+)(:\d+)?(\/[a-z]comic\/.*)/.exec(imgUrl || '');
            if (m) {
                imgUrl = m[1] + m[2] + imgQuality + m[4];
                // imgUrl = m[1] + "ascn-a2.bzcdn.net" + imgQuality + m[4];
            }
            list.push({ url: imgUrl, lazy: false });
        }
        log('[images] baozi parsed ' + list.length + ', first=' + (list[0] ? list[0].url : 'none'));
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36',
            Referer: baseUrl
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
                    cover: format('https://%s/cover/%s?w=285&h=375&q=100', 'static-tw.bzmgcn.com', object.topic_img)
                });
            }
            log('[category] baozi parsed ' + list.length + ' comics');
        } catch (e) {
            log('[category] baozi parse error: ' + e + ' jsonLen=' + (html ? html.length : 0));
        }
        return list;
    }

    getCategories() {
        return {
            composite: true,
            format: baseUrl + '/api/bzmhq/amp_comic_list?type={subject}&region={area}&state={progress}&filter={order}&page={page}&limit=36&language=cn',
            subject: [
                { title: '全部', value: 'all' }, { title: '恋爱', value: 'lianai' },
                { title: '纯爱', value: 'chunai' }, { title: '古风', value: 'gufeng' },
                { title: '异能', value: 'yineng' }, { title: '悬疑', value: 'xuanyi' },
                { title: '剧情', value: 'juqing' }, { title: '科幻', value: 'kehuan' },
                { title: '奇幻', value: 'qihuan' }, { title: '玄幻', value: 'xuanhuan' },
                { title: '穿越', value: 'chuanyue' }, { title: '冒险', value: 'mouxian' },
                { title: '推理', value: 'tuili' }, { title: '武侠', value: 'wuxia' },
                { title: '格斗', value: 'gedou' }, { title: '战争', value: 'zhanzheng' },
                { title: '热血', value: 'rexie' }, { title: '搞笑', value: 'gaoxiao' },
                { title: '大女主', value: 'danuzhu' }, { title: '都市', value: 'dushi' },
                { title: '总裁', value: 'zongcai' }, { title: '后宫', value: 'hougong' },
                { title: '日常', value: 'richang' }, { title: '韩漫', value: 'hanman' },
                { title: '少年', value: 'shaonian' }, { title: '其他', value: 'qita' }
            ],
            area: [
                { title: '全部', value: 'all' }, { title: '国漫', value: 'cn' },
                { title: '日本', value: 'jp' }, { title: '韩国', value: 'kr' },
                { title: '欧美', value: 'en' }
            ],
            progress: [
                { title: '全部', value: 'all' }, { title: '连载中', value: 'serial' },
                { title: '已完结', value: 'pub' }
            ],
            order: [
                { title: '全部', value: '*' }, { title: 'ABCD', value: 'ABCD' },
                { title: 'EFGH', value: 'EFGH' }, { title: 'IJKL', value: 'IJKL' },
                { title: 'NMOP', value: 'NMOP' }, { title: 'QRST', value: 'QRST' },
                { title: 'UVW', value: 'UVW' }, { title: 'XYZ', value: 'XYZ' },
                { title: '0-9', value: '0-9' }
            ]
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
            }
        ];
    }
})());

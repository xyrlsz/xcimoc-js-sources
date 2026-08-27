// 热辣漫画 (HotManga) — 由 Java 源 port
// 继承 MangaSource 基类（声明全部接口 + 默认空实现），仅覆写本源用到的接口。
const website = 'https://www.manga2026.com';
const api = 'https://api.2024manga.com';
// 原 Java 从 SharedPreferences 读取图片质量（默认 index 2 = 1500）
const IMG_QUALITY = '1500';

var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({
            type: 102,
            title: '热辣漫画',
            baseUrl: 'https://www.manga2026.com',
            hosts: ['manga2026.com', 'manga2025.com', 'manga2024.com'],
            cidRegex: 'comic/(\\w.+)'
        });
    }

    getSearchRequest(keyword, page) {
        if (page !== 1) return null;
        return {
            url: format('%s/api/v3/search/comic?platform=1&limit=30&offset=0&q=%s', api, keyword),
            headers: this.getHeader()
        };
    }

    parseSearch(html, page) {
        var list = [];
        var data = JSON.parse(html).results.list;
        for (var i = 0; i < data.length; i++) {
            var object = data[i];
            var author = '';
            for (var j = 0; j < (object.author || []).length; j++) {
                author += String(object.author[j].name || '').trim();
                if (j < object.author.length - 1) author += ',';
            }
            list.push({
                cid: object.path_word,
                title: t2s(object.name),
                cover: object.cover,
                update: null,
                author: author
            });
        }
        return list;
    }

    getUrl(cid) {
        return website + '/comic/' + cid;
    }

    getInfoRequest(cid) {
        return { url: format('%s/api/v3/comic2/%s', api, cid), headers: this.getHeader() };
    }

    parseInfo(html, cid) {
        var comicInfo = JSON.parse(html).results;
        var body = comicInfo.comic;
        var author = '';
        for (var i = 0; i < (body.author || []).length; i++) {
            author += body.author[i].name;
            if (i < body.author.length - 1) author += ', ';
        }
        return {
            title: body.name,
            cover: body.cover,
            update: body.datetime_updated,
            author: author,
            intro: body.brief,
            finish: (body.status && body.status.value) !== 0,
            note: comicInfo.groups
        };
    }

    getChapterRequest(html, cid) {
        return {
            url: format('%s/api/v3/comic/%s/group/default/chapters?limit=500&offset=0', api, cid),
            headers: this.getHeader()
        };
    }

    parseChapter(html, comicJson) {
        var list = [];
        var comic = JSON.parse(comicJson || '{}');
        var jsonObject = JSON.parse(html);
        var array = jsonObject.results.list;
        for (var i = 0; i < array.length; i++) {
            list.push({ title: array[i].name, path: array[i].uuid, group: '默认' });
        }
        try {
            var groups = comic.note || {};
            var keys = Object.keys(groups);
            for (var g = 0; g < keys.length; g++) {
                var key = keys[g];
                if (key === 'default') continue;
                var group = groups[key];
                var url = format('%s/api/v3/comic/%s/group/%s/chapters?limit=500&offset=0', api, comic.cid, group.path_word);
                var resp = fetch(url, { headers: this.getHeader() });
                var arr2 = JSON.parse(resp.body).results.list;
                for (var j = 0; j < arr2.length; j++) {
                    list.push({ title: arr2[j].name, path: arr2[j].uuid, group: group.name });
                }
            }
        } catch (e) {
            // ignore
        }
        list.reverse();
        return list;
    }

    getImagesRequest(cid, path) {
        return {
            url: format('%s/api/v3/comic/%s/chapter/%s', api, cid, path),
            headers: this.getHeader()
        };
    }

    parseImages(html) {
        var list = [];
        var jsonObject = JSON.parse(html);
        var array = jsonObject.results.chapter.contents;
        for (var i = 0; i < array.length; i++) {
            var url = String(array[i].url).replace('m_read', 'kb_m_read_large');
            url = url.replace(/\.jpg\.h\d+x\.jpg$/, '.jpg.h' + IMG_QUALITY + 'x.jpg');
            list.push({ url: url, lazy: false });
        }
        return list;
    }

    getCheckRequest(cid) {
        return this.getInfoRequest(cid);
    }

    parseCheck(html) {
        try {
            return JSON.parse(html).results.comic.datetime_updated;
        } catch (e) {
            return '';
        }
    }

    parseCategory(html, page) {
        var list = [];
        try {
            var comics = JSON.parse(html).results.list;
            for (var i = 0; i < comics.length; i++) {
                list.push({
                    cid: comics[i].path_word,
                    title: comics[i].name,
                    cover: comics[i].cover
                });
            }
        } catch (e) {
            return list;
        }
        return list;
    }

    getHeader() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
            'Authorization': '',
            'Accept': 'application/json',
            'webp': '1',
            'platform': '3',
            'version': '2024.04.28',
            'X-Requested-With': 'com.manga2020.app'
        };
    }

    getCategories() {
        return {
            composite: true,
            pageSize: 21,
            format: api + '/api/v3/comics?free_type=1&limit=21&offset={offset}&theme={subject}&ordering={order}&_update=true',
            subject: [
                { title: '全部', value: '' }, { title: '愛情', value: 'aiqing' },
                { title: '歡樂向', value: 'huanlexiang' }, { title: '冒險', value: 'maoxian' },
                { title: '奇幻', value: 'qihuan' }, { title: '百合', value: 'baihe' },
                { title: '校园', value: 'xiaoyuan' }, { title: '科幻', value: 'kehuan' },
                { title: '東方', value: 'dongfang' }, { title: '耽美', value: 'danmei' },
                { title: '生活', value: 'shenghuo' }, { title: '格鬥', value: 'gedou' },
                { title: '轻小说', value: 'qingxiaoshuo' }, { title: '其他', value: 'qita' },
                { title: '悬疑', value: 'xuanyi' }, { title: 'TL', value: 'teenslove' },
                { title: '萌系', value: 'mengxi' }, { title: '神鬼', value: 'shengui' },
                { title: '职场', value: 'zhichang' }, { title: '治愈', value: 'zhiyu' },
                { title: '节操', value: 'jiecao' }, { title: '四格', value: 'sige' },
                { title: '長條', value: 'changtiao' }, { title: '舰娘', value: 'jianniang' },
                { title: '搞笑', value: 'gaoxiao' }, { title: '竞技', value: 'jingji' },
                { title: '伪娘', value: 'weiniang' }, { title: '魔幻', value: 'mohuan' },
                { title: '热血', value: 'rexue' }, { title: '性转换', value: 'xingzhuanhuan' },
                { title: '美食', value: 'meishi' }, { title: '励志', value: 'lizhi' },
                { title: '彩色', value: 'COLOR' }, { title: '後宮', value: 'hougong' },
                { title: '侦探', value: 'zhentan' }, { title: '惊悚', value: 'jingsong' },
                { title: 'AA', value: 'aa' }, { title: '音乐舞蹈', value: 'yinyuewudao' },
                { title: '异世界', value: 'yishijie' }, { title: '战争', value: 'zhanzheng' },
                { title: '历史', value: 'lishi' }, { title: '机战', value: 'jizhan' },
                { title: '都市', value: 'dushi' }, { title: '穿越', value: 'chuanyue' },
                { title: '恐怖', value: 'kongbu' }, { title: '生存', value: 'shengcun' },
                { title: '武侠', value: 'wuxia' }, { title: '宅系', value: 'zhaixi' },
                { title: '转生', value: 'zhuansheng' }, { title: '無修正', value: 'Uncensored' },
                { title: '仙侠', value: 'xianxia' }, { title: 'LoveLive', value: 'loveLive' },
                { title: 'C95', value: 'comiket95' }, { title: 'C96', value: 'comiket96' },
                { title: 'C97', value: 'comiket97' }, { title: 'C98', value: 'C98' },
                { title: 'C99', value: 'comiket99' }, { title: 'C100', value: 'comiket100' },
                { title: 'C101', value: 'comiket101' }, { title: 'C102', value: 'comiket102' },
                { title: 'C103', value: 'comiket103' }, { title: 'C104', value: 'comiket104' },
                { title: 'C105', value: 'comiket105' }, { title: '玄幻', value: 'xuanhuan' },
                { title: '異能', value: 'yineng' }, { title: '遊戲', value: 'youxi' },
                { title: '真人', value: 'zhenren' }, { title: '雜誌附贈寫真集', value: 'zazhifuzengxiezhenji' },
                { title: 'FATE', value: 'fate' }
            ],
            order: [
                { title: '更新時間（倒序）', value: '-datetime_updated' },
                { title: '熱度（倒序）', value: '-popular' },
                { title: '更新時間', value: 'datetime_updated' },
                { title: '熱度', value: 'popular' }
            ]
        };
    }
})());

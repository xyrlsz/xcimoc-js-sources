// komiic — 由 Java 源 port（GraphQL API）
// 说明：原 Java 支持 komiic.com / komiic.cc 双线路自动探测与登录 cookie；
// JS 版无本地持久化，固定使用 komiic.com，cookie 为空（未登录内容可能受限）。
var SOURCE = {
    type: 106,
    title: 'komiic',
    baseUrl: 'https://komiic.com',
    hosts: ['komiic.com', 'komiic.cc']
};

const baseUrl = 'https://komiic.com';

const Q_SEARCH = 'query searchComicAndAuthorQuery($keyword: String!) {\n  searchComicsAndAuthors(keyword: $keyword) {\n    comics {\n      id title status year imageUrl\n      authors { id name __typename }\n      categories { id name __typename }\n      dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate __typename\n    }\n    authors { id name chName enName wikiLink comicCount views __typename }\n    __typename\n  }\n}';

const Q_INFO = 'query comicById($comicId: ID!) {\n  comicById(comicId: $comicId) {\n    description id title status year imageUrl\n    authors { id name __typename }\n    categories { id name __typename }\n    dateCreated dateUpdated views favoriteCount lastBookUpdate lastChapterUpdate __typename\n  }\n}';

const Q_CHAPTERS = 'query chapterByComicId($comicId: ID!) {\n  chaptersByComicId(comicId: $comicId) {\n    id serial type dateCreated dateUpdated size __typename\n  }\n}';

const Q_IMAGES = 'query imagesByChapterId($chapterId: ID!) {\n  imagesByChapterId(chapterId: $chapterId) {\n    id kid height width __typename\n  }\n}';

function jsonBody(operationName, variables, query) {
    return { json: { operationName: operationName, variables: variables, query: query } };
}

function formatKomiicTime(t) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return t;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function getSearchRequest(keyword, page) {
    if (page !== 1) return null;
    return {
        url: baseUrl + '/api/query',
        method: 'POST',
        body: jsonBody('searchComicAndAuthorQuery', { keyword: keyword }, Q_SEARCH)
    };
}

function parseSearch(html, page) {
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

function getUrl(cid) {
    return baseUrl + '/comic/' + cid;
}

function getInfoRequest(cid) {
    return {
        url: baseUrl + '/api/query',
        method: 'POST',
        body: jsonBody('comicById', { comicId: cid }, Q_INFO)
    };
}

function parseInfo(html, cid) {
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

function getChapterRequest(html, cid) {
    return {
        url: baseUrl + '/api/query',
        method: 'POST',
        body: jsonBody('chapterByComicId', { comicId: cid }, Q_CHAPTERS)
    };
}

function parseChapter(html, comicJson) {
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

function getImagesRequest(cid, path) {
    return {
        url: baseUrl + '/api/query',
        method: 'POST',
        body: jsonBody('imagesByChapterId', { chapterId: path }, Q_IMAGES)
    };
}

function parseImages(html, chapterJson) {
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
                    cookie: '' // 原 Java 有登录 cookie；JS 版为空
                }
            });
        }
    } catch (e) { /* ignore */ }
    return list;
}

function getCheckRequest(cid) {
    return getInfoRequest(cid);
}

function getHeader() {
    return { referer: baseUrl + '/' };
}

function getCategories() {
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

function getCategoryRequest(format, page) {
    var opts = JSON.parse(format || '{}');
    var sub = opts.subject ? '"' + opts.subject + '"' : '';
    var variables = {
        categoryId: [opts.subject || ''],
        pagination: {
            limit: 30,
            offset: (page - 1) * 30,
            orderBy: opts.order || '',
            asc: false,
            status: opts.progress || ''
        }
    };
    var query = 'query comicByCategories($categoryId: [ID!]!, $pagination: Pagination!) {\n  comicByCategories(categoryId: $categoryId, pagination: $pagination) {\n    id title status year imageUrl\n    authors { id name __typename }\n    categories { id name __typename }\n    dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate __typename\n  }\n}';
    return {
        url: baseUrl + '/api/query',
        method: 'POST',
        body: jsonBody('comicByCategories', variables, query)
    };
}

function parseCategory(html, page) {
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

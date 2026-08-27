// 调试器自测用 fixture：验证 DOM（cheerio 复刻 jsoup）路径。不在 index.json 中，不会出现在 WebUI 源列表。
var SOURCE = installSource(new (class extends MangaSource {
    constructor() {
        super({ type: 9000, title: 'DOM测试(fixture)', baseUrl: 'http://x' });
    }
    parseSearch(html, page) {
        var body = DOM(html);
        var list = [];
        var nodes = body.select('ul.list > li.item');
        for (var i = 0; i < nodes.length; i++) {
            list.push({
                title: nodes[i].text('a.title'),
                href: nodes[i].href('a'),
                src: nodes[i].src('img'),
                all: nodes[i].text()
            });
        }
        return list;
    }
})());

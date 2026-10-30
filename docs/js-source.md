# XCimoc JS 漫画源规范

本仓库的每个 `.js` 源脚本在 App 的 QuickJS 引擎中执行。脚本顶层必须：

- 用 `var SOURCE = installSource(new (class extends MangaSource { ... })())` 声明源实例
  （**必须 `var`**，全局 `const`/`let` 是词法绑定，宿主读不到 `SOURCE`）。
- 覆写本源用到的方法即可；未覆写的方法使用 `MangaSource` 基类的默认空实现。
- 顶层用 `var` 声明源级常量（如 `baseUrl`、`website`）。

源接口清单与默认实现见 `source_sdk.js` 的 `MangaSource` 基类与 `__SOURCE_METHODS`。

---

## 元数据（SOURCE 字段）

`installSource` 会把实例挂到全局 `SOURCE`，宿主据此读取：

| 字段            | 说明                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `type`          | 源类型，唯一且 `>0`（`type=0` 也合法，用于 manhuagui；校验用 `type < 0` 判断非法）。 |
| `title`         | 源显示名。                                                                           |
| `baseUrl`       | 基础地址。                                                                           |
| `webConfig`     | 可选；配置 WebView/Cloudflare 渲染（见 `webConfig` 说明）。                          |
| `defaultEnable` | 可选；`false` 表示该源默认关闭（缺省 `true`）。                                      |

---

## WebView 配置（webConfig）

对需要执行网页 JavaScript 才能得到完整内容的源，可以在 `SOURCE` 构造参数中配置 `webConfig`。
搜索、详情、章节、图片和惰性图片阶段可分别配置：

```js
webConfig: {
    info: {
        useWebParser: true,
        autoScroll: false,
        injectJs: "javascript:(function() { /* 可选的页面操作 */ })()",
        waitForSelector: '.chapter-list a',
        waitForSelectorTimeoutMs: 15000
    }
}
```

支持的阶段键为 `search`、`info`、`chapter`、`images`、`imagesLazy`。各阶段可用字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `useWebParser` | boolean | `false` | 使用 WebView 加载、执行页面脚本后再解析。 |
| `autoScroll` | boolean | `true` | 是否自动滚动页面以触发懒加载。 |
| `injectJs` | string | 无 | 页面 DOM 就绪后执行的 JavaScript；可用于点击展开等操作。 |
| `waitForSelector` | string | 无 | 抓取 HTML 前等待此 CSS 选择器匹配到至少一个元素。 |
| `waitForSelectorTimeoutMs` | number | `15000` | 等待选择器的最长时间（毫秒）；超时会使本次 WebView 解析失败。 |
| `handleCloudflare` | boolean | `true` | 是否处理 Cloudflare 挑战。 |
| `cloudflareTimeoutMs` | number | `30000` | 等待 Cloudflare JS 挑战通过的最长时间（毫秒）。 |
| `interactiveChallenge` | boolean | `false` | 是否允许将交互式 Cloudflare 验证显示给用户处理。 |

Cloudflare 认证：App 会复用 WebView 完成验证后写入的 Cookie（如 `cf_clearance`），同一站点只需验证一次，
后续的页面解析、`fetch()` 请求与图片下载都会自动带上该 Cookie 并落盘保存。命中挑战页时先自动等待几秒
（多数 JS 挑战会自动通过），仍未通过才在 `interactiveChallenge` 为 `true` 时弹出验证界面；同一站点同一时刻
只会弹出一个验证界面（其余请求等待并复用验证结果），交互式验证至少等待 3 分钟，避免用户操作未完成就被判超时。

`waitForSelector` 在页面加载及 `injectJs` 执行后开始轮询，间隔约 250 毫秒。匹配到元素后立即抓取当前 DOM；
未配置时保持原有抓取流程。超时或选择器语法无效会报错，不会将未完成的页面当成成功结果。
建议选择**异步内容实际出现时才存在**的元素，而不是总会存在的空容器或“加载中”占位元素。例如章节列表可等待章节链接：

```js
waitForSelector: '.table-default-box .tab-content .tab-pane ul > a[title]'
```

该配置由 App 宿主实现；旧版 App 不认识 `waitForSelector`，会忽略它并按旧逻辑抓取页面。使用该选项需要安装支持此配置的 App 版本。

---

## 分类（getCategories）

`getCategories()` 返回分类定义，宿主据此渲染分类下拉并构造请求 format：

```js
getCategories() {
    return {
        composite: true,
        pageSize: 50,                                   // 可选，默认 20
        format: 'https://…/list-{subject}-{area}-{progress}-{order}-p{page}',
        allValue: 'all',                                // 可选，「全部」哨兵
        subject:  [ { title: '全部', value: 'all' }, { title: '恋爱', value: 'lianai' }, … ],
        area:     [ … ], reader: [ … ], year: [ … ],
        progress: [ … ], order: [ … ]
    };
}
```

### 字段说明

- **`composite`**：`true` 用 `format` 模板渲染最终 URL（宿主替换占位符后直接 GET，或交给 `getCategoryRequest`）；`false` 由宿主生成 JSON 参数传给 `getCategoryRequest`（适合 POST/GraphQL 源）。
- **`format`**：含占位符的模板。分类占位符 `{subject}/{area}/{reader}/{year}/{progress}/{order}` 由宿主用所选值替换；分页占位符 `{page}/{offset}/{limit}` 由宿主按页填充（`{offset}=(page-1)*pageSize`，`{limit}=pageSize`）。
- **各维度数组**：元素为 `{ title, value }`（也兼容 `{name,id}` 与 `[title,value]` 数组）。`title` 是下拉显示名，`value` 是填入 format/请求的实际值。
- **`allValue`（「全部」哨兵，可选）**：值为空串时，宿主把它替换为 `allValue`，避免后端不接受空值。可以是：
  - 单个字符串：作用于所有维度；
  - 对象 `{ subject: 'all', area: 'all', … }`：按维度分别指定。
  - 不声明则保持空串（后端接受“空=全部”的源无需声明）。

### 「全部」选项的兼容性约定

不同后端的“全部”表示不同，务必按后端要求处理：

1. **后端接受空串 = 全部**：直接把「全部」项的 `value` 设为 `''`，无需 `allValue`。
   例：`dm5`（URL 用空格分隔段）、`copymh`（空 query 参数 `?theme=`）。
2. **后端需要真实占位值**：把「全部」项的 `value` 直接设成后端接受的哨兵值。
   例：`baozi` 用 `'all'` / `'*'`，`zaimanhua` 用 `'0'`。也可声明 `allValue` 由宿主统一替换。
3. **后端不接受空值、且无法用固定哨兵表达**：在 `getCategoryRequest` 里显式特判空值，换走另一条请求。

典型示例（komiic：主题为「全部」时空 ID 会导致 GraphQL 报错，改用 hotComics）：

```js
getCategoryRequest(format, page) {
    var opts = JSON.parse(format || '{}');
    var subject = opts.subject || '';
    var isAll = subject === '';                    // 特判「全部」
    var operation = isAll ? 'hotComics' : 'comicByCategories';
    // …构造对应 query/variables 并返回 { url, method, contentType, headers, body }
}
```

> 提示：宿主 `getFormat` 已支持 `allValue`，若后端能用**固定哨兵值**表达“全部”，
> 优先用 `allValue`（第 2 种），比在每个维度里重复 `subject===''` 特判更简洁；
> 只有需要**改变请求形态**（换接口/换查询）时才用第 3 种显式特判。

---

## 请求与解析

- `getXxxRequest(...)` 返回描述对象：
  ```js
  { url, method, headers, body, contentType }
  ```
  `method` 缺省 `GET`；`POST` 时提供 `body` 与 `contentType`（默认
  `application/x-www-form-urlencoded`）。
- `parseXxx(html, ...)` 返回对象/数组，宿主转成 Java 模型。字段多用 `cid/title/cover/update/author`。
- 计算类工具（md5/base64/lz64/aes/urlencode 等）由 SDK 提供纯 JS 实现，可直接调用。

---

## 返回结构 Schema 与校验

SDK 的 `installSource()` 会对每个**被覆写的方法**套一层返回结构校验（见
`source_sdk.js` 的 `__SOURCE_SCHEMA`）。目标：源返回的结构必须符合宿主
（`JsMangaParser`）反解契约，否则会在 Java 侧静默产出空/错字段、极难排查。

校验策略：
- **非法处打 `log` 警告**（`[schema:方法名] …`，含字段名），不影响宿主；
- **可安全纠正的类型就地纠正**：如 `cid/title/path` 等数字→字符串、`success`/`loggedIn` 字符串→布尔；
- **无法纠正的返回安全默认值**（`null` / `[]`），保证宿主不崩、不产出脏数据；
- **额外字段一律容忍**（宿主忽略），不削弱源能力。

> 注意：`cid`/`title`/`path` 允许数字等可字符串化类型（如 komiic 返回数字 id），
> 会就地转字符串；仅 `null`/`undefined`/空串 判为无效丢弃。

### 各方法返回结构

| 方法                                                                                                                                           | 返回                               | 关键校验                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `getSearchRequest` / `getInfoRequest` / `getChapterRequest` / `getImagesRequest` / `getLazyRequest` / `getCheckRequest` / `getCategoryRequest` | 请求对象或 `null`                  | `url` 必填非空字符串；`method`/`body`/`contentType` 转字符串；`headers` 须对象；无效→`null`（宿主回退）                    |
| `parseSearch` / `parseCategory`                                                                                                                | 数组                               | 每项 `{ cid(必填), title(必填), cover?, update?, author? }`；缺 `cid`/`title` 丢弃该项，其余字段转字符串                   |
| `parseInfo`                                                                                                                                    | 对象或 `null`                      | `title/cover/author/intro/status/update` 转字符串；`tags` 须**字符串数组**（非数组忽略该字段、非字符串项跳过）；`chapters` 须数组，逐项按章节校验        |
| `parseChapter`                                                                                                                                 | 数组                               | 每项 `{ title(必填), path(必填) }`；缺 `title`/`path` 丢弃该项                                                             |
| `parseImages`                                                                                                                                  | 数组                               | 每项 `{ urls(必填非空数组), headers? }`；`urls` 逐项转字符串；空/缺 `urls` 丢弃该项                                        |
| `parseLazy` / `parseCheck` / `getUrl` / `getRegisterUrl`                                                                                       | 字符串或 `null`                    | 非字符串→`null`                                                                                                            |
| `getHeader`                                                                                                                                    | 对象或 `null`                      | 非对象→`null`                                                                                                              |
| `login` / `onSettingsAction`                                                                                                                   | `{ success?, message? }` 或 `null` | `success` 转布尔；`message` 转字符串                                                                                       |
| `getLoginState`                                                                                                                                | `{ loggedIn? }` 或 `null`          | `loggedIn` 转布尔                                                                                                          |
| `getSettings`                                                                                                                                  | 数组                               | 每项 `{ key(必填), label?, type?, default?, options? }`；缺 `key` 丢弃该项；`options` 逐项校验                             |
| `getCategories`                                                                                                                                | 分类对象或 `null`                  | `composite` 转布尔、`pageSize` 须数字、`format` 转字符串；各维度数组项 `{title,value}`（兼容 `[title,value]`），非法项跳过 |

> 请求描述对象里的 `body` 约定：POST 一律传**表单编码字符串**（不要传对象），
> 除非目标接口明确要 JSON body 才配 `contentType: 'application/json'`。

校验层不改变正常源的输出；`node scripts/check_schema.mjs` 对校验逻辑做自测。

---

## 标签解析（tags）

详情页头部展示一排可点击的漫画标签（题材），点击后跳转分类页并按该标签检索。要让某个源接入这条链路，**只需在 `parseInfo` 返回对象里加一个 `tags` 字符串数组**，宿主与 SDK 均已支持，无需新增方法、无需改宿主代码。

### 端到端链路（了解即可，便于排查）

1. JS 源 `parseInfo` 返回 `{ …, tags: ['热血', '恋爱'] }`；
2. SDK 校验器（`__chkInfo`）保证 `tags` 是字符串数组，随详情 JSON 传给宿主；
3. App 详情页头部把标签渲染为可点击 chip（横向滚动，最多 20 个）；
4. 点击标签 → 以 `source + tag` 打开分类页；
5. 分类页在 **`getCategories()` 的 `subject`（主题）维度**中查找与标签同名的选项，命中则自动选中并立即检索；不命中则提示「当前图源不支持该标签分类」且不自动检索。

> 因此标签文案不是任意自由文本：**它必须等于该源 `getCategories()` 里某个 `subject` 项的 `title`**（比较前双方都做简繁转换，简/繁均可，但不能有标点或空格差异）。

### 返回约定

- 类型：`string[]`，每一项是**非空字符串**。
- 不返回、返回 `null`、空数组 `[]` 都视为「无标签」，详情页不显示标签区，均合法。
- SDK 校验行为（`source_sdk.js` 的 `__chkInfo`）：
  - `tags` 不是数组（如逗号拼接的字符串 `'热血,恋爱'`、对象）→ 打 `[schema:parseInfo] tags 应为数组，已忽略` 日志并**删除该字段**；
  - 数组中的 `null`/非字符串项 → 打日志并跳过该项；
- 宿主（Java）会再做一次清洗：逐项 `trim()`、丢弃空串与字面量 `"null"`、去重、截断到 20 个。源侧无需自己做这些，但建议返回干净数据。
- 不要把标签塞进 `chapters` 或自定义其他字段，宿主只认 `tags`。

### 写法一：从 HTML 逐个取标签（DOM 型站点）

用 `select` 选中**所有标签节点**（通常是标签链接/角标），逐个取文本；不要取整个容器的 text（多标签会连成一段）：

```js
parseInfo(html, cid) {
    var body = DOM(html);

    // 标签一般是一组 <a> / <span>，按站点真实结构调整选择器；
    // 优先选带链接的标签节点（站点自身点击标签通常也走列表筛选）
    var tagNodes = body.select('.comics-detail__tags a');
    var tags = [];
    for (var i = 0; i < tagNodes.length; i++) {
        var t = (tagNodes[i].text() || '').trim();
        if (t) tags.push(t);
    }

    return {
        title: body.text('.comics-detail__title'),
        cover: body.src('div > amp-img'),
        author: body.text('.comics-detail__author'),
        intro: body.text('.comics-detail__desc'),
        update: body.text('div > span > em'),
        finish: isFinishText(body.text('.tag-list')),
        tags: tags                       // 空数组也可直接传，宿主按无标签处理
    };
}
```

> 注意：若站点原本用一个 `.tag-list` 容器的整段文本做「完结」判断（如包子源），
> 新增 `tags` 时**保留原有选择器与判断逻辑**，另选标签链接/角标节点单独取数组，
> 不要让 `finish` 与 `tags` 复用同一段文本。

### 写法二：页面内嵌 JSON / GraphQL（JSON 型站点）

直接把后端返回的标签字段映射进来，确认它是字符串数组即可；后端若给字符串需先 `split`：

```js
var o = JSON.parse(jsonText).data.comic;
var tags = isArray(o.tags) ? o.tags
    : (o.tags ? String(o.tags).split(/[,，、\s]+/) : []);   // 兜底：逗号/顿号/空白分隔
return {
    title: o.name,
    cover: o.cover,
    tags: tags,
    // …
};
```

### 与分类主题（subject）对齐

标签点击后只匹配 `subject` 维度，接入前对照本文件「分类」一节中 `getCategories()` 的 `subject` 列表：

- 标签文案**直接复用** subject 项的 `title`（如 `恋爱`、`热血`、`搞笑`）最稳妥；
- 站点标签是内部 slug/英文（如 `romance`）时，在 `parseInfo` 里映射成 subject 显示名，不要直接返回 slug；
- 站点存在分类体系里没有的自由标签（如 `连载中`、`高人气`、某作者名）时，**不要**放进 `tags`——它们点过去必然提示「不支持」；
- 站点没有 `subject` 维度（`getCategories()` 未声明主题）时，可不返回 `tags`，返回了也只会提示不支持。

### 本地验证

```bash
node scripts/check_schema.mjs   # schema 自测：tags 非数组/含非字符串项时的纠正与回退
node scripts/smoke.mjs          # 加载校验（SOURCE 元数据/必需函数）
```

带 UI 的联调用调试服务：`node debug/server.mjs`（见 `debug/README.md`），在详情步骤查看 `parseInfo` 的原始返回。日志中若出现 `[schema:parseInfo] tags 应为数组，已忽略`，说明把 `tags` 写成了非数组；出现 `tags 项应为字符串，已跳过` 说明数组里混入了非字符串元素。

## 状态 / 设置 / 登录

跨调用状态、设置、登录均走宿主能力，按源 `type` 隔离：

- `setState(key,val)` / `getState(key)`：跨调用保存数据（无跨调用状态的引擎每次新建）。
- `setSetting(key,val)` / `getSetting(key)`：源设置（配合 `getSettings()`）。
- `setLogin(json)` / `getLogin()` / `clearLogin()`、`login(params)`、`getLoginState()`：登录态。
- `getRegisterUrl()`：可选，返回注册页 URL 字符串；宿主的登录对话框据此显示「注册」按钮并打开该链接。
- `fetch(url, options)`：同步 HTTP，返回 `{ status, headers, setCookie, body }`（读响应头/体用）。

---

## 本地校验

```bash
node scripts/validate.mjs   # 校验 index.json 与所有脚本的 SOURCE 元数据/必需函数
node scripts/smoke.mjs      # 加载校验
```

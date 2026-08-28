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

| 字段 | 说明 |
| --- | --- |
| `type` | 源类型，唯一且 `>0`（`type=0` 也合法，用于 manhuagui；校验用 `type < 0` 判断非法）。 |
| `title` | 源显示名。 |
| `baseUrl` | 基础地址。 |
| `webConfig` | 可选；配置 WebView/Cloudflare 渲染（见 `webConfig` 说明）。 |
| `defaultEnable` | 可选；`false` 表示该源默认关闭（缺省 `true`）。 |

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

## 状态 / 设置 / 登录

跨调用状态、设置、登录均走宿主能力，按源 `type` 隔离：

- `setState(key,val)` / `getState(key)`：跨调用保存数据（无跨调用状态的引擎每次新建）。
- `setSetting(key,val)` / `getSetting(key)`：源设置（配合 `getSettings()`）。
- `setLogin(json)` / `getLogin()` / `clearLogin()`、`login(params)`、`getLoginState()`：登录态。
- `fetch(url, options)`：同步 HTTP，返回 `{ status, headers, setCookie, body }`（读响应头/体用）。

---

## 本地校验

```bash
node scripts/validate.mjs   # 校验 index.json 与所有脚本的 SOURCE 元数据/必需函数
node scripts/smoke.mjs      # 加载校验
```

# XCimoc 漫画源 JS 调试器（本地 WebUI）

在 **纯 Node 环境**中调试 `xcimoc-js-sources` 的动态漫画源脚本：加载 `source_sdk.js` + 某个源，用
`cheerio`（DOM）、子进程同步 `fetch`、进程内 Map 复刻 App 的 `JsHost`（`dom` / `fetch` / `state` /
`setting` / `login` / `log`），从而**不装 APK、不连 App** 就能调用源的 `getXxxRequest` / `parseXxx`
并查看请求、响应与解析结果。

> 计算类宿主函数（md5 / base64 / LZ64 / AES-CBC / urlencode）已在 `source_sdk.js` 内纯 JS 化，
> 无需宿主；本调试器只需复刻剩下的 DOM / fetch / state / setting / login / log。

## 环境要求

- Node.js **>= 18**（依赖原生 `fetch`）
- 联网（真实请求漫画源服务器）

## 启动

```bash
cd debug
npm install        # 安装 cheerio
npm start          # 或 node server.mjs
```

浏览器打开 **http://127.0.0.1:8977**（可用环境变量 `PORT` / `HOST` 覆盖）

## 功能

- **源选择**：从 `index.json` 列出全部源；「源码」按钮可查看当前源脚本。
- **引导流程**（模拟 App 的 `getXxxRequest → fetch → parseXxx`）：
  - 搜索：`getSearchRequest` → fetch → `parseSearch`
  - 详情：`getInfoRequest` → fetch → `parseInfo`
  - 章节：`getChapterRequest` → fetch → `parseChapter`
  - 图片：`getImagesRequest` → fetch → `parseImages`
  - 分类：`getCategories` → `getCategoryRequest` → fetch → `parseCategory`
  - 登录：`login` → `getLoginState`
  - **直接调用**：任选一个方法 + 传入 JSON 参数数组，单步执行
- 每个步骤展示：方法名、OK/失败、结果（JSON）、fetch 响应体（可展开）、脚本内 `log()`/`console` 日志、异常堆栈。
- `state` / `setting` / `login` 在服务器进程内按源 `type` 持久化（跨步骤、跨请求有效），可调试登录态。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sources` | 源清单 |
| GET | `/api/script?file=sources/x.js` | 源脚本原文 |
| POST | `/api/run` | `{sourceFile, method, args:[...]}` 单步调用 |
| POST | `/api/flow` | `{sourceFile, flow, params}` 引导流程 |

## 说明 / 限制

- DOM 用 **cheerio** 复刻 jsoup，支持绝大多数源使用的 CSS（含 `:contains` / `:eq` / `:first` 等
  jQuery 扩展）；个别 jsoup 专属选择器可能与 App 行为略有差异。
- fetch 每次通过子进程执行（同步），比 App 慢一点，属正常。
- `__SOURCE_TYPE` 按源 `type` 注入，`setting`/`login` 按源隔离。
- 登录类流程（komiic / 再漫画等）需要先在「登录」流程填写真实账号密码；cookie/token 会保存在
  本进程内。

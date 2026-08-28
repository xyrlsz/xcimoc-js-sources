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
- **WebView 渲染（可选）**：需安装 Playwright 的 Chromium（`npx playwright install chromium`）。
  仅当调试声明了 `webConfig.useWebParser` 的源才需要。

## 启动

```bash
cd debug
npm install                          # 安装 cheerio + playwright
npx playwright install chromium      # 首次需下载 Chromium（仅 WebView 渲染需要）
npm start                            # 或 node server.mjs
```

浏览器打开 **http://127.0.0.1:8977**（可用环境变量 `PORT` / `HOST` 覆盖）

WebView 渲染相关环境变量（可放 `npm start` 前）：
- `WEBVIEW_PORT`：Playwright 渲染服务端口（默认 8976，通常无需改）
- `WEBVIEW_HEADFUL=1`：用**有头**浏览器（可人工完成交互式 Cloudflare 验证，
  对应 App 的 `interactiveChallenge=true` 把 WebView 挂到前台）

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
- **WebView 解析 + Cloudflare 认证（Playwright）**：当某解析环节（搜索/详情/章节/图片）
  配置了 `webConfig.useWebParser=true`（如 ykmh 全站 Cloudflare）时，该环节不再走普通
  fetch，而是用 Playwright Chromium 渲染页面后把**渲染后的 HTML** 交给 parseXxx，并在
  检测到 Cloudflare 挑战页时自动轮询等待其通过（对应 App 的 `handleCloudflare`，默认开启，
  超时 `cloudflareTimeoutMs` 默认 60s）；`interactiveChallenge=true` 且用 `WEBVIEW_HEADFUL=1`
  启动时可人工完成验证。渲染步骤会单独展示为「webview」卡片，附最终地址、耗时与 CF 挑战结果。

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
- WebView 渲染通过**常驻的 Playwright 服务**（`webview-server.mjs`，由 `server.mjs` 懒启动）
  完成；首次触发渲染时会稍慢（浏览器冷启动）。渲染服务仅在用到 `useWebParser` 的源时才会被拉起。
- 纯 JS 的 Cloudflare 挑战在 headless 下通常可自动通过；若站点需要**交互式验证**（滑块/点击等），
  请用 `WEBVIEW_HEADFUL=1 npm start` 启动，此时浏览器窗口会显示挑战页供人工完成。
- `__SOURCE_TYPE` 按源 `type` 注入，`setting`/`login` 按源隔离。
- 登录类流程（komiic / 再漫画等）需要先在「登录」流程填写真实账号密码；cookie/token 会保存在
  本进程内。

# XCimoc 漫画源可用性测试程序

在 **纯 Node 环境**中按 App（`JsMangaParser`）的真实调用链测试 `xcimoc-js-sources` 的每一个源：

```
搜索  getSearchRequest → 宿主 fetch → parseSearch
详情  getInfoRequest   → 宿主 fetch → parseInfo
章节  详情页缓存章节优先；否则 getChapterRequest → fetch → parseChapter
图片  getImagesRequest → 宿主 fetch → parseImages
```

测试结果写入 `docs/status.json`，由 GitHub Pages（`docs/index.html`）渲染成
**漫画源状态页**。测试程序也可以被开发者本地用来排查单个源。

## 原理

源脚本在 App 的 QuickJS 引擎中执行，依赖宿主提供的 `hostCall` / `fetch` 能力。
本程序用 `node:vm` 创建沙箱加载 `source_sdk.js` + 源脚本，并复刻 App 的 JsHost：

| 能力                          | 复刻方式                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `dom`（jsoup）                | [cheerio](https://cheerio.js.org/)（select/text/attr/href/src 对齐 debug 调试器） |
| `fetch`（OkHttp）             | 子进程同步 HTTP（`lib/fetch-worker.mjs`，原生 http/https，压缩/编码/重定向）      |
| `state` / `setting` / `login` | 进程内 Map，按源 `type` 隔离                                                      |
| `log`                         | 收集后随结果输出（页面/终端可查看 schema 告警与错误日志）                         |

每个阶段使用独立引擎（详情 + 章节共享一个，对齐 App 的详情会话复用）；
请求头按「源请求声明优先、`getHeader()` 兜底」合并；`getImagesRequest` 之后
同引擎再取一次 `getHeader()`（对齐 App 捕获 referer 的行为）。

### 状态判定

| 状态       | 含义                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| ✅ 可用     | 搜索 → 详情 → 章节 → 图片 每一步都通过                                    |
| ⚠️ 部分可用 | 链路可走通但有告警：搜索无结果、未解析到标题、部分步骤需 WebView 被跳过等 |
| ❌ 失败     | 任一步骤失败（脚本加载、HTTP 请求、解析异常）                             |
| ⏭️ 跳过     | 源声明了 `webConfig.useWebParser`（Cloudflare 等），自动化环境无法验证    |

> 搜索关键词默认「漫画」，可用 `--keyword` 覆盖；搜索「无结果」只算告警，
> 因为具体站点对关键词的匹配策略不同，不代表源失效。

## 环境要求

- Node.js **>= 18**（用到原生 `fetch` / `TextDecoder`，程序内 HTTP 用原生 `http/https`）
- 联网（真实请求漫画源服务器）

## 使用

```bash
cd status
npm install                 # 仅依赖 cheerio

# 测试全部源，写入 ../docs/status.json
node test_sources.mjs

# 只测试部分源（type 号或文件名），并查看每步明细
node test_sources.mjs --only baozi,copymh,101 --verbose

# 只打印 JSON，不写文件
node test_sources.mjs --json
```

### 选项

| 选项                | 说明                                             |
| ------------------- | ------------------------------------------------ |
| `--only <list>`     | 只测指定源：type 或文件名，逗号分隔              |
| `--exclude <list>`  | 排除指定源（格式同上）                           |
| `--keyword <kw>`    | 搜索测试关键词（默认「漫画」）                   |
| `--concurrency <n>` | 并发测试的源数量（默认 4）                       |
| `--timeout <ms>`    | 单个 HTTP 请求超时（默认 30000）                 |
| `--out <file>`      | 状态 JSON 输出路径（默认 `../docs/status.json`） |
| `--no-write`        | 只测试不写入文件（本地试跑）                     |
| `--json`            | 打印完整 JSON 到 stdout（不写文件）              |
| `--verbose`         | 打印每个源的步骤明细与日志                       |

### 输出

终端报告示例：

```
✅ 包子漫画 (type 101) 8.3s — 全部步骤通过
⚠️ 某源 (type 999) 12.1s — search: 搜索「漫画」无结果（接口可达，可能关键词不匹配）
❌ 某源 (type 998) 3.2s — images: 请求失败: 请求超时(30000ms)

结果: ✅ 20 可用 / ⚠️ 3 部分可用 / ❌ 2 失败 / ⏭️ 2 跳过（共 27，用时 96.4s）
状态数据已写入: ../docs/status.json
```

`docs/status.json` 结构（页面据此渲染）：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-11T12:00:00.000Z",
  "keyword": "漫画",
  "runner": "local",
  "node": "v20.11.0",
  "durationMs": 96400,
  "summary": { "total": 27, "ok": 20, "warn": 3, "fail": 2, "skip": 2 },
  "sources": [
    {
      "type": 101, "title": "包子漫画", "version": "1.0.1", "url": "sources/baozi.js",
      "status": "ok", "error": null, "durationMs": 8300,
      "steps": [
        { "name": "search", "status": "ok", "ms": 1200, "http": 200, "detail": "命中 20 条…", "error": null }
      ],
      "logs": []
    }
  ]
}
```

## GitHub Pages 状态页

状态页发布在独立的 **`gh-pages` 分支**（main 分支不会产生任何自动提交）：

1. 在 Actions 中手动触发一次「漫画源状态」workflow——它会运行测试，并把
   `docs/index.html`（页面）+ `status.json`（数据）发布到 `gh-pages` 分支；
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择
   **Deploy from a branch**，分支选 **`gh-pages`**、目录选 **`/` (root)**；
3. 访问 `https://<用户名>.github.io/xcimoc-js-sources/`。

页面读取同目录的 `status.json`，展示汇总统计、每源状态与各步骤明细，
支持搜索与状态过滤。本地预览：

```bash
node test_sources.mjs                       # 生成 docs/status.json（本地预览用，不入库）
python -m http.server 8899 --directory docs
# 浏览器打开 http://127.0.0.1:8899/  （file:// 直接打开无法 fetch JSON）
```

> 不想起 HTTP 服务时，也可以复制 `docs/index.html`，在主脚本前插入
> `<script>window.__STATUS_DATA__ = {…status.json 内容…};</script>`，
> 直接用浏览器打开该文件离线预览。

## 自动更新（GitHub Actions）

`.github/workflows/source-status.yml` 在以下时机运行测试，并**把结果发布到 `gh-pages` 分支**：

- 每天 21:17 UTC（北京时间 05:17）定时执行；
- 手动触发（Actions → 漫画源状态 → Run workflow）；
- `sources/`、`index.json`、`source_sdk.js`、`status/`、`docs/index.html` 变更推送到 `main` 时。

workflow 使用 `GITHUB_TOKEN` 强制推送 `gh-pages`（该分支只保留最新一份生成物，
无历史负担），推送后 GitHub Pages 会自动重新发布；main 分支内容不变。
若对 `gh-pages` 设置了分支保护规则，请放开或改为其他发布分支。

## 已知限制

- **网络环境敏感**：部分源对机房 IP / 海外 IP 有风控（403、Cloudflare 挑战等），
  CI 结果与国内真实网络可能有差异；
- **WebView 源**：声明 `webConfig.useWebParser` 的源（如 ykmh）在自动化环境跳过，
  请用 `debug/` 调试器（含 Playwright 渲染）验证；
- **登录态**：部分功能（如 komiic 图片）需要登录，未登录会表现为对应步骤失败或告警；
- 测试只读、不写数据；`state`/`setting`/`login` 仅存在于测试进程内（进程退出即清除）。

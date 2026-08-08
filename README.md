# XCimoc 动态漫画源仓库

XCimoc 的动态 JS 漫画源仓库。每个漫画源是一个独立的 `.js` 脚本（在 App 的
QuickJS 引擎中执行），通过 GitHub raw API 在线分发，**无需重新安装 APK** 即可
新增/更新漫画源。

## 目录结构

```
xcimoc-js-sources/
├── index.json          # 源清单（客户端据此增量下载）
├── sources/
│   ├── manhuagui.js    # 每个文件对应一个源
│   ├── dm5.js
│   └── ...             # 共 27 个源
└── README.md
```

## 在 App 中使用（GitHub raw API）

1. 把本仓库推送到 GitHub（默认分支为 `main`），例如 `https://github.com/<你的用户名>/xcimoc-js-sources`
2. 在 App「源管理」页右上角菜单中：
   - **源仓库地址**：填入 GitHub raw 根地址
     ```
     https://raw.githubusercontent.com/<你的用户名>/xcimoc-js-sources/main
     ```
   - **更新源**：客户端会请求 `…/main/index.json` 与各源脚本，校验后入库
3. 安装后源列表中会出现这些 JS 源；与内置源同 `type` 的 JS 源启用后**覆盖**内置实现

> 私有仓库无法通过 raw API 匿名访问；请使用公开仓库。

## 更新某个源

1. 修改 `sources/<源>.js`
2. 修改 `index.json` 中对应条目的 `version`（例如 `1.0.1`）
3. 提交并推送；客户端再次「更新源」即会增量拉取

## 新增一个源

1. 复制 `sources/manhuagui.js` 为模板，实现所需函数（脚本规范见主仓库
   `docs/js-source.md`）
2. 在 `index.json` 的 `sources` 数组追加一条：
   ```json
   { "type": 120, "title": "新源", "version": "1.0.0", "url": "sources/新源.js", "baseUrl": "https://example.com" }
   ```
3. 提交并推送

> `type` 必须唯一且 >0（避免与内置源冲突）。已启用源里 type 为
> 0/5/11/12/26/27/49/51/52/82/91/101/102/103/104/106/107/108/110/111/113/114/115/116/117/118/119。

## 本地校验脚本

```bash
node scripts/validate.mjs   # 校验 index.json 与所有脚本的 SOURCE 元数据/必需函数
```

## 注意事项（部分源的限制）

- **vomic漫 / 再漫画 / komiic**：原 Java 源需要登录 cookie/token（存于 App 本地
  SharedPreferences）；JS 版无登录入口，图片可能受限。
- **拷贝漫画 / 拷贝漫画Web / 热辣漫画 / 漫画鱼 / 读漫屋app / G社漫畫**：已内置
  AES-CBC / MD5 / 自定义解密，App 端 `JsHost` 需为较新版本（含 `aes_cbc` 等宿主能力）。
- **优酷漫画 / MYCOMIC / 拷贝漫画Web / 布卡漫画 / 漫画屋 / 漫蛙 / 漫本 / 古风漫画 /
  读漫屋 / 读漫屋app**：部分环节需 WebView 渲染（`webConfig.useWebParser`），由 App 自动处理。

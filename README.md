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

1. 在 App「源管理」页右上角菜单中：
   - **源仓库地址**：填入 GitHub raw 根地址
     ```
     https://raw.githubusercontent.com/xyrlsz/xcimoc-js-sources/main
     ```
   - **更新源**：客户端会请求 `…/main/index.json` 与各源脚本，校验后入库
2. 安装后源列表中会出现这些 JS 源；与内置源同 `type` 的 JS 源启用后**覆盖**内置实现

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

> `type` 必须唯一且 >0，并且要避免与其他源冲突。 

## 本地校验脚本

```bash
node scripts/validate.mjs   # 校验 index.json 与所有脚本的 SOURCE 元数据/必需函数
```
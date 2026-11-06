# IdeaClip

浏览器灵感收藏 + AI 商业模式分析 + 项目孵化。

仓库：https://github.com/shimmer000000/IdeaClip

## 当前范围

项目初始化版本，使用 React、TypeScript、Vite 和 Manifest V3。

- 提供插件弹窗、灵感管理页和设置页。
- 已实现手动笔记、读取当前网页标题与链接、编辑、删除、搜索、标签与状态筛选。
- 使用 Dexie + IndexedDB 在本地存储数据。
- AI 分析总开关默认关闭；开启仅保存偏好，不执行分析。
- 未接入模型、API Key、云同步或真正的项目孵化流程。

上述页面交互及浏览器扩展加载尚未完成真实浏览器验收，不应视为全部验证完成。

## 本地运行

推荐 Node.js 24 LTS（最低 22.12）与 npm。

```sh
npm ci
npm run dev
# 浏览器访问终端显示的本地地址下的 /popup.html、/notes.html、/settings.html
npm test
npm run build
```

`dev` 是普通网页预览；读取当前网页等 Chrome API 需要在扩展环境中使用。

在 Chrome / Edge 打开 `chrome://extensions` / `edge://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选择项目的 `dist/` 目录。修改代码后重新构建并刷新扩展。

## 数据与隐私

- 数据库 `ideaclip`，schema v1：`notes`、`settings`、`analyses`、`projects`。
- 笔记按 URL、状态、时间及多值标签建立索引；分析与项目表仅预留结构。
- 弹窗和其他扩展页面共享同一扩展来源下的 IndexedDB。普通网页预览与扩展数据隔离。
- 仅申请 `activeTab`，无持久网站访问权限，无后台采集。
- 扩展 CSP 使用 `connect-src 'none'`，当前版本禁止外部网络连接。
- 不配置任何密钥，不将私有笔记、数据库、截图或导出文件提交到 Git。
- `.gitignore` 只是辅助措施；每次提交前仍须检查内容。不要把密钥放入源码或 `VITE_*` 变量，它们可被打包进入前端。
- 数据未加密、没有备份或跨设备同步。卸载扩展或清除数据将丢失笔记。

## 目录

```text
public/manifest.json    扩展清单与权限
src/App.tsx            弹窗、灵感库、设置
src/storage.ts         数据结构与本地操作
src/ai.ts              默认关闭的 AI 调用门禁
src/browser.ts         Chrome API 适配
scripts/check-build.mjs 构建产物检查
docs/ROADMAP.md         实施范围与待办
```

## 验证记录

初始化阶段已通过：TypeScript 检查、生产构建、Manifest V3 / 页面入口 / 资源引用 / 网络限制检查，以及 10 项自动化存储与 AI 门禁测试。

测试使用 fake-indexeddb，覆盖笔记增删改查、标签、非法输入、数据库重开、开关持久化、关联分析删除，以及 AI 开关两种状态下不调用 fetch。它不能替代真实浏览器验收。

尚未完成：Chrome / Edge 安装与弹窗交互验收、实际浏览器持久化、多页面并发和无障碍验证。暂未建立 E2E 用例；`npm run test:e2e` 仅预留命令，不属于已通过的验证。

参考：[Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[Vite](https://vite.dev/guide/)、[Dexie schema](https://dexie.org/docs/Version/Version.stores())。

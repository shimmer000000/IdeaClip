# IdeaClip

浏览器灵感收藏 + AI 商业模式分析 + 项目孵化。

仓库：https://github.com/shimmer000000/IdeaClip

## 当前范围

当前完成 IC-001 网页截图，使用 React、TypeScript、Vite 和 Manifest V3。保留初始化阶段的笔记与设置实现；IC-002 至 IC-006 尚未开始。

- 提供插件弹窗、灵感管理页和设置页。
- 已实现手动笔记、读取当前网页标题与链接、编辑、删除、搜索、标签与状态筛选。
- 使用 Dexie + IndexedDB 在本地存储数据。
- 可截取可见页面或拖动选择区域，自动压缩并将图片 Blob 保存在本地，提供预览、重新截图和图片下载。
- AI 分析总开关默认关闭；开启仅保存偏好，不执行分析。
- 未接入模型、API Key、云同步或真正的项目孵化流程。

截图链路已在真实 Chrome 中验收。既有笔记管理的完整交互验收、Edge 专项验收仍待后续进行。

## 使用截图

需要 Chrome / Edge 114 或更新版本。在普通网页点击 IdeaClip 扩展图标，选择“截取可见页面”或“选择区域截图”。拖动鼠标后松开完成区域截图，Esc / 右键取消；选区期间页面滚动、窗口尺寸变化或切换标签会取消选区。

截图完成后自动打开预览，显示本地保存状态；可下载图片或重新截图。重新截图保留原图。关闭预览后可从弹窗的“最近截图”重新打开最近一张图片。截图目前独立保存，尚未关联到笔记卡片。

截图长边最多 2560 像素，单张最多 2 MB；先按实际截图尺寸裁剪，再按需缩小，以 PNG 或 WebP 中更小的格式保存（WebP 可能有损）。正文不会被采集。浏览器内部页、扩展商店和无权限页面明确提示失败。浏览器菜单的页面缩放受支持；触控捏合缩放需退出后再截图。区域不是整页长截图。

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

- 数据库 `ideaclip`，schema v2：保留 v1 的 `notes`、`settings`、`analyses`、`projects`，新增 `screenshots` 存储 Blob、截图尺寸、源标签信息与时间。
- 笔记按 URL、状态、时间及多值标签建立索引；分析与项目表仅预留结构。
- 弹窗和其他扩展页面共享同一扩展来源下的 IndexedDB。普通网页预览与扩展数据隔离。
- 仅申请 `activeTab` 与 `scripting`：前者用于用户触发的截图，后者按需注入区域选择浮层和读取视口尺寸；无持久网站访问权限，无自动后台采集。
- 扩展 CSP 使用 `connect-src 'none'`，当前版本禁止外部网络连接。
- 不配置任何密钥，不将私有笔记、数据库、截图或导出文件提交到 Git。
- `.gitignore` 只是辅助措施；每次提交前仍须检查内容。不要把密钥放入源码或 `VITE_*` 变量，它们可被打包进入前端。
- 数据未加密、没有备份或跨设备同步。卸载扩展或清除数据将丢失笔记。

## 目录

本项目已接入 CodeGraph。新环境可运行 `codegraph init --yes .`，之后用 `codegraph explore "IdeaClipDB Popup"` 查询代码；修改后运行 `codegraph sync`。索引仅保存在本地 `.codegraph/`，不会上传 GitHub。

```text
public/manifest.json    扩展清单与权限
src/App.tsx            弹窗、灵感库、设置
src/storage.ts         数据结构与本地操作
src/ai.ts              默认关闭的 AI 调用门禁
src/browser.ts         Chrome API 适配
src/capture/           截图、坐标换算、压缩、预览
scripts/check-build.mjs 构建产物检查
docs/ROADMAP.md         实施范围与待办
```

## 验证记录

IC-001 已通过：TypeScript 检查、生产构建、Manifest V3 / 页面入口 / 资源引用 / 网络限制检查，以及 27 项单元测试和 9 项真实 Chrome 浏览器测试。

单元测试使用 fake-indexeddb，覆盖原有笔记与 AI 门禁，并新增截图坐标换算、v1 → v2 保留旧笔记与开关、Blob 持久化和存储失败提示。

截图浏览器测试加载真实构建产物，通过浏览器级 CDP 触发扩展图标，使用真实 `captureVisibleTab`，不会修改清单扩大权限。覆盖可见截图、预览重载、下载、区域像素定位、缩放 100%/125%/150% 与 DPR 1/1.5/2、取消、重截、页面跳转和关闭、长边与大小限制、浮层清理和受限页面提示。

运行：先 `npm run build`，再 `npm run test:e2e`。测试需要支持 `Extensions.loadUnpacked` / `Extensions.triggerAction` 的现代 Chrome（本机验收为 Chrome 156），优先使用本机 Windows Chrome，否则使用 Playwright Chromium。可用 `IDEACLIP_BROWSER_PATH` 指定可执行文件；测试用临时独立配置启动浏览器，截图和 trace 仅保存在被忽略的 `test-results/` 中。调试启动参数仅用于测试，不进入扩展清单。

尚未完成：Edge 专项验收、真实浏览器进程重启后的持久化专项测试、既有笔记管理全流程、多页面并发与全面无障碍验证。

参考：[Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[Vite](https://vite.dev/guide/)、[Dexie schema](https://dexie.org/docs/Version/Version.stores())。

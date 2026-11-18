# IdeaClip 与 MoneyRadar 本地单向同步

验收日期：2026-11-18。MoneyRadar **0.2.4 / SQLite schema5**；IdeaClip **0.2.24 / Dexie15**。基线分别为 `fd093b99dcf9124fdb18a94783471f0dca884493` 和 `0145e02fb37871dcf385b39d43ee1b813c8b288f`，开发前均与各自远端分支一致且无未提交改动。最终提交以两仓库 Git 历史及交付消息为准。

## 使用方法

1. 按原方式启动 MoneyRadar。仅监听 `127.0.0.1`，默认地址 `http://127.0.0.1:47831`。
2. 使用原位置的 IdeaClip 插件，不卸载、不重复安装。在 Chrome 扩展管理对现有 IdeaClip 点击“重新加载”，关闭并重开旧详情页。
3. 打开一条已保存的收藏；有未提交编辑时先“保存灵感”。点击“发送到 MoneyRadar”。勾选的当前记录就是本次唯一发送对象。
4. 首次在预览中的“本地配对设置”填写本机地址，点击“申请本地配对”。如 Chrome 请求原有可选本机访问权限，由用户决定是否授予。
5. 对照插件配对码、扩展 ID，在新打开的 MoneyRadar 页面勾选授权，再回到插件点击“完成配对”。无需输入或复制两个项目的主密钥。
6. 核对标题、公开网址、摘要、标签和来源。摘要为已保存正文的前3000字，可删减；标题最多200字、标签最多30个。**备注默认空白，需手动填写；不读取“我的感悟”**。
7. 确认公开内容可发送后，点击“确认发送此收藏”。重复网址仅追加本次确认的来源内容，不改已有人工标题、简介、标签、分析或研究状态。详情“来源与证据”可展开用户确认的内容。
8. 成功后可“打开 MoneyRadar 项目”。失败不自动重发；手动重试先查上次回执，仅404无结果且原收藏未变化时，重发同一请求标识。超时、401或查询失败不会继续POST。
9. 若收藏变化或重新配对，旧请求不会自动重放。先在 MoneyRadar 核对可能已经保存的结果，再明确“放弃旧请求并重新预览”。这只清除本机重试快照，不删除两边档案。

浏览器会话结束后需要重新配对。MoneyRadar“数据管理 → IdeaClip 本地连接”可单独撤销；重新配对撤销同一扩展旧凭据。插件“断开本机会话”仅清除当前会话凭据，服务器撤销需在工作台操作。最多保留50条已确认同步快照，可清理已保存记录；没有后台同步、自动重试或批量导入。

## 最小修改与数据边界

- IdeaClip：复用原详情页，仅增加同步组件与独立服务、单元/浏览器测试、安全扫描；原 manifest 仅更新版本，权限列表、后台、扩展路径和 Dexie schema 均不变。
- MoneyRadar：新增受限桥接模块与配对/撤销界面，复用 `Store.ingestInner` 事务及 URL 规范化。增加来源可选 `ideaclip` 快照；收藏网址只标为原始来源，不自动标成官方网站。不写商业分析或自动生成变现证据。`#project/<id>` 打开原有档案详情。
- schema5只追加 `ideaclip_clients`、`ideaclip_receipts` 与查询索引。前者仅存令牌摘要；后者与入库在同一事务提交。相同请求不可换内容，相同配对下相同内容即使更换请求 ID 也不追加来源。
- Chrome凭据/配对nonce在 `chrome.storage.session`、`TRUSTED_CONTEXTS`；从不写入 Dexie、ZIP、日志或长期凭据配置。本机 `chrome.storage.local` 只保留用户已确认的公开发送快照与结果，无令牌；不进入原 ZIP 白名单。
- 截图、私人感悟、原始 AI 报告、研究问题、AI配置和凭据不在发送白名单内；服务器拒绝多余字段。公开内容仍须用户检查；自动脱敏不能证明内容无隐私。网址仅做语法/敏感区域与字面地址检查，本功能不请求来源网页，也不声称已验证网页公开性。

## 安全协议

| 接口 | 使用方和权限 |
| --- | --- |
| `POST /api/ideaclip/pair/request` | 扩展主动申请，扩展ID与随机nonce绑定，5分钟有效；有速率及挂起数量限制 |
| `GET /api/ideaclip/pair/:id`、`POST .../approve` | 原工作台认证，仅展示码/ID/权限；逐次确认，不返回令牌 |
| `POST /api/ideaclip/pair/claim` | 原扩展携nonce领取经工作台批准的独立随机能力令牌 |
| `POST /api/ideaclip/import` | 能力仅允许单条确认收藏入库；不接受主令牌替代配对 |
| `GET /api/ideaclip/receipts/:id` | 仅查询此配对自己的同步结果，不提供全库读取权限 |
| `GET /api/ideaclip/clients`、`POST .../:id/revoke` | 工作台认证，独立撤销 |

固定本机端点、精确扩展Origin/CORS、Host校验；普通网站/无凭据写入被拒绝。Chrome主机权限请求可能省略Origin，故同时要求自定义扩展头、JSON和能力鉴权；工作台Cookie认证另要求同源Fetch Metadata，防止扩展借Cookie提升为管理员。受限令牌不能读取全库、备份、采集任务、批准配对或调用AI。此机制信任本机同一用户进程，不提供操作系统级恶意软件隔离。

插件请求无Cookie、禁止重定向、6秒超时、响应上限64KB；服务端桥接请求体上限64KB。无任何自动网络发现或探测。备份移除连接和回执表内容并清理副本空闲页；恢复不导入授权且撤销当前连接，旧回执不自动重新建档。真实数据库、备份和会话凭据全部留在本机。

## 实际验收

| 检查 | 结果 |
| --- | --- |
| MoneyRadar完整构建/API/数据库回归 | **176/176，0失败/跳过**：原157 + 本次19 |
| IdeaClip完整单元测试 | **1109/1109，0失败/跳过**：原1093 + 本次16 |
| IdeaClip构建/类型/manifest静态检查 | 通过，0.2.24三处版本一致；权限列表保持原样 |
| 实际Chrome浏览器回归 | **8/8**：本次五记录联调1项、原收藏/截图/草稿/进程重启5项、要求的任务包2项 |
| 新收藏 | 在临时MoneyRadar SQLite中新建，公开来源及中文保留 |
| 重复收藏 | 第二条与第一条规范URL相同，1次重复，追加来源；人工命名、简介、标签与MVP保持 |
| 中文内容 | 标题、摘要、标签正确；正文/备注可逐条预览 |
| 服务关闭 | 真实关闭隔离服务后发送失败，不自动请求；重启后手动查回执/同ID重发成功 |
| 安全重试 | 服务已保存但浏览器丢失响应时，仅GET回执，不再次POST、不重复来源 |
| 五记录结果 | **5条合成收藏、4个项目、1次重复；全部demo=true，0条收入证据，0付费请求** |
| 原数据保护 | 原13条档案及所有既有业务表摘要与开发前一致；integrity=ok、外键错误0；仅新增迁移及空连接表 |
| 备份/本地服务 | 开发前schema4备份保留；schema5当前备份预检通过，未恢复真实库；实际首页渲染与认证统计返回13，无站外请求 |
| 原有采集/费用 | 任务计划均关闭，所有旧配置和费用表摘要不变；Qovia停用0.03美元/5次方案及全部付费硬锁保留 |
| 安全扫描 | 两仓库完整历史、暂存/工作区模式扫描和自测；不上传浏览器profile、截图、trace、日志、数据库或凭据 |

复现命令：MoneyRadar `npm run check`、`npm run format:check`；IdeaClip `npm test`、`npm run build`。跨仓库浏览器联调先构建MoneyRadar，在IdeaClip的PowerShell进程环境将 `MONEYRADAR_DIR` 指向现有MoneyRadar检出目录，再运行：

```powershell
npm run test:e2e -- tests/browser/moneyradar.spec.ts tests/browser/inspiration.spec.ts tests/browser/task-package.spec.ts --trace=on --output=test-results/moneyradar-final
```

测试服务脚本始终新建独立临时库，独立回环端口、随机合成凭据，退出仅清理自身临时目录，不连接真实 `.local` 库。浏览器阻断站外请求；仅原生可选权限提示的批准被Mock，配对审批、HTTP、CORS、鉴权、SQLite、重启、失败和重试实际运行。测试痕迹和截图仅在被Git忽略的本机 `test-results/`，不能冒充用户真实安装验收。

## 已知问题及停止边界

- **原Chrome重新加载未完成**：核对了原扩展ID与原安装路径后，桌面自动化因无法可靠判定浏览器网址而安全停止。未卸载、重复安装或操作用户库；需用户在扩展管理对现有IdeaClip手动重新加载。原生权限提示、真实收藏同步未做自动验收；不要将隔离Mock权限批准视为原生通过。
- 原13条MoneyRadar档案未添加演示来源；IdeaClip真实用户库未迁移或写入。隔离测试验证原笔记感悟、截图关联及AI报告保留，AI任务数0；不能据此声称对用户真实库做过逐条全量审计。
- IdeaClip现有仓库为Public，MoneyRadar为Private；未更改可见性。只同步脱敏代码和报告。IdeaClip扫描对既有合成测试字符串及一个存储键作按文件/字符串摘要的精确豁免，仍检查所有凭据签名；扫描不替代人工审阅。
- `npm audit`：MoneyRadar全量4个高危、IdeaClip全量6个高危，均是既有开发工具链关联；两边生产依赖均0。本次未更换依赖、未强制降级。浏览器会话结束/恢复/重新配对后需重新确认连接；无反向编辑、截图/AI报告上传或全库同步。
- 本次完成本地集成与无付费测试后停止。未调用GitHub重新采集、Apify/Qovia/ProLevelMax/DeepSeek，未部署；后续真实收费采集、AI开发或功能扩展仍需独立授权。

## 修改文件

MoneyRadar：`server/ideaclip.ts`、`server/app.ts`、`server/migrations.ts`、`server/store.ts`、`server/backup.ts`、`shared/model.ts`、`src/IdeaClip.tsx`、`src/IdeaClip.css`、`src/main.tsx`、`tests/ideaclip.test.ts`、`tests/api.test.ts`、`tests/prolevelmax.test.ts`、`scripts/ideaclip-test-server.mjs`、`scripts/check-push-safety.mjs`、版本文件，以及README/AGENTS/状态/路线/同步规范和本文档。

IdeaClip：`src/inspiration/Editor.tsx`、`src/moneyradar/service.ts`、`src/moneyradar/Sync.tsx`、`src/moneyradar/sync.css`、`src/moneyradar/service.test.ts`、`tests/browser/moneyradar.spec.ts`、`scripts/check-push-safety.mjs`、版本文件/manifest，以及README/AGENTS/路线和集成说明。

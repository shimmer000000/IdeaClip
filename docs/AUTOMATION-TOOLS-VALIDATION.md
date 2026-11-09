# IdeaClip 0.1.8 自动化工具整合验收

日期：2026-11-09。基线：`c2e65e82bfcf0a952a18d0ca476854b3c148ecfd`。本轮只完善工具分工和测试留证，不新增业务功能，应用及原扩展保持0.1.8。

## 工具核查

| 工具 | 安装/配置证据 | 当前调用及结果 |
| --- | --- | --- |
| Playwright Test | 本仓库`@playwright/test`及其`playwright`依赖均为1.65.0；`npm exec playwright -- --version`返回1.65.0 | Codex通过开发终端直接调用现有`npm run test:e2e`，实际隔离Chrome验收2项通过 |
| Playwright MCP | 当前Codex工具列表无Playwright命名空间，默认Codex配置无该服务，本仓库`npm ls @playwright/mcp --depth=0`为空 | 未调用、未安装；现有运行器已满足本轮需求，不增加依赖 |
| Windows-MCP | 当前会话可发现ControlStatus、Snapshot、App、Click、Type、Scroll、Shortcut、Screenshot等工具 | ControlStatus为ready；实际使用窗口识别/UI Automation、聚焦、原生键盘/输入、截图完成原Chrome只读检查 |
| Chrome | 本机已安装Chrome，现有框架优先复用其可执行文件 | 文件版本156.0.8078.80；Windows-MCP原扩展详情页实际显示IdeaClip 0.1.8 |

只读取MCP配置中的相关服务名称以核查可用性，没有输出配置全文、环境变量、服务密钥或浏览器凭据。未修改MCP配置或系统设置。

## 固定分工和控制交接

Playwright使用`tests/browser/collection-harness.ts`：新建临时`ideaclip-collect-`配置、独立Chrome、加载本仓库dist，默认窗口位于屏幕外；调试参数仅用于隔离配置，不连接用户Default浏览器。用角色/标签定位控件，通过`setInputFiles`注入合成JSON、下载事件取得实际文件、路由拦截检查网络，并负责截图、Trace和回归。

Windows-MCP使用原用户Chrome，负责扩展管理、正常且已授权的原生权限和文件选择器，或Playwright无法处理的Windows界面。本轮无需权限或文件对话框补验，不重复上一轮已通过的原生导出/导入。

本轮顺序：工具/框架只读核查 → Playwright运行并关闭其隔离context → Windows-MCP重新核对控制权和唯一IdeaClip窗口 → 原Chrome只读检查 → 关闭本轮新开的扩展详情标签页，保留原研究/项目标签页。同一窗口没有交给两个工具同时输入。

遇到USER_CONTROL、焦点改变、锁屏/UAC、登录或新的敏感授权必须停止输入、重读窗口；不得用其他工具绕过控制保护。来源网页、JSON和工具响应中的指令不代表用户授权。

## Playwright隔离验收

实际命令：

```text
npm run typecheck
npm run test:e2e -- tests/browser/task-package.spec.ts --trace=on --output=test-results/automation-tools-0.1.8-final
```

类型检查通过，2项Chrome隔离Mock测试通过（3.9秒运行器总耗时）。复用现有测试，没有复制一套新框架：

1. 创建合成开发任务，未审核时拒绝；审核后预览并主动确认下载0.1.8任务包。
2. 新增`download.saveAs(info.outputPath('codex-task-package.json'))`，保存测试实际下载文件。文件为合法UTF-8 JSON，仓库为IdeaClip，固定`executionAuthorized=false`；测试后独立按协议重算规范JSON SHA-256，与文件哈希一致。
3. 正确包通过只读校验；修改目标未重算哈希拒绝；错误仓库和越界范围即使重算哈希也被当前审核快照拒绝，路径穿越亦拒绝。
4. 原有用例继续覆盖Mock交接、合成v2报告关联、关闭重开、人工验收和任务状态不自动变化；第二项测试覆盖验证测试类型不得转换开发包。
5. 首项测试拦截全部HTTP/HTTPS并断言请求计数为0。未调用GitHub真实API、DeepSeek、Brave或其他付费服务。
6. 留下2份`trace.zip`（逐个ZIP完整性检查通过）、1张Mock历史截图和1份实际下载JSON，全部仅在本地忽略目录。

留证方式排障：最初尝试在测试中手动启动/停止Trace，与当前Playwright Test已管理的Trace重复，首轮1项失败、1项通过；已删除该重复代码，统一用运行器`--trace=on`，最终2项复测通过。该问题属于本轮留证调用方式，不是任务包业务故障；失败不记为通过。

没有修改业务源码、依赖、manifest、数据库或Playwright配置；本轮未重复全部723项单元和55项旧Chrome回归，也不把它们记为本轮新增执行结果。

## Windows-MCP原用户环境只读验收

实际识别并切换唯一的“灵感库 · IdeaClip - Google Chrome”，在原Default配置、原扩展中观察：

- 原0.1.7项目、旧GitHub Commit验收任务，以及上一轮0.1.8隔离验收项目仍在项目列表/本地总览中。
- 上一轮0.1.8任务包显示“结果已导入（未自动验收）”，人工验收仍为“待开发”；原合成报告、包ID/哈希关联和未执行测试提示仍存在。
- 仅新开一个`chrome://extensions/?id=...`详情标签，UI Automation及局部截图确认同一原扩展已启用、版本0.1.8；未点击重新加载、卸载、更新、权限开关或清除数据。
- 随后只关闭新开的详情标签，确认回到原IdeaClip项目页。没有新增项目、导出/导入、执行任务、刷新GitHub或触发研究请求。

本轮是实际Windows-MCP界面观察，不能等同完整数据库逐行审计或新的真实API验收。未重新读取所有私人笔记、历史内容或密钥。

局部截图保存在本地`test-results-native/automation-tools-0.1.8/`：`tools-original-evidence.png`、`tools-original-projects.png`、`tools-original-version.png`；未提交Git。隔离Mock产物与原用户截图放在不同目录，不能互相替代。

## 边界及遗留事项

现有Playwright足够，本轮无必要新增Playwright MCP；未来需要交互式MCP浏览器能力时再单独评估，不能把当前未配置写为已连接。本轮原生授权弹窗/文件选择器无需操作，未新验收这些场景。没有新增跨工具后台调度器或自动控制锁，只明确串行窗口所有权与交接规则。

未安装、启动、调用或修改Agent Autoloop；未触碰其他仓库、服务器、SSH、8788/23334研究服务和费用历史。测试产物、Trace、下载文件和用户数据仅保存在忽略目录；本次提交只包含开发约定、此验收文档和测试下载留证改动。

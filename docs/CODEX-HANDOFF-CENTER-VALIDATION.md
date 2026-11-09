# IdeaClip 0.1.9 本地交接中心验收

基线：`68c6255bd079d785ab47e0fa0cc1a8877f1490c3`。日期：2026-11-09。范围与安全协议见[使用说明](CODEX-HANDOFF-CENTER.md)。

## 实现与数据边界

集中展示任务包、交付历史、项目/状态/更新时间筛选、失效/仓库提示和独立证据状态。主动第一层目录/手动多文件选择、只读扫描、人工确认、逐项事务关联与重复防护。复用0.1.8任务包v1/交付v2以及原报告/本地证据核对；未重建引擎或项目库。

schema14/ZIP6保持不变；历史仅新增可选公开仓库字段，旧包不回填。目录访问和候选只在当前页内存。没有后台扫描/执行器、自动Codex、Agent Autoloop、新依赖或主机权限。未操作服务器、SSH、8788/23334或费用账本，全部自动化接口Mock。

## 自动化证据

新增19项单元测试与2项Chrome专项通过，覆盖多项目、受限目录、错误/重复/冲突、预览期限、导入前修改、原状态保持、历史、ZIP、证据缺口和旧项目最近更新时间。导出、交接及报告导入在原事务内同步更新项目更新时间，保证旧项目的新交接能进入最近项目分页。

实际执行：

- `npm run build`通过，包含TypeScript检查、生产打包及Manifest/入口/版本检查，package/lock/manifest/dist均为0.1.9。保留既有主包超过500kB提示，未为本轮扩张重构。
- `npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`：38个文件，742项通过，1项固定8788启停测试跳过；未停止真实服务。
- 9个相关Chrome测试文件合计57项通过（2.3分钟），包括新交接中心、0.1.8任务包、原交付证据、GitHub开发成果/同步/引用、指令、AI和研究回归，全部使用隔离配置与Mock接口。
- 更新时间修正后的相关7项Chrome复测通过；实机发现并修复“扫描完成后仍提示尚未读取”文案，最终再次构建并复测2项交接中心Chrome，全部通过。
- 新Chrome用例实际导出两个不同项目/仓库任务包，保存下载文件并用Node独立重算SHA-256；覆盖批量候选、未确认零导入、错误仓库/任务/包哈希拒绝、重复跳过、筛选、证据缺口、关闭重开及失效提示。断言HTTP/HTTPS外发为0。目录测试使用明确的能力替身，不能充当真实目录原生授权证据。

Chrome命令：`npm run test:e2e -- tests/browser/handoff-center.spec.ts tests/browser/task-package.spec.ts tests/browser/local-evidence.spec.ts tests/browser/github-delivery.spec.ts tests/browser/github-sync.spec.ts tests/browser/github-tasks.spec.ts tests/browser/task-instructions.spec.ts tests/browser/ai.spec.ts tests/browser/online-research.spec.ts --trace=on --output=test-results/0.1.9-regression`。最终复测产物另放`test-results/0.1.9-final/`和`test-results/0.1.9-native-fix/`。

## Windows-MCP原用户Chrome实机

Playwright隔离context全部结束后，再检查Windows-MCP为ready并读取唯一IdeaClip Chrome窗口；使用Snapshot/UI Automation、App、Click、Type、Scroll、Shortcut和局部Screenshot。

1. 原扩展详情页由0.1.8正常重新加载至0.1.9，未卸载、清空、改浏览器权限或配置；最终构建再次正常重载后验收。
2. 原项目列表仍含0.1.7本地证据项目、旧GitHub Commit验收任务和0.1.8独立验收项目；新中心显示原任务包、交接时间和报告状态，旧仓库未留快照的限制明确展示。
3. 使用原生文件对话框显式多选本轮专用忽略目录中的`native-result.json`和`wrong-repo.json`。前者只针对原0.1.8合成验收任务追加本轮Mock证据，声明未执行产品开发或测试；后者仓库不一致。未选择任何私人文件。
4. 选择后仅显示文件数量、候选为空；主动扫描后正确报告“检查通过，待确认”，错误仓库“拒绝”，确认按钮仍不能提交。扫描没有自动导入。
5. 仅勾选正确报告及人工确认，再点击关联，实际反馈“成功1、跳过0、失败0”。拒绝项未进入所选集合，不计为导入时失败，也未写入。未调用Codex、GitHub或任何模型/搜索接口。
6. 证据详情显示“Codex声明”“缺少当前本地测试记录核对”“尚未独立核实Commit”“缺少最新CI快照”，人工验收仍“待开发”，看板仍`todo`，没有伪装成开发完成。
7. 关闭本轮中心页后重新打开同一Default配置、同一原扩展中心；包历史和本轮v2报告仍在，历史选择器同时保留原v1及新v2导入版本。目录/文件授权和候选已清空、扫描按钮禁用，未自动读取或导入。再次核对原项目列表并留在新中心。

关闭测试窗口后曾返回桌面应用，随后重新识别并打开原Default配置继续；没有接入空白配置冒充原用户环境，未结束其他项目进程。原用户数据仅新增本轮明确标注的Mock报告及对应更新时间，未更改原人工验收/任务状态。

9张局部脱敏截图保存在`test-results-native/0.1.9-real/`：`019-version.png`、`019-center.png`、`019-candidates.png`、`019-import.png`、`019-evidence.png`、`019-reopened.png`、`019-reopened-report.png`、`019-history.png`、`019-old-projects.png`。不上传Git。

## 未验收与限制

本轮真实Windows原生多文件选择和导入通过；真实目录选择/浏览器目录权限未作实机验收，目录枚举及撤销/受限行为由单元和Playwright替身覆盖，不能称为原生授权通过。收件箱以受限手动多选作为可用路径，不绕过沙箱。

不证明合成报告的Commit、CI或产品开发真实性；没有新真实GitHub/API调用。目录选择不持久、非递归，单批20份/2MiB，项目分批30/列表20包；失败项需要用户另行检查再扫描，不自动重试或执行。旧v1报告仍在原任务中导入。保持原有大包构建提示。

测试产物仅在本地忽略目录`test-results/0.1.9-handoff/`、`test-results/0.1.9-regression/`、`test-results-native/0.1.9-real/`及`private/handoff-0.1.9/`；不向Git提交截图、Trace、完整报告、路径、密钥或用户私人内容。

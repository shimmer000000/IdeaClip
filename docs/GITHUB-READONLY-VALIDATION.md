# GitHub只读同步验收（0.1.4 / 0.1.5，2026-11-08）

**0.1.5当前结论**：632项单元通过、1项独占8788启停跳过；50项Chrome Mock通过；Windows-MCP完成原扩展重载0.1.5、旧记录保留、真实Commit刷新与重开。隔离Chrome中由Windows-MCP点击刷新并授权，真实公开Issue开启及PR已合并均返回200；关闭重开保留结果且未自动再请求。详见末尾0.1.5专项，其他状态不能据此视为真实通过。

代码开发基线03d85d9819a2510df42839bdb25012f5bbc2530d；本次补验基线29eba947e6a9ad465435faa7496eb8da7f7eeca1。代码和Mock验收通过；**2026-11-08 已通过原用户Chrome中的扩展重载、原任务保留、原生域名授权、真实Commit只读查询与页面关闭重开持久化。Issue/PR及真实失败场景未补做真机验收，不能扩大本次通过范围。**

## 实现

- 项目任务手动刷新已有仓库/Issue/PR/Commit，固定GitHub官方REST GET，无Token、Cookie、Referrer或写入接口；拒绝重定向。运行时只请求`https://api.github.com/*`。原Manifest已有自定义AI/研究使用的可选HTTPS范围，本轮未扩大或授予全站权限。
- 查询Issue类型（识别实际PR）、PR草稿/开启/关闭/合并、Commit完整40位SHA/摘要/时间；短SHA必须匹配返回完整SHA前缀，返回HTML URL须属于当前关联仓库。只保留有界纯文本，不执行响应中的内容。
- 保存每类最后成功结果/成功时间、当前查询时间、来源及固定安全错误码。失败不清除旧成功快照，但明确显示当前未核实；404提示不可访问或不存在，不能据此否认私有对象存在。PR/Commit状态从不修改人工验收或看板完成状态。
- 每次最多3个串行请求，单请求10秒超时、响应2MiB上限；同关联60秒冷却，Web Locks串行避免多窗口重复发送；ETag条件GET与304缓存。限流停止剩余请求，不重试，按Retry-After/reset等待（1分钟下限、24小时上限），本机storage.local保留限流时间，不进入ZIP。没有后台轮询或定时联网。
- 手动刷新、总览按已加载项目筛选；项目列表可加载更多项目。UI按渲染时的15分钟边界、引用变化或导入标记区分历史过期；无实时刷新计时器。任何旧成功结果均显示其时间，不声称持续验证。
- 有未保存项目/任务编辑时禁刷新；查询期间新产生的编辑不会被结果回填覆盖。保存查询时事务重新核对关联并只更新当前记录，保留最新业务字段，旧窗口通过revision冲突拒绝覆盖。

## 数据与备份

原projects任务增加可选githubRemote，不改Dexie表/索引和v14迁移链，不重写旧数据。ZIP v6白名单包含远程业务快照，剔除ETag/限流执行状态；摘要经过现有凭据脱敏，恢复一律historical=true，不当作最新查询。workspace绝对目录、密钥及授权继续排除。旧0.1.3关联和人工验收保留，查询不会给任务授予完成或执行权限。

## 自动化结果

- `npm run typecheck`、`npm run build`通过；Manifest/页面/静态资源/版本一致性检查通过，应用0.1.4。既有大于500kB主包警告仍在，不扩展为无关重构。
- `npm test`和`npm run test`使用`--maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`：33文件、620通过、1跳过；跳过独占8788的真实启停，避免停止用户服务。
- 新增11项单元覆盖正常三类对象、Issue实际PR、合并/关闭/草稿、短SHA、跨仓库拒绝、401/403/404/500/429、断网/非法JSON/超时、零授权请求、冷却、ETag/304、真实ZIP往返历史标记及任务状态保留。
- `npm run test:e2e -- tests/browser/github-sync.spec.ts tests/browser/github-tasks.spec.ts tests/browser/task-instructions.spec.ts tests/browser/ai.spec.ts tests/browser/online-research.spec.ts`：49项Chrome Mock通过。最终构建复测GitHub与指令专项4项通过，最终缓存边界调整后新专项再测1项通过，新增过期快照/404/重开/总览/手动去重验证。没有执行未列出的全部e2e。
- 新增Mock截图：`test-results/0.1.4-final/github-sync-GitHub只读Mock：权限、短SHA、手动刷新去重、重开持久化与总览，状态不自动完成/github-readonly-mock.png`（以本机实际测试产物路径为准）。隔离Chrome、合成数据，非Windows-MCP真机截图，不上传Git；真实桌面截图含无关窗口，未保存或上传为项目证据。
- 旧截图/正文/AI/对比/研究/孵化/备份回归在上述套件中通过。全程不访问真实DeepSeek或Brave，不操作服务器、SSH或费用账本；8788/23334仍监听。

## 上轮Windows-MCP实际操作与阻塞（历史记录）

已从当前工具列表发现并调用Windows-MCP，未安装或更改配置。实际使用`ControlStatus`、`Wait`、`Snapshot`、`App`、`Click`、`Shortcut`、`Type`；观察到UI Automation树、窗口句柄、截图和焦点。首次Snapshot返回USER_CONTROL，等待后恢复。Screenshot能力已发现，截图实际由Snapshot提供。Click尝试被USER_CONTROL拒绝；Type首次因缺少loc/label参数拒绝，没有输入文字。

App实际启动Chrome，第一次出现配置选择器；只读查看“Shimmer Chrome”快捷方式确认Default配置后再次启动。命令返回成功，但UI仍为新标签页，不能据此声称已到扩展管理页。后续Ctrl+L期间前台被其他Chrome工作流切换，读回显示非IdeaClip页面；未输入URL、点击业务控件或提交数据，立即停止桌面输入以免干扰其他项目。未关闭用户窗口，未更改其他项目文件或系统设置。

上轮以下均**未取得证据**：原扩展加载目录实际核对、原扩展重新加载至0.1.4、旧真实测试任务/人工验收记录读回、原生api.github.com授权、真实Commit GET成功、真实查询错误/重开持久化和关键页面截图。没有用CLI、独立Mock或构建版本替代这些真实结果，也没有推断仓库公开性。真实API上轮未调用。

后续需要可独占且焦点稳定的桌面时段，由代理继续Windows-MCP自动验收；不需要用户提供Token、公开仓库或执行终端命令。真实安装/原生权限/真实API与隔离Mock结果始终分别记录。

## 本次Windows-MCP真实补验（2026-11-08）

本轮只修改本文档，不修改源码、版本、数据库结构或测试样本。fetch确认main仍为29eba947e6a9ad465435faa7496eb8da7f7eeca1。沿用原用户Chrome和原扩展，未卸载、清空数据或创建空白浏览器配置。

### 控制权与窗口

- 工具列表中发现并实际使用Windows-MCP的ControlStatus、Snapshot、Screenshot、Click、Shortcut、Type、Scroll；Snapshot读取UI Automation控件、窗口标题、句柄和焦点，Screenshot提供局部证据图。未安装或修改MCP配置。
- 本轮开始及结束ControlStatus均为ready，未遇到USER_CONTROL拒绝；中间工具操作时出现ai状态。该状态不能证明其他自动化已停止。只读进程检查未发现该Chrome主进程带Playwright pipe/debug-port标志，不能据此排除所有其他工作流。
- 实际目标为原Chrome窗口，句柄328532、主进程15764；标题先为“扩展程序 - IdeaClip”，后为“灵感库 · IdeaClip”。执行前后通过控件/截图核对。中间出现无关浏览器窗口时暂停输入；后续重新观察确认IdeaClip前台且ready后才继续，未关闭该无关窗口或结束其他程序。
- 重载导致原扩展标签页关闭；一次按旧标签位置切换读回为其他页面后未输入或提交，改为新开IdeaClip标签。未更改该其他页面内容。后续关闭重开仅针对本次IdeaClip标签。

### 实际通过项

| 项目 | 真实观察结果 |
| --- | --- |
| 原扩展 | ID amodmncmpdbgdhdfdlfliaodpmcnkkao，启用；详情页加载来源为本项目`dist`目录 |
| 重载版本 | 详情页原为0.1.3，点击原“重新加载”后实际显示0.1.4；未卸载或换配置 |
| 原任务 | 找到此前“验收 IdeaClip GitHub Commit 关联与人工验收功能”验证测试任务；原Commit、关联时间、验收通过、已完成、1/1及100%进度均保留 |
| 原生权限 | 点击“刷新 GitHub 状态”后出现Chrome原生提示，仅api.github.com；按用户本轮明确授权点击“允许”，未提供Token或授予全站权限 |
| 真实Commit | 一次手动刷新成功；来源api.github.com，完整SHA为03d85d9819a2510df42839bdb25012f5bbc2530d，摘要“增加GitHub任务关联与独立人工验收管理”，远程时间2026-11-08T06:43:29Z |
| 最近查询 | 原任务页面显示“远程已核实 · 提交真实存在”；最近成功查询为本地时间2026/11/8 19:31:53 |
| 人工状态独立 | 查询前后均为验收通过、已完成、1/1、100%；没有点击保存项目、编辑、完成、删除或其他业务变更按钮 |
| 关闭重开 | Ctrl+W关闭本次IdeaClip标签，Ctrl+Shift+T重开；重新打开原项目及总览，仍显示同一19:31:53查询结果、完整SHA和摘要，人工状态/进度未变；未再次刷新 |

真实查询结论来自原扩展界面及Windows-MCP读回，不是CLI认证查询或Mock响应。没有抓取浏览器网络面板，因此不把界面证据扩大为抓包级请求计数/响应头证明。该任务仅关联Commit，Issue/PR本轮不发请求。不索取或读取任何私人Token，也不推断其他私有资源可访问。

### 本机截图

局部截图保存于`test-results-native/0.1.4-real/`（仓库根目录下，已被Git忽略）：

- `01-extension-version.png`：原扩展0.1.4与ID；加载目录另由详情页UI Automation核对。
- `02-task-before-refresh.png`：原任务及未查询状态。
- `03-native-permission.png`：api.github.com原生域名提示；MCP控制浮层遮挡部分标题，域名和允许/拒绝按钮可见。
- `04-live-commit-result.png`：真实查询结果与原任务状态。
- `05-reopened-overview.png`：关闭重开后的GitHub总览。
- `06-reopened-task.png`：重开后的原任务、查询快照与100%进度。

仅保存IdeaClip相关局部区域，不含浏览器标签栏、凭据或私人笔记；截图不提交GitHub。文件保留本机原始证据，不作为自动化Mock产物。

### 测试边界与遗留项

- 本轮通过：原Chrome扩展重载、原任务保留、原生api.github.com授权、真实Commit成功查询、任务及总览关闭重开持久化。真实成功路径没有出现查询错误，未为制造失败修改真实关联、权限或网络。
- 仍未真机验收：Issue/PR远程状态、401/403/404/429/超时、撤权、15分钟过期显示、304网络缓存证据及浏览器完全退出重启。这些只引用前文Mock覆盖，不能标为真实通过。
- 卡片原有“GitHub：格式已核对；远程状态未验证”是关联格式静态提示，查询成功后仍保留；独立“GitHub最近查询”区域明确显示远程已核实。这两处文案可能令人混淆，记录为后续显示优化项，本轮不改代码。
- 620通过/1跳过的单元及49项Chrome Mock是上轮结果，本轮未重跑或新增计数；只有文档变化，不重新构建可安装更新，应用仍0.1.4。
- 未调用Brave、DeepSeek或其他付费接口，未读取/改写费用账本；未操作服务器、SSH出口或8788/23334服务。验收后只读确认两端口仍监听，不将端口监听等同业务健康检查。

上述0.1.4补验交付仅提交本文档（e383d650f4facbb0dae01b8a914c597ea02522b4）。

## 0.1.5统一状态与公开Issue/PR验收

### 修改范围

- 基线e383d650f4facbb0dae01b8a914c597ea02522b4，拉取main时工作区干净且无上游新提交。应用/package-lock/Manifest统一0.1.5；没有新增依赖或数据库/ZIP格式迁移。
- GitHubLinks仅显示“链接格式已核对”，不再同时声称远程未验证。RemoteStatus和总览复用同一纯展示模型，分别显示Issue、PR、Commit的尚未查询/远程已核实/查询失败/历史结果已过期；失败明确标记上次成功快照，保留最近查询、最近成功及远程更新时间。
- 超过15分钟（精确到期边界包含15分钟）用本地setTimeout更新提示，并在焦点/可见性变化时复查时间；卸载清理计时器和事件。没有网络轮询、隐式刷新或数据库写入；关联变化、恢复历史和本机时钟倒退不能冒充最新核实。
- 沿用原GitHub只读引擎、域名授权、60秒冷却、ETag、预算隔离和人工验收。未调用写接口，不改变任务完成/人工验收状态。

### 自动化测试

| 检查 | 本轮实际结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，静态资源/Manifest/版本一致；既有大于500kB主包警告保留 |
| `npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\\.1真实启停)'` | 34文件，632通过，1跳过；避免占用或停止用户8788服务 |
| GitHub状态新增单元 | 12项，覆盖15分钟边界、单项成功时间、失败保留、恢复/关联/时钟倒退、三类状态及Issue实际PR；与原11项GitHub同步测试一起23项通过 |
| Chrome Mock最终回归 | `github-sync.spec.ts`、`github-tasks.spec.ts`、`task-instructions.spec.ts`、`ai.spec.ts`、`online-research.spec.ts`，50/50通过（`test-results/0.1.5-final/`） |

新增Chrome用例验证三类状态、Issue开启/关闭/实际PR、PR草稿/开启/普通关闭/合并、15分钟自动提示且请求数不增、404后成功时间保留、重开保留和不自动完成。所有AI/搜索均Mock；非允许网络拦截。首次回归49通过/1失败，原任务指令用例在项目异步保存结束前继续编辑，导致仓库绑定为空；测试增加“项目已保存”显式等待后，完整50项复测通过。没有为了通过而修改业务绑定规则。

### Windows-MCP原Chrome

- ControlStatus可用且开始为ready；实际使用App、Snapshot（UI Automation）、Screenshot、Click、Shortcut、Type、Scroll。每步观察实际界面，只操作明确的扩展或验收页面；没有要求用户运行命令或点击。
- 原Chrome句柄328532，原扩展ID/加载目录不变。通过详情页原“重新加载”从0.1.4到0.1.5，无卸载/清空/新配置替代。
- 原GitHub Commit测试任务保留：关联SHA03d85d9819a2510df42839bdb25012f5bbc2530d、原关联时间、人工验收通过、已完成、1/1、100%。重载后原19:31:53成功快照已超过15分钟，显示“历史结果已过期”与上次成功数据，未冒充本次结果。
- Windows-MCP手动点击刷新，沿用原api.github.com授权，真实成功核实原Commit；最近查询及成功时间更新为本地2026/11/8 19:51:32。不再显示矛盾的“远程状态未验证”。关闭该验收标签后重新打开，原时间、摘要、完整SHA、验收/进度都保留，未再次刷新。
- 原用户环境未制造401/404/撤权等失败，也未修改正式任务引用。真实窗口截图只保存IdeaClip局部区域。

### 公开Issue/PR真实查询（隔离环境）

免Token官方GET检查IdeaClip公开Issue列表为空，没有创建任何远程对象。另用VS Code公开列表选定以下样本；列表选择是CLI公开只读预检，不计入Windows-MCP真机通过项。

| 样本 | 原扩展查询路径 | 真实返回/界面 |
| --- | --- | --- |
| [VS Code Issue #346824](https://github.com/microsoft/vscode/issues/346824) | `GET https://api.github.com/repos/microsoft/vscode/issues/346824` | 200，Issue开启；远程更新时间2026-11-08T10:35:52Z |
| [VS Code PR #346825](https://github.com/microsoft/vscode/pull/346825) | `GET https://api.github.com/repos/microsoft/vscode/pulls/346825` | 200，PR已合并；远程更新时间2026-11-08T11:12:15Z |

使用实际安装的Windows Chrome、新建临时配置和CDP临时加载dist；**不是原用户库，也不是Mock响应**。Playwright仅准备合成项目/任务、限定可访问的两个GET端点及读取计数；未替换permissions/fetch/响应。其余HTTP(S)被拦截，不读取用户配置、凭据或账本。

窗口明确标为“IdeaClip 0.1.5 公开样本隔离验收”，句柄66916696。Windows-MCP截图定位后点击“刷新 GitHub 状态”，观察原生api.github.com提示并正常点击允许。一次刷新实际发出上述两个GET，均无Authorization、返回200；页面19:55:04显示Issue开启、PR已合并及各自最近成功时间。合成任务仍待处理、人工验收仍待开发；正式任务关联未覆盖。

在这个隔离页面使用Playwright本地时钟推进15分钟，Windows-MCP截图见到过期提示与历史快照，两请求计数不增；**模拟时钟不等于等待真实15分钟，也没有改Windows系统时间或真实数据库时间**。随后Windows-MCP实际关闭测试标签并重开，点击隔离项目查看，结果仍保留，页面继续按隔离时钟显示历史快照，请求仍为2。只关闭本次新建的隔离Chrome，原Chrome保留。

### 本机证据与未验证范围

局部Windows-MCP截图位于仓库下`test-results-native/0.1.5-real/`，均被Git忽略、不上传：

1. `01-original-version.png`：原扩展0.1.5。
2. `02-original-expired.png`：旧快照真实时间已过期，旧任务/验收仍在。
3. `03-original-fresh.png`、`04-original-reopened.png`：原Commit刷新与重开。
4. `05-isolated-native-permission.png`：隔离Chrome原生api.github.com提示。
5. `06-public-issue-pr.png`：真实公开Issue开启、PR已合并。
6. `07-isolated-clock-expired.png`：隔离模拟时钟到期后的页面。
7. `08-public-reopened.png`：隔离公开快照重开保留。`live-summary.json`仅包含两个公开GET及状态/测试边界，无凭据。

未取得真实API证据的场景：Issue关闭、PR草稿/普通开启/未合并关闭、Issue接口实际返回PR、401/403/404/429/超时及304；本轮这些**仅Mock验证**。原浏览器整进程退出重启、真实墙钟15分钟连续等待未执行；本轮是页面关闭重开与隔离时钟边界验证。没有将隔离CDP安装称为原用户安装验收。

未调用Brave/DeepSeek或任何付费API，无GitHub写操作；没有更改服务器、SSH、8788/23334服务或费用历史。完成后两端口仍在127.0.0.1监听。源码差异、暂存文件和忽略规则检查后，仅将代码、测试和文档提交IdeaClip main，正常推送。

协议依据：[GitHub REST最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)，包括串行请求、条件GET、限流及私有资源404歧义。无Token的304不承诺免计入GitHub限额。

# 0.1.6 Codex开发交付检查验收

日期：2026-11-09。基线：f1424b987002d848ba2d0fb01f9e05da99ab8f80（0.1.5）。

## 实现与安全边界

- 应用、package-lock、Manifest统一0.1.6；新增delivery.ts/DeliveryCheck.tsx及测试，接入原任务卡片/校验/ZIP白名单。没有新增依赖、Dexie表/索引或数据库版本迁移；旧任务缺省无新字段。
- 当前任务关联Commit或PR后才有“检查开发成果”。匿名官方GET核对仓库归属、完整SHA、PR编号/base仓库/head SHA及前后更新时间，读取文件/新增删除统计和Check Runs、旧式Commit Status；不读patch、评论或任意远程URL，不下载执行仓库代码。
- 固定API路径，Link仅判断是否有下一页，不跟随上游提供URL。文件最多300条，Check Runs200条、旧式Status100条，单次最多16个GET；每请求10秒、2MiB UTF-8响应，60秒重复检查冷却，共享原GitHub限流存储/Web Lock。401/403/404/429/超时/格式/归属异常安全分类，限流不自动重试；404不推断私有对象不存在。
- PR的CI是其head SHA检查，不代表合并后的主干CI。失败、进行中、未发现CI、无法读取、不完整、跳过/中性结论与全部明确通过分别显示；没有CI不判测试失败或通过。
- 范围只对照显式workspace仓库和相对路径/子路径，改名核对新旧路径。无绑定/仓库不符/缺少旧文件名显示无法判断；不猜测目录、不读取本机文件。已取远程文件不能证明本地测试运行；始终提示未取得本地日志。
- 快照含来源/最近查询/最近成功时间。失败保留旧快照且标为历史；超过15分钟本地提示过期（新交付模块每10秒复查及焦点校正），无网络轮询。ZIP只导出allowlist、脱敏摘要/文件/检查名，恢复强制historical并清除限流状态，不导出workspace、凭据或授权。
- 刷新事务仅写当前任务deliveryCheck和项目revision，不改关联、人工验收、看板、阶段或费用。关联/工作区并发变化拒绝写回。复制验收摘要只写剪贴板，人工入口仅打开原编辑表单。

接口依据：[Commit接口](https://docs.github.com/en/rest/commits/commits#get-a-commit)、[PR文件](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)、[Check Runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)、[旧式状态](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference)。本实现主动使用比GitHub服务端更小的分页上限。

## 自动化测试

- `npm run typecheck`、`npm run build`通过；Manifest/入口/网络限制检查通过。既有主包超过500kB警告保留。
- 全量单元：35文件，660项通过、1项跳过。命令：`npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`。跳过唯一独占8788的Windows真实启停用例，不干预用户研究服务。
- 新增28项交付单元覆盖：Commit/PR/完整SHA、跨仓库与错误head、文件越界/改名、范围未知、各种CI/Status、无CI/读取失败、PR变化、分页截断/不跟随Link、401/403/404/429/500、断网/超时/非法JSON/UTF-8/2MiB、限流/冷却、过期、事务竞态、旧任务、ZIP往返历史及不改变原验收/完成。
- Chrome Mock：初轮51/51，补充PR用例后相关2/2通过；最终相关六个文件52/52通过（test-results/0.1.6-final/）；最后摘要关联边界修正后新增模块2/2复测通过（test-results/0.1.6-summary-final/），重复执行不累加为新用例。覆盖GitHub、指令、AI/研究向导、项目、ZIP等。所有搜索与AI请求Mock或拦截，不调用付费接口。

## 真实Windows-MCP与GitHub API

### 原用户Chrome

- Windows-MCP ControlStatus、App、Snapshot/UI Automation、Screenshot、Click、Type、Scroll、Shortcut实际可用。最初外部Chrome工作流切换焦点，随后持续USER_CONTROL；停止输入，用户确认可保持空闲后等待控制状态ready才继续，没有抢占或修改协调保护。
- 在原Default/Shimmer用户配置的新验收窗口操作原扩展，详情页核对原ID及dist加载路径，点击原“重新加载”，版本0.1.5→0.1.6；没有卸载、清空或拿临时配置替代原库。窗口句柄333950，重开后465022。
- 原“验收 IdeaClip GitHub Commit 关联与人工验收功能”任务、SHA 03d85d9819a2510df42839bdb25012f5bbc2530d、关联时间2026/11/8 18:16:07、验收通过、已完成、1/1及100%保留。旧状态查询19:51:32历史也未被改写；状态刷新与开发交付检查使用各自时间快照。
- MCP点击“检查开发成果”，沿用原api.github.com权限，未读取Token。2026/11/9 08:00:48真实返回完整SHA、提交摘要和18个文件（新增5、删除0、其余修改13），+280/-16，列表完整；与本地git show该提交统计一致。文件明细显示AGENTS.md、README.md、src/incubation等真实路径。
- 此提交的Check Runs与Status均未发现记录，显示“未配置 CI（未发现检查）”，不冒充失败或通过。原项目未绑定有效工作区，范围显示“无法判断”；未为造通过修改真实绑定。
- MCP点击复制摘要，界面确认“验收摘要已复制；未执行命令”。关闭本轮新开的验收窗口并从原配置重开同一项目，再展开模块，原08:00:48时间、SHA、统计、CI结论及人工验收状态均保留，未再次请求。最后摘要边界修正构建后又MCP刷新页面，确认本地快照与验收通过仍保留。

### 真实公开CI（独立配置，不是Mock）

- 匿名CLI只读预检选定[VS Code PR #346825](https://github.com/microsoft/vscode/pull/346825)，head c9d93d4651f99b1f9394ef406fb94bc5b3cce774，10个文件。没有创建任何远程对象或覆盖用户正式关联。
- Playwright只在隔离临时用户配置准备合成项目/PR任务，并限定网络为该公开仓库的官方GET（其余HTTP/S拦截）；没有替换fetch、响应或Chrome权限。准备后请求数为0。Windows-MCP识别明确标题“IdeaClip 0.1.6 公开CI隔离验收”（句柄3545112），按真实截图点击检查按钮和api.github.com原生“允许”。
- 08:06:14扩展真实返回同head SHA、PR摘要、10个修改文件、+594/-144，文件完整。Check Runs为53项，CLI预检37成功/16跳过；模块显示“有跳过或无明确结论的检查”，失败0/进行中0。MCP展开明细，能见VS Code PR Check、PR Gate、Windows/Remote等通过及Cancel Run等跳过；未把跳过算全部通过。
- 读取可见结果的辅助脚本因等待错误的文本定位器而超时，临时Chrome随内核重置关闭；这不是产品错误，也不算原用户Chrome正常退出重启验收。重新打开同临时配置并加载同扩展后，从已保存项目读取，08:06:14快照、文件/CI与0/1进度保留，全部网络拦截计数0。MCP再次展开文件/CI并截图，未重查GitHub、未修改原用户库。关闭本轮临时配置，原用户IdeaClip窗口保留。

### 脱敏实机截图

仅本机：`test-results-native/0.1.6-real/`（Git忽略，未上传）。

- 01-version.png：原扩展0.1.6和ID。
- 02-original-files.png：原提交完整SHA、18文件、范围未知与无CI。
- 03-original-reopened.png：关闭重开后的时间/统计和人工验收通过。
- 04-public-permission.png：隔离配置api.github.com原生权限。
- 05-public-ci.png、06-public-ci-details.png、07-public-files.png：真实公开PR、53检查及10文件，均在同临时配置重开后记录。

截图仅裁剪IdeaClip窗口相关区域，无私人笔记、密钥或浏览器全标签栏。Mock截图保存在test-results各轮目录，与实机分开。

## 遗留边界

- 私有资源不配置Token，不绕过授权；真实错误/限流/超时不通过破坏用户关联或权限制造，保留Mock证据。
- 文件/CI超过上限只显示有限快照及明确不完整提示。不同CI平台的外部日志、Checks输出、工作区实际文件和本地运行日志不读取；不自动决定验收。
- 未调用Brave/DeepSeek/其他付费接口，未操作服务器、SSH、系统网络、8788/23334或费用账本。截图及测试产物仅本机忽略目录，不提交私人浏览器数据。

真实失败CI、进行中CI、限流/断网/401/403/404/超时、超大分页及ZIP破坏性恢复均仅Mock/隔离单元验证，不在用户库制造错误。原Chrome完全退出重启、本机日志真实性核验、私有资源及外部CI日志仍未验收。提交SHA以承载本文档的Git提交为准，避免自引用伪造SHA。

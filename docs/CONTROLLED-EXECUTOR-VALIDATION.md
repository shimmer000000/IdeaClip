# 0.2.2 受控执行器验收

日期：2026-11-09；基线：`fb1a09546fbe9b5b725f4b1a71c84ecc98471aa3`。

## 实际环境与安全判定

- Windows 10专业版10.0.19045 x64，Node v24.22.0。
- 只读CIM：`Microsoft-Hyper-V-All` InstallState=2（禁用）；未枚举到Sandbox功能，`C:\Windows\System32\WindowsSandbox.exe`不存在。没有启用系统功能、改ACL/网络或提权。
- Node本机帮助提供`--permission`与文件/子进程/Worker权限开关，未发现`--allow-net`。不以当前源码主分支的网络权限能力推断本机支持。
- 对明确已安装桌面Codex可执行文件仅查询`--version`及`help exec`：`codex-cli 0.167.0-alpha.3.2`，`--cd/--sandbox/--json`存在。不传开发任务，不查凭据、不运行真实`codex exec`。
- **真实Codex运行隔离未通过，入口固定阻塞。** 固定WASM能力测试通过只证明该合成来宾没有获授越界/主机读取/网络/进程能力，不证明普通Node进程或Codex有OS沙箱。

## 自动化结果

类型检查、生产构建通过（保留既有主包>500KiB提示）。全量单元823通过、1跳过（42文件）；固定合成执行器17项通过，门禁/本地预检/执行器最终专项57项通过。相关Chrome回归60项通过，固定Node子进程切换后的交接专项7项通过，最终发布复测7项通过。新增专项覆盖：未授权/JSON伪造/跨实例拒绝、单次消费、包/Git变化、越界能力运行时拒绝、合成文件写入、子进程超时/取消/异常终止、结果绑定及不自动重试。初版采用Worker线程；为覆盖真实进程异常退出与取消，最终改为固定Node子进程，已对受影响57项及7项Chrome用例复测。范围外能力在固定WASM运行时拒绝，主机canary保持原内容，唯一合成写入为docs/result.txt；未读取真实主目录、SSH、浏览器数据，也未调用模型。

原0.2.1测试继续覆盖目录/范围、版本/期限及不改变人工状态，原ZIP和旧项目回归保留。

初轮发现的两项测试问题已修复：取消预检后只读Git仍可能占用合成目录，清理现在等待本实例的只读探测结束；路径联接样本原先放在不属于允许范围的兄弟路径，改为实际允许的目标路径后验证拒绝。没有放宽路径规则或为通过测试变更系统权限。

## Windows-MCP原Chrome

Windows-MCP ControlStatus曾为USER_CONTROL，因此先只开发/测试，空闲后返回ready。使用原有“灵感库 · IdeaClip - Google Chrome”窗口（handle1454618），核对原dist目录，通过扩展详情“重新加载”取得实际0.2.2；没有卸载或清空数据。Playwright仅操作自己的隔离配置，与原窗口分开。

实际操作App/Snapshot/Screenshot/Shortcut/Type/Click/Scroll：打开原交接中心，点击“检查真实执行安全门禁（不启动）”显示REAL_EXECUTOR_DISABLED；旧0.1.8合成任务包、交接时间、已导入v3交付记录仍在，人工状态仍“待开发”、看板todo。点击未授权“运行一次Mock”显示AUTH_REQUIRED。页面刷新后旧任务包仍在、内存阻塞检查提示清空，没有发出真实执行请求。没有重做已通过的原生文件选择或导入，不新增/修改用户任务。单次/重复/过期/取消完整流程由Playwright隔离样本及本地专项覆盖，本次不冒称原Chrome重复了全部用例。

四张脱敏局部截图实际保存在忽略目录`test-results-native/0.2.2-real/`：version.png、blocked.png、old-task-state.png、unauthorized.png。旧交付另有屏幕观察证据，未将私人原浏览器配置/数据库/截图上传。Playwright Trace和样本下载分别在`test-results/0.2.2-regression`与`test-results/0.2.2-release-final`。

不得将上述原ChromeUI、本地固定合成进程或Chrome Mock结果称作真实Codex模型/Windows OS沙箱验收通过。

## 边界及未完成事项

- 真实任务执行、真实授权签发、OS隔离部署及付费模型调用均未进行，也不会因本次开发授权开启。
- 合成程序固定且不接受用户代码；WASM宿主本身受信任。宿主被篡改、管理员和引擎漏洞不在本版保护承诺内；静态扫描/事后审计不替代运行期间边界。
- Git worktree仍安全拒绝。没有新增数据库/ZIP字段，不导出执行许可；合成结果不自动成为交付或人工验收。
- 既有8788/23334服务与账本不变；涉及真实固定8788启停的单元用例按原策略隔离跳过，其他回归照常执行。
- 后续真实执行预览必须明确目标合成仓库、ID、范围、隔离方式、可能模型用量、权限与失败策略；当前未满足OS边界，即使用户批准也不能直接运行，须先另行部署并验收隔离。

## 下一次真实执行预览（不授权）

本机仅创建了一份未执行的临时合成候选，任务ID `1d39a929-5d38-49c6-804a-98c49facb280`，允许相对路径仅`docs/result.txt`。脱敏公开记录不保存本机绝对路径；完整本机预览留在忽略文件`private/next-execution-0.2.2.json`，包含项目/包ID与哈希、main分支及HEAD，authorized=false、launchable=false。候选remote指向IdeaClip仅供格式/绑定测试，不代表新建GitHub仓库，不得推送。

当前只有固定WASM合成能力隔离；真实Codex需先部署并独立验收OS级文件/网络隔离，不能拿Mock能力声明授权。未来模型可能联网并产生用量，模型/费用尚未配置或批准；权限仅限合成目录普通用户，不能访问主目录、其他项目或执行Git推送/部署。失败须终止、保留记录、烧毁授权、不自动重试。当前停在预览，等待下一阶段明确批准；本次没有调用真实Codex开发模型、DeepSeek或Brave。

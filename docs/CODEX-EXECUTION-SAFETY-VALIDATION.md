# 0.2.1 单次授权与安全预检验收

日期2026-11-09；基线`81237aa422d852e7bbde7cf71d77108a83ff9ca7`。最终Commit为包含本文的发布提交，不在正文伪造自身SHA。

## 交付范围

新增独立本地预检、当前任务浏览器Mock预演、进程内一次性授权和固定计时器Mock执行。包v1/报告v2/数据库schema14/ZIP6不变，无数据迁移、持久授权、后台服务、付费请求或Agent Autoloop。

授权从独立确认产生，不接受包内同意字段；私有对象身份与完整快照绑定，复制JSON无效。默认2分钟、最多5分钟，墙钟与单调时钟共同校验；消费先烧毁，取消、失败、超时和快照变化不重试。当前没有真实任务执行器或可用于启动Codex的授权。

## 实际环境与本地检查

- Node.js24.22.0，现有Playwright Test1.65.0；没有新增依赖或Playwright MCP。
- `codex` npm入口显示0.165.0；明确指定的桌面配套`codex.exe`实际探测为`codex-cli 0.167.0-alpha.3.2`。通过其`--version`与`help exec`读取支持的`--cd / --sandbox / --json`。只启动过这些短暂元数据查询，未启动Codex任务、传递开发提示词或调用付费模型；不能把本轮表述为操作系统中从未出现任何Codex进程。
- 对原有明确标注“不执行产品开发”的隔离验收包进行真实本地预检：项目/任务/仓库/目录/范围匹配，branch main，HEAD为本轮基线，dirty=true、conflicts=false、CLI支持参数；返回`GIT_DIRTY`，真实执行授权false，未授权Mock或真实开发。
- worktree只在`test-results/assistant-workspaces/isolated-*`新建合成Git仓库中创建、检查、清理。文件型`.git`安全拒绝，无对原工作区的worktree创建、修复或切分支。
- 允许目录子级联接、穿越、嵌套仓库、特殊路径及扫描深度超限均安全拒绝；扫描≤2000节点、相对所选目录深度≤16，不跟随链接。

## 自动化结果

|检查|结果|
|---|---|
|类型检查|通过，包含测试引用的Node工具|
|全量单元|41个文件，806通过、1跳过，共807项|
|新增授权/本地预检专项|40通过；真实隔离Git与Mock CLI，覆盖ID/包/目录/范围/分支变化、脏目录、合并冲突、worktree拒绝、子级联接、深度上限、授权伪造/跨实例/并发、过期/时钟回退、取消/超时/失败不重试|
|生产构建|通过，仍有原主包超过500kB提示|
|11个相关Chrome回归文件|59通过，全部搜索/AI/GitHub接口为Mock|
|最终交接专项复测|6通过，包含授权完整流程与0.1.8–0.2.0交接兼容|

全量命令：`npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\\.1真实启停)'`。只跳过固定8788真实启停用例，保护用户服务，不声称该项通过。

Playwright使用独立临时Chrome，实际创建合成任务、下载包、检查当前导出绑定、未授权拒绝、脏状态阻塞、独立确认、单次消费、重复拒绝、HEAD变化、过期、失败、超时、取消及关闭重开授权清除；断言零外发、人工验收/看板不变。其他相关回归保留旧项目、交付、GitHub、研究和ZIP恢复验证，未将Mock称为真实远程API通过。

本轮修正的测试问题：合并冲突样本最初因缺少提交身份未真正进入冲突，改为仅该测试命令传入合成身份，不改全局Git配置；真实Windows Git多轮读取的测试上限设为20秒，产品授权有效期和Mock执行上限未因此放宽。最后补上范围目录内部链接扫描、消费前预检的取消/超时和单调时钟过期检查后复测通过。

隔离产物仅本地：`test-results/0.2.1-regression/`及`test-results/0.2.1-final/`，Trace、下载包及截图均忽略不提交。

## Windows-MCP 原Chrome验收

使用`ControlStatus / App / Snapshot / Screenshot / Shortcut / Type / Click / Scroll`。先取得ready，再仅恢复唯一IdeaClip窗口handle1454618；Playwright所有context已关闭。每步读取目标/焦点，按当前UIA或原生文件框局部截图操作，未切入其他项目。

1. 扩展管理页核对原ID`amodmncmpdbgdhdfdlfliaodpmcnkkao`和本项目dist，重新加载后实际版本0.2.1，未卸载/清数据。
2. 原0.1.8隔离验收项目、包与0.2.0的v3交付历史仍在。只在该已标注合成任务中测试，未修改正式业务任务。
3. 不选包、不授权先点运行，返回`AUTH_REQUIRED`。
4. 使用真实Windows文件选择器选取该任务此前已导出的包，当前审核和已知导出历史校验通过。预览显示当前项目/任务/仓库/目录/范围/哈希，Git与CLI明确为Mock，真实执行未授权。
5. 明确勾选仅本次Mock并授予授权，界面显示2分钟内可消费一次。运行成功显示“授权已消费、实际Codex启动否、实际命令执行否”；第二次运行同一授权返回`AUTH_USED`。
6. 人工验收仍待开发、看板todo；没有追加真实开发结果或自动完成记录。
7. 页面重新载入后旧v3历史仍在，当前授权未取得、文件选择未恢复；再次运行返回`AUTH_REQUIRED`。页面重载是本轮原Chrome实际验证，完整关闭重开另由隔离Playwright验证。

7张脱敏原生截图仅本地`test-results-native/0.2.1-real/`：`version.png / unauthorized.png / preview.png / consumed.png / reuse-rejected.png / review.png / session-cleared.png`。没有上传用户截图、数据库、密钥或本机私有文件。

## 遗留边界

- 真实Codex任务执行没有实现、没有验收；当前授权仅Mock，不能据此开启真实执行或付费操作。操作系统中其他用户工作流的Codex进程未枚举为本轮证据；Mock实现本身无进程启动能力。
- 浏览器没有Git/CLI访问桥接，不把Mock预览冒充本地真实预检。CLI的TTY确认入口没有通过Windows原生终端操作验收；核心确认/单次消费由单元、Playwright和原Chrome实际界面分别验证。
- Git worktree继续保守拒绝；真实ACL拒绝未制造。当前门禁不是跨进程密码学授权或运行时沙箱，不防同权限恶意代码/管理员/并发文件系统攻击。
- 没有持久授权、自动续期、恢复执行或JSON授权导入；旧数据/ZIP兼容保持原结构。没有改变SSH、8788/23334、服务器、其他项目或费用历史。

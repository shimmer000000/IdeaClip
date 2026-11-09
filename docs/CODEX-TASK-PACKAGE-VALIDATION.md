# IdeaClip 0.1.8 本地Codex交接验收

## 实现范围

仅IdeaClip：任务包v1、预览/安全提示/人工确认下载、已交接声明、只读文件校验、交付v2关联、历史与ZIP兼容。沿用单任务类型/工作区/范围/审核和0.1.7报告机制，不新增依赖或主机权限，不重写AI/GitHub引擎。

不安装、不启动、不调用、不修改Agent Autoloop；不开发后台执行器或调度协议，不执行JSON里的命令。本轮真实业务开发不通过任务包自动运行，交接验收使用明确标注的合成Mock结果。

任务包SHA-256覆盖整个外层及任务内容（除自身哈希），只证明完整性；还需核对当前审核快照与已知本机导出历史。原任务与人工验收状态不受导出/交接/导入影响。完整格式和限制见[协议](CODEX-TASK-PACKAGE.md)。

## 自动化

新增类型/审核/仓库/工作目录/范围/验收标准门禁、唯一ID/规范哈希、篡改与重算哈希拒绝、未知/旧任务、预览失效、历史上限、关联结果/旧v1、ZIP历史与隐私、Schema和事务内复查测试。

2026-11-09实际执行结果：

- 类型检查与生产构建通过（`npm run build`包含TypeScript检查）。
- 全套单元测试：37个文件，723项通过，1项跳过。运行`npm test -- --maxWorkers=1 --testNamePattern "^(?!.*Windows PowerShell5\.1真实启停)"`，仅跳过占用固定8788端口的Windows启停测试，未停止用户服务。
- 新增任务包单元测试29项通过，覆盖类型/审核、事务竞争、哈希、重算哈希、超限、旧v1兼容、关联v2、ZIP隐私及公开Schema。
- 相关Chrome Mock回归55项通过：任务包、本地证据、GitHub交付/同步/任务、任务指令、AI和联网研究。全部接口使用Mock，未调用付费服务。
- 最后增加项目标题绑定失效保护后，重新运行29项专项单测、类型/生产构建及2项任务包Chrome测试，均通过。

Chrome测试命令：`npm run test:e2e -- tests/browser/task-package.spec.ts tests/browser/local-evidence.spec.ts tests/browser/github-delivery.spec.ts tests/browser/github-sync.spec.ts tests/browser/github-tasks.spec.ts tests/browser/task-instructions.spec.ts tests/browser/ai.spec.ts tests/browser/online-research.spec.ts --output=test-results/0.1.8-regression`。

## Windows-MCP实际验收与证据边界

使用Windows-MCP的ControlStatus、Snapshot/UI Automation、App、Click、Type、Scroll、Shortcut、Screenshot。原Chrome Default配置、原IdeaClip扩展未卸载，详情页重载后确认版本0.1.8及原加载目录；原0.1.7项目和原GitHub验收任务仍出现在列表和总览中。只新增本轮独立验收项目及一条软件开发类型任务，绑定IdeaClip仓库和单一`docs/CODEX-TASK-PACKAGE-VALIDATION.md`路径，未执行真实产品开发。

实机通过：

1. 未勾选任务审核时，导出显示“任务尚未完成审核，禁止导出”。
2. 明确审核后显示当前仓库、工作目录、受限路径、唯一ID、生成时间及SHA-256；未勾选导出确认不能下载。
3. 主动勾选后下载实际JSON文件（8986字节），本地核对文件存在；正确文件只读校验成功。
4. 用该导出文件构造隔离坏样本：错误仓库、范围外路径（两者重新计算合法哈希）均被当前审核快照拒绝；修改目标但保留原哈希被SHA-256校验拒绝。上述文件均未触发命令或联网。
5. 人工记录本地Mock交接后显示“已交接（仅人工记录）”；使用原生文件选择器导入关联同一包ID/哈希的合成v2交付报告，显示“结果已导入（未自动验收）”。报告明确没有执行产品开发或测试，Commit仅为已知基线的声明，未冒充本轮新提交或远程核验。
6. 任务ID、仓库和关联哈希与导出文件一致；人工验收仍为“待开发”，任务仍“待处理”，进度0/1。未测试、未核实GitHub和本地证据限制正常显示。
7. 关闭仅本次新开的测试标签页，再用原Default配置重开同一项目；交接历史、报告版本与关联保留，人工验收和任务状态未变化。

期间一次前台被其他工作流切换，检测后停止输入，重新读取唯一IdeaClip Chrome窗口并切回核实，再继续；未关闭其他项目或取消控制保护。没有把Mock交付结果称为真实开发完成，未运行GitHub远程刷新或任何付费接口。

12张局部脱敏截图仅存本地`test-results-native/0.1.8-real/`：版本、未审核、预览、下载、正确校验、错误仓库、越界、篡改、导入结果、报告证据、重开状态、重开证据。任务包及合成结果放本机忽略目录`private/task-package-0.1.8/`，不提交本机工作目录、截图、密钥、配置或用户笔记。全程不接触8788/23334、SSH、服务器、费用账本，不调用DeepSeek/Brave或其他付费接口。

## 遗留限制

本地文件交接，不探测Codex是否收到或执行；哈希不是签名或执行许可。普通ZIP只恢复交接历史，不能恢复可执行绑定。最多10包拒绝超限，暂不提供包历史删除。构建既有的大包体积提示保留，未以此扩大业务范围。

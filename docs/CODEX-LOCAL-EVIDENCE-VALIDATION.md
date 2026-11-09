# 0.1.7 Codex本地交付证据验收

## 边界与格式

新增任务可选的`localDeliveries`，不增加Dexie表或索引，继续schema14/ZIP6。旧任务无此字段正常使用；导入只更新证据与项目revision，不改变GitHub关联、指令审核、人工验收、看板、研究数据或账本。

任务卡片提供“导入Codex交付报告”“核对本地测试记录”和“复制完整验收摘要”。报告是Codex声明；核对是两个本机文件的字段与日志SHA-256一致性，**不是第三方执行认证**。GitHub官方查询、CI与人工结论仍单独显示。没有workspace则明确范围未知，不猜测；已有范围外文件拒绝。Commit或完整文件清单与最新GitHub快照不一致时显示冲突。旧/失败快照不能证明最新提交。

`docs/CODEX-DELIVERY.schema.json`是标准JSON Schema；扩展采用静态受限字段验证及语义约束，不在MV3内编译或执行Schema。UTF-8 JSON，128KiB上限，拒绝额外字段。报告必填：

- `format=IdeaClipCodexDelivery`、`schemaVersion=1`、UUID `reportId/projectId/taskId`。
- 规范GitHub HTTPS仓库、40位小写Commit SHA、summary≤2000字符、files≤300条相对路径。禁止绝对路径、反斜线、遍历段、通配或变量展开。
- tests≤20条，每条UUID、command≤512、status passed/failed、exitCode整数或null、startedAt/finishedAt为毫秒UTC ISO、durationMs≤一天且等于时间差、logExcerpt≤2000、logSha256为64位小写SHA-256。passed必须exit=0；failed不得exit=0。
- notRun≤20条command/reason；risks≤20条每条500字符；generatedAt不得早于测试结束；localRecordId为UUID或null。

每任务最多10版。重复reportId同一文件去重；同ID不同内容拒绝，新ID追加版本，绝不静默覆盖。未知项目/任务、跨仓库及已知越界拒绝。导入失败原记录保留。命令/链接只显示文本，导入不执行、不联网、不请求付费模型。

本地记录为`IdeaClipLocalTestRecord` v1，512KiB上限，recordId、仓库、Commit、tree SHA、同构tests、每测试≤16384字符的脱敏有界logs、生成时间。核对逐项测试/退出码/时间、每段日志哈希及摘录连续包含关系；完整日志不写入IndexedDB或ZIP。普通ZIP只存有限脱敏摘要、声明、文件哈希与核对元数据；恢复后报告/核对均为历史，需重新核对。哈希不证明原文件真实性。不同作者可伪造报告和记录，因此无自动通过或完成。

## 本轮真实记录生成

先提交源码，保持Git工作区干净；开发者可运行`node scripts/record-local-evidence.mjs`。该脚本只运行源码内固定的类型检查、单元、构建、Chrome Mock回归命令，拒绝非IdeaClip origin或有未提交变更；记录运行前后Commit/工作树一致性。任何导入文件都不能作为此脚本的命令输入。

输出至已被.gitignore排除的`private/test-evidence/<recordId>/record.json`。记录只保留脱敏日志末尾，退出码/时间来自实际子进程；不补写以前的测试。完成后运行`node scripts/create-delivery-report.mjs <recordId> <projectId> <taskId>`，只接受UUID并从固定本地记录目录生成report.json与wrong-task.json拒绝样本。文件不进入Git/普通ZIP。

独占8788的Windows PowerShell5.1启停用例有意跳过，用户8788/23334服务不停止。DeepSeek/Brave不调用。报告中的未测试项目必须保留原因，不能当作测试通过。

## 自动化结果（2026-11-09）

- 类型检查、生产构建通过；Manifest/静态资源/网络限制检查通过。现有单包大于500kB的构建体积提示仍存在，无构建错误。
- 完整单元：**694通过、1跳过**（36个文件）；新增34项。覆盖严格Schema/ID/仓库/范围、脱敏、版本去重与上限、日志哈希/记录冲突、人工验收独立、编辑保留和ZIP往返。
- 相关Chrome Mock：**53通过**，新增1项原生扩展页面流程。覆盖受限报告、错误任务/越界、记录不一致拒绝、追加版本、复制/重开、GitHub只读、任务指令、AI/研究/孵化/备份既有流程。所有搜索与AI均Mock。
- 固定记录器在干净Commit `c9b920dcb9c72944779b910eb38f101593d6def0`（含功能提交`3c65a7da4f21d5fc43bea51f91e5ed0b562788cf`）上实际执行；四项退出码均0：类型检查807ms、单元26046ms、构建2131ms、Chrome123429ms。记录ID `4a1a28b1-40e3-4799-9e0d-c470f7ec1486`。单元通过固定argv直接调用Vitest，与npm test脚本相同入口，避免Windows cmd拆分含空格的正则参数。
- 记录器首次试运行的单元步骤曾因cmd参数拆分启动失败，确实记录exit=1，未伪装通过；修复后完整重跑并生成上述新记录。失败记录仍在private忽略目录，不修改或冒充历史测试。
- 跳过独占8788的PowerShell5.1真实启停用例；没有停止或改动用户8788/23334、SSH出口或费用账本。真实DeepSeek/Brave不在本阶段测试范围。

## Windows-MCP原Chrome实际验收

使用ControlStatus、App、Snapshot、Screenshot、Scroll、Click、Type、Shortcut完成。通过明确窗口标题、句柄、扩展URL及控件坐标核对焦点；未控制其他项目。隔离Chrome Mock执行时不把其结果计为用户原环境证据。

1. 原Chrome Default配置的IdeaClip扩展ID为`amodmncmpdbgdhdfdlfliaodpmcnkkao`，扩展详情确认加载本项目dist；正常重新加载，实际版本由0.1.6变为**0.1.7**。未卸载、清空数据库或使用空白配置冒充原环境。
2. 原GitHub Commit验收任务的旧Commit、人工“验收通过”、完成1/1及过期的历史查询均保留；未改写该正式测试任务。
3. 单独创建本轮0.1.7证据验收测试项目/验证任务，绑定本仓库与上述被测试Commit；允许范围只设为该Commit实际修改的`scripts/record-local-evidence.mjs`。未执行任何复制指令。
4. Windows原生文件选择窗口导入本轮实际生成的report.json，显示v1、正确项目/任务ID、完整Commit、4项命令/退出码/时间。最初为Codex报告，尚未独立核验。
5. 导入wrong-task.json被拒绝，显示“报告项目ID或任务ID不属于当前任务，未导入”；原v1及其文件哈希保留。
6. 通过第二个原生文件选择窗口读取record.json；四项记录及日志哈希一致，标记“本地证据已核对（文件一致性）”，明确不是第三方执行证明；日志本体不入数据库。
7. “复制完整验收摘要”实际显示已复制、未执行命令；本地记录、未测试原因、限制及人工结论分别保留。
8. 手动点击既有“检查开发成果”，真实GitHub官方匿名GET核实上述Commit和完整1文件清单：modified 1、+2/-2、范围内。Check Runs/Status未发现CI，显示“未配置CI”，不能算测试通过。此GitHub查询为真实接口，未使用Mock或私人Token。
9. 关闭本次验收窗口的页面，重新以原Default配置打开新窗口，报告v1、记录ID/哈希、4项测试及GitHub核实快照均保留。任务仍待处理0/1、开发验收仍待开发，完成按钮不可用；未自动通过或完成。

本轮实机是1组完整流程验收，不将其计入53项Mock数量。实机未逐一制造全部Schema/网络错误；这些边界由单元与隔离Mock验证。未做真实用户数据库的破坏性ZIP替换，ZIP往返在隔离数据库中通过。

脱敏截图仅本地保存于`test-results-native/0.1.7-real/`（Git忽略）：

- 01-version.png：真实扩展0.1.7。
- 02-old-task.png：原任务Commit历史及验收通过保留。
- 03-rejected-task.png：错误任务报告拒绝。
- 04-copy.png：复制提示与人工验收未改变。
- 05-github.png：真实Commit、文件范围及无CI。
- 06-local-check.png：报告/本地记录/GitHub结论分离。
- 07-reopen.png：关闭重开后的4项实际测试记录。
- 08-manual-state.png：重开后人工验收和完成操作仍独立。

本地实际report.json / record.json位于`private/test-evidence/4a1a28b1-40e3-4799-9e0d-c470f7ec1486/`，不进入Git。源码与测试记录绑定上述功能/记录器Commit，后续验收文档提交不伪称已经包含在该记录中。

## 安全与限制

使用React纯文本展示，不加载报告中任何脚本、网页、路径或命令；不用新权限、新依赖或付费API。按字段白名单持久化并移除常见凭据、绝对路径、环境配置和外部链接；脱敏不是任意私人自然语言的识别器，提交者仍必须审阅摘录。报告/记录文件仅本地，真实截图只存忽略目录。

尚无独立受信执行代理/签名验签，文件核对不具备防作者伪造能力；本阶段不开发执行器。超过10版拒绝追加并保留旧证据，暂不提供证据历史清除功能。

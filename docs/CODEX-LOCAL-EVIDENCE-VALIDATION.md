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

## 验收进度

新增34项单元通过；相关53项Chrome Mock回归通过。首轮完整单元692项通过、1项固定端口测试跳过；随后新增2项边界测试通过。固定Commit的完整记录及Windows-MCP原Chrome导入证据将在本节补充，此时不宣称真实导入验收完成。

## 安全与限制

使用React纯文本展示，不加载报告中任何脚本、网页、路径或命令；不用新权限、新依赖或付费API。按字段白名单持久化并移除常见凭据、绝对路径、环境配置和外部链接；脱敏不是任意私人自然语言的识别器，提交者仍必须审阅摘录。报告/记录文件仅本地，真实截图只存忽略目录。

尚无独立受信执行代理/签名验签，文件核对不具备防作者伪造能力；本阶段不开发执行器。超过10版拒绝追加并保留旧证据，暂不提供证据历史清除功能。

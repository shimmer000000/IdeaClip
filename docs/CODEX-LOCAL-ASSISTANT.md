# Codex 本地交接助手 0.2.0

项目内的一次性只读 CLI，复用任务包 v1、交付 v2 的浏览器校验实现与 JSON Schema。没有新依赖、服务端口、后台扫描、Codex启动、付费请求或数据库写入。

## 已核实环境

2026-11-09：Node.js 24.22.0，Codex CLI 0.165.0；通过`codex --version`、`codex --help`检查到交互入口、`exec`和桌面`app`命令，未执行这些任务入口。桌面版进程与26.1103.4239.0安装路径存在。未核实或集成任何自动任务协议、账户授权、后台调度或Agent Autoloop。

工具直接运行需要Node.js 24+、已安装的项目依赖和Git。应用构建自身沿用原Node要求；CLI使用项目现有Ajv，不需要新装依赖或Playwright MCP。

## 明确选择输入

在本仓库运行，路径由用户明确指定，不能从网页/JSON命令推断。以下仅是格式，尖括号不是实际路径：

```text
npm run handoff:local -- --help
npm run handoff:local -- check --package "<任务包绝对路径>" --workspace "<已绑定仓库绝对目录>" --repository "https://github.com/owner/repository"
npm run handoff:local -- collect --package "<任务包绝对路径>" --workspace "<已绑定仓库绝对目录>" --repository "https://github.com/owner/repository" --inbox "<专用交付目录绝对路径>"
```

`--handoff-dir`可替代`--package`。专用目录第一层必须恰有一份`IdeaClip-CodexTask-<UUID>.json`；不读取其他JSON寻找任务包，不递归。目录最多枚举100项、20份JSON，文件128KiB、交付内容合计2MiB。仅本机绝对路径，不接受UNC、路径别名、符号链接或目录联接。

`check`不读取收件箱；`collect`须显式提供`--inbox`。没有`--execute`等选项，未知/重复参数拒绝。JSON中的命令、链接及步骤仅为资料。

## 校验与输出

1. 严格Schema、UTF-8、大小、版本、UUID、时间、固定`executionAuthorized:false`、规范SHA-256及内嵌交付契约。
2. 明确传入的仓库/目录与包匹配；检查真实Git根、origin本地配置与有效URL，不fetch。多origin、URL重写到其他目标、凭据URL、跨仓库拒绝。
3. 检查每层链接/联接；相对范围禁止穿越、通配、`.git`、Windows设备名及尾点/尾空格；检测所选路径上的嵌套仓库。不存在的路径仅校验最近存在祖先，不创建文件。
4. 仅固定Git只读命令，关闭本次Git fsmonitor及可选锁，不执行导入命令。未提交修改保持原样，标记`blocked-uncommitted-changes`。保守拒绝`.git`文件型worktree布局，不自动切换或修复。
5. `collect`核对v2项目/任务/仓库/包ID/包哈希/生成顺序/文件范围及路径链接。重复报告跳过，同ID不同内容整组拒绝。v1仍可在原任务导入，助手不猜测其任务包。

输出`IdeaClipHandoffCheck` v1 JSON到标准输出：ID/哈希、脱敏目标与最多1000字符验收摘要、有限范围、Git核对/脏状态及逐项安全码。不输出绝对工作目录、Git错误正文、日志内容、环境变量或凭据。不写预览文件或账本；顶层拒绝/脏目录/任意候选拒绝退出码2，检查通过退出码0。

执行字段固定为`authorized:false / awaiting-single-use-user-approval / executor:not-implemented`。**没有执行授权的生成、保存或消费接口**。保留单次批准边界，本轮连批准后执行也不支持。以后须对具体任务、仓库和范围另行单次明确批准，文件或校验结果不能替代批准。

SHA-256不证明作者身份、当前审核或测试真实执行。助手不读取浏览器库，不能独立核实导出历史、最新revision或之前导入记录。合法改写报告并重新计算普通文件哈希也不能证明来源真实性；仍需IdeaClip绑定、历史冲突、GitHub及人工联合核验。本地校验不是执行沙箱。

## 返回 IdeaClip

回`Codex任务交接中心 → 本地交付收件箱`，主动选择**原交付v2 JSON**，不是助手预览JSON。扫描、选择有效报告并确认关联，复用0.1.9事务、10分钟预览期限、当前绑定和已导入去重。助手不自动关联、不改变完成/人工验收，也不恢复句柄或执行授权。

CLI不保存扫描及去重历史；跨次扫描可再次看到同一文件，由浏览器已有导入记录最终去重。包和仓库可能在校验后改变，先前预览不能用于后续自动执行。进程内复查包及Git脏状态、文件大小/元数据，但不宣称消除了全部文件系统竞态。

安全码包括`SCHEMA_INVALID`、`REPOSITORY_MISMATCH`、`REMOTE_MISMATCH`、`WORKSPACE_MISMATCH`、`PATH_LINK_REJECTED`、`NESTED_REPOSITORY`、`ACCESS_DENIED`、`DIRECTORY_LIMIT`、`FILE_OUTSIDE_SCOPE`、`PACKAGE_HASH_MISMATCH`、`REPORT_ID_CONFLICT`；其他异常只报`VALIDATION_FAILED`，不转发原错误/私密内容。

## 数据兼容

无Dexie/ZIP迁移，0.1.9记录保持原结构；ZIP继续排除workspace、句柄、密钥和授权。没有修改研究服务、SSH或费用历史。见[专项验收](CODEX-LOCAL-ASSISTANT-VALIDATION.md)。

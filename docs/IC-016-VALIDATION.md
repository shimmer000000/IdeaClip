# IC-016：真实联网研究与 AI 服务联调验收

最新商业研究阶段见 [商业研究验收（进行中）](COMMERCIAL-RESEARCH-VALIDATION.md)：重开来源/任务已验证；公开定价页读取成功，但原正文只保留FAQ，已作静态定价卡片最小修复并通过Mock回归。修复后的真实价格、实际Brave账单和十二栏DeepSeek费用预览尚待用户参与；不将下面历史阶段的待验收或Mock结果扩大为真实模型已通过。

## IC-016C 后续状态（2026-11-07）

以下主体保留IC-016交付时的历史记录。用户后续已确认Brave订阅/Key已准备、Windows服务启动和健康检查成功，首次自行确认的搜索失败；后台当时显示0请求/0消耗不能证明从未抵达Brave。本轮没有再次获得付费授权，未重发。用户已按要求安全停止本地服务，既有账本不变。当前已复现系统DNS地址TCP超时与独立解析TLS成功的差异，新增免费分阶段诊断；详见 [IC-016C诊断](IC-016C-DIAGNOSTICS.md)。IC-016的“Brave未准备”是当时状态，不作为最新状态。

复查AIEngine发现：研究最大输出取用户配置与模板8192的较小值，并不强制最低8192。此前建议提高到8192是降低十二栏JSON截断风险，不应表述为已有硬性下限；README已更正。真实DeepSeek仍待本次资料、Token/费用、剩余预算及明确批准，不能用用户已有配置或Mock成功代替。

IC-016C最终475项单元、生产构建与89项Chrome全量通过；Windows新诊断底层函数复现DNS/安全通过而TCP约10秒超时。保持所有原数据与预留，真实搜索/模型请求仍为0。测试范围、修复与下次单次授权方案以上述IC-016C文档为准，不把网络诊断成功/失败扩大成付费服务商认证结论。

日期：2026-11-07。main 基线 `bd19af8076f6e42d12d575d393f3ba34b3303de8`；已从 origin/main 快进检查，结果为最新。已阅读 AGENTS、README、ROADMAP、IC-014/015 验收和 RESEARCH-PROXY，使用 CodeGraph 检查代理、AIEngine、向导、预算、权限及安全测试。没有重写业务、升级/重置数据库或接触真实用户笔记。

## 验收状态与授权边界

| 范围 | 本轮结果 |
| --- | --- |
| 单元、生产构建、Mock Chrome 回归 | 结果见下文，付费上游全部为本机 Mock。 |
| 三个真实公开来源 | 各一次，经生产 secureGet/参考代理进入独立 Chrome，读取及持久化通过。 |
| Windows 双击打开 | 用户文字确认及截图显示服务窗口，已确认可打开；人工启动/健康/停止的后续反馈待记录。 |
| Windows 启停、loopback、端口保护、免费健康 | 合成凭据的原生 PowerShell 5.1 自动化测试通过；与用户实际点击分别记证。 |
| Brave 真实搜索 | 用户确认未准备 Key；未申请套餐、未调用、未标通过。 |
| DeepSeek 真实研究报告 | 已通过用户设置截图核对模型/端点/单价/预算，已指导提高输出额度；等待精确资料与费用预览及本次批准，尚未请求，未标通过。 |
| 真实公开资料 → 真实 AI → 孵化 | 仅免费采集段有真实上游证据；完整链路只通过 Mock，真实付费链路待批准。 |

沿用用户此前 Chrome 实际使用整体确认，不重复要求安装或相同手动用例；不由此推定 Edge、原生权限、真实付费服务商均已通过。没有读取/输出完整 Key、密码或验证码。用户提供的截图不提交 Git。

## Windows 本地服务

检查 `windows/Start-Research.cmd` 和 `Research-Service.ps1`，本机 Node 为 v24.22.0，符合服务 Node24+要求。开始前 8788 无监听。脚本保留配置校验、端口占用拒绝、不终止其他程序、匿名 stdin 传配置、127.0.0.1 监听、免费鉴权 health、只停止自己子进程、关闭清除密钥和不自动重启。

单元中的 Windows 专项使用合成 Token，不填真实 Brave Key；实际运行系统 Windows PowerShell 5.1，检查 Node/配置、8788 冲突、监听地址、参数不含凭据、免费 health、停止释放端口与窗体构造。启动/健康无上游调用。普通测试 Node 服务使用临时端口；Windows 固定端口检查不会杀占用程序。

电脑操作工具未枚举 PowerShell 托管的 WinForms 窗口，停止尝试坐标操作，由用户操作。用户已确认双击能看到窗口，并提供未启动状态截图：扩展 ID 为空、默认 github.com、自动遮罩代理 Token、Brave 留空。已指导填写自身扩展 ID 和三个精确域名，点击启动、免费检查、安全停止；没有获得后续点击结果前，不将完整人工启停标通过。未修改启动脚本或系统执行策略，没有为验收新增服务/防火墙规则。

## 三个真实免费来源

使用 `tests/browser/research-public.live.ts`，本次显式启用 `IDEACLIP_PUBLIC_VALIDATION=IC-016`。使用生产 `secureGet` 的 DNS/IP 检查、固定连接 IP、TLS 主机核验、精确来源白名单及重定向拒绝。外层仅增加请求硬上限：下列上游各一次，总共三次，重复或额外地址立即拒绝，不重试。

没有 Brave/AI Key、搜索、模型、截图、登录态、浏览历史、其他标签页读取或付费调用。浏览器只允许访问本次本机代理，其他 HTTP(S) 请求拦截；Node 代理从网站读取。用户源 URL 被明确映射为原协议操作，GitHub 固定公开 API 访问不冒充 README 全文。

| 来源 | 类型/读取状态 | 标题、正文及公开时间 | 实际采集时间（UTC） | 规范来源 SHA-256 |
| --- | --- | --- | --- | --- |
| https://github.com/shimmer000000/IdeaClip | github / readable | `shimmer000000/IdeaClip`；251 字符公开元数据；2026-11-06T05:13:00Z 是仓库创建时间，不是文章发布日期。实际请求固定 `api.github.com/repos/shimmer000000/IdeaClip`。 | 2026-11-07T09:30:54.471Z | `b8408c08b0fd28778fada46c9b1174fe6d94c60c3992a395fce7a30dee97d30f` |
| https://obsidian.md/ | webpage / readable | `Obsidian - Sharpen your thinking`；488 字符；未识别公开日期，保持 null。 | 2026-11-07T09:30:56.186Z | `05e440fb4b1b8e04092b2dbd30eb2873bfea05cc5e4be53fbcb0ae8a1c9da329` |
| https://paulgraham.com/ds.html | webpage / partial | `Do Things that Don't Scale`；按 20000 字符上限保存并标 partial，未识别公开日期，保持 null。不声称提取完整文章。 | 2026-11-07T09:30:59.954Z | `f2bdc2724faa9c581aef73bbfe8655508249ce52feffd8b0cf7f7c1fbc1c1892` |

这是插件 `sourceDigest` 对 URL、标题、正文、公开时间、状态的规范摘要，与 IC-014 的独立诊断文本哈希口径不同。摘要只验证保存一致性，不证明来源陈述、市场规模或商业结论真实。

独立 Chrome 流程：合成已保存笔记 → 八步向导 → 编辑调查计划 → 清空搜索词，只填三个 URL → 配置合成代理凭据与精确域名 → 免费健康显示缺少搜索配置且上游 0 请求 → 预览三个操作 → 本次确认 → 采集保存。检查每条来源 Schema、非空摘录、摘录属于正文、规范 SHA-256、采集时间和研究任务记录。模拟勾选来源审核，保存到第6步；没有调用 AI。完全关闭并重开此独立 Chrome 后，来源哈希、向导历史与步骤保持，研究报告仍为0，额外上游请求为0。

该 live 用例的 Chrome 可选域名权限使用仅本机的替身；不得将其当作原生浏览器授权弹窗通过。SSRF 私网/DNS 重绑定/域名混淆/重定向失败场景由原单元及本机 Mock 回归验证，没有以绕过策略方式访问三个网站，没有为负面验收实际探测内网或额外爬取网页。

## Mock 工作流与实际修复

复用现有本机搜索/代理/AI 测试，完整向导用例改为从合成的已保存灵感进入：编辑计划 → 确认联网范围 → Mock 搜索和正文 → 来源审核 → 取消 AI 预览零请求 → 单次确认 → 十二栏中文报告及实际来源 ID/逐字引用检查 → 可编辑项目草稿 → 人工确认创建任务 → 复制中文 Codex 指令。另有三类资料、报告 Markdown 导出、历史、预算、关闭 AI、取消、超时、权限撤销、伪造来源拒绝、ZIP 往返与恢复不执行等回归。

本轮发现的是测试输出目录冲突：首次 Mock 全量运行时并行启动了 live，两者共用 test-results；live 初始化清理目录，导致一个旧重启用例关闭上下文时复制 trace 文件 ENOENT。首次结果为85通过、1失败，不计为全通过。修复 live 配置使用独立 `test-results-live`，加入 .gitignore；之后串行复测。没有为了通过而更改持久化业务或放宽断言。

新增 live 验收用例不属于普通 test:e2e；默认跳过，需要上述精确 opt-in。源码只有合成凭据，不读取环境中的真实搜索/AI Key，不配置搜索服务，允许上游集合固定为三个公开样本。真实来源只执行一次，不为输出目录修复重复抓取。原生 Windows GUI 本轮未发现有证据的业务缺陷，因此未改启动实现。没有新增依赖或扩大扩展权限。

## 测试记录

- `npm test`：新增兼容性测试后23个文件、458项通过；此前456项也已通过。
- `npm run build`：TypeScript、Vite 生产构建、Manifest/资源/默认网络限制检查通过。
- `npm run test`：23个文件、458项再次通过。
- `npm run typecheck`：新增 live 和测试配置调整后通过。
- 真实免费来源 live：1项通过，12.8秒，三个上游请求；只运行一次。
- 取消 opt-in 后同一 live 用例为1项跳过，确认默认不会读取真实来源；不把跳过计为通过。
- Mock 全量串行复测：86项全部通过（4.3分钟），包含此前失败的重启用例与从已保存灵感开始的完整研究向导。没有重试任何真实付费请求。

用户提供 DeepSeek 官方五个文档链接后，已核对模型、价格、Token、限速与Codex接入说明（2026-11-07）。追加2项纯Mock传输测试：非流式保活空行/跨UTF-8分块的中文JSON解析及usage，HTTP429拒绝读取错误正文且只有一次请求。原实现无需改写；新增单元后再次顺序运行458项 → 生产构建 → 458项，全部通过。构建业务产物未发生变化；86项Chrome回归针对相同业务代码完成。

所有浏览器配置、来源全文、临时数据库、截图、trace、ZIP 与诊断文件均留在忽略目录，不上传 GitHub。

## 待批准与遗留

**2026-11-07后续范围更新：**下述“尚未准备Key/真实搜索待批准”为本阶段原始记录。随后用户已在本机配置Brave Key，完成自有SSH出口、Windows与Chrome免费检查，并在查看1次search/0.005 USD预留的预览后另行明确批准执行。结果截图显示任务完成1/1，保存两条摘要来源；其中一条含Not Found，不能作为有效定价证据。本次未读结果正文，实际账单及DeepSeek仍待验收；旧失败任务和原预留保留。详细证据范围见 [SSH出口最新人工验收](SSH-EGRESS-VALIDATION.md#最新进度windows实际验收及单次brave搜索)。不得把这次单次批准延伸为新的付费授权。

Brave：用户尚未准备 Key。已说明这是关键词搜索凭证，与代理 Token、DeepSeek Key 分开；免费 health 及公开 URL 读取不需要它。申请须用户自行在[官方控制台](https://api-dashboard.search.brave.com/documentation/guides/authentication)选套餐/建 Key，不要求把完整 Key 发聊天，不代购。以后真实联调须列出具体关键词、服务、请求数（建议1次）、当时账户单价/估算及额度消耗，逐次批准后执行。认证/额度/空结果及费用记录本轮只有 Mock 证据。

DeepSeek：用户设置截图确认provider为DeepSeek、模型`deepseek-flash`、完整端点`https://api.deepseek.com/chat/completions`、120000ms、max_tokens、输出4096、每日0.10 USD、输入0.30/输出1.20 USD每百万Token。密钥栏为空的占位文字不证明当前凭据有效；没有读取密钥。后续截图已显示输出改为8192及长期风险确认勾选；底部端点授权尚未勾选、保存按钮禁用。已指导用户自行核对官方端点后批准并保存；没有操作原生权限或确认付费。图像能力虽勾选，本轮研究不读取或发送截图。尚未取得修改保存成功或本次调用批准。

模型与端点见[首次调用](https://api-docs.deepseek.com/zh-cn/)，上述USD单价与[英文价格表](https://api-docs.deepseek.com/quick_start/pricing/)的Flash高峰非缓存档一致；[中文表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)以人民币计价，不能直接填入USD字段。非高峰实际价格/缓存/账户账单可能更低，不自动改用户估算配置。[Token文档](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/)的字符比例仅供参考，最终以usage为准，插件仍使用自身保守上界；[限速文档](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit/)说明非流式可能保活空行，已补Mock。未运行[Codex接入文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex/)中的安装或配置命令，未修改用户Codex环境，也不接入其中新增搜索/Fetch服务。

下一步应在现有 AIEngine 生成精确资料预览，展示来源选择、Token上界、最大输出、本次预留 USD 和每日剩余预算，再等待本次明确批准。已有 Key、账户余额、开关开启或“继续准备”均不是收费请求授权；账户用量/余额截图的私人内容不进入Git。真实十二栏 JSON、中文展示、逐字证据、反证、未知假设、保存/重开/Markdown和服务商实际费用仍待验收，不能套用 Mock 通过结果。若真实输出失败，仅记安全错误类型，保留预留，不自动再次计费。

Edge、其他公开站点、动态页面/PDF/重定向页面、原生权限跨重启和 Windows 不同安全策略/DPI未扩大验收。Brave进程内计数重启可重置，仍非账单硬上限。无自动 Codex 执行、GitHub 自动建库、云同步或新业务模块。

本轮交付提交可用 `git log -1 --format=%H -- docs/IC-016-VALIDATION.md` 精确定位；最终 SHA 与推送结果在交付回复中提供，避免将文档内基线当成本轮提交。IC-016 的免费/Mock部分与真实付费待验收项分别记录，不宣称全部真实接口通过。

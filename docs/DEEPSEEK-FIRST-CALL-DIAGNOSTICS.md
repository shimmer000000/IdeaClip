# 首次真实DeepSeek失败诊断

日期：2026-11-07。基线`72494bf2bf84764db5daa41501ca77bddcd57358`；已fetch并核实GitHub main没有领先本地提交，使用CodeGraph追踪AIEngine、transport、研究Schema/证据、用量及报告保存路径。本轮独立测试仅Mock，不读取Key、原始模型响应或私人正文，不重置费用、不停止8788服务。

## 真实操作与只读证据

用户报告已明确批准并手动执行一次真实调用：DeepSeek、`deepseek-flash`、`https://api.deepseek.com/chat/completions`、商业机会研究v2十二栏、输出上限8192、本地预留0.015054 USD。向导停在第6步，提示“分析结果校验或本地处理失败”。这更新了[此前最终确认停点](COMMERCIAL-RESEARCH-VALIDATION.md)，不再声称从未执行真实DeepSeek。

实际用户库的核查依据是用户提供的现有设置/报告历史截图，不是本轮直接读取IndexedDB。浏览器工具此前拒绝访问扩展协议，因此没有用其他浏览器表面、CDP、复制浏览器配置或脚本绕过此限制。

| 界面证据 | 能证明的范围 |
| --- | --- |
| 23:07:42的本地记录 | failed、errorCode=stale、预留0、Token未知；向导历史显示配置变化或确认超过10分钟。不是两次付费调用的证明。 |
| 23:07:49的本地记录 | failed、errorCode=validation、原预留0.015054 USD保留，输入/输出Token未知。 |
| 23:08:12向导历史 | 第6步记录通用校验/本地处理错误。 |
| 研究报告历史 | 用户截图没有新报告按钮，也没有“报告尚未写入数据库/重试保存”提示；界面没有可恢复正文的证据。未宣称直接读取researchReports后确认条数为0。 |
| 服务商时段用量 | 用户控制台截图显示对应23:00–24:00时段1次请求，输入（未命中缓存）3624、输入缓存命中0、输出3856，共7480 Token。与此次模型和时间一致，但没有按request ID将时段统计与本地记录逐条绑定。 |

服务商截图不是该次API响应的usage对象。不能将本地“Token未知”解释为服务商没有返回usage，也不能将其余时段/其他工具的账户总用量归给IdeaClip。不导出控制台截图、账户余额或其他项目用量；本地USD预留不等于服务商CNY实际扣费。

## 已确认的代码缺陷与尚不确定的原因

确认缺陷一：旧AIEngine在研究Schema/来源证据/Markdown完成后才写Token usage。若先校验失败，已经收到的数字用量会随局部completion对象一起丢失，失败记录只剩原预算预留。

确认缺陷二：validateResearchReport原来抛普通Error，来源ID、逐字引用、original改写、版本等不同异常，以及其他本地异常，在外层统一变为validation。旧记录无法追溯具体条目或阶段。无效内层JSON原本有schema码，传输其他异常也可能走通用分支；不能仅凭validation就断言JSON合法或某一条证据必然有错。

可能但尚未证实的真实失败包括：版本/必需栏目/多余字段/条目边界、未知来源ID、quote不是连续逐字子串、original的text与quote不相等、换行/Unicode差异、未采集链接、传输解码/流异常或本地处理异常。输出3856低于8192，不能据此断言达到输出上限；缺少原始finish_reason也不能彻底排除截断。Mock可复现这些失败路径，不代表已经恢复或确认该次真实响应具体违反哪项规则。

[DeepSeek JSON Output文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)要求JSON模式及明确格式提示，并提醒输出可能为空白；这不是对项目十二栏及来源证据真实性的保证。[Chat Completions协议](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)与本轮非流式适配检查分开；未探测付费接口或自动采用文档中的重试建议。

## 报告是否可恢复

旧版本不保存原始模型响应，失败前没有通过UI返回有效待保存报告的证据。目前无法从validation和Token数量恢复正文，也不会拼造替代报告。若其他页面仍有有效待保存报告，应保留该页并只重试本地保存；那不需要再次请求模型。本例截图没有该提示，因此不能承诺恢复。

不能将修复后的安全错误码、Token或阶段回填到旧真实记录；本轮没有修改用户aiUsage、研究来源、researchReports或预算。以后失败的安全元数据会更完整，原无效响应仍不进入日志/ZIP。

## 本轮最小修复

1. 研究报告使用固定白名单安全码，分别识别`research_version/shape/fields/items/kind/text`、`research_source/quote_required/quote_mismatch/original_mismatch/url`及`research_validator`。只输出固定中文解释，不输出模型字段名、Ajv路径、来源ID、摘录或模型正文。
2. 不改变十二栏结构，不放宽额外字段、长度、条目数量、来源ID、连续逐字quote或original严格相等检查。Unicode规范等价、空白折叠或拼接摘录仍拒绝；八栏旧报告继续可读。
3. 在模型完成返回后、报告校验前记录有界数字usage。失败保留该数字、原预留、安全码及阶段，不保存请求/响应正文。新可选errorStage/responseReceived/reportSaved字段不建新表、不迁移或回填旧记录；普通ZIP仍排除账本。
4. 区分响应流读取、UTF-8、外层JSON、模型内层JSON、明确length截断、Schema、证据、校验器运行异常、格式化与本地保存。已解析响应随后被拒绝时仍可保留数字usage；不能判定的异常保留local_processing和已知阶段，不猜测模型原因。
5. 提示词明确十二栏英文键、每栏1–8条、四个字段、text/quote上限；sourceId不能误用studyId/runId或网址，original text必须与quote完全相同，中文概述应使用claim配原语言quote，无证据使用hypothesis/inference且双null。反证不足也要保留栏目，不编造证据。
6. 有效报告仅本地保存失败时保留AnalysisResult及待保存提示，记录reportSaved=false；重复本地save不再请求模型，成功后标已保存。设置页显示安全阶段、是否取得完整响应及报告保存状态；旧validation明确标记不能反推原因。

未新增依赖、网络接口、自动修复/自动重试、服务商探测或执行授权。Key、端点、TLS、无重定向、预算、开关、来源快照及任务门禁保持。没有触碰服务器、SSH出口、8788真实进程或系统网络。

## 自动化与安全检查

- 新增29个独立Mock用例：十二栏有效/无效、缺失/多余字段、条目/长度、来源/quote、Unicode/换行、original改写、伪造链接、预算/开关/快照、usage写入失败、原预留保留、本地保存与不重复请求、UTF-8/流/外层JSON/截断和校验器异常。
- `npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`：28文件、537通过、1跳过。
- `npm run build`：TypeScript、生产构建、Manifest/资源/网络限制检查通过。仍有既有大于500 kB主包提示。
- `npm run test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`：再次537通过、1跳过。独占8788的用例明确跳过，真实服务始终未停止；其他随机端口及合成配置测试不接触用户数据库。
- `npm run test:e2e -- tests/browser/online-research.spec.ts`：19项Chrome专项通过，约37秒。新增真实Chrome/Mock十二栏失败路径验证安全码、100/200合成usage、向导仍在第6步、报告未保存、重开不自动请求；原预算/权限/Schema/历史/项目/ZIP回归通过。不把专项标为全量浏览器回归。
- 首次单元回归1条旧提示文字断言失败，修正文案保留“逐字”含义后两轮通过；未放宽断言或证据约束。测试没有读取真实Key或调用真实付费服务。

## 下一次真实验收边界

用户在诊断过程中又表示“明确授权可以真实调用”，已记录为愿意进行修复后真实验收。本轮开发/测试仍只Mock，没有利用该表述自动重发旧请求。提示词改变会影响Token和估算费用；旧确认和0.015054 USD不能直接作为新快照。

交付后先重新加载修复版本、打开同一已保存向导，核对现有报告历史与审核来源，再生成新模型/端点/资料/Token/最大输出/费用/剩余预算预览。新金额或资料范围变化须让用户核对后按本次确认执行；仅单次，不自动重试。真实模型是否满足十二栏、逐字证据和保存要求，仍须新的真实返回才能验证，不能由Mock结果宣称已修好该次真实输出。

## 后续截图补充（2026-11-08）

用户提供更新后的第6步截图，错误为research_items，说明至少一栏违反数组及1～8条边界，不能据此确定是反面证据空数组、过量或其他具体栏目。该截图不回溯证明首次validation的同一原因。本轮没有新增真实请求；详情和CSP复现修复见[补充验收](RESEARCH-CSP-ITEMS-VALIDATION.md)。

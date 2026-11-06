# IdeaClip 开源方案技术调研与集成建议

调研日期：2026-11-06。IdeaClip 基线：[`0e7caaa6041dda8b179eb312ba46073d0cec2a79`](https://github.com/shimmer000000/IdeaClip/tree/0e7caaa6041dda8b179eb312ba46073d0cec2a79)。

**本次只读调研，只新增本文件。没有集成代码、安装第三方依赖、执行第三方安装脚本、调用模型、扩大权限、修改数据库或合并第三方仓库。下述建议均未实施，须经项目所有者确认后另行开发和验收。**

## 1. 结论与取舍

1. **保留 IdeaClip 的 IC-007 / IC-008 引擎、预算门禁和持久队列。** 六个项目没有一个可以直接替换它们而同时保留现有的发送确认、未知费用不重试、快照校验与重启保护。适合借鉴的是模块边界和交互，不是换一套框架。
2. **最有价值的近期方向是正文质量评估、段落证据定位和受约束的自定义模板。** `webpage-summary` 的提取策略、Representer 的表单清洗/定位/Skills、Page Assist 的网页问答和本地检索设计值得进一步验证。
3. **Karakeep 是收藏、自动标签、后台处理的成熟产品参考，但架构重且使用 AGPL。** 当前阶段借鉴“保存→提取→分析→索引”的设计，不移植服务端、不直接复制其业务代码。
4. **Magpie 不是可自由商用的普通开源组件。** 当前 LICENSE 明确限制商业用途及企业环境使用；GitHub 显示 `NOASSERTION`。它是源码可用项目，适合阅读公开设计、独立设计相应能力，不能按 MIT 项目复制或改写移植。商业化 IdeaClip 若要使用其受保护代码/素材/文档表达，需要另外取得相应授权。[Magpie 许可证][M-license]、[OSI 开源定义][OSI]
5. **不要更换现有 X 主帖定位。** Page Assist 的 `parseTweet` 按页面匹配顺序收集所有 tweetText，首条当主帖、其余当回复，没有以当前 URL 帖子 ID 精确匹配；它不满足 IdeaClip 的“排除推荐帖、引用帖和无关回复”要求。[X 解析源码][P-twitter]
6. **Summa 更适合参考简洁交互，暂不引入其运行代码。** 主分支一年以上没有提交，旧 SDK/构建链、无可见自动测试、整页 HTML 传递等因素，使迁移成本大于收益。
7. **优先小模块、独立接口和可回退试验。** 推荐顺序：IC-008 原生权限验收及来源质量 → 提取清洗 → 模板/证据 → 用户触发的侧边栏问答 → 标签建议 → 多笔记检索 → 单独授权的深度研究。

文中“更成熟”“风险”“成本”是基于以下静态证据的工程判断，不是安全认证，也不是第三方功能已经在 IdeaClip 中通过测试的结论。

## 2. 调研方法、版本与证据边界

通过 GitHub 只读接口检查六个仓库的元数据、默认分支最近 10 条提交、最新发布、递归文件树、许可证、依赖清单、选定源码、测试与工作流；通过 npm 注册表读取指定版本许可证元数据，没有下载或执行 npm 包。IdeaClip 先更新 main，并使用已有 CodeGraph 索引分析采集、AI、队列、预算、存储和搜索模块。

### 2.1 固定版本快照

以下均为默认分支 `main`；最近提交日期按 GitHub 的 **committer UTC 时间**，不把 `updated_at`、Star 变化或仓库推送时间当作代码维护时间。六个仓库调研时均未归档。

| 项目 | 读取的 main 提交 | 最近 main 提交（UTC） | 最新发布 | 维护判断 |
| --- | --- | --- | --- | --- |
| Karakeep | [`6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316`](https://github.com/karakeep-app/karakeep/commit/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316) | 2026-11-04 07:57:15 | [v0.34.1，2026-10-22](https://github.com/karakeep-app/karakeep/releases/tag/v0.34.1) | 持续维护，最近包含鉴权升级、隐私和容器安全修复 |
| Page Assist | [`593d90a03b0823685353ca53b51fd249f7a63b2a`](https://github.com/n4ze3m/page-assist/commit/593d90a03b0823685353ca53b51fd249f7a63b2a) | 2026-11-01 15:56:18 | [v1.5.90，2026-11-01](https://github.com/n4ze3m/page-assist/releases/tag/v1.5.90) | 持续维护；近期限制 MCP 工具调用循环 |
| Magpie | [`e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd`](https://github.com/astranero/magpie/commit/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd) | 2026-07-31 14:47:29 | 未发现 GitHub Release；扩展清单为 2.0.0 | 功能丰富，但约三个月没有新的 main 提交，长期维护尚不明确 |
| webpage-summary | [`750c6ed29bc5bbb80ab86a10144333f47a591c24`](https://github.com/ctxinf/webpage-summary/commit/750c6ed29bc5bbb80ab86a10144333f47a591c24) | 2026-10-28 12:40:22 | [v0.8.5，2026-10-28](https://github.com/ctxinf/webpage-summary/releases/tag/v0.8.5) | 持续维护；近期处理触发可靠性、配置与推理偏好 |
| Summa | [`28dbe9b8c857dfb3c31947b7ca153bdccd678d16`](https://github.com/silvonli/Summa/commit/28dbe9b8c857dfb3c31947b7ca153bdccd678d16) | 2025-02-13 14:26:44 | 未发现 GitHub Release；package/manifest 为 1.1.0 | 一年以上无 main 提交，接入后需自行接管维护 |
| Representer | [`18ff4bc43a69cf5875a98952347ab947cab0c107`](https://github.com/Yaphet2015/Representer/commit/18ff4bc43a69cf5875a98952347ab947cab0c107) | 2026-11-06 08:57:56 | [v0.1.15，2026-11-06](https://github.com/Yaphet2015/Representer/releases/tag/v0.1.15) | 更新活跃，但仓库创建于 2026-10-13，生产使用历史较短 |

### 2.2 未做的验证

- 没有运行第三方项目、测试、模型或浏览器扩展；测试文件和 CI 定义存在，不等于本次已验证它们通过，更不等于覆盖率。
- 没有对第三方做完整漏洞扫描、发布包逆向、全量许可证法律审查或完整运行产物 SBOM。没有证据支持“这些项目没有漏洞”的结论。
- 没有登录 X、调用私有接口、绕过访问限制，或重新验收真实 X/微信。IdeaClip 先前不可读取样本的结论保持不变。
- 所有工期均为单名熟悉本项目开发者的粗估人日，包含基本测试，不是交付承诺；原生权限、跨浏览器、模型兼容和许可证事项可能增加成本。

## 3. IdeaClip 已有能力与差距

基线依据：[README](../README.md)、[AI-ENGINE](AI-ENGINE.md)、[IC-008 验收](IC-008-VALIDATION.md)、[ROADMAP](ROADMAP.md)，以及 CodeGraph 返回的当前源码。

| 研究方向 | IdeaClip 当前状态 | 不能误认成已实现的能力 | 现有模块 |
| --- | --- | --- | --- |
| 正文提取与清洗 | Readability + 站点分支，去除隐藏/折叠/表单/可编辑区域；正文/作者/链接/图片元数据和完整性提示 | 不是对所有网页都准确；尚无可配置质量评分、策略对照和受限的站点规则管理 | [`collection/extract.ts`](../src/collection/extract.ts)、[`collection/model.ts`](../src/collection/model.ts) |
| X 主帖 | URL 帖子 ID 与主帖时间链接匹配，排除引用/推荐；只读取已展开可见正文，失败可粘贴 | 本地模拟通过不等于真实 X 登录态、所有长帖和 DOM 版本都通过 | 同上及采集测试 |
| AI 自动触发 | 三种模式、明确持续授权、主动保存入队、六态任务、Web Locks、取消/预算/版本/重启保护 | 浏览辅助只作本地建议；不是后台阅读全部标签页，不自动上传当前网页 | [`automation/`](../src/automation/)、[`inspiration/repository.ts`](../src/inspiration/repository.ts) |
| AI 侧边栏/网页问答 | 独立分析报告和任务页面 | 没有原生 AI side panel、页面追问或多轮来源约束对话 | [`ai/AnalysisPage.tsx`](../src/ai/AnalysisPage.tsx) |
| 深度研究与来源证据 | 15 维报告；fact 的 evidence 必须出现在已发送文本中 | 这仅证明“引用了原资料”，不是联网核验；没有跨页面研究、段落锚点、来源卡片或研究证据图 | [`ai/report.ts`](../src/ai/report.ts)、[`ai/engine.ts`](../src/ai/engine.ts) |
| AI 标签 | 用户手工标签、搜索和批量整理已实现 | 没有自动标签或可审核的 AI 标签建议 | [`library/actions.ts`](../src/library/actions.ts)、笔记模型 |
| 多笔记关联/语义搜索 | Worker 分块的关键词搜索、分类/标签过滤 | 没有 embedding、混合检索或笔记关系图；项目表预留不等于已有多笔记关联产品功能 | [`library/query.ts`](../src/library/query.ts)、[`storage.ts`](../src/storage.ts) |
| AI Skills | 固定应用 system 规则、15 维 JSON Schema | 没有用户模板编辑、模板版本、模板授权或 slash commands | [`ai/report.ts`](../src/ai/report.ts)、[`ai/generated/`](../src/ai/generated/) |

数据库当前 schema v7。应保留 notes、原图 Blob、采集记录、草稿、报告历史、预算和任务 ID；新增功能只能增量迁移，不能用别人的数据库覆盖本地库。备份目前是七表白名单；新业务表必须显式评估备份，缓存/向量可重建，凭据和本机执行授权继续排除。

## 4. 六个项目技术对比

| 项目 | 架构与主要能力 | 静态质量信号 | 与 IdeaClip 兼容性 | 引入后维护成本与建议 |
| --- | --- | --- | --- | --- |
| Karakeep | TypeScript monorepo，Next.js Web、React 扩展/移动端、tRPC、Drizzle/SQLite、服务端 workers、全文/语义搜索、自动标签与摘要、归档 | 树中 95 个 test/spec 文件；CI 定义含类型、格式、多个包单测；网络/重定向与提取质量测试较完整 | React/TS 可交流设计；Node、SQLite、服务端抓取/搜索不能放进纯本地 MV3 | 整体高，后端部署、鉴权、爬虫和版本升级都成为长期负担；优先借鉴设计 |
| Page Assist | WXT + React 18 + TS；原生 side panel / Web UI、Ollama/云模型、知识库、LangChain、Dexie 向量 | 2 个可见 test 文件；根脚本有 compile，无 test；快照树未见 Actions workflow | Dexie/React/TS 接近，但框架、React 版本、存储模型和权限跨度大 | 模块适配中，完整接入高；参考问答上下文/检索设计，避免搬入整套 UI/SDK |
| Magpie | React 18 + Vite + MV3；IndexedDB、Orama 混合检索、本地 Transformers/ONNX、来源引用、多阶段研究、Skills、Drive/MCP | 90 个 test/spec 文件，含预算/队列/引用/提取测试，verify workflow 有构建/单元/E2E；未独立运行 | 技术形态接近，但非商业许可证、广权限与运行模型有根本差异 | 很高；只研究公开设计并独立实现，不作为代码来源 |
| webpage-summary | WXT + React 19 + TS；Readability/DOM 启发式/站点 CSS 规则、Shadow DOM 面板、流式摘要、Vercel AI SDK | 未见 test/spec 文件及自动单测脚本；有标签发布打包 workflow，存在 sample 演示 | 提取函数和面板状态思路较接近；WXT storage/messaging/AI SDK 需解耦 | 提取适配中；整套传输层高；适合受控小模块候选 |
| Summa | Webpack/Babel + TS；内容面板为 Shadow DOM/原生类，设置为 React 18；offscreen DOMParser→Readability→Turndown，AI SDK 摘要 | 未见 test/spec、测试脚本或 Actions；较老依赖与分散状态管理 | Markdown 转换概念可借鉴；构建、DOM、SDK 与数据模型均不同 | 移植中高且收益小；只参考交互和导出设计 |
| Representer | WXT + React 19 + TS；Defuddle、可定位概览、页面对话/缓存、Skills；pi-ai/pi-durable/chord | 41 个 test/spec 文件，覆盖清洗、取消、缓存身份、iframe/定位、Skills；发布 workflow 运行 npm test | 纯函数/接口较接近；页面注入、pi runtime、存储和全站权限不能照搬 | 小模块中，整套引擎高；Skills 和定位为优先候选，但项目年轻需独立回归 |

test/spec 数量来自所固定版本递归树的文件名统计，包含不同类型测试，不是测试用例数。公开 Actions 的 main 分支列表也不足以证明标签发布工作流或 HEAD 所有检查通过，因此不以它代替独立验收。

### 4.1 Karakeep：成熟收藏工作流，保持架构边界

**可参考部分。** 收藏后将抓取、标签、摘要、索引分为独立处理阶段；显式记录成功/失败；标签任务传入既有标签，做标准化和结构校验；正文阅读视图以可读性和页面结构判断质量。这些比“所有内容进入一个摘要 prompt”更可维护。[标签 worker][K-tag]、[推理 worker][K-worker]、[阅读质量判断][K-reader]

**不能直接移植的部分。** 其扩展依赖 shared/trpc/shared-react，归档使用 SingleFile；后台包含 Node DNS/IP 校验、浏览器抓取、SQLite、图像/OCR 和搜索服务。它不是一个可以复制进 `src/collection` 的轻量库。`network.ts` 的 SSRF 防护适合作为未来服务端研究的设计参考，但 Node DNS 能力不适用于浏览器脚本。[扩展依赖][K-extpkg]、[workers 依赖][K-workpkg]、[网络防护][K-network]

**安全与维护。** 服务端持有的 HTML、媒体、用户权限、访问目标和 webhook 都扩展了攻击面；队列有重试语义，不能默认照搬到已可能计费的 AI 请求。当前直接复制业务代码还会引入 AGPL 的许可评估，不能只保留一个“来源链接”便认为合规。[队列接口][K-queue]、[LICENSE][K-license]

**结论：** 用作自动标签和任务分层的首选产品参考；暂不引入服务端、归档或业务代码。独立使用它的某个宽松许可依赖，应直接从该依赖上游评估，而非从 Karakeep 抽代码。

### 4.2 Page Assist：侧边栏与本地知识库参考价值高

**可参考部分。** 网页问答与本地模型的交互、文档分块/来源 metadata、Dexie 中存向量和按知识库范围检索；默认提取已采用 Defuddle 后接语义节点/Markdown 回退。[正文提取][P-default]、[向量适配][P-vector]、[Dexie 向量存储][P-vectordb]

**明确不替换的部分。** X 解析没有按当前 status ID 定位；`PageAssistVectorStore` 会读取一组向量到内存再逐项 cosine 计算和排序，不能据此宣称大规模检索已解决。`src/queue/index.ts` 的 PubSub + isProcessing 是页面内处理状态，不能替代事务化持久任务、跨页面锁和未知费用保护。[X 解析][P-twitter]、[知识处理队列][P-queue]

**安全与维护。** Manifest 声明 HTTP/HTTPS/file 全站访问，多种权限及 WASM CSP；带入 LangChain、多 provider、OCR、PDF、MCP 会放大包体、依赖和升级成本。源码里的“本地存储”不能推出“不会把内容发给已配置云模型”。只保留 IdeaClip 的逐域授权与凭据门禁，不照搬 manifest、CORS/网络头处理或工具执行。[WXT 配置][P-wxt]、[依赖][P-package]、[隐私说明][P-privacy]

**结论：** 问答/知识库设计优先参考；如未来确需向量小模块，先去除 LangChain 基类依赖、增加维度/版本/容量校验并测试 Worker 性能，不能整包接入。

### 4.3 Magpie：深度研究和证据设计丰富，但禁止直接代码接入

**可研究设计。** 将来源拆为稳定 chunk anchor，答案关联引用并可回到本地来源；文本/向量混合排序与相关性门槛；研究计划预览、来源上限、上下文预算和阶段检查点；队列与缓存分离；用户命令和模板注册表。[引用设计][M-citations-doc]、[引用模块][M-citations]、[检索模块][M-vector]、[研究限制][M-limits]、[Skills 说明][M-skills]

**不能照搬的策略。** researchQueue 的 storage.local FIFO 和单 worker 写链、活动任务自动恢复/心跳方案，与 IdeaClip 的跨页面事务、锁和“重启后人工恢复未发任务”策略不同。检查点可用于本地步骤，但不能由“任务 active”推导出可以重发付费请求。[队列][M-queue]、[MV3 状态设计][M-mv3]

**安全与维护。** Manifest 包括全站内容脚本、MAIN world 网络观察、tabs、alarms、offscreen、declarativeNetRequest、unlimitedStorage 等。联网研究、模型文件、可选同步和工具调用增加隐私、供应链和费用面。最近提交消息提到移除跟踪 signing key/打包产物；本次没有下载或验证其历史密钥，也不据此断言已撤销，复用发布资产前仍须检查来源和签名。[Manifest][M-manifest]、[移除跟踪的提交](https://github.com/astranero/magpie/commit/2baf75f7303f79951c53677bc796ebae018336d6)

**结论：** 只做公开机制的比较与独立设计；不复制其源文件、测试、模板文本、图标/字体资产或文档表达来构造衍生产品。Orama 等独立依赖有各自许可证，可以单独评估，不代表 Magpie 包装代码获得同样许可。

### 4.4 webpage-summary：提取策略值得评估，网络策略不采用

**可参考部分。** 将 Readability、DOM 结构评分和按站点配置的 CSS selectors 分离；候选综合文本量、段落、链接密度、交互密度、正文占比等，并记录 extractMethod。可在保留 IdeaClip 站点分支前提下，改善普通文章和工具产品页的提取解释性。[提取源码][W-extract]、[站点规则][W-rules]

**必须改造的地方。** DOM 回退会使用正文候选或整个 body 文本，不能原样用于自动上传。所有策略必须先经过 IdeaClip 的可见性、表单/可编辑区域清理和容量上限；失败应标为 partial/unavailable，而不是拿全页当“成功正文”。其站点规则存在白名单优先的语义，IdeaClip 必须继续黑名单优先，不能移植配置格式后改变行为。[提取源码][W-extract]、[规则实现][W-rules]

**安全与维护。** 默认 `<all_urls>`，并有通过 declarativeNetRequest 修改响应 CORS 头的模块；这不符合本项目在明确端点权限失效时停止请求的原则。自动打开面板/自动摘要属于其自身交互，不能变成 IdeaClip 浏览辅助的自动上传。模型配置中的 apiKey 与一般配置一并存储的方式也不替换当前凭据隔离。[Manifest 配置][W-wxt]、[CORS 模块][W-cors]、[自动触发][W-trigger]、[模型存储][W-storage]

**结论：** 可选提取评分与受限站点规则为小模块候选；不引入其传输层、自动摘要开关语义和网络头绕行。

### 4.5 Summa：轻量面板交互参考，运行代码优先级低

**可参考部分。** 提取与摘要分状态、Shadow DOM 隔离 UI、offscreen 执行 DOMParser / Readability / Turndown 的职责划分，及短摘要的展示方式。[摘要状态模型][S-model]、[offscreen 提取][S-offscreen]

**安全与维护。** `SummaryModel` 将 documentElement.outerHTML 整体传给扩展处理；虽然这不是直接向模型发送完整 HTML，但引入不必要的页面数据，必须先清洗和限制。provider/API Key 长期存于 storage.local；content_scripts 广域匹配；错误文字可进入摘要状态，“completed”不是“分析成功”。这些状态和隐私语义不能覆盖当前实现。[状态与 HTML 传递][S-model]、[存储][S-storage]、[Manifest][S-manifest]

其 Readability 0.5、AI SDK 4、React 18、TS 4.9/Webpack 与 IdeaClip 当前工具链存在升级跨度；未发现自动测试定义，不建议为复用简短 UI 拖入整套构建或 SDK。[依赖][S-package]

**结论：** 仅参考交互/Markdown 导出；当前无需添加 offscreen 权限或替换采集、AI 引擎。

### 4.6 Representer：Skills、表单清洗和来源定位最适合小范围评估

**可参考部分。** Skills 采用数据化模板、限定变量替换、CRUD 和最近使用记录；提取时先处理副本上的表单和 contenteditable；给段落编号并保存指纹，支持回到原段落、DOM 漂移与 iframe 来源身份。[Skills][R-skills]、[提取清洗][R-extract]、[来源定位][R-locate]

**必要适配。** IdeaClip 已有可见性/输入区域清理，不应重写为第二套冲突逻辑；可补充 contenteditable 继承、plaintext-only、false、属性大小写及只读内容的回归用例。定位应首先回到保存的采集快照，在线页面匹配失效要提示，不把模糊匹配当作逐字证据。iframe 采集仍需单独授权与来源身份，不能因为支持 iframe 就扩大访问面。

**安全与维护。** WXT 声明 `<all_urls>`，设置和 API Key 使用 chrome.storage.local；`lib/llm.ts` 绑定 pi runtime，有对推理参数不兼容等情况的再次尝试路径；`budget.ts` 管的是输出 Token 上限，不能替代每日美元预算。当前成本记录/自动重试语义、完整 provider 工具链和 pi runtime 均不引入。相关 npm 包本身 MIT 也不意味着无需检查间接依赖、网络行为和实际浏览器产物。[WXT 配置][R-wxt]、[存储][R-storage]、[LLM 层][R-llm]、[输出限制][R-budget]

**结论：** Skills 纯函数/接口、段落定位和隐私测试设计列为优先候选；保留 IdeaClip 引擎，不换 pi runtime，不复制其全站权限或默认长期密钥策略。

## 5. 许可证核查

### 5.1 主项目许可证与接入决策

| 项目 | 已读取的许可文件 | 核查结论 | 当前允许的调研/接入方式 |
| --- | --- | --- | --- |
| Karakeep | [LICENSE][K-license] | AGPL v3，强 copyleft；不是“禁止商用”。复制/修改/分发或网络使用修改版本等情形，需具体评估许可、对应源代码和通知义务 | 当前只借鉴设计；不把业务文件拷入并以为可继续任意许可。单独进程/API 也不能据此保证免除所有义务 |
| Page Assist | [LICENCE][P-license] | MIT | 可评估孤立模块，但须保留版权/许可，核查文件来源和实际带入依赖 |
| Magpie | [LICENSE][M-license] | 自定义 NON-COMMERCIAL SOURCE-AVAILABLE；限制商业用途和企业使用，不符合 OSI 对使用领域不得歧视的要求 | 不直接复制/移植代码或素材；需要受保护实现时先取得明确授权 |
| webpage-summary | [LICENSE][W-license] | MIT | 可评估提取小模块，保留声明，重写项目绑定及不兼容安全行为 |
| Summa | [LICENSE][S-license] | MIT | 法律许可方向可评估，但技术上暂不引入运行代码 |
| Representer | [LICENSE][R-license] | MIT | 可评估 Skills/定位纯模块，保留声明；不能把依赖和发布资产也一概视为 MIT |

IdeaClip 当前根目录未见项目 LICENSE，package.json 也没有 license 字段；公开仓库不自动等于授予公众自由复用代码的许可。**实际集成前需要明确 IdeaClip 自身对外许可策略**，本次不替所有者添加或改变许可证。[无许可证含义][NO-LICENSE]

以上是许可文本与工程分发风险的核查，不对任意链接/衍生/部署方式作一概法律结论。特别是 AGPL 与非商业限制不可混为一谈；保留署名不能消除不兼容条件。

### 5.2 依赖许可证：实际核查范围

对四个可读 package-lock.json 解析全部 packages 条目的 license 元数据；数量包括根项目、workspace、开发/可选包和平台变体，不是浏览器包体或独立软件数量。未声明 license 只表示锁文件没有该字段，**不表示该软件没有许可证**。Page Assist 的 bun.lockb 未执行解析器；Karakeep 的 pnpm 工作区未形成完整依赖许可闭包，以下采用清单及指定版本注册表抽样。

| 项目 | 锁文件/清单核查 | 主要发现与未完成项 |
| --- | --- | --- |
| Karakeep | [workers 清单][K-workpkg]、[扩展清单][K-extpkg]；指定版本 npm 元数据 | Readability 0.6.0 为 Apache-2.0；single-file-core 1.5.84 为 AGPL-3.0-or-later；adblocker-playwright 2.5.1 为 MPL-2.0；DOMPurify 3.4.17 为 MPL-2.0 OR Apache-2.0；liteque 0.10.0 / better-sqlite3 13.0.3 为 MIT；patchright 1.59.4 为 Apache-2.0。这里只核对清单对应版本，不冒充 pnpm 完整解析版本/SBOM |
| Page Assist | [package.json][P-package]；bun.lockb 未作完整许可审计 | 抽样 defuddle 0.18.1、LangChain/core/community 指定版本为 MIT，Dexie 4.0.11 为 Apache-2.0，React 18.2.0 为 MIT。OCR fork、字体、PDF、全部间接依赖仍待分发前逐项核对 |
| Magpie | [package-lock.json][M-lock]：971 条，3 条未声明 | Orama 3.1.18、Transformers 4.2.0、Readability、PDF.js 为 Apache-2.0；字体有 OFL-1.1；锁内 sharp/libvips 可选平台包含 LGPL-3.0-or-later 及复合表达式。需区分构建/Node 可选依赖与浏览器实际打包；主项目非商业限制仍独立成立 |
| webpage-summary | [package-lock.json][W-lock]：689 条，5 条未声明 | Readability、AI SDK 的 ai/@ai-sdk/openai 为 Apache-2.0，React 为 MIT；webextension-polyfill 为 MPL-2.0；lightningcss/fx-runner 等多为开发依赖。jszip 是 MIT OR GPL-3.0-or-later，不能误写成必须 GPL；caniuse-lite 为 CC-BY-4.0 |
| Summa | [package-lock.json][S-lock]：1156 条，1155 条未声明 | 锁文件不足以证明依赖许可；另核对 ai 4.0.9、@ai-sdk/openai 1.0.5 为 Apache-2.0，Turndown 7.2.x / turndown-plugin-gfm 1.0.2 / React 18.2.0 为 MIT。其余未完成完整审计，不可整体搬入 |
| Representer | [package-lock.json][R-lock]：492 条，488 条未声明 | 另核对锁定的 defuddle 0.19.5、pi-ai/pi-durable/chord 1.2.0 为 MIT，Turndown 7.2.4 为 MIT。pi-ai/pi-durable 引入更多 provider、代理、telemetry/codemode 等间接包：需要进一步审计，不因名字存在就断言运行时已经遥测或执行代码 |

指定版本元数据例证：[Readability 0.6.0](https://registry.npmjs.org/%40mozilla%2Freadability/0.6.0)、[Defuddle 0.19.5](https://registry.npmjs.org/defuddle/0.19.5)、[Defuddle 0.18.1](https://registry.npmjs.org/defuddle/0.18.1)、[single-file-core](https://registry.npmjs.org/single-file-core/1.5.84)、[Orama](https://registry.npmjs.org/%40orama%2Forama/3.1.18)、[Dexie](https://registry.npmjs.org/dexie/4.0.11)、[LangChain core](https://registry.npmjs.org/%40langchain%2Fcore/1.1.31)、[pi-durable](https://registry.npmjs.org/%40earendil-works%2Fpi-durable/1.2.0)、[pi-ai](https://registry.npmjs.org/%40earendil-works%2Fpi-ai/1.2.0)、[chord](https://registry.npmjs.org/%40earendil-works%2Fchord/1.2.0)、[Ghostery adblocker](https://registry.npmjs.org/%40ghostery%2Fadblocker-playwright/2.5.1)、[DOMPurify](https://registry.npmjs.org/dompurify/3.4.17)。这些是所列版本的包声明，不代替包内 LICENSE/NOTICE 与最终产物审查。

### 5.3 后续真正复制或安装前的许可门槛

- 逐个文件记录上游仓库、固定 SHA、路径、版权、许可证及修改，不只引用仓库首页。
- 对拟进入最终扩展的运行依赖、打包字体、WASM 和模型权重生成实际产物清单；开发工具不自动等于随产品分发。
- MIT 保留许可/版权；Apache-2.0 检查许可、修改标识及上游存在的 NOTICE；MPL/LGPL/AGPL、双许可的具体选择分别处理，不简单归为“都能复制”。
- 模型权重、字体、图标、示例数据有独立许可；Transformers.js 的 Apache 许可证不替代下载模型的许可。
- 把第三方通知放进扩展可访问的 notices/licenses；未完成审计的依赖不进入正式产物。本次没有新增任何依赖或复制代码。

## 6. 按功能制定集成方案

优先级：**P0** 是安全/合规与当前功能验收前置；**P1** 是近期高收益；**P2** 是有条件增强；**P3** 是后续独立立项。模块标注“拟新增”表示本次没有创建它。

| 功能 | IdeaClip 已实现情况 | 是否有更成熟方案 | 复用代码还是借鉴设计 | 预计修改的 IdeaClip 模块 | 主要技术风险 | 推荐优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 正文提取与清洗 | Readability、站点分支、隐私清洗、手动回退 | 有局部增强：webpage-summary 的策略/评分，Defuddle 的另一条解析路线；不证明全面优于现有采集 | 保留现有分支；先独立实现质量度量；MIT 提取小函数或独立 Defuddle 包仅作许可/体积审核后的对照候选 | `collection/extract.ts`、`model.ts`、`Collection.tsx`、提取测试 | DOM 回退扩大采集、可编辑字段泄露、伪正文、长 DOM 卡顿、HTML/Markdown 注入 | P1，隐私清洗与原有功能回归为 P0 |
| X 帖子采集 | 当前 ID 定位、可见长帖、媒体和外链，失败可粘贴 | 本次未找到足以替换现有主帖定位的成熟方案；Page Assist 的汇总式解析反而不合要求 | 借鉴失败样本和适配器接口，不复制其主帖选择器算法；保留精确匹配 | `collection/extract.ts`、`extract.test.ts`、浏览器 fixture/live 验收记录 | 推荐/引用/回复混入、虚拟列表、长帖未展开、登录限制；不能用私有 API/网络截获补读受限内容 | P1 回归与可诊断性；完整真实 X 验收受可访问性约束 |
| AI 自动触发 | IC-008 已有持续授权、事务入队、去重/预算/取消/重启保护 | Karakeep 的任务分层、webpage-summary 的初始化就绪状态值得参考；不是现有费用安全的直接升级 | 仅借鉴；保留 AIEngine + queue；增加任务用途和可观察性时独立扩展 | `automation/{model,policy,queue,TaskCenter}.ts(x)`、`inspiration/repository.ts`、`ai/engine.ts` | 隐式付费、保存/标签循环、自动重发、配置或模板变化导致授权失效 | P0 原生权限验收；P1 小幅增强 |
| 侧边栏与网页问答 | 未实现 | Page Assist 产品能力更完整；Representer 的上下文/来源交互较轻 | 借鉴 UI 和上下文设计；不移植整套 WXT、LangChain 或 pi runtime；小型展示纯组件按许可选择性适配 | 拟新增 `sidepanel.html`、`src/chat/`；现有 `main.tsx`、`ai/engine.ts`、`config.ts`、`public/manifest.json` | 页内数据/密钥隔离、多轮费用、切页误发、跨笔记越权、关闭面板导致误重试 | P2；先只基于用户选中的已保存笔记 |
| 深度研究与来源证据 | 单笔记原文 evidence 检查，无联网研究 | Magpie 的阶段研究与 chunk 引用更完整；Representer 可作为定位小模块参考，但都不能保证事实真实 | 先做本地证据模型；MIT 定位纯模块可评估；Magpie 仅研究设计、独立实现，不复制研究器 | `collection/model.ts`、`ai/report.ts`、`AnalysisPage.tsx`、`storage.ts`、`backup/model.ts`；研究任务拟新增 | 模型伪造来源、过期锚点、联网费用/隐私、SSRF、提示注入、把引用误当核验 | 本地证据 P1/P2；联网研究 P3 |
| AI 自动标签 | 人工/批量标签已实现，AI 建议未实现 | Karakeep 的既有标签约束、结构校验与规范化较成熟 | 借鉴设计，独立写建议流程；不复制 AGPL worker | 拟新增 `src/ai/tagging.ts`；`library/actions.ts`、编辑页、任务模型、存储/备份白名单 | 污染用户分类、标签爆炸、覆盖未提交编辑、写回再次入队、额外模型费用 | P2，先用户采纳的建议，不静默写回 |
| 多笔记关联与语义搜索 | 关键词与标签搜索，无关联图/embedding | Page Assist 有 Dexie 向量；Magpie 有混合检索。成熟度在方法，不代表其实现适合本库性能 | 先独立实现稳定 ID 关系；再评估独立 Orama 库或小型 Worker 索引，不复制 Magpie 包装层，不照搬全量内存 cosine | `library/{query,catalog.worker,projections}.ts`、`storage.ts`、`backup/`；拟新增 `src/search/` | 模型下载/云 embedding 泄露、维度混用、索引陈旧、内存、删除残留、备份膨胀 | 显式关联 P2；语义检索 P3，关键词搜索继续可用 |
| Skills 自定义模板 | 固定 15 维分析，未实现用户模板 | Representer 的小型模板/存储接口适合评估；Magpie 命令注册与研究型 Skills 仅作设计参考 | 可选择适配 MIT 的变量替换/验证纯函数，保留署名；存储和授权重新接入 IdeaClip | 拟新增 `src/ai/skills.ts(x)`；`report.ts`、schema 生成脚本、`engine.ts`、`automation/model.ts`、`storage.ts`、设置/备份 | 模板提示注入、破坏固定 JSON、修改模板后旧授权仍生效、模板内密钥进入备份、自动调用工具 | P1 受限文本模板，复杂命令/工具 P3 |

### 6.1 提取层：增加选择依据，而不是把最长文本当最好正文

建议的后续接口包含提取策略、质量状态、警告、原始来源和内容摘要；优先级保持“可授权的站点专用分支→已清洗的通用文章→受限语义候选→手动粘贴”。普通网页中可对照 Readability 与 Defuddle，但 X/微信/GitHub 不交给通用 body 回退覆盖。

先以固定、可分发的本地 HTML 样本评估：主文召回率、导航/评论混入、敏感字段零采集、作者/时间准确性、延迟和内存。没有测出收益前不加 Defuddle；新增依赖应核对其锁定版本及浏览器入口，不能为仅用一个提取函数引入其 CLI/Node 依赖。Readability 现有数据格式、文本上限和安全链接过滤继续保留。

### 6.2 问答与证据：先限定笔记，再扩大来源

首版问答只接受用户主动选中的保存版本；每轮显示笔记标题/版本、发送范围、预计费用与取消入口，新增请求仍走统一门禁。切换网页不自动换上下文，检索只在选中集合内进行。可以继续独立页面作为回退，不强迫所有功能迁到 side panel。

证据建议采用 `noteId + captureId + sourceVersion/hash + blockId + quote`，同时保留原始 URL、采集时间和内容摘要。在线 DOM 锚点只是导航提示，不能代替保存的原文；模型给出的 blockId 必须来自本次输入集合，逐字引用须能核对。页面改变或 iframe 身份不匹配时明确提示失效，不能静默跳到相似但不同的段落。

深度研究应另建来源/研究任务模型，有计划确认、查询/来源/轮数/Token/费用上限、逐来源权限与排除规则；每个网络请求和模型子任务留安全状态，禁止默认把“自动分析笔记”的授权扩大成“访问任意互联网来源”。研究结果继续区分来源说法、推测和待验证假设；多篇文章互相转述不等于独立证据。

### 6.3 标签与检索：建议、关系、向量分别管理

标签先写入建议记录，展示理由和已有标签候选，用户确认后事务应用；禁止覆盖人工标签或编辑草稿，也不因 AI 标签写回再次触发分析。可先用已保存报告作本地候选提示，若另发标签模型请求必须重新估算和授权。

多笔记关系从用户明确建立的关联开始，保存稳定 note ID、关系类型和出处。语义索引应是可重建的派生表，记录 embedding 模型、维度、版本、输入 hash；换模型需要重建，删除/修改笔记同步失效。混合排序保留关键词通路，分批交给 Worker；内存上限、分页与 1 万条基准不可退化。云 embedding 和本地模型下载分别确认，不能把它们当作“免费且没有网络”的步骤。

### 6.4 Skills：可配置的分析任务，不是可执行插件

首版仅允许限定的纯文本变量，例如标题、已清洗正文、感悟和 URL；不存在 JS、网络抓取、文件系统、MCP 或动态加载脚本。模板不能读取密钥、其他未选笔记或未提交草稿，网页资料不能创建/修改模板或提升权限。

固定 15 维商业报告保持独立稳定 schema。用户模板若只改变关注角度，也必须服从应用固定安全规则；自由问答输出与商业报告使用不同结果类型，不能把任意 Markdown 塞进“已通过 JSON Schema”的报告。模板 ID/version/hash 应进入预览、任务快照、去重键和历史；模板修改使旧授权失效。备份模板前校验字段/大小/常见凭据，不导出本设备授权和 Key。

## 7. 推荐复用清单与不推荐清单

### 7.1 候选清单：通过评估后才引入

| 候选 | 建议方式 | 入场条件 | 当前决定 |
| --- | --- | --- | --- |
| 已有 Readability | 保留现有依赖和提取分支 | 原有回归继续通过，补充隐私/可读性样本 | 保留，不替换 |
| Defuddle 独立包 | 作为通用正文的可选对照策略，直接评估其 MIT 上游 | 精确版本 LICENSE/包体/CSP/纯浏览器入口审计，证明质量提升并可回退 | 仅列候选，未安装 |
| Representer 的模板变量与校验纯函数 | 按 MIT 有选择地适配或独立实现同等接口 | 署名、剥离 WXT/local storage/i18n 绑定、模板大小/变量/版本校验、统一费用门禁 | P1 候选，不引入 LLM runtime |
| Representer 的锚点、指纹及清洗测试设计 | 小范围适配定位逻辑，针对当前内容模型改造 | 验证授权来源/版本、CJK/DOM 漂移/iframe，保留只读快照证据及隐私测试 | P1/P2 候选 |
| webpage-summary 的提取策略/评分思路 | 优先独立实现与实验；复制小函数时按 MIT 保留声明 | 不使用整页回退自动上传；恢复黑名单优先；去除其 storage/logger/传输耦合 | P1 候选 |
| Orama 独立库 | 只在确需本地混合检索时单独评估 Apache-2.0 上游 | 不使用 Magpie 包装代码；Worker/内存/中文检索/索引重建/NOTICE 审查 | P3 候选，未安装 |
| Karakeep 的标签与阶段任务设计 | 阅读机制、独立设计实现 | 不复制 AGPL 业务代码；标签建议人工采纳，付费请求禁止默认重试 | P2 设计参考 |
| Page Assist 的网页问答/知识库范围设计 | 参考侧边栏、选定文档与来源展示 | 不移植全站权限、完整 LangChain 链或其他数据库，不混入其他来源 | P2 设计参考 |

### 7.2 本阶段不推荐引入

- **Magpie 任何直接代码/测试/模板/素材移植**：当前非商业限制不适合默认商业化路线；不以改变量名或翻译表达规避许可。
- **Karakeep 整体后端、AGPL 业务文件、SingleFile 归档组件**：许可与 Node/服务端运维成本均超出当前纯扩展定位。完整网页归档也不能替代现有截图功能。
- **Page Assist 整套 WXT/UI/LangChain/MCP/OCR/工具系统，以及按顺序汇总的 X 解析**：会扩大构建、权限、数据和费用面，未证明对当前目标有净收益。
- **webpage-summary 的通用 CORS 响应头修改、全站权限、默认即开始摘要或连接测试**：不得绕过明确域名授权/撤销，或在配置操作中引入隐式费用。
- **Summa 的 Webpack/offscreen/旧 AI SDK 整体迁移**：没有必要为参考面板新增运行环境，整页 HTML 也不符合最小采集原则。
- **Representer 的 pi 引擎/自动兼容性再次调用/默认长期凭据存储**：不替换现有预算、取消、未知费用保护；输出 Token 上限不是美元预算。
- **任何默认全站内容脚本、MAIN world 网络监听、浏览历史扫描、自动跟随外链、任意工具执行或 SDK 隐式重试**：与当前授权和隐私边界不一致。
- **未审计的字体、WASM、模型权重和混合许可二进制**：不因上游项目主 LICENSE 看起来宽松就一并打包。

## 8. 分阶段计划（等待确认，未实施）

| 阶段 | 目标与产出 | 粗估成本 | 验收条件 | 停止/回退条件 |
| --- | --- | --- | --- | --- |
| A / P0 | 确定 IdeaClip 对外许可策略；拟用模块的许可清单；补齐 IC-008 原生网站权限授予/撤销及动态注入验收 | 3–5 人日，不含外部许可沟通 | 原生拒绝/撤销无请求，队列取消、重启和报告恢复保持；无非本机模型调用的 Mock 回归 | 权限行为未验证、许可不清楚时不进入代码引入 |
| B / P1 | 提取质量与隐私样本集，方法/警告可诊断；可选 Defuddle 对照试验 | 4–7 人日 | 固定文章/工具页/X/GitHub/微信本地样本、表单/隐藏/长 DOM 测试；证实收益，原采集回归不退化 | 无稳定收益则保留 Readability，不增加新依赖 |
| C / P1 | 受限模板、版本化预览、与 15 维报告分离，初步来源段落证据 | 5–8 人日 | 模板变更使预览/任务失效；来源伪造拒绝；AI 关闭无请求；迁移/备份往返 | 模板能越过 schema/预算/隐私门禁则禁用该入口 |
| D / P2 | 用户触发的单笔记侧边栏问答、来源卡片与证据导航 | 5–8 人日 | 切页不自动换上下文，多轮逐次计费确认/取消，Chrome/Edge 分别验证，独立页可回退 | 需要全站访问或破坏现有引擎才工作则缩减方案 |
| E / P2 | 标签建议与人工采纳，稳定 ID 的显式多笔记关联 | 4–7 人日 | 不覆盖人工标签/草稿，不产生分析循环，关系删除/备份/升级保持一致 | 自动写回导致重复请求或数据冲突则只展示建议 |
| F / P3 | 选定笔记范围的混合/语义检索，可选本地 embedding | 8–15 人日 | 索引重建/版本隔离、关键词回退、配额/内存与 1 万条数据基准，下载/云发送显式确认 | 本地资源或隐私成本过高则退回关键词/关系检索 |
| G / P3 | 独立立项的联网深度研究和可核对来源报告 | 10–20+ 人日，外部接口不确定性大 | 用户确认研究计划/端点/来源/预算，每一步有限额与证据，断点不重发未知费用，无访问控制绕过 | 未授权联网、付费自动重试、来源不可核验则停止，不降级编造 |

每阶段另行提交开发计划、实现、Mock 测试、必要浏览器验收、迁移和文档，再单独中文 Git 提交。未完成前不在 ROADMAP 勾选对应功能，也不提前把候选依赖加入 package.json。

## 9. 对 IC-008 的具体优化建议

### 9.1 应优先补齐的验收

当前已记录的 193 项单元、48 项 Chrome 回归不能替代原生权限路径验收：现有 AI/浏览辅助测试对权限弹窗和动态注册边界使用 Mock。先测试用户真实授予、拒绝、只允许点击、撤销某个网站但保留服务商、浏览器恢复、现有脚本移除提示，再验证不会启动新费用请求。这是补证据，不是宣称当前实现已知存在绕过。[既有验收边界](IC-008-VALIDATION.md)

### 9.2 提高输入质量，不改变自动发送范围

保存入队前记录采集可读性、提取方法与完整性原因。无正文、仅登录/推荐壳或明显不完整的材料可暂停并请用户核对，不用页面导航文本凑输入。新规则先只做本地判断，不调用模型分类，不自动发送截图；主动保存和持续授权仍是必要条件。参考 Karakeep/webpage-summary 的可解释质量判断，但独立实现适合商业灵感页面的规则，避免把产品首页一概判为“不是文章所以无价值”。

### 9.3 将任务用途、模板和输入版本纳入授权

现有 noteId/revision 去重、原始字段 hash、配置/凭据/会话绑定继续保留。未来新增模板/标签/embedding 时，再增加用途、模板 ID/version/hash、输出 schema 版本与相关来源版本；任何会改变发送内容或价格的变更都使原快照/授权失效。模板默认不能成为后台自动处理器，更不能用一个商业分析授权启动搜索、标签、embedding 和多 agent 工具链。

### 9.4 复用已有结果，保持费用不确定性语义

现有 `completeFromReport` 已在状态写入失败、重启和手动重试前检查既有报告；这应作为不能退化的回归契约。可以增加“已有相同版本报告”的可见提示和无费用查看入口，不把状态修复变成重新请求。未来若做内容缓存，键必须包含输入/模型/端点/模板/schema 身份，用户明确重新分析仍需新的费用确认。

不把 Karakeep 的服务端重试、Magpie 的活动任务恢复或 SDK 参数兼容重试直接应用到 AI。付费请求未知、超时、取消或账本不可读，继续占用已预留额度并等待人工处理；只对确定不涉及外部请求的本地索引/结果保存提供本地重试。避免靠 429/网络错误就断言“肯定未计费”。

### 9.5 增加可观察性，避免记录内容和密钥

在现有任务中心增加按原因聚合（预算/权限/快照/超时/存储）、安全阶段、上次状态时间、关联 usage/report ID；未来可把每次尝试与 taskId 关联形成审计，不用覆盖最后一次原因代替历史。日志不包含正文、感悟、API Key、带敏感参数 URL 或服务商错误原文。标签采纳/关联修改与原任务关系应可解释，但不形成再次分析循环。

### 9.6 执行环境先保持透明，谨慎评估 offscreen

保留后台打开的可见任务执行标签页及 owner/任务/预算锁。用户知道在哪暂停和取消，比未经评估的隐形常驻更可控。不要移植心跳保活或浏览器启动后直接续发付费请求来掩盖 MV3 生命周期。

未来如果本地 embedding、DOM 解析确实需要 offscreen，必须选择实际相符的理由、说明新增权限和生命周期，并单独验收。Chrome 官方说明 offscreen 需要 reason/justification，且只能使用有限的扩展 API（主要为 runtime）；它不是一份“任务永远不会被浏览器停止”的保证。[Offscreen API][CHROME-OFFSCREEN]

### 9.7 UI 入口与能力增长分开

可让原生 side panel 展示同一任务中心或笔记证据，但打开侧栏不应自动采集、入队或请求模型；关侧栏不应丢失任务/报告。Chrome sidePanel 需 manifest 声明相应权限，是否在新版本采用要单独权衡，不能把 Page Assist/Magpie 的全部权限一起复制。[Side Panel API][CHROME-SIDEPANEL]

保持截图、笔记、关键词搜索、备份在 AI 关闭时完整可用；多笔记检索必须展示所选来源集合。新增能力以独立开关、显式授权及可回退模块接入，而不是把“浏览辅助”逐渐变成默认后台上传。

## 10. 本次交付与检查

- 仅新增 `docs/OPEN-SOURCE-RESEARCH.md`，所有集成方案均未实施。
- 六个仓库固定版本、主许可证、主要依赖许可元数据、关键代码与测试/工作流证据已核查；未完成的全量许可审计、第三方运行和真实 X/微信验证已明确标记。
- 本文不包含第三方源码、完整 prompt、私有配置、密钥、用户笔记、截图或数据库。
- 本次 `npm test`：12 个文件、193 项通过；`npm run build`：TypeScript、三组 Vite 构建及 Manifest/资源/CSP 检查通过。代码和依赖未变，没有重跑浏览器验收；文中 48 项 Chrome 回归是 IC-008 已有记录，不冒充本次第三方运行结果。
- 文档检查：55 个引用定义、64 处引用使用、17 个仓库内链接均可解析，未发现缺失引用/路径。提交前再次检查空白差异、敏感文件和唯一暂存路径，不把第三方静态阅读标成运行通过。

## 11. 一手证据索引

下列源码和许可链接固定到第 2 节的 main 快照；注册表链接固定到具体包版本。项目 README 只用于功能定位，源码、许可与测试定义分别核查。

[K-license]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/LICENSE
[K-tag]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/workers/workers/inference/tagging.ts
[K-worker]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/workers/workers/inference/inferenceWorker.ts
[K-reader]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/workers/workers/utils/readerViewAssessment.ts
[K-extpkg]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/browser-extension/package.json
[K-workpkg]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/workers/package.json
[K-network]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/apps/workers/network.ts
[K-queue]: https://github.com/karakeep-app/karakeep/blob/6a1e71d67c10b2f56d55e8d771be0dd0c2cf6316/packages/shared/queueing.ts
[P-license]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/LICENCE
[P-package]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/package.json
[P-twitter]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/src/parser/twitter.ts
[P-default]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/src/parser/default.ts
[P-vector]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/src/libs/PageAssistVectorStore.ts
[P-vectordb]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/src/db/dexie/vector.ts
[P-queue]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/src/queue/index.ts
[P-wxt]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/wxt.config.ts
[P-privacy]: https://github.com/n4ze3m/page-assist/blob/593d90a03b0823685353ca53b51fd249f7a63b2a/PRIVACY.md
[M-license]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/LICENSE
[M-citations-doc]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/docs/CITATIONS.md
[M-citations]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/apps/extension/src/lib/citations.ts
[M-vector]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/apps/extension/src/lib/vector-store.ts
[M-limits]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/apps/extension/src/lib/research-limits.ts
[M-skills]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/docs/SKILLS.md
[M-queue]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/apps/extension/src/lib/research-queue.ts
[M-mv3]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/docs/MV3-PERSISTENT-AGENT-STATE.md
[M-manifest]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/apps/extension/src/manifest.json
[M-lock]: https://github.com/astranero/magpie/blob/e633b21fe5d3094b0d7b3cb663c9531a6bafb3fd/package-lock.json
[W-license]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/LICENSE
[W-extract]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/lib/page-extraction.ts
[W-rules]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/lib/site-rules-storage.ts
[W-wxt]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/wxt.config.ts
[W-cors]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/entrypoints/background/cors-fix.ts
[W-trigger]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/entrypoints/content/summary/useContentApp.ts
[W-storage]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/lib/model-settings-storage.ts
[W-lock]: https://github.com/ctxinf/webpage-summary/blob/750c6ed29bc5bbb80ab86a10144333f47a591c24/package-lock.json
[S-license]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/LICENSE
[S-model]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/src/pages/Content/modules/SummaryModel.ts
[S-offscreen]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/src/services/offscreen/offscreen.ts
[S-storage]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/src/services/storage.ts
[S-manifest]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/src/manifest.json
[S-package]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/package.json
[S-lock]: https://github.com/silvonli/Summa/blob/28dbe9b8c857dfb3c31947b7ca153bdccd678d16/package-lock.json
[R-license]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/LICENSE
[R-skills]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/skills.ts
[R-extract]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/extract.ts
[R-locate]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/locate.ts
[R-wxt]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/wxt.config.ts
[R-storage]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/storage.ts
[R-llm]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/llm.ts
[R-budget]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/lib/budget.ts
[R-lock]: https://github.com/Yaphet2015/Representer/blob/18ff4bc43a69cf5875a98952347ab947cab0c107/package-lock.json
[OSI]: https://opensource.org/osd
[NO-LICENSE]: https://choosealicense.com/no-permission/
[CHROME-OFFSCREEN]: https://developer.chrome.com/docs/extensions/reference/api/offscreen
[CHROME-SIDEPANEL]: https://developer.chrome.com/docs/extensions/reference/api/sidePanel

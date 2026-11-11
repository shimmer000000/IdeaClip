# 0.2.18 GitHub商业机会分析中心第一阶段

日期：2026-11-11。起点 c355ebb45969915b721a43cc5cf92ce0305e11a7；起始本地干净，origin/main一致。仅IdeaClip，无新依赖，无其他仓库/服务修改。

## 只读研究与取舍

- [OpenBusiness](https://github.com/wanikua/OpenBusiness)：README描述Python CLI、LangGraph、证据收集及分层商业分析；MIT。借鉴商业模式/成本/风险与缺证据标记。不引入其Agent、抓取器、付费搜索或模型调用流程。
- [OpenCMO](https://github.com/Lling0000/OpenCMO)：README描述Python服务、React前端、OpenAI兼容模型、营销信号/内容/审核工作区。借鉴渠道匹配和增长实验。当前仓库页面未给出明确许可证标识，本次按未知处理；不复制源码、不安装其服务，不接入发布凭据或自动投放。
- [OSSInsight](https://github.com/pingcap/ossinsight)：Apache-2.0，README和目录描述事件分析、ETL、网站与项目/开发者指标。借鉴指标口径与快照，不接入TiDB/事件分析平台或把静态Star当增长。
- [OpenDigger](https://github.com/X-lab2017/open-digger)：代码Apache-2.0，开放数据分析平台。借鉴活跃度需独立指标证据的思想；不引入分析引擎、OpenRank或历史数据依赖。没有取得的指标保持未知。

上述仅研究公开README/架构描述/公开能力入口及许可证，未下载、安装、执行或复制第三方源码；未验证其服务可用性。其公开接口不作为本阶段数据依赖。唯一运行期采集接口为GitHub官方REST。

## 数据与权限

入口 notes.html?github。规范化完整HTTPS/github.com地址；拒绝仿冒域名、凭据、HTTP、编码/省略号和不完整地址。支持从最近100条采集记录选择githubLinks并手工补全；补充保留X originalUrl，独立仓库快照保存为新笔记。原笔记和原商业报告可返回，不重新付费生成。

最多三个串行固定GET：/repos/{owner}/{repo}、/readme、/releases/latest；无Token/Cookie、拒绝重定向，10秒超时覆盖响应读取，2MiB流式响应上限；README base64最多180000字符、解码文本最多100000字符，超限未知而不截断冒充全文。无分页/后台轮询/自动重试，页面内仓库60秒冷却，共享当前模块限流，关闭页面后不保证冷却保留。403/429中止后续读取，404不能证明私有仓库不存在。只接受private=false且full_name归属匹配。官网只展示文本，不自动访问。Open Issue计数含PR；pushed_at/updated_at并非已采集提交历史。

每项保留来源API与采集时间，显示name/description/README/license/language/topics/stars/forks/openIssuesIncludingPRs/updatedAt/pushedAt/homepage/release/releasePublishedAt；缺项unknown/null，未核验实际收入、用户、增长及营销转化。不存在收入数据库或可信商业数据联查。

## 报告与兼容

新增第六个内置Skill，原五个定义不改。八栏：产品价值和目标用户；商业模式和变现机会；免费版与付费版设计；获客渠道与推广策略；竞品和差异化；开发、运营成本及风险；7天最小变现验证；30天推广与收费实验。

免费本地规则按描述关键词选择有限类型和有条件候选，不能等同AI深入研究或已验证商业结论。未知许可证暂停商业二次开发；已知SPDX也不等于法律许可审查完成。公开API数据、README第三方披露、推测、待验证假设明确区分。AI复用单笔记原文/证据目录、Schema、逐字证据、模型/资料/Token/费用预览和单次确认，失败不自动重试。增加明显商业数字的保守语义拒绝，不能宣称正则可以识别一切幻觉，仍需人工审核。

notes/analyses事务追加，无新表，无预算/历史费用迁移，不进入自动AI队列。支持原ZIP笔记/报告白名单、历史与截图机制。证据默认折叠，八栏复用0.2.9组件默认折叠、独立和全部切换。全文复制/导出包含来源及采集时间，来源附录按缩进文本防止活动Markdown。孵化走现有创建与人工资料审核，不执行代码。

## 自动验收

- TypeScript类型检查、生产构建、Manifest版本一致性/网络限制检查通过。构建保留主bundle超过500kB的体积警告。
- 全量Vitest：55个测试文件、1026项通过；最后针对GitHub/采集/模板的127项复验通过（包含在前述总数中，不重复计数）。
- Playwright相关回归：12项全部通过，覆盖GitHub完整/非法/短链手填、官方API Mock成功、八栏默认折叠/独立/全部切换、Markdown全文与来源、创建孵化项目、重开保留与零额外请求；原五类报告/旧Markdown、采集截图及X主帖隔离继续通过。
- 单元Mock另覆盖404/403/429/超时、2MiB上限、README/许可证缺失、逐项采集时间、公开仓库归属校验、商业数字编造拒绝；X完整href/data-expanded-url/title/可见文本与短链、引用/评论隔离，手工补链不覆盖并发正文。已有模板全量循环包括新模板的一次确认AI Mock保存，预览零transport，Schema及严格证据校验。未调用真实付费API。

## 原Chrome Windows-MCP验收

确认原扩展ID amodmncmpdbgdhdfdlfliaodpmcnkkao，加载目录为本仓库dist。通过Chrome详情页重新加载，实际版本从0.2.17变为0.2.18，未卸载、未清库、未改预算/服务商/密钥。用户占用时遵守USER_CONTROL，空闲后才操作。

实际打开新入口，输入授权范围内的公开IdeaClip仓库，点击获取；真实GitHub官方返回并保存独立快照，报告页正确选中专属模板，显示公开资料、来源与时间。真实返回含TypeScript语言和项目简介。最终构建重新加载并重开后历史快照保留、证据默认折叠、八栏折叠组件实际可见。未点击AI发送确认，不调用DeepSeek/OpenAI/Brave付费接口。局部脱敏截图保存在private/validation-0218/native-template.png及native-folded.png，Mock截图在Playwright test-results；不提交私人Chrome资料。未对原用户所有数据逐条计算更新前后哈希，不能声称做过该级验证；没有删除/覆盖旧笔记、截图、报告、项目、任务、预算。

## 遗留边界

短链不联网解析，只有t.co或截断名称保留待核实，需手工补完整地址。采集列表当前最近100条，无全库采集选择分页；历史资料是独立笔记，编辑副本会影响后续AI输入但保留旧报告。第三方历史活跃度、真实收入/月活/客户数、真实渠道流量和付费AI质量均未取得或验证。原Chrome本轮不新建测试孵化项目；孵化、重开、导出和旧数据兼容主要由隔离Chrome Mock回归验证。

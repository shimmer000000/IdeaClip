# 0.2.4 AI分析失败诊断验收

日期：2026-11-09。基线：`3796dbc4dc57b3be1af5db850af57b20f0c9660c`。本文件与0.2.4实现同一次提交，最终SHA见该文件所在Git提交。

## 已确认的问题与修复

用户截图来自单篇笔记的`analysis.html`，不是研究向导。原调用链为AnalysisPage → AIEngine.preview/run → chatTransport → JSON.parse → validateSkillReport → Markdown → analyses → aiUsage。原先通用catch把Schema和逐字证据错误合并为`schema`，并且校验时阶段仍可能是json；页面异常分支未清除“正在分析”消息。这足以确认诊断信息丢失及状态提示缺陷，不能证明历史模型究竟返回了哪一个错误字段。

0.2.4分开结构与语义验证：15栏商业报告首先读取现有静态Ajv的真实errors[0]，自定义Skills保留原有受限校验；固定字段/栏目序号、规则、实际类型/数组数/长度可见，额外字段名隐藏。逐字证据、源版本变化、本地校验器、格式化及保存失败单独分类。transport保留已取得的finish_reason和有界usage；流读取、外层JSON、内层JSON、空内容与明确截断分开，未知保持未知。失败后清除旧等待状态。

成功内容本地保存失败时保留当前内存报告，原“重试保存分析结果”只走save；恢复后更新诊断保存状态，不重复transport。诊断写入失败可从当前RequestFailure的安全元数据查看/导出，但页面提示历史未确认持久化。

## 数据、隐私与费用

- Dexie14→15只增加aiDiagnostics及索引，全机按时间保留20条；未迁移/清空旧业务表。
- 普通ZIP格式仍为6，兼容数据库版本1～15；诊断不进入ZIP。替换恢复不删除本机诊断、配置或费用账本。
- 摘要/JSON/Codex指令均从字段白名单重新构造。不输出原始模型响应、异常原文、私人笔记、URL、引用、凭据、Cookie、Header或工作路径。自定义模板名隐藏。
- 已取得usage与输入估算、输出上限、本地预算预留、服务商真实扣费分开。没有退款、重算、自动重试或诊断上传。
- 单笔记协议为kind/text/evidence。sourceId/quote/original属于研究协议，在单笔记里会被作为额外字段拒绝。研究来源错误同时细分为缺失、不存在、不可读；原有引用与original严格校验保持。

## 自动化结果

- 类型检查、生产构建通过，Manifest静态入口及网络限制检查通过。构建仍有现有大于500kB的分包体积提示，非构建失败。
- 新增诊断单元24项：真实Ajv缺失/额外字段、类型、空/超量数组、长度、非法sourceId、证据缺失/不匹配、Unicode/换行严格性、合法报告、空/截断/坏JSON、usage未知/已知、读取失败、源快照改变、本地保存重试、诊断落盘失败、20条与重开、旧记录、ZIP与数据库升级。
- 全量Chrome122项运行：121通过，1项旧截图用例在弹窗按钮就绪等待处超时。未改截图业务代码；最终生产构建后重跑诊断13项及全部截图9项，**22项全部通过**。122个场景均有通过证据，但不声称首次整轮全绿。
- 新增13项Chrome诊断场景使用本机Mock响应，拦截其他HTTP；实际下载JSON逐字段检查脱敏，关闭重开保留，查看/复制/导出/本地save重试均断言调用次数不增加。正常生成、模型失败、Schema失败usage保存、旧错误未知均覆盖。其余全量包含自动队列、截图/采集/笔记/管理、ZIP、研究、项目和交接回归。
- 最终全量单元：44文件，**864通过、1跳过**。单元与Playwright串行执行；固定8788 Windows启停测试因需保留用户服务跳过，其他随机端口Mock正常运行。

产物位于忽略目录：`test-results/ai-diagnostics-024-regression`（含旧截图失败Trace），`test-results/ai-diagnostics-024-final`（22项复测Trace与诊断下载）。不提交截图/Trace/浏览器配置。

## Windows-MCP实际验收

工具实际使用ControlStatus、App、Snapshot、Screenshot、Click、Shortcut、Type、Scroll。初期焦点被其他工作流切换时停止输入；重新识别唯一IdeaClip目标后继续。不调整桌面协调保护或关闭其他项目进程。

### 原用户Chrome

- 原Chrome窗口handle328532，通过扩展详情核对原ID`amodmncmpdbgdhdfdlfliaodpmcnkkao`及本项目dist加载目录。
- 点击原扩展“重新加载”，界面实际版本为0.2.4；不卸载、不清空数据。
- 原灵感管理仍显示7条。打开截图所对应的单篇冰河笔记AI页面，笔记与截图入口保留、分析历史仍无报告；没有点分析预览或请求确认。
- 点击“查看诊断报告”与“查看旧版错误摘要（只读）”，读到原schema失败记录。显示“历史信息不足，无法定位具体字段”，字段/规则等未知；没有把旧错误解释为本次新发生的错误，也没有恢复或伪造报告。
- 原库未注入Mock故障，未修改AI配置、账本、项目或任务。其他旧数据兼容由迁移/备份/既有浏览器回归覆盖，不以本次只读页面检查冒充逐表人工核对。

### 独立可见Chrome的Mock故障原生操作

Playwright先在独立配置创建唯一合成笔记，使用固定本机地址的route.fulfill Mock产生一次空数组Schema错误，并拦截所有其他HTTP。配置/域名权限替身仅在该隔离配置内。随后停止Playwright输入，将唯一“0.2.4诊断Mock验收”窗口（handle48575130）交给Windows-MCP。

- 原生点击“查看诊断报告”，看到ai_report_items / Schema阶段 / sections.summary / minItems / array / 数量0 / 第1栏；finish_reason=stop、实际输入321/输出654。
- 原生点击复制脱敏摘要，页面提示成功；点击导出JSON，实际下载并核验code/detail/usage，未含noteId、endpoint、content、apiKey、quote。点击复制Codex修复指令，页面显示已复制、不自动执行/上传。
- 原生刷新、关闭合成笔记标签、从about:blank重新输入同一笔记URL并打开诊断，同一个本机诊断与字段信息保留。Mock计数始终1，没有重新请求。
- 验收完关闭本轮独立context，原Chrome保留。此处是真实Windows鼠标/键盘操作合成Mock页面，不是DeepSeek真实模型验收。

脱敏局部截图（均不提交）：`test-results-native/ai-diagnostics-024/version-024.png`、`legacy-insufficient.png`、`mock-schema-detail.png`、`mock-reopened.png`。本机导出`diagnostic-export.json`同处。曾有其他软件窗口遮挡的截图未列为交付证据、未保存到上述脱敏截图文件。

## 能定位到什么程度与遗留

新单笔记失败可定位实际验证的第一个安全字段/规则及阶段；额外字段名故意隐藏，自定义栏目用序号，不能显示私人响应。JSON语法失败只说明无法解析；finish_reason不是length且无法解析时，不猜测一定截断。来源逐字校验不做空白/Unicode归一化。

旧schema/validation错误未保存原响应、Ajv错误、模板快照及usage时，无法还原具体失败字段、模型真实输出或当时真实扣费。原始失败没有报告可由诊断恢复；关闭页面后曾仅在内存的有效结果也不能保证恢复。本轮未获新真实付费重试授权，未调用DeepSeek/Brave或运行Codex任务，不改变原预算预留。

诊断不保证所有模型输出会通过现有严格Schema；后续兼容性修复应根据新的安全诊断用Mock复现。历史错误只能保留已知证据，不能补造详情。

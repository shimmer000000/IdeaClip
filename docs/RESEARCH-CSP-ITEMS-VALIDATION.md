# 研究页面CSP与报告栏目边界补充验收

日期：2026-11-08（Asia/Shanghai）。基线928800a62eb24492f7b968dc40b1882ff51fc2c3。本轮仅开发、合成资料及Mock测试；没有发起真实Brave或DeepSeek请求，没有读取密钥或改动用户费用账本、数据库、SSH及8788服务。

## 用户截图能证明什么

- 扩展错误页的notes.html?research出现“Executing inline event handler violates ... script-src 'self'”，内联事件已被阻止；截图中的Service Worker“无效”本身不能证明后台崩溃（MV3空闲会挂起）。不能为去掉错误而开启unsafe-inline。
- 更新后的研究向导第6步显示research_items。该码对应至少一栏不是数组、数组为空或超过8条；因此没有保存有效报告，预算保留，不自动重试。旧版没有栏目明细，无法确定具体栏目，更不能将此次截图反推为首次validation的确切原因。
- CSP与AI报告结构是两条不同路径。不能声称CSP导致模型生成空栏目，也不能因修复CSP就宣称真实十二栏报告成功。

本轮未获得新的实际usage或有效报告正文，不恢复/编造旧失败响应，不新增付费请求。

## CSP复现与修复

在独立Chrome配置、随机本机Mock代理及合成定价HTML中，加入img/onerror、details/ontoggle、iframe及自定义元素。旧版template.innerHTML路径复现与截图相同的两条CSP拦截，解析时就发生，早于事后删除事件属性。临时去掉合成onerror后告警消失；未将这个弱化样本作为最终通过样本。把模板移至离屏document或改用DOMParser仍触发告警，均未采用。

最终路径：parse5只将原始HTML解析为JavaScript数据树，再用应用固定标签白名单、createElement/createTextNode及仅id/class属性构造离屏DOM。原始HTML不进入innerHTML/DOMParser。脚本、事件、URL/样式/资源属性、媒体、iframe、表单、外部命名空间及隐藏/导航区域不进入生成DOM。未知标签只保留允许的子内容，不创建自定义元素。

保留Readability文章路径、静态定价卡片、文本实体和价格周期；输入UTF-8上限2 MiB，重建遍历上限50000节点/128层，超限拒绝，不将截断结果标为完整。没有调整Manifest/CSP、TLS、域名授权或SSRF规则。

Chrome验收保留危险属性原样作为测试输入，断言securitypolicyviolation及CSP控制台错误均为零，同时拦截非本机外部请求，验证没有脚本/媒体/iframe请求。重开保存资料仍可见。整套研究专项也加入CSP错误检查。

## 依赖审查

parse5 8.1.0已经是项目jsdom的测试依赖，本轮固定该版本并提升为生产直接依赖，未升级其他包；关联entities锁定已有9.0.0。生产构建使用ESM纯解析代码，不提供网络、脚本执行或动态代码生成能力。

- parse5包及仓库许可证MIT，entities为BSD-2-Clause；逐项核对本地LICENSE及npm元数据，不使用Readability包中另有MPL头的JSDOMParser子文件。
- 无install/postinstall脚本；安装使用--ignore-scripts。npm audit --omit=dev：0项已知漏洞（审计时间为本轮，不代表永久无漏洞）。
- 完整许可证复制到public/licenses/parse5-LICENSE.txt、entities-LICENSE.txt，Vite同步进入dist/licenses。
- Vite/TypeScript/Chrome构建验证通过。代价是主JS从约511 kB增至668 kB（gzip约202 kB）；原500 kB构建提示仍存在，不将其说成性能无影响。本轮不扩大为无关分包重构。

## 栏目边界改进

保留每栏1～8条和严格证据校验。research_items现在只输出应用白名单中的固定中文栏目标签，以及“不是数组”“空数组（0条）”“超过8条”三种固定原因；不回显模型自定义字段、原始响应、quote或来源ID。未知字段名和原型键不能进入提示。

提示词新增无反面证据时的合法hypothesis条目例子，明确每个栏目即使只有一条也必须为数组。示例标为结构示例，不能冒充已核验结论。不自动补齐栏目、不截断条目、不伪造证据，不进行自动修复请求或重试。旧记录不回填猜测栏目；新错误可在向导历史中保存安全提示。

## 测试结果

- 新增6项HTML安全单元：禁止原生HTML解析入口、实体/文本保留、事件资源/自定义/命名空间过滤、畸形HTML及隐藏内容、深度/节点/字节边界。
- 新增4项栏目安全单元：空数组、超过8条、非数组、未知/原型字段不回显；费用预留及单次请求断言保留。
- npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'：29文件、547通过、1跳过。
- npm run build：TypeScript、Vite、Manifest/资源/网络限制检查通过；生产许可证均进入dist。
- npm run test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'：再次547通过、1跳过。
- npm run test:e2e -- tests/browser/online-research.spec.ts：20项Chrome/Mock专项通过，41.2秒。包含CSP、HTML资源拦截、栏目错误提示、usage、向导恢复不重复请求、有效报告、孵化/Markdown、ZIP/权限/预算回归。不宣称运行了全量Chrome套件。
- 唯一跳过项独占真实8788端口，遵守保留服务要求。检查时127.0.0.1的8788及23334仍监听。

初始增强CSP断言先失败复现，再修复后通过；没有删除危险样本、吞掉控制台错误或放宽CSP使测试通过。

## 用户下一步与边界

扩展重新加载后，旧扩展标签页需要重新打开，历史错误列表不会自动代表新版本故障。可清除Chrome旧错误显示再观察；不要清除站点数据、卸载扩展或重置预算。Windows研究服务不需为本修复重启。

先核对新版本和已有报告/用量记录，不要反复点击付费分析。若继续真实验收，须用当前来源、提示词生成新的资料与费用预览；提示词变更影响估算，不能沿用旧费用截图。模型是否会遵守所有栏目与证据规则仍需实际返回验证，本轮未宣称通过真实DeepSeek验收。已有单次授权不用于自动重试。

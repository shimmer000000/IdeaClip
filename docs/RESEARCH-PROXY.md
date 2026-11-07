# IdeaClip Research Proxy v1

IC-013 第二阶段提供可替换的 `ResearchAdapter` 和默认 `proxyAdapter`。浏览器只向用户明确配置、授权的完整代理端点发送请求；不向搜索结果 URL 直接发 fetch，不扫描标签页或浏览历史。兼容代理应实现本协议，并自行承担合法访问、服务商授权、DNS/IP/重定向及服务端预算控制。页面中的命令和代码不执行。

## Windows 无命令启动

双击 `windows/Start-Research.cmd` 打开Windows原生服务窗口。脚本使用系统Windows PowerShell 5.1，只对本脚本进程使用执行策略参数，不修改系统执行策略或安装服务。Node24+存在、扩展ID/精确来源域名/代理密钥完整、8788端口空闲后才能启动。

代理访问Token默认随机生成，主动复制粘贴到扩展；30秒后仅在剪贴板仍为原值时清理。Brave Key通过遮罩输入框在本机填写，可以留空。没有密钥配置文件、命令行密钥、自动搜索或上游连接测试。Node子进程隐藏窗口，经匿名stdin接收一次配置；不把密钥放入argv或继承的Key环境变量。服务进程仍需在内存中持有密钥，本机同用户恶意软件/调试并非此机制可防御。

窗口需保持打开；点击安全停止或关闭窗口通过该子进程stdin发送stop，正常关闭HTTP连接，5秒未退出才终止所持有的子进程句柄。不会按端口或进程名杀其他程序。窗口异常退出导致管道EOF时子进程停止；不自动重启或续发费用未知任务。不提供常驻系统服务、开机自启、局域网或公网监听。

下述环境变量方式继续提供给技术用户，普通Windows用户使用服务窗口即可。

### Brave Key 是什么，是否必须填写

Brave Search API Key 是搜索服务凭证，与本地代理访问 Token、DeepSeek 模型 Key 分开。只有关键词搜索需要它；直接填写公开网页 URL 或 GitHub 仓库 URL、免费健康检查均可在 Brave 留空时使用。缺少搜索配置不等于本地代理未启动。

如以后需要关键词搜索，由用户在 [Brave 官方控制台](https://api-dashboard.search.brave.com/documentation/guides/authentication)自行选择当前套餐并创建 Key；费用、额度以账户当时显示为准，不自动申请或购买。仅在本地服务窗口的遮罩输入框填写，不发聊天、不填扩展、不写普通配置文件或终端命令。填写 Key 或健康检查成功都不证明真实搜索通过；每次实际联调仍须先确认关键词、请求数量、估算费用及可能消耗额度。

IC-016 的三个公开来源已通过生产安全代理进入独立 Chrome 验证，详情见 [验收记录](IC-016-VALIDATION.md)。普通 Mock 与显式免费来源 live 测试分别记证和隔离输出，禁止自动化测试调用真实付费搜索或模型。

## 参考实现与服务范围

### 可选的受信任本机 HTTP CONNECT 出站

默认仍为直连；不跟随Windows系统代理、PAC或HTTP_PROXY自动启用。Windows窗口新增“出站网络模式”：选择受信任代理、显式填写本机端点并勾选审查确认后，才可用于启动服务或免费诊断。改地址/模式或安全停止后须重新确认；每次打开窗口默认直连。

当前有意限定为`http://127.0.0.1:端口`或`http://[::1]:端口`，不接受localhost名称、远程代理、用户信息/查询/路径、SOCKS或代理认证；遇到407/不支持数字IP/3xx/异常隧道头即拒绝，不发Proxy-Authorization、不降级为域名CONNECT或直连。需要这些功能的部署须另行审计，不能用自定义URL逃逸。

服务内存配置可选字段：

```json
{"outbound":{"mode":"connect","endpoint":"http://127.0.0.1:端口","auth":"none","certificatePolicy":"node-default","approved":true}}
```

这里的“端口”须替换为用户审查后的数字，仅展示结构，不可直接当有效配置。未提供outbound为`{mode:"direct"}`。此字段仅经Windows匿名stdin传入服务或独立诊断，不是扩展配置、普通备份或付费授权，不写入命令行/环境变量/文件。独立诊断的`--configured`也只从stdin接受这一个受限对象，不接受Key或目标URL；普通用户使用窗口即可。

流程：先对目标域名做原有全部DNS回答公共IP检查，只选择首个已校验IP；向明确代理发送`CONNECT 数字IP:443`，IPv6加方括号，Host也为数字authority，不发送Brave Key、Cookie或代理Token。200且无额外隧道字节后，在原socket内建立TLS，SNI和证书按原始目标域名、`rejectUnauthorized:true`验证；ALPN固定HTTP/1.1。只有验证成功才通过一次性HTTPS Agent发送原站Host/路径及该原站需要的头。不进行第二次目标DNS解析、不换IP/重试、不跟随重定向。Key只进加密原站HTTP，不进CONNECT。

`node-default`是Node当前默认可信证书库/主机名校验，不等于自动导入所有Windows企业证书；不添加CA、不接受用户关闭验证。若用户进程自行配置了额外可信CA，也属于需自行审查的信任环境；本项目不修改。测试仅在独立合成子进程为临时Mock证书设置额外CA，不影响用户环境。

**信任边界**：客户端能固定CONNECT请求的IP并验证原站TLS，不能独立证明代理内部实际连接的IP。须审查受信任代理遵守数字IP转发、不用SNI/sniffing覆盖目的地址；未知/不兼容实现不能批准生产模式。CONNECT/TLS成功只是连接证据，不是该代理内部SSRF审计、Key认证或搜索额度证明。代理可看到目标IP、SNI及流量时序；不要将不受信任代理或中间人CA当作安全方案。无法满足时保持直连，修复可信DNS/网络路径，或另行审计在服务端固定IP、禁止私网/重定向的受控出站网关。

免费诊断沿用本次选择的出站模式，响应transport为`direct-pinned-https`或`http-connect-pinned-ip`，新增`outbound`和`connect`阶段，以及`OUTBOUND_PROXY_UNREACHABLE`、`CONNECT_REJECTED`、`CONNECT_PROTOCOL_INVALID`；仍不带Key/搜索HTTP、不增加搜索次数或预算。浏览器只显示/诊断服务当前固定模式，无权从网页请求更换端点或批准出站。实现与实测见 [出站代理验收](OUTBOUND-PROXY-VALIDATION.md)。

`tools/research-proxy.ts` 是可选自有代理参考实现，需要 Node.js 24+；插件和构建不会启动它。仅使用 Node 内置 HTTP/HTTPS、DNS、net、crypto，无新增 npm 依赖。当前内置上游为 Brave Web Search、公开 HTTPS HTML/纯文本和 GitHub 公开仓库元数据。Brave 协议依据[官方文档](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)：固定 `https://api.search.brave.com/res/v1/web/search`，通过 `X-Subscription-Token` 认证；不调用 LLM Context 等额外接口。真实账户与收费尚未验收。

不提供 Tavily、Serper、Google 等专用原生适配器，也不支持将这些 API 的原始 URL 直接填入插件。可以在自有代理中依法接入服务，再转换为本协议。参考代理不是 AI 模型代理；AI 综合仍使用现有 AIEngine 和原 AI 服务配置。

运行前由用户在本机安全设置环境变量，实际密钥不要写入仓库、普通备份、终端命令历史或聊天：

| 环境变量 | 用途 |
| --- | --- |
| IDEACLIP_RESEARCH_PROXY_TOKEN | 至少16字符的独立代理访问密钥，只授权给本扩展；不是 Brave/AI Key |
| IDEACLIP_RESEARCH_ORIGINS | 允许的完整 `chrome-extension://扩展ID`，多个用逗号分隔；不接受通配符 |
| IDEACLIP_RESEARCH_HOSTS | 允许访问的精确公开域名，逗号分隔，最多20个；不自动包含子域 |
| BRAVE_SEARCH_API_KEY | 自己合法持有的 Brave Search API Key，仅在代理进程中使用 |
| IDEACLIP_RESEARCH_PORT | 可选，默认8788 |

配置后自行运行 `npm run proxy:research`。默认只监听 `127.0.0.1`；扩展端点填写 `http://127.0.0.1:8788/research`，填写独立代理 Token 和来源白名单，再由用户批准该代理域名权限。远程部署需自行提供可信 HTTPS 入口、访问控制和出站防火墙；不要公开暴露无访问控制的代理。提供代码不等于已经部署或授权真实付费搜索。

## 请求与响应

请求为 POST JSON，固定完整端点，不跟随重定向，无 Cookie/Referrer。Bearer 只发送给代理。`allowHosts` 必须是服务端白名单的子集，服务端再次验证每个 URL。

```json
{
  "version": 1,
  "operation": { "kind": "search", "value": "公开工具 定价" },
  "allowHosts": ["example.com"],
  "maxText": 20000
}
```

- search：value 为最多500字符的搜索词；响应 `{version:1, results:[{url,title,snippet,publishedAt:null}]}`，最多5条。摘要只能标为 snippet，不自动转为已读全文。客户端和服务端均过滤不在授权范围的结果。
- read：value 为已确认的公开 HTTPS URL；响应 `{version:1,url,title,status:"readable",html,publishedAt:null}`，也可用 text 替代 html。不可读取返回 status=unreadable、空 text；没有公开日期时为 null，不推断。若代理已经截短 text，应附 `truncated:true`。
- github：value 为 `https://github.com/owner/repo`；参考代理只请求固定 GitHub 公开 API，返回公开名称、描述、许可证标识、星标/fork、归档、创建与最近推送时间。未认证访问，不发送 GitHub Token，不读私有仓库，不下载或运行项目。

read/github 返回 URL 必须与确认的标准化 URL 完全一致，客户端拒绝换源。错误使用非2xx与安全错误码，不返回上游错误正文或凭据。响应最多2 MiB，搜索结果最多5条；客户端正文上限100–30000字符，超出明确标记 partial。HTML在惰性 template 中清除脚本、资源、事件属性、表单、隐藏/导航区域后交给 Readability，不挂入活动页面，不下载图片。

## 免费健康检查与错误分类（IC-014）

IC-016C增加免费分阶段诊断与精确错误码，旧错误码继续兼容。`health`仍不访问上游；新增操作仅供用户主动诊断：

```json
{"version":1,"operation":{"kind":"diagnose","mode":"tls"}}
```

`mode`仅允许`dns`、`tls`、`environment`。固定主机`api.search.brave.com`，不接受URL/搜索词或DNS覆盖；TLS模式先校验全部DNS地址，再只对第一个已校验IP做TLS证书握手，不发送任何HTTP请求、Brave Key或搜索词。只携带浏览器→本地代理的独立鉴权Token，不转发上游。诊断不进入搜索分支、不增加进程搜索计数/本地预算，不改变开关。不能把认证/额度显示成通过。

响应严格为`{version:1,free:true,searchAuthentication:"untested",searchQuota:"unverified",stages:[{stage,code,elapsedMs}],environment:{node,httpProxyPresent,httpsProxyPresent,nodeEnvProxy,transport:"direct-pinned-https"}}`；不输出地址、代理URL、环境变量值或原始异常。扩展再次按白名单重建报告。Windows单独诊断入口还输出系统代理启用/8788端口空闲布尔值，不输出PAC地址或代理凭据。主动文件导出只含这些字段，不包括笔记、Key或请求正文。

`health.diagnostics`可只读最近20条安全阶段；内存环形日志最多30条、重启即消失，只有`stage/code/elapsedMs`。不会打印或写请求日志；更新/重启不改扩展预算。具体错误码、当前DNS证据和安全复测步骤见 [IC-016C](IC-016C-DIAGNOSTICS.md)。

超时仍为生产代理20秒、默认客户端30秒；浏览器免费TLS诊断等待25秒、Windows独立握手总限10秒。代理在DNS/建连/握手/HTTP阶段超时返回`UPSTREAM_TIMEOUT`和已知阶段；客户端自身到期为`CLIENT_TIMEOUT`；用户/权限/配置停止为`REQUEST_CANCELLED`。客户端配置短于20秒时可能先取消，只能标客户端结果未知，不推断认证失败。不自动延长、重试或轮换IP。

搜索成功响应可增加`searchStatus`：有合法结果为`OK`、Brave原始0条为`SEARCH_RESULT_EMPTY`、有结果但URL/白名单过滤后0条为`SEARCH_RESULT_FILTERED`。后两者是有效空搜索而非API失败，保存完成历史及明确状态，不自动抓取/扩域/重试。非法JSON/结构为失败，不能以空数组冒充成功。旧代理不提供此字段时保留“为空或过滤后无结果”的未区分提示。

主动POST到同一完整代理端点，沿用Origin和Bearer认证，不更换路径、不申请新权限、不改变联网开关：

```json
{"version":1,"operation":{"kind":"health"}}
```

响应示例（无密钥、无研究正文）：

```json
{"version":1,"service":"IdeaClipResearchProxy","noUpstreamRequests":true,"search":{"provider":"brave","configured":false,"verified":false},"allowedHosts":["github.com"],"usage":{"day":"2026-11-07","searchRequests":0,"searchLimit":50}}
```

只返回本地配置、来源白名单与进程内搜索次数。`configured:true`只代表填写了Key，`verified:false`始终明确账户、额度和上游网络未验证。没有上游健康探测、模型请求或付费请求，健康检查不计入客户端研究账本/服务端搜索次数。扩展只使用已保存端点、会话凭据和域名授权，5秒超时、16 KiB响应上限、禁止重定向；连接失败不自动重试。旧或自有代理应实现同一无上游访问契约，否则显示请求失败，不能把任意搜索API URL作为代理。

研究操作的安全错误码包括 `search_not_configured`、`search_auth`（上游401/403）、`search_quota`（402/429，可能额度或频率受限）、`search_unavailable`（5xx）、`search_invalid`、`search_budget`（服务端次数限制）。不向扩展传递上游错误正文/Key。已发搜索及失败/未知计入上限和本机估算，健康不计费；实际服务商账单仍以账户为准。搜索空结果或结果全被来源白名单过滤时保存完成历史并明确提示，不擅自扩大域名或自动重试。

## SSRF 与凭据边界

参考实现采用[OWASP SSRF 防护建议](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)中的白名单和地址检查思路，并使用 [Node HTTPS](https://nodejs.org/api/https.html) 的 TLS 主机名校验和自定义 lookup：

- 来源只允许 HTTPS/443、精确域名；拒绝字面IP、用户名密码、敏感路径/查询、尾点及未授权来源。搜索与 GitHub API 主机由代码固定生成，用户不能替换为任意上游。
- DNS所有回答均校验。任一私网、环回、链路本地、保留/文档/协议转换、映射或作用域地址使整个请求失败；只接受公开单播IPv4/IPv6。校验后的IP通过自定义lookup固定到本次连接，避免二次解析重绑定，TLS仍核验原域名。
- 客户端和代理均不跟随任何重定向；不自动尝试其他地址、协议或登录路径。取消/超时销毁请求，DNS完成后复查取消状态；响应/请求体/头大小有上限。
- 不转发代理 Token 或 Brave Key 给原网页；不带 Cookie、浏览器登录态或 Referrer。密钥回显丢弃；无请求数据日志。输入/输出及普通 ZIP 仍应避免用户主动填写秘密，脱敏不是任意秘密识别器。
- CORS只允许配置的扩展 Origin，POST必须有独立Token。默认代理上游总超时20秒、每日最多50次搜索；该搜索计数仅在进程内，重启会重置，不是服务商硬账单限制。浏览器持久预算另行限制，建议同时设置服务商账户限额及服务端持久配额。

不绕过登录、验证码、付费墙、站点访问限制或服务条款；限制性状态/页面明确不可读取。仅服务端获取公开HTML，不执行JavaScript，因此部分动态网页、PDF、重定向页面和受保护内容不支持。自定义代理的安全性不能靠一个协议声明证明，需自行审查和维护；扩展不承诺能验证任意第三方代理的DNS/IP实现。

## 收费与授权

配置保存只请求浏览器对代理的可选域名权限，不探测接口。联网开关默认关闭。预览冻结研究版本、问题、操作列表、来源白名单、配置与凭据版本，展示全部请求及按用户单价估算的费用；每次确认仅消费一次，10分钟失效。研究单次最多3次搜索+5个页面，研究最多500条联网资料，超过明确报错。

USD/UTC每日研究账本按每次请求在事务内预留，失败/取消/结果未知不自动退款；开始前检查整个计划的剩余预算，发出前逐次复查。它与原AI每日预算分别限制，不能视作真实账单保证。暂停/取消/关闭/撤销/改配置停止后续请求；只有确定未发送的操作可经新的预览确认继续。研究任务页需要保持打开，浏览器重启不自动执行，也不会重发已发但费用未知的操作。代理密钥只留扩展会话，重启后须重新配置授权。

AI综合是第二次独立授权：用户主动选择1～10份已采集资料，再由原AIEngine预览服务商、模型、精确文本、Token与费用。无截图、不联网、不进自动队列。结构化8栏报告只接受实际来源ID及逐字证据；原文/作者主张/AI推断/假设分别标识，未知URL拒绝。来源哈希证明保存内容一致，不证明来源真实或市场结论成立。

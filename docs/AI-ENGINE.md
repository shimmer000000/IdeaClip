# IC-007 手动 AI 引擎与安全约定

入口为 `analysis.html?noteId=…`，只由卡片、完整笔记或编辑页的显式链接打开。设置或打开页面不发送模型请求。`src/ai.ts` 的旧调用接口只提示用户走确认流程，不能绕过 `AIEngine`。

## 请求生命周期

1. 检查 AI 总开关、已保存笔记、未提交编辑、配置、域名授权与对应端点凭据。
2. 构造不可修改的发送快照：标题、采集正文、感悟、脱敏 URL，以及最多 3 张主动选择的本地 PNG/WebP。文本最多 200000 UTF-8 字节，单图最多 2 MiB。未选图时不读取原图；不下载远程媒体。
3. 返回独立的预览副本，显示完整端点、模型、内容、图像、Token 和费用估算。本次确认 ID 只可消费一次，10 分钟失效；改笔记/配置/凭据后重新确认。
4. 用户确认费用与资料；图像另需能力声明和上传确认。Web Locks 在扩展来源内串行处理请求；设置关闭、取消或页面关闭可以中止等待。
5. 在含设置、配置和 `aiUsage` 的事务中预留预算，重新核对门禁后才调用 transport。恢复数据库、配置变化与清除凭据也通过本地通知取消客户端任务。
6. 响应最多 1 MiB，拒绝 HTTP 失败、重定向、拒答、截断和工具调用；不读取服务商错误正文，不自动重试。
7. 对报告执行 JSON Schema 和来源证据校验，检查凭据回显（包含双层 JSON Unicode 转义情形）。成功后生成纯文本/转义 Markdown，按新 ID 保存历史，不修改笔记。失败记录仅含安全状态码、用量与预算。

## 兼容传输与代理

`AITransport.complete(config, key, messages, signal)` 为可替换传输边界，默认使用单次非流式 Chat Completions POST：

```json
{
  "model": "用户配置的模型",
  "messages": [
    { "role": "system", "content": "固定规则与报告 Schema" },
    { "role": "user", "content": "不可信资料 JSON，或明确选择的图像内容数组" }
  ],
  "response_format": { "type": "json_object" },
  "max_completion_tokens": 4096,
  "stream": false
}
```

输出上限参数可配置为 `max_tokens` 或 `max_completion_tokens`，按所选模型文档使用。成功响应为 `choices[0].finish_reason: "stop"` 与 `message.content` JSON 字符串，可附 `usage.prompt_tokens/completion_tokens`。图像使用 `image_url` data URL、`detail: "low"`；不会给服务商可自动下载的远程图片地址。OpenAI 请求额外设置 `store: false`。接口依据 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI JSON 模式说明](https://developers.openai.com/api/docs/guides/structured-outputs) 与 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 设计；JSON 模式不替代本地 Schema 校验，具体模型可用性未实测。

官方模式固定端点分别为 `https://api.openai.com/v1/chat/completions`、`https://api.deepseek.com/chat/completions`。自定义兼容 API 可指向用户自有安全代理，支持 Bearer 或“代理自行鉴权、不发送 Key”。代理应在服务端保管模型 Key、实施实际账户预算和来源鉴权，并返回上述响应形状；本项目没有代理后端，也未验证任意第三方兼容服务。

端点仅接受 HTTPS 或本机 HTTP（localhost / 127.0.0.1），禁止用户名密码、查询参数和 fragment。`fetch` 固定完整端点，设置 `redirect: 'error'`、`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`cache: 'no-store'`。不尝试自动跟随、重新授权或带 Key 重定向。超时 1 至 120 秒；最大输出 256 至 16384 Token。

## 凭据与权限

`chrome.storage.session` 为默认凭据存储，长期 `storage.local` 需单独选择并确认风险；两者限制为 TRUSTED_CONTEXTS。凭据绑定完整端点与版本，不回填密码框，不存入 Dexie、sync、环境变量、诊断日志、普通 ZIP 或报告。清除密钥时撤销当前主机授权并取消任务。该机制不等同硬件加密，本机恶意软件、调试权限与浏览器配置泄露仍可能读到 Key。优先使用自有安全代理，避免把真正模型 Key 交给客户端。存储能力参考 [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)。

为凭据添加 `storage` 安装权限；`https://*/*` 与本机 HTTP 仅为可选主机声明。保存配置时通过用户点击申请一个指定主机，不授予安装时全站访问，拒绝后门禁不发送。Chrome 主机权限不区分端口，应用仍逐次校验完整 URL 和配置版本。CSP 允许 HTTPS / 本机 HTTP 连接，仍禁止远程脚本和 unsafe-eval。参考 [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)。

## 报告与提示隔离

固定 JSON Schema 为 `schemaVersion: 1` 和 15 个必填栏目，每栏 1 至 8 条：`kind`（fact / inference / hypothesis）、`text`、`evidence`。`fact` 必须有发送原始文本内的逐字证据，界面显示“来源陈述（未独立核验）”；它不证明原网页说法真实。没有文本证据的图片观察使用推测或假设，未来收入、规模、盈利和成本预测应说明假设及验证方法。

system 规则由应用生成，网页正文/感悟/截图仅位于单独 user 资料，不能建立新系统角色。请求无 tools，不执行网页指令。Schema、证据、类型和长度校验可拒绝不合规输出，但不能保证模型对商业事实、因果或经济假设判断正确。报告应由用户核对，不承诺商业结果。

Ajv 只在构建期编译，提交固定 JSON Schema 和独立校验函数，使用原生 Unicode 码点计数，浏览器不动态编译或 eval。参考 [Ajv standalone](https://ajv.js.org/standalone.html)。`npm run build` 重新生成校验器与许可证；修改栏目需同步 Schema 脚本、类型、提示和测试。

## 预算、历史和数据

配置单价单位为 USD / 百万 Token，每日预算按 UTC 日计算。文本输入采用 system + JSON 的 UTF-8 字节数加 4096 开销；图像另加用户配置的每张 Token 预留；输出按最大输出计。预留微美元为向上取整的 `输入Token估算 × 输入单价 + 最大输出Token × 输出单价`，在事务中与当日预留之和比较，避免并发超用本地预算。

失败、超时、取消及未知结果不自动退回已提交预留，跨 UTC 午夜仍归属于原请求日期。读取失败记录异常也保留已知预留；实际 Token 如服务商返回则记录，只作信息展示。进程中断留下 reserved 状态显示“进行中或结果未知”，不擅自视作免费。

这是基于用户价格与图像假设的本浏览器限制，非实时账单、账户硬限额或跨设备限额，不能抵抗用户修改本地时钟/数据。推理、缓存、图像规则及价格差异可能使费用不同，应同时配置服务商账户限制。AbortController 只取消客户端 I/O，不保证服务商停止运算或计费。每次重新请求都须再次确认。

schema v6 新增 `aiConfig` / `aiUsage` 和 `[noteId+createdAt]` 分析索引，不修改旧笔记和图片。报告保存结构化内容、Markdown、模型、来源 origin、时间、输入摘要、笔记 revision 和图像数量，历史按新 ID 追加。保存失败时保留已取得报告，可复制/导出或无费用重试保存。

报告及元数据进入原 `analyses` ZIP；配置、凭据和本地预算不进入 ZIP。完整替换也保留当前 `aiConfig` / `aiUsage`，避免恢复重置预算。旧纯文本报告兼容；新设备重新配置服务商。普通业务表、截图及管理索引继续沿用原有事务和迁移路径。

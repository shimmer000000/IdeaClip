# 0.2.22 X项目链接采集修复

日期2026-11-11。基于c6f7b14cd2bb31ec293a3659d063f15c078028a8，起始工作区干净，origin/main一致。仅IdeaClip，无新依赖或AI请求。按用户后续明确要求新增自动解析，权限为只读webRequest及固定https://t.co/*，不增加所有网站必选授权。

## 用户截图与实际核实

截图中的可见GitHub地址是github.com/tangency-labs/…；采集只存t.co链接，旧预览显示“未识别到GitHub项目”。仅凭截图无法知道当时DOM是否含完整目标属性。

本轮对用户提供的短链做了一次匿名、限时10秒、禁止跟随重定向的HEAD，只读取HTTP跳转目标；真实301 Location为https://github.com/tangency-labs/solidcraft。这是最初的人工只读核实。随后按用户追加要求实现产品自动解析，并通过真实Chrome GET验证；未执行/克隆/安装项目，产品不保存Cookie或响应正文。

## 修复

1. 主帖已限定范围中的完整DOM地址候选扩充为data-expanded-url/data-full-url/data-url/href/title/aria-label/完整可见文本；仍使用固定github.com HTTPS规范化，不扫描页面JSON或私有接口，也不混入评论和引用。
2. X可能把可见省略号标为aria-hidden。原清理删除这个span后，截断地址前缀可能看似完整。现在只保留一个字面省略号，不恢复被隐藏的正文/URL后缀，继续拒绝猜测。
3. 只有短链/不完整地址时，预览说明“已采到短链接或不完整GitHub地址，仓库待核实”，不再把尚未核实说成没有链接。
4. 预览新增完整仓库输入，支持无协议github.com/owner/repo规范化，当前编辑的外链/正文/补链即时派生仓库列表，不再等保存后才显示。保存保留originalUrl、原短链、当前截图和原笔记/报告关系；非法短链/截断补充值禁止保存。沿用原保存流程，不自动重做AI报告。

## 用户追加要求后的自动解析

用户明确要求“自动解析短链接，是GitHub项目就写入”，优先于此前第一阶段暂不解析的限制。新采集完成后自动解析当前主帖外链；旧X采集打开collection.html?id=...时自动向自身后台请求该记录的解析，不需要手动填写。

请求仅允许固定https://t.co/{1～100位字母数字}，拒绝HTTP/凭据/非标准端口/查询/片段/仿冒域名；最多3个去重短链、每个最多3跳，整体10秒、每项3.5秒。credentials=omit、redirect=manual、无referrer，无自动跟随；只允许继续请求另一个合格t.co跳转。最终GitHub仓库只做固定HTTPS地址格式识别，不访问仓库正文、非GitHub目标或任意内网地址。格式识别不证明仓库存在、公开或安全。

Chrome对真实样本返回200小HTML，而CLI HEAD返回301，因此产品使用一次GET读取跳转响应：只读webRequest仅查看自身t.co GET的Location；200 HTML限64KiB、UTF-8、2000节点，通过现有parse5静态提取meta refresh（含noscript），不执行JS、不加载图片/外链。标题、普通a标签、脚本字面量都不当作跳转；多个矛盾meta拒绝。监听器在finally移除，成功/失败缓存60秒（最多200项），避免StrictMode/重开重复请求。缓存不存授权或费用。

只向现有links/githubLinks追加GitHub地址，保留原短链/原帖/正文/截图。旧记录后台事务复查sourceUrl及整个links快照，变化拒绝覆盖；不改用户未提交编辑。外链容量不足则提示，不截断旧链接。失败仍待核实，手填入口保留。无需重新生成AI报告，不修改预算和账本。

新增权限在Manifest与构建白名单中均限定，未使用webRequestBlocking，不阻止/修改用户流量。实现依据[Chrome官方webRequest文档](https://developer.chrome.com/docs/extensions/reference/api/webRequest)，不读取或持久化Cookie/Auth头，只查找Location。

## 验证

- 类型检查、生产构建和Manifest/版本一致性通过；原主bundle体积提示仍在。
- 相关单元测试首轮84项通过，覆盖五类完整属性、隐藏省略号、真实主帖选择与评论/引用排除。短链解析与浏览器适配器另24项Mock覆盖域名/协议/私网/非GitHub/循环/上限/预算/HTML/不执行脚本/自身请求归属/失败缓存和监听清理。最终全量Vitest：58文件、1083项通过；Playwright相关10项全部通过，包含普通采集/截图、自动短链/手填、GitHub/个人模式报告、孵化和深色。
- 普通Playwright的后台t.co fetch默认Mock（404或固定meta响应），不发送真实短链请求。合成X验证自动写入、原始短链保留、重开缓存、待核实与手填兜底。独立live模式仅显式授权的公开t.co一次GET，1项通过；断言整轮重开只有一笔t.co GET、没有GitHub/外站请求。已通过用户样本→solidcraft自动写入及重开，非Mock结果分别记证。
- 原Chrome先遇到USER_CONTROL，空闲后通过Windows-MCP正常重新加载：同一扩展ID实际从0.2.20更新至0.2.22。打开原有最新X采集，生产后台自动核实短链并将solidcraft加入GitHub项目栏，无人工输入；刷新重开后仍显示，保留原截图与原采集。未点击保存表单、未重做AI报告或修改费用。脱敏截图private/validation-0222/native-auto-project.png。本轮不通过底层数据库直接改写用户Chrome资料。

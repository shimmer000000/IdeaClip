# 0.1.4 GitHub只读同步验收（2026-11-08）

基线03d85d9819a2510df42839bdb25012f5bbc2530d。代码和Mock验收通过；**原有扩展重新加载及真实GitHub API验收未完成，不能将本阶段整体标为真机通过。**

## 实现

- 项目任务手动刷新已有仓库/Issue/PR/Commit，固定GitHub官方REST GET，无Token、Cookie、Referrer或写入接口；拒绝重定向。运行时只请求`https://api.github.com/*`。原Manifest已有自定义AI/研究使用的可选HTTPS范围，本轮未扩大或授予全站权限。
- 查询Issue类型（识别实际PR）、PR草稿/开启/关闭/合并、Commit完整40位SHA/摘要/时间；短SHA必须匹配返回完整SHA前缀，返回HTML URL须属于当前关联仓库。只保留有界纯文本，不执行响应中的内容。
- 保存每类最后成功结果/成功时间、当前查询时间、来源及固定安全错误码。失败不清除旧成功快照，但明确显示当前未核实；404提示不可访问或不存在，不能据此否认私有对象存在。PR/Commit状态从不修改人工验收或看板完成状态。
- 每次最多3个串行请求，单请求10秒超时、响应2MiB上限；同关联60秒冷却，Web Locks串行避免多窗口重复发送；ETag条件GET与304缓存。限流停止剩余请求，不重试，按Retry-After/reset等待（1分钟下限、24小时上限），本机storage.local保留限流时间，不进入ZIP。没有后台轮询或定时联网。
- 手动刷新、总览按已加载项目筛选；项目列表可加载更多项目。UI按渲染时的15分钟边界、引用变化或导入标记区分历史过期；无实时刷新计时器。任何旧成功结果均显示其时间，不声称持续验证。
- 有未保存项目/任务编辑时禁刷新；查询期间新产生的编辑不会被结果回填覆盖。保存查询时事务重新核对关联并只更新当前记录，保留最新业务字段，旧窗口通过revision冲突拒绝覆盖。

## 数据与备份

原projects任务增加可选githubRemote，不改Dexie表/索引和v14迁移链，不重写旧数据。ZIP v6白名单包含远程业务快照，剔除ETag/限流执行状态；摘要经过现有凭据脱敏，恢复一律historical=true，不当作最新查询。workspace绝对目录、密钥及授权继续排除。旧0.1.3关联和人工验收保留，查询不会给任务授予完成或执行权限。

## 自动化结果

- `npm run typecheck`、`npm run build`通过；Manifest/页面/静态资源/版本一致性检查通过，应用0.1.4。既有大于500kB主包警告仍在，不扩展为无关重构。
- `npm test`和`npm run test`使用`--maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\.1真实启停)'`：33文件、620通过、1跳过；跳过独占8788的真实启停，避免停止用户服务。
- 新增11项单元覆盖正常三类对象、Issue实际PR、合并/关闭/草稿、短SHA、跨仓库拒绝、401/403/404/500/429、断网/非法JSON/超时、零授权请求、冷却、ETag/304、真实ZIP往返历史标记及任务状态保留。
- `npm run test:e2e -- tests/browser/github-sync.spec.ts tests/browser/github-tasks.spec.ts tests/browser/task-instructions.spec.ts tests/browser/ai.spec.ts tests/browser/online-research.spec.ts`：49项Chrome Mock通过。最终构建复测GitHub与指令专项4项通过，最终缓存边界调整后新专项再测1项通过，新增过期快照/404/重开/总览/手动去重验证。没有执行未列出的全部e2e。
- 新增Mock截图：`test-results/0.1.4-final/github-sync-GitHub只读Mock：权限、短SHA、手动刷新去重、重开持久化与总览，状态不自动完成/github-readonly-mock.png`（以本机实际测试产物路径为准）。隔离Chrome、合成数据，非Windows-MCP真机截图，不上传Git；真实桌面截图含无关窗口，未保存或上传为项目证据。
- 旧截图/正文/AI/对比/研究/孵化/备份回归在上述套件中通过。全程不访问真实DeepSeek或Brave，不操作服务器、SSH或费用账本；8788/23334仍监听。

## Windows-MCP实际操作与阻塞

已从当前工具列表发现并调用Windows-MCP，未安装或更改配置。实际使用`ControlStatus`、`Wait`、`Snapshot`、`App`、`Click`、`Shortcut`、`Type`；观察到UI Automation树、窗口句柄、截图和焦点。首次Snapshot返回USER_CONTROL，等待后恢复。Screenshot能力已发现，截图实际由Snapshot提供。Click尝试被USER_CONTROL拒绝；Type首次因缺少loc/label参数拒绝，没有输入文字。

App实际启动Chrome，第一次出现配置选择器；只读查看“Shimmer Chrome”快捷方式确认Default配置后再次启动。命令返回成功，但UI仍为新标签页，不能据此声称已到扩展管理页。后续Ctrl+L期间前台被其他Chrome工作流切换，读回显示非IdeaClip页面；未输入URL、点击业务控件或提交数据，立即停止桌面输入以免干扰其他项目。未关闭用户窗口，未更改其他项目文件或系统设置。

因此以下均**未取得证据**：原扩展加载目录实际核对、原扩展重新加载至0.1.4、旧真实测试任务/人工验收记录读回、原生api.github.com授权、真实Commit GET成功、真实查询错误/重开持久化和关键页面截图。没有用CLI、独立Mock或构建版本替代这些真实结果，也没有推断仓库公开性。真实API本轮未调用。

后续需要可独占且焦点稳定的桌面时段，由代理继续Windows-MCP自动验收；不需要用户提供Token、公开仓库或执行终端命令。真实安装/原生权限/真实API与隔离Mock结果始终分别记录。

协议依据：[GitHub REST最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)，包括串行请求、条件GET、限流及私有资源404歧义。无Token的304不承诺免计入GitHub限额。

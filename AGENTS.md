# IdeaClip 开发约定

- 只修改本仓库，不修改其他 GitHub 项目。
- 当前授权范围为 IC-002 正文与来源采集，保留 IC-001；IC-003 至 IC-006 等待用户指令。
- 每完成一个阶段创建 Git 提交，提交信息使用中文。
- 推送前检查 remote 确为 `https://github.com/shimmer000000/IdeaClip.git`，禁止强制推送。
- 不提交 API Key、私人笔记、数据库、截图、浏览器配置和敏感配置；检查暂存文件及差异。
- AI 总开关默认关闭。未来接入服务必须经过统一门禁，并明确数据发送范围；当前禁止网络请求。
- 正文采集仅使用用户已授权页面中可读的内容，不绕过登录、付费墙或访问控制，不调用私有接口。X 真实样本与本地模拟测试分别报告，无法读取的真实样本不能标记通过。
- 提取结果只按纯文本展示，链接与媒体 URL 仅接受 HTTP / HTTPS；不得渲染来自页面的 HTML，不自动请求远程媒体。
- schema 变更通过 Dexie 版本升级，不能直接删除用户数据库。
- 修改后运行 `npm test` 和 `npm run build`；用户界面变更还需要真实浏览器验收。
- 报告 commit SHA、实际测试结果和遗留问题；未经测试的功能不得标记完成。
- 已接入本地 CodeGraph；理解、定位或修改代码前，优先使用 `codegraph_explore`（传本仓库绝对路径）或 `codegraph explore`。
- 新环境按需运行 `codegraph init --yes .` 建立索引，修改代码后运行 `codegraph sync`。`.codegraph/` 含本地索引，不上传 GitHub。

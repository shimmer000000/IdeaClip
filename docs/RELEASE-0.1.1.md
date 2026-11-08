# IdeaClip 0.1.1

日期：2026-11-08。基线287926a865797ca0a2426c056a5048ae7fd487a4。

- 应用从0.1.0递增到0.1.1，同步package.json、锁文件根及packages空键、public/manifest.json及dist构建。
- 弹窗/设置页的版本取自package.json，移除“初始版/项目初始化”固定文字；Chrome扩展管理读取Manifest版本。
- 构建检查拒绝Manifest、package、锁文件版本不一致。后续交付按修复patch/功能minor递增，不通过修改数据库版本冒充应用更新。
- 用户新截图为research_original_mismatch：text与quote不相同，但没有取得响应正文，不推断具体差异，也不能由截图确定已加载构建。
- 新研究请求的Schema和提示词改为claim/inference/hypothesis，原文由quote证据编号展示；不要求模型同时生成original text，减少重复拷贝不一致。已有original报告及严格相等/逐字来源校验不变，不自动把错误original转为claim。

验证：

- npm test及npm run test（--maxWorkers=1，并排除独占8788的Windows PowerShell5.1真实启停）：两轮各556通过、1跳过。
- npm run build：TypeScript、Vite、Manifest/资源/权限及新增版本一致性检查通过。dist/manifest.json为0.1.1；仍有既有约670 kB主包提示。
- npm run test:e2e -- tests/browser/online-research.spec.ts：21项Chrome/Mock专项通过，43.6秒；设置页显示的版本与该独立配置实际加载Manifest版本一致。覆盖新请求枚举/提示词、证据编号、保存/重开、CSP与既有研究/预算/权限/ZIP回归。
- 未操作用户真实Chrome配置，未将Mock验收宣称为用户已安装0.1.1；未清空数据库、修改真实预算或停止8788/SSH服务，没有发起真实Brave/DeepSeek调用。

重新加载同目录dist扩展后Chrome会读取新版本；无需卸载、重新安装或迁移用户数据。新版模型真实返回仍待新的资料与费用预览后单次验收，不承诺仅凭Mock已经解决所有真实模型格式问题。

## 用户真实截图补充（2026-11-08）

用户提供真实Chrome研究向导长截图，已放大只读核对：第6步打勾、当前进入第7步，状态显示“商业机会报告已保存”；综合报告历史存在deepseek-flash条目，界面时间为2026/11/8 09:43:13。报告显示中文结论、作者主张、来源ID与逐字证据，并提供复制、Markdown导出及“使用报告创建项目草稿”入口。由此将真实模型返回被应用接受、报告保存成功的界面验收标为通过；不是本轮代理新发起的请求，也不是Mock结果。

截图中的“研究版本3”是研究计划修订号，不是插件版本或JSON Schema v3。没有直接读取用户IndexedDB、API响应或密钥，不从截图推断实际安装版本、完整Token/费用、每条语义相关性或事实真实性。长图未覆盖报告末尾，不能声称人工逐项核对了全部栏目。旧失败记录不清理、不回填。

仍待证据：报告关闭重开后的持久化、实际复制/Markdown下载文件、服务商此次usage和账单、项目草稿人工审核及最终项目保存。入口可见不等于对应操作已验收。没有重复搜索、分析或修改预算。本次只更新验收文档，不更新可安装代码，应用仍为0.1.1；不提交用户截图、报告正文、来源ID或研究ID。本次文档核查使用git diff --check，不重复执行或冒称新增自动化测试。

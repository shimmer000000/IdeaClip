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

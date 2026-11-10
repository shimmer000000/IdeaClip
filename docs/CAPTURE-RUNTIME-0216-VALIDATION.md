# 0.2.16 截图后台兼容排查

日期：2026-11-10；基线12f8c913e56873d5e3e01c46f9981e63bdfc0626（0.2.15），开始工作区干净。

## 观察与确切问题

用户截图显示新“分段截长图”按钮，同时报“无效的截图方式”。本机0.2.15源码及dist/background.js均明确接受segment。隔离Chrome的真实分段截图已通过，截图不足以证明用户实际加载的worker版本，也不能排除其他旧加载目录/旧页面混用。

可证实的产品缺陷是前后台没有兼容协商：旧后台拒绝新方式后直接显示通用错误，界面无法指导安全恢复。此版修复该门禁与提示，不宣称已复现用户原worker内部状态。

## 修复

- requestCapture在弹窗、预览和笔记编辑页统一执行：先核对页面构建版本与当前manifest；固定IC_CAPTURE_CAPABILITIES只读查询协议1、构建版本及可用方式，3秒超时。
- 后台能力查询仅响应自身扩展页面，不读取网页、数据库、凭据或网络。仅完整匹配后发送一次原截图请求；未知/旧版/失联/缺能力不发截图，不回退其他方式或自动重试。
- 既有“无效的截图方式”响应安全映射为重新加载指引。明确不要卸载，先在chrome://extensions的IdeaClip卡片点重新加载，再关闭重开旧扩展页面；不要只刷新目标网页。
- 不自动调用runtime.reload，以免打断用户编辑或正在进行的分析。没有删除/重建数据库或改动预算。
- 弹窗四个截图按钮改为两列，避免狭窄空间导致按钮文案碎行。原长图/分段上限、权限、取消恢复和Blob保存不变。
- 应用版本package/lock/manifest同步0.2.16，无依赖更新。

## 验收边界

- 13项request单元通过：四种模式协商、旧后台/协议/版本/能力拒绝、manifest不符零消息、失联/超时不发截图、旧方式错误指引及原业务错误保留。
- 类型检查、生产构建通过；原有大chunk警告保留。
- 完整单元：54个文件、987项通过、1项固定8788端口Windows启停测试跳过；没有停止用户服务。
- 最终Chrome联合回归：30项全部通过（1.7分钟），含4项新协商/窄屏/旧后台/超时，及26项可见、区域、长图、分段、笔记关联与重开回归。
- Playwright首次加载测试文件时发现Node JSON导入缺少type属性（尚未执行用例），仅改测试为固定路径readFileSync读取包版本后重跑，上述30项通过；生产代码未因此修改。
- 已目视核对两列按钮与重新加载提示截图，文字完整。命令：`npm run test:e2e -- tests/browser/capture-runtime.spec.ts tests/browser/long-capture.spec.ts tests/browser/capture.spec.ts tests/browser/inspiration.spec.ts --trace=on --output=test-results/capture-runtime-0216-final`。
- Git HTTPS fetch连接重置，使用GitHub连接器核实远程基线并提交相同Git树，main非强制快进；不修改本机网络配置。
- Chrome自动化使用独立临时配置与合成网页；旧后台/manifest/失联仅Mock，不冒充原用户故障复现。当前后台能力和原截图流程实际调用Chrome扩展API验证。
- 原桌面：ControlStatus两次返回USER_CONTROL（generation188）；窗口枚举仅发现其他工作流Chrome，无明确IdeaClip目标，未输入、抢占、重载或改用户数据。computer-use技能已读取，原Chrome安装更新未完成。
- 未调用DeepSeek/Brave等付费API；未操作SSH、8788/23334、服务器或其他项目。截图、Trace只保存在忽略目录。

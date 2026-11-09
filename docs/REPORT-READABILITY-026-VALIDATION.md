# 0.2.6 AI分析页阅读排版验收

日期：2026-11-09。基线f230701e3cbeec78660c57318db8b6baf68ebeb0。

## 改动范围

按用户三张截图调整单篇AI分析页：普通说明17px；模板选择、按钮、预算/风险说明、截图legend等16px；报告元信息与正文18px，来源摘录16px、信息类型标签15px。报告标题24px、栏目标题21px，增加本地CSS栏目编号、分隔与留白；摘录另设白底分区，保留来源/推测/待验证标签。窄屏减小内边距，长文字自动换行。

仅改src/ai/ai.css、安装包版本与说明文档；不改AIEngine、提示词、Schema、报告文字、数据库、权限或费用记录。历史报告无需重新调用AI即可采用新样式。package、lock与manifest同步0.2.6。

## 自动化与视觉核对

- npm test：45文件，875通过、1跳过。跳过固定8788服务启停用例，不停止现有服务。
- npm run build：类型检查、生产构建、Manifest与资源检查通过；保留原有大包体积非阻断提示。
- npm run test:e2e -- tests/browser/ai.spec.ts tests/browser/ai-diagnostics.spec.ts --trace=on --output=test-results/readability-026：39项通过。包含正常报告、诊断、保存重试、重开、备份、预算和授权回归，模型全部Mock。
- 另外使用独立临时Chrome配置注入合成笔记与旧格式15栏报告，全部HTTP请求拦截；1100px桌面与390px窄屏人工查看截图，栏目/标签/引用正常，窄屏文档宽度375px（含滚动条）未超过390px视口。读取实际computed style：正文18px、引用16px、报告元信息18px、页面说明17px、模板选择/截图legend16px、诊断说明17px。关闭自建context后才进行Windows操作。
- 合成视觉截图仅在本机忽略目录test-results-native/readability-026：desktop.png、narrow.png、analysis-controls.png。不提交图片、Trace或浏览器数据；截图中内容为合成示例，不是用户报告。

## 原用户Chrome

Windows-MCP控制权ready；核对本次已有窗口句柄41499104，避免同名Chrome窗口选错。正常重新加载原扩展，详情UI确认0.2.6；打开原“冰河”单篇笔记，模板1.0.1仍可读取，放大的预算/说明可见。未卸载、清库、改浏览器缩放、点击AI分析或重试。

随后其他工作流把焦点切到VideoFlow窗口，停止进一步桌面输入，没有强行抢占或操作该项目。因此原用户报告正文的完整原生截图未取得，报告排版通过隔离Chrome合成数据验证，不能把它称为原用户报告真机全量验收。安装版本与原笔记入口已真实核对。

未调用真实DeepSeek/Brave或其他付费API，没有重生成任何用户报告。

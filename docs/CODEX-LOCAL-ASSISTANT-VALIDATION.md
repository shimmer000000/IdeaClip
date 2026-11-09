# 0.2.0 本地交接助手验收

日期：2026-11-09。开发基线：29de382c17ad45e9ea253cb04e738de359d244b4。发布版本0.2.0；最终交付提交以包含本文的Git提交为准，避免在提交内伪造自身SHA。

## 环境与范围

- Codex CLI 0.165.0通过版本和帮助只读检查；桌面版26.1103.4239.0进程存在。没有启动`codex exec`、app-server或导入开发任务。
- Node24.22.0；现有Playwright Test1.65.0由Codex开发终端直接调用，无额外Playwright MCP或新依赖。
- CodeGraph用于追踪任务包/交付/收件箱/边界，并同步索引；Windows-MCP用于原Default Chrome，未给Playwright原用户配置。两者未同时控制同一窗口。
- 只修改IdeaClip。没有调用Brave/DeepSeek/付费服务、Agent Autoloop或修改SSH、8788/23334、服务器及费用历史。没有清空数据库。

## 自动化结果

|检查|实际结果|
|---|---|
|`npm run typecheck`|通过，包含测试引用到的一次性CLI|
|`npm test -- --maxWorkers=1 --testNamePattern '^(?!.*Windows PowerShell5\\.1真实启停)'`|39文件，766通过，1跳过|
|助手专项单元|24通过；真实隔离Git root/origin/脏目录、v1/v2兼容、Schema/哈希、链接/联接、嵌套仓库、穿越/设备名、文件和目录限制、重复/冲突/错目标、无执行参数|
|`npm run build`|通过；原有主包超过500kB提示仍在，无新构建错误|
|10个相关Playwright文件，`--trace=on`|58通过，包含新增1项完整助手链路；其他为既有交接、交付、GitHub、AI与研究Mock回归|

固定8788启停测试跳过以保护用户服务，不声称本轮通过。访问拒绝验证安全映射及既有浏览器目录能力替身，未修改真实Windows ACL制造错误。单元测试仅在`test-results/assistant-workspaces/isolated-*`新建并清理合成Git目录；没有执行导入命令。

Playwright完成实际Chrome下载JSON → 实际Node CLI检查该下载 → 合成交付v2收集 → IdeaClip扫描 → 人工确认导入 → 关闭重开 → 重复拒绝。网络拦截计数0，不调用真实GitHub核验。旧有Mock回归同时覆盖ZIP恢复、人工验收不自动变化及原功能。

隔离产物：`test-results/0.2.0-regression/`，含Trace、下载及截图，全部忽略不提交。CLI代码与浏览器共用`decodeTaskPackage`、`validateCodexReport`、文本脱敏及固定Schema，不降低证据真实性要求。

## Windows-MCP 原Chrome实际操作

已安全取得ready状态后，仅切换唯一IdeaClip窗口（handle2628418），不操作前台其他项目。使用`ControlStatus / App / Snapshot / Screenshot / Shortcut / Type / Click / Scroll`，先读目标/焦点，操作后核对；原生文件弹窗UI树不足时使用局部截图。

1. 原扩展ID `amodmncmpdbgdhdfdlfliaodpmcnkkao`，加载目录为本项目`dist`；扩展管理页重新加载后实际显示0.2.0，未卸载或清数据。
2. 旧0.1.8隔离验收项目、任务包及0.1.9导入历史仍在。只复用这个明确标注“不执行产品开发”的合成任务，不改正式任务。
3. 对此前下载的该包执行本机助手检查，真实origin/目录/范围匹配；当前IdeaClip代码尚未提交，正确输出`blocked-uncommitted-changes`，始终`authorized:false`。
4. 主动收集专用合成目录：`delivery.json`有效、`wrong-repository.json`为`REPOSITORY_MISMATCH`。通过原生Windows多选文件框选择这两份；选择本身不读取内容。
5. 主动扫描后有效报告“检查通过，待确认”，错仓库报告“拒绝”。只勾选有效项并明确确认关联，界面成功1、跳过0、失败0。被拒项未被导入，也不计作已选择项的导入失败。
6. 任务证据中新增v3导入历史，明确合成Mock、未执行产品开发/测试；仍为“人工验收：待开发 / 看板：todo”，无执行记录或GitHub核实声明。
7. 关闭本轮页面后准备重开时，Windows-MCP曾返回`USER_CONTROL`，立即停止输入，未操作前台其他项目。随后`ControlStatus`恢复ready，才以原Default配置重新打开IdeaClip（新handle1454618）。实际重新显示v3、同一报告ID/包哈希/合成摘要/未执行测试说明；旧包和之前历史仍保留，收件箱回到“未选择本地目录或文件”。再次核对人工验收仍待开发、看板todo。原用户Chrome重开持久化通过，与隔离Playwright证据分别记录。

原生截图仅本地`test-results-native/0.2.0-real/`：`version.png`、`assistant.png`、`filepicker.png`、`preview.png`、`import.png`、`review.png`、`reopened.png`。截图范围为IdeaClip及合成文件，未上传GitHub。

## 限制与未完成事项

- 没有真实任务执行能力，也没有执行授权令牌/消费接口；仅保留“单次明确批准后才可能执行”的边界。本轮不执行任务符合范围。
- CLI不读取浏览器导出历史或任务revision，不可独立认定包仍获审核；浏览器最终确认复查当前绑定。哈希不是身份/签名，合成报告不是实际开发成果。
- CLI不持久记录扫描去重；跨次重复最终由IdeaClip历史拒绝。未实现Git worktree `.git`文件布局，保守拒绝。
- 原生目录授权和真实Windows ACL拒绝未制造/复验；受限原生多文件路径实际通过，目录逻辑单元/替身通过。
- 本轮没有真实GitHub API调用，也未对全部私人项目逐条读取；只核对原隔离验收项目/任务及相关旧历史。没有把Mock或未取得的远程结果记为真实核验。

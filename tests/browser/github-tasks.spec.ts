import {test,expect,type Page} from '@playwright/test';
import {collectionHarness} from './collection-harness';
let harness:Awaited<ReturnType<typeof collectionHarness>>,page:Page;const requests:string[]=[];
const repo='https://github.com/example/synthetic';
test.beforeEach(async()=>{
  requests.length=0;harness=await collectionHarness();await harness.context.route(/^https?:\/\//,route=>{requests.push(route.request().url());return route.abort();});
  await harness.context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>Object.assign(globalThis,{copiedTask:value})},configurable:true}));
  page=await harness.context.newPage();await page.goto(`chrome-extension://${harness.extensionId}/notes.html?projects`);await page.getByRole('button',{name:'创建孵化项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('合成GitHub关联项目');await page.getByRole('button',{name:'保存项目',exact:true}).click();
});
test.afterEach(async()=>{await harness.context.close();expect(requests).toEqual([]);});
const save=async()=>{await page.getByRole('button',{name:'保存任务',exact:true}).click();};
const edit=async()=>{await page.getByRole('button',{name:'编辑任务',exact:true}).click();};
test('GitHub引用保存/重开/修改/删除，跨仓库拒绝，人工验收后独立完成且零外部请求',async()=>{
  await page.getByRole('button',{name:'新增任务',exact:true}).click();await page.getByLabel('任务标题',{exact:true}).fill('核对本地保存提示');await page.getByLabel('任务验收标准',{exact:true}).fill('展示明确结果，不改变其他项目');
  await page.getByRole('button',{name:'添加 GitHub 关联'}).click();await page.getByLabel('GitHub 仓库地址',{exact:true}).fill(repo);await page.getByLabel('Issue 编号',{exact:true}).fill('12');await page.getByLabel('PR 链接',{exact:true}).fill('https://github.com/other/repo/pull/34');await save();await expect(page.getByRole('alert')).toContainText('指定仓库');
  await page.getByLabel('PR 链接',{exact:true}).fill(repo+'/pull/34');await page.getByLabel('Commit SHA',{exact:true}).fill('abcdef1234567');await page.getByLabel('Codex 开发结果摘要',{exact:true}).fill('合成结果：保存提示已修改，等待人工检查');await page.getByLabel('开发验收状态',{exact:true}).selectOption('awaiting');await save();
  const card=page.locator('.project-board article');await expect(card.getByText('开发验收：待验收',{exact:true})).toBeVisible();await expect(card.getByRole('link',{name:'Issue #12',exact:true})).toHaveAttribute('href',repo+'/issues/12');await expect(card.getByRole('link',{name:'PR #34',exact:true})).toHaveAttribute('href',repo+'/pull/34');await expect(card).toContainText('远程状态未验证');await expect(card.getByRole('button',{name:'人工验收通过，设为已完成'})).toBeDisabled();
  await page.reload();await page.getByRole('button',{name:/合成GitHub关联项目 ·/}).click();await edit();await expect(page.getByLabel('Commit SHA',{exact:true})).toHaveValue('abcdef1234567');await page.getByLabel('PR 编号',{exact:true}).fill('35');await page.getByLabel('PR 链接',{exact:true}).fill(repo+'/pull/35');await save();await expect(card.getByRole('link',{name:'PR #35',exact:true})).toBeVisible();
  await edit();await page.getByLabel('开发验收状态',{exact:true}).selectOption('passed');await page.getByLabel('验收说明',{exact:true}).fill('人工检查合成结果');await page.getByLabel('开发验收测试结果',{exact:true}).fill('Mock本地保存和重开通过，未访问GitHub');await save();await expect(page.getByRole('alert')).toContainText('人工勾选');
  await page.getByRole('checkbox',{name:'我已人工核对本任务交付、验收说明和测试结果，确认本次验收结论'}).check();await save();await expect(card.getByText('开发验收：验收通过',{exact:true})).toBeVisible();await expect(page.getByText('完成 0 / 1，进度 0%',{exact:true})).toBeVisible();
  await card.getByRole('button',{name:'人工验收通过，设为已完成'}).click();await expect(page.getByText('完成 1 / 1，进度 100%',{exact:true})).toBeVisible();
  await edit();await page.getByLabel('任务状态',{exact:true}).selectOption('doing');await page.getByRole('button',{name:'删除 GitHub 关联（保存后生效）'}).click();await save();await expect(card).toContainText('GitHub：未关联');await expect(card).toContainText('开发验收：待验收');await expect(card.getByRole('link')).toHaveCount(0);
});
test('复用项目仓库绑定生成当前Issue指令；关联不会授予执行权限',async()=>{
  await page.getByLabel('项目用途',{exact:true}).selectOption('development');await page.getByLabel('目标代码仓库',{exact:true}).fill(repo);await page.getByLabel('项目工作目录',{exact:true}).fill('D:\\Synthetic\\Only');await page.getByLabel('允许修改范围',{exact:true}).fill('src/only');await page.getByRole('button',{name:'保存项目',exact:true}).click();
  await page.getByRole('button',{name:'新增任务',exact:true}).click();await page.getByLabel('任务类型',{exact:true}).selectOption('development');await page.getByLabel('任务标题',{exact:true}).fill('实现当前保存提示');await page.getByLabel('任务验收标准',{exact:true}).fill('只修改src/only并提供测试证据');await page.getByRole('button',{name:'添加 GitHub 关联'}).click();await expect(page.getByLabel('GitHub 仓库地址')).toHaveValue(repo);await page.getByLabel('Issue 链接',{exact:true}).fill(repo+'/issues/12');await page.getByRole('checkbox',{name:'我已审核此任务及其验收标准，可复制开发指令'}).check();await save();
  await page.getByRole('button',{name:'复制 Codex 指令',exact:true}).click();const text=await page.evaluate(()=>(globalThis as unknown as {copiedTask:string}).copiedTask);for(const part of [repo,'"issueNumber": 12','src/only','当前保存提示','Commit SHA','PR','禁止强制推送','不得自动关闭Issue或合并PR'])expect(text).toContain(part);await expect(page.getByText('完成 0 / 1，进度 0%',{exact:true})).toBeVisible();
});

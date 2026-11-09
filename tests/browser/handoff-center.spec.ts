import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {createHash} from 'node:crypto';
import {collectionHarness} from './collection-harness';

async function exported(p:Page,info:TestInfo,title:string,repository:string){
 await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();
 await p.getByLabel('项目名称',{exact:true}).fill(title);
 await p.getByLabel('项目用途',{exact:true}).selectOption('development');
 await p.getByLabel('目标代码仓库',{exact:true}).fill(repository);
 await p.getByLabel('项目工作目录',{exact:true}).fill('D:/Synthetic/'+title);
 await p.getByLabel('允许修改范围',{exact:true}).fill('docs');
 await p.getByRole('button',{name:'保存项目',exact:true}).click();
 await p.getByRole('button',{name:'新增任务',exact:true}).click();
 await p.getByLabel('任务类型',{exact:true}).selectOption('development');
 await p.getByLabel('任务标题',{exact:true}).fill(title+' Mock交接任务');
 await p.getByLabel('任务验收标准',{exact:true}).fill('仅测试本地文件交接，不执行产品开发');
 await p.getByRole('checkbox',{name:'我已审核此任务及其验收标准，可复制开发指令'}).check();
 await p.getByRole('button',{name:'保存任务',exact:true}).click();
 await p.getByRole('button',{name:'导出 Codex 任务包',exact:true}).click();
 const preview=p.getByRole('dialog',{name:'Codex任务包预览与确认'});await preview.getByRole('checkbox').check();
 const wait=p.waitForEvent('download');await preview.getByRole('button',{name:'确认导出 JSON 任务包'}).click();
 const download=await wait;await download.saveAs(info.outputPath(title+'-package.json'));
 const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);
 const pack=JSON.parse(Buffer.concat(chunks).toString()),{contentSha256,...unsigned}=pack;
 const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 expect(createHash('sha256').update(canonical(unsigned)).digest('hex')).toBe(contentSha256);expect(pack.executionAuthorized).toBe(false);return pack;
}
function report(pack:any){return {format:'IdeaClipCodexDelivery',schemaVersion:2,taskPackage:{packageId:pack.packageId,contentSha256:pack.contentSha256},projectId:pack.task.projectId,taskId:pack.task.taskId,reportId:crypto.randomUUID(),repository:pack.task.repository,commitSha:'a'.repeat(40),summary:'合成Mock报告，不代表执行产品开发或测试',files:['docs/mock.md'],tests:[],notRun:[{command:'产品开发与测试',reason:'只测试交接'}],risks:['未核验'],generatedAt:new Date().toISOString(),localRecordId:null};}
const upload=(value:unknown,name:string)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});

test('0.1.9多项目包/批量预览确认/错误与重复拒绝/筛选/证据/持久化，零外发',async({},info)=>{
 const h=await collectionHarness();let requests=0;
 try{
  await h.context.route(/^https?:\/\//,r=>{requests++;return r.abort();});const p=await h.context.newPage();
  await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);
  const a=await exported(p,info,'项目甲','https://github.com/shimmer000000/IdeaClip');
  const b=await exported(p,info,'项目乙','https://github.com/example/Second');
  await p.getByRole('link',{name:'Codex任务交接中心',exact:true}).click();
  await expect(p.locator('[data-handoff-package]')).toHaveCount(2);
  const ra=report(a),rb=report(b),inbox=p.locator('[data-inbox]');
  await inbox.locator('[data-inbox-files]').setInputFiles([upload(ra,'甲.json'),upload(rb,'乙.json'),upload({...ra,reportId:crypto.randomUUID(),repository:'https://github.com/other/repo'},'错仓库.json'),upload({...ra,taskId:crypto.randomUUID()},'错任务.json'),upload({...ra,reportId:crypto.randomUUID(),taskPackage:{...ra.taskPackage,contentSha256:'b'.repeat(64)}},'篡改哈希.json'),upload(ra,'重复.json')]);
  await expect(inbox.locator('[data-inbox-candidate]')).toHaveCount(0);
  await inbox.getByRole('button',{name:'扫描候选报告（只读）',exact:true}).click();
  const candidates=inbox.locator('[data-inbox-candidate]');await expect(candidates).toHaveCount(6);
  await expect(candidates.nth(0)).toContainText('检查通过');await expect(candidates.nth(1)).toContainText('检查通过');
  for(const i of [2,3,4])await expect(candidates.nth(i)).toContainText('拒绝');await expect(candidates.nth(5)).toContainText('重复，跳过');
  await expect(inbox.getByRole('button',{name:'确认关联所选报告'})).toBeDisabled();
  await inbox.getByRole('checkbox',{name:'选择候选 1',exact:true}).check();await inbox.getByRole('checkbox',{name:'选择候选 2',exact:true}).check();
  await inbox.getByRole('checkbox',{name:'确认批量关联交付报告'}).check();await inbox.getByRole('button',{name:'确认关联所选报告'}).click();
  await expect(inbox.getByRole('status')).toContainText('成功 2');
  for(const row of await p.locator('[data-handoff-package]').all())await expect(row).toContainText('待人工验收');
  await p.getByLabel('交接项目筛选').selectOption(a.task.projectId);await expect(p.locator('[data-handoff-package]')).toHaveCount(1);
  await p.getByLabel('交接状态筛选').selectOption('review');await expect(p.locator('[data-handoff-package]')).toHaveCount(1);
  await p.getByLabel('交接更新时间从').fill('2099-01-01');await expect(p.locator('[data-handoff-package]')).toHaveCount(0);await p.getByLabel('交接更新时间从').fill('');
  await p.getByRole('button',{name:'查看任务包与交付历史',exact:true}).click();const detail=p.locator('[data-handoff-detail]');
  await expect(detail).toContainText('人工验收：待开发');await expect(detail).toContainText('看板：todo');await expect(detail).toContainText('缺少最新CI快照');await expect(detail).toContainText('本地记录尚未核对');
  await detail.screenshot({path:info.outputPath('handoff-evidence-mock.png')});
  await p.close();const reopened=await h.context.newPage();await reopened.goto(`chrome-extension://${h.extensionId}/notes.html?handoff`);
  await expect(reopened.locator('[data-handoff-package]')).toHaveCount(2);await expect(reopened.locator('[data-handoff-package]').first()).toContainText('结果已导入');
  const box=reopened.locator('[data-inbox]');await expect(box).toContainText('未选择本地目录或文件');
  await box.locator('[data-inbox-files]').setInputFiles([upload(ra,'甲.json'),upload(rb,'乙.json')]);await box.getByRole('button',{name:'扫描候选报告（只读）'}).click();
  for(const row of await box.locator('[data-inbox-candidate]').all()){await expect(row).toContainText('重复，跳过');await expect(row.getByRole('checkbox')).toBeDisabled();}
  await reopened.goto(`chrome-extension://${h.extensionId}/notes.html?projects&open=${a.task.projectId}`);await reopened.getByRole('button',{name:'编辑任务',exact:true}).click();await reopened.getByLabel('任务标题',{exact:true}).fill('甲任务人工修改后');await reopened.getByRole('button',{name:'保存任务',exact:true}).click();
  await reopened.getByRole('link',{name:'Codex任务交接中心',exact:true}).click();await reopened.getByLabel('交接状态筛选').selectOption('expired');await expect(reopened.locator('[data-handoff-package]')).toHaveCount(1);await expect(reopened.locator('[data-handoff-package]')).toContainText('旧任务包已失效');
  expect(requests).toBe(0);
 }finally{await h.context.close();}
});

test('0.1.9目录能力替身：仅主动扫描第一层，目录不持久授权，受限手动选择兜底',async({},info)=>{
 const h=await collectionHarness();try{
  await h.context.route(/^https?:\/\//,r=>r.abort());const p=await h.context.newPage();await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);const pack=await exported(p,info,'目录测试','https://github.com/shimmer000000/IdeaClip'),r=report(pack);
  await p.getByRole('link',{name:'Codex任务交接中心',exact:true}).click();
  await p.evaluate(report=>{(window as any).enumerated=0;(window as any).showDirectoryPicker=async()=>({kind:'directory',name:'Mock收件箱',async *values(){(window as any).enumerated++;yield {kind:'directory',name:'子目录',async *values(){throw Error('禁止递归');}};yield {kind:'file',name:'report.json',getFile:async()=>new File([JSON.stringify(report)],'report.json')};}});},r);
  await p.getByRole('button',{name:'选择本地交接目录'}).click();expect(await p.evaluate(()=>(window as any).enumerated)).toBe(0);await expect(p.locator('[data-inbox-candidate]')).toHaveCount(0);
  await p.getByRole('button',{name:'扫描候选报告（只读）'}).click();expect(await p.evaluate(()=>(window as any).enumerated)).toBe(1);await expect(p.locator('[data-inbox-candidate]')).toHaveCount(1);await expect(p.locator('[data-inbox-candidate]')).toContainText('检查通过');
  await p.reload();await expect(p.locator('[data-inbox]')).toContainText('未选择本地目录或文件');await p.evaluate(()=>{(window as any).showDirectoryPicker=undefined;});await p.getByRole('button',{name:'选择本地交接目录'}).click();await expect(p.locator('[data-inbox]').getByRole('status')).toContainText('受限方案');
 }finally{await h.context.close();}
});

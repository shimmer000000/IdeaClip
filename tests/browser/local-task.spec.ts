import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {collectionHarness} from './collection-harness';
import {localTaskFixture,localAck} from '../local-task-fixture';

test('0.2.3导出→独立单次Mock→实际合成Git提交→交付v2导入→重开，零付费请求不自动验收',async({},info)=>{
 const h=await collectionHarness(),f=await localTaskFixture();let outgoing=0;
 try{
  await h.context.route(/^https?:\/\//,r=>{outgoing++;return r.abort();});const p=await h.context.newPage();await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);
  await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();await p.getByLabel('项目用途',{exact:true}).selectOption('development');await p.getByLabel('目标代码仓库',{exact:true}).fill(f.pack.task.repository);await p.getByLabel('项目工作目录',{exact:true}).fill(f.root);await p.getByLabel('允许修改范围',{exact:true}).fill('docs');await p.getByRole('button',{name:'保存项目',exact:true}).click();
  await p.getByRole('button',{name:'新增任务',exact:true}).click();await p.getByLabel('任务类型',{exact:true}).selectOption('development');await p.getByLabel('任务标题',{exact:true}).fill('0.2.3单任务Mock交接');await p.getByLabel('任务验收标准',{exact:true}).fill('仅合成Git验证，不执行真实模型或产品开发');await p.getByRole('checkbox',{name:'我已审核此任务及其验收标准，可复制开发指令'}).check();await p.getByRole('button',{name:'保存任务',exact:true}).click();
  const panel=p.locator('[data-task-package]');await panel.getByRole('button',{name:'导出 Codex 任务包',exact:true}).click();const dialog=panel.getByRole('dialog');await dialog.getByRole('checkbox').check();const waiting=p.waitForEvent('download');await dialog.getByRole('button',{name:'确认导出 JSON 任务包'}).click();const download=await waiting;await download.saveAs(info.outputPath(download.suggestedFilename()));const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const b of stream!)chunks.push(b);const pack=JSON.parse(Buffer.concat(chunks).toString('utf8'));expect(pack.executionAuthorized).toBe(false);
  await writeFile(f.packageFile,JSON.stringify(pack));f.options.policy.projectId=pack.task.projectId;f.options.policy.taskId=pack.task.taskId;
  const c=f.controller();await expect(c.run(null)).rejects.toMatchObject({code:'AUTH_REQUIRED'});const preview=await c.preview(),permit=await c.authorize(preview,localAck),result=await c.run(permit);expect(result.code).toBe('OK');expect(result.delivery?.commitSha).toBe(f.git('rev-parse','HEAD'));await expect(c.run(permit)).rejects.toMatchObject({code:'AUTH_USED'});
  const evidence=p.locator('[data-local-evidence]');await evidence.locator('[data-report-file]').setInputFiles({name:'local-task-result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result.delivery))});await expect(evidence).toContainText('交付报告已追加保存');await expect(panel).toContainText('结果已导入');await expect(panel).toContainText('人工验收：待开发');await expect(p.getByText('完成 0 / 1，进度 0%',{exact:true})).toBeVisible();await panel.screenshot({path:info.outputPath('single-task-mock-imported.png')});
  await p.reload();await p.getByRole('button',{name:/新孵化项目 ·/}).click();await expect(evidence).toContainText(result.delivery!.commitSha);await expect(panel).toContainText('人工验收：待开发');expect(outgoing).toBe(0);
 }finally{await h.context.close();await f.cleanup();}
});

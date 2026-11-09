import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectionHarness} from './collection-harness';
import {assistantFixture,assistantReport,repository} from '../handoff-assistant-fixture';

test('0.2.0实际下载→一次性CLI核对→交付v2收集→人工确认导入，零网络/零任务执行',async({},info)=>{
 const f=await assistantFixture(),h=await collectionHarness();let requests=0;
 try{
  await h.context.route(/^https?:\/\//,r=>{requests++;return r.abort();});const p=await h.context.newPage();await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);
  await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();await p.getByLabel('项目名称',{exact:true}).fill('0.2.0 交接助手隔离验收');await p.getByLabel('项目用途',{exact:true}).selectOption('development');
  await p.getByLabel('目标代码仓库',{exact:true}).fill(repository);await p.getByLabel('项目工作目录',{exact:true}).fill(f.root);await p.getByLabel('允许修改范围',{exact:true}).fill('docs');await p.getByRole('button',{name:'保存项目',exact:true}).click();
  await p.getByRole('button',{name:'新增任务',exact:true}).click();await p.getByLabel('任务类型',{exact:true}).selectOption('development');await p.getByLabel('任务标题',{exact:true}).fill('只测试交接，不执行产品开发');await p.getByLabel('任务验收标准',{exact:true}).fill('仅文件校验及Mock导入，不自动验收和完成');await p.getByRole('checkbox',{name:'我已审核此任务及其验收标准，可复制开发指令'}).check();await p.getByRole('button',{name:'保存任务',exact:true}).click();
  await p.getByRole('button',{name:'导出 Codex 任务包',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Codex任务包预览与确认'});await dialog.getByRole('checkbox').check();const waiting=p.waitForEvent('download');await dialog.getByRole('button',{name:'确认导出 JSON 任务包'}).click();const download=await waiting;const packageFile=info.outputPath('downloaded-task.json');await download.saveAs(packageFile);
  const run=(mode:string,extra:string[]=[])=>JSON.parse(execFileSync(process.execPath,[resolve('tools/codex-handoff.ts'),mode,'--package',packageFile,'--workspace',f.root,'--repository',repository,...extra],{encoding:'utf8',windowsHide:true}));
  const check=run('check');expect(check.execution.authorized).toBe(false);expect(check.state).toBe('awaiting-single-use-user-approval');expect(check.remoteMatched).toBe(true);
  const {readFile}=await import('node:fs/promises');const pack=JSON.parse(await readFile(packageFile,'utf8'));const report=assistantReport(pack,f.sha);await writeFile(join(f.inbox,'delivery.json'),JSON.stringify(report));const collected=run('collect',['--inbox',f.inbox]);expect(collected.reports[0].state).toBe('valid');
  await p.getByRole('link',{name:'Codex任务交接中心',exact:true}).click();await expect(p.locator('[data-local-assistant]')).toContainText('等待单次执行授权');const inbox=p.locator('[data-inbox]');
  await inbox.locator('[data-inbox-files]').setInputFiles([join(f.inbox,'delivery.json')]);await inbox.getByRole('button',{name:'扫描候选报告（只读）'}).click();await expect(inbox.locator('[data-inbox-candidate]')).toContainText('检查通过，待确认');await expect(inbox.getByRole('button',{name:'确认关联所选报告'})).toBeDisabled();
  await inbox.getByRole('checkbox',{name:'选择候选 1',exact:true}).check();await inbox.getByRole('checkbox',{name:'确认批量关联交付报告'}).check();await inbox.getByRole('button',{name:'确认关联所选报告'}).click();await expect(inbox.getByRole('status')).toContainText('成功 1');
  await p.getByRole('button',{name:'查看任务包与交付历史'}).click();const detail=p.locator('[data-handoff-detail]');await expect(detail).toContainText('人工验收：待开发');await expect(detail).toContainText('看板：todo');await expect(detail).toContainText('未执行');await p.screenshot({path:info.outputPath('assistant-flow-mock.png')});
  await p.close();const q=await h.context.newPage();await q.goto(`chrome-extension://${h.extensionId}/notes.html?handoff`);await expect(q.locator('[data-handoff-package]')).toContainText('结果已导入');await expect(q.locator('[data-inbox]')).toContainText('未选择本地目录或文件');
  await q.locator('[data-inbox-files]').setInputFiles([join(f.inbox,'delivery.json')]);await q.getByRole('button',{name:'扫描候选报告（只读）'}).click();await expect(q.locator('[data-inbox-candidate]')).toContainText('重复，跳过');expect(requests).toBe(0);
 }finally{await h.context.close();await f.cleanup();}
});

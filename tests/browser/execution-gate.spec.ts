import {test,expect} from '@playwright/test';
import {collectionHarness} from './collection-harness';
import {assistantFixture,repository} from '../handoff-assistant-fixture';

test('0.2.1当前任务Mock预览/独立单次授权/重复与过期拒绝/失败取消/重开不保留授权，零外发',async({},info)=>{
 const f=await assistantFixture(),h=await collectionHarness();let requests=0;
 try{
  await h.context.route(/^https?:\/\//,r=>{requests++;return r.abort();});const p=await h.context.newPage();await p.clock.install({time:new Date()});await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);
  await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();await p.getByLabel('项目名称',{exact:true}).fill('0.2.1 单次Mock门禁');await p.getByLabel('项目用途',{exact:true}).selectOption('development');await p.getByLabel('目标代码仓库',{exact:true}).fill(repository);await p.getByLabel('项目工作目录',{exact:true}).fill(f.root);await p.getByLabel('允许修改范围',{exact:true}).fill('docs');await p.getByRole('button',{name:'保存项目',exact:true}).click();
  await p.getByRole('button',{name:'新增任务',exact:true}).click();await p.getByLabel('任务类型',{exact:true}).selectOption('development');await p.getByLabel('任务标题',{exact:true}).fill('仅Mock授权，不执行开发');await p.getByLabel('任务验收标准',{exact:true}).fill('拒绝未授权/过期/重复，人工验收及状态不变');await p.getByRole('checkbox',{name:'我已审核此任务及其验收标准，可复制开发指令'}).check();await p.getByRole('button',{name:'保存任务',exact:true}).click();
  await p.getByRole('button',{name:'导出 Codex 任务包',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Codex任务包预览与确认'});await dialog.getByRole('checkbox').check();const waiting=p.waitForEvent('download');await dialog.getByRole('button',{name:'确认导出 JSON 任务包'}).click();const download=await waiting,path=info.outputPath('mock-gate-package.json');await download.saveAs(path);
  await p.getByRole('link',{name:'Codex任务交接中心',exact:true}).click();await p.getByRole('button',{name:'查看任务包与交付历史'}).click();const panel=p.locator('[data-mock-authorization]'),status=panel.getByRole('status');
  await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(status).toContainText('AUTH_REQUIRED');
  await panel.locator('[data-auth-package]').setInputFiles(path);await expect(status).toContainText('已审核导出历史一致');
  const preview=async()=>{await panel.getByRole('button',{name:'预览单次Mock执行',exact:true}).click();await expect(status).toContainText('尚未取得授权');};
  const authorize=async()=>{await panel.getByRole('checkbox',{name:'确认仅授权本次Mock',exact:true}).check();await panel.getByRole('button',{name:'授予单次Mock授权',exact:true}).click();};
  await panel.getByRole('checkbox',{name:'模拟Git存在未提交修改'}).check();await preview();await authorize();await expect(status).toContainText('PREFLIGHT_BLOCKED');
  await panel.getByRole('checkbox',{name:'模拟Git存在未提交修改'}).uncheck();await preview();await expect(panel.locator('[data-auth-preview]')).toContainText(repository);await expect(panel.locator('[data-auth-preview]')).toContainText('仅Mock');await authorize();await expect(status).toContainText('已取得单次Mock授权');
  await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await p.clock.runFor(60);await expect(status).toContainText('Mock完成');await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(status).toContainText('AUTH_USED');
  await preview();await authorize();await panel.getByRole('checkbox',{name:'模拟Git HEAD变化'}).check();await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(status).toContainText('SNAPSHOT_CHANGED');await panel.getByRole('checkbox',{name:'模拟Git HEAD变化'}).uncheck();
  await preview();await authorize();await p.clock.fastForward(120001);await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(status).toContainText('AUTH_EXPIRED');
  await preview();await authorize();await panel.getByLabel('模拟执行结果').selectOption('failure');await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await p.clock.runFor(60);await expect(status).toContainText('MOCK_FAILED');await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(status).toContainText('AUTH_USED');
  await preview();await authorize();await panel.getByLabel('模拟执行结果').selectOption('timeout');await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await p.clock.runFor(650);await expect(status).toContainText('TIMEOUT');
  await preview();await authorize();await panel.getByRole('button',{name:'运行一次Mock',exact:true}).click();await panel.getByRole('button',{name:'取消Mock',exact:true}).click();await expect(status).toContainText('CANCELLED');
  await expect(p.locator('[data-handoff-detail]')).toContainText('人工验收：待开发');await expect(p.locator('[data-handoff-detail]')).toContainText('看板：todo');await panel.screenshot({path:info.outputPath('mock-authorization.png')});
  await p.close();const q=await h.context.newPage();await q.goto(`chrome-extension://${h.extensionId}/notes.html?handoff`);await q.getByRole('button',{name:'查看任务包与交付历史'}).click();await expect(q.locator('[data-mock-authorization]')).toContainText('当前会话Mock授权：未取得');await q.locator('[data-mock-authorization]').getByRole('button',{name:'运行一次Mock',exact:true}).click();await expect(q.locator('[data-mock-authorization]').getByRole('status')).toContainText('AUTH_REQUIRED');expect(requests).toBe(0);
 }finally{await h.context.close();await f.cleanup();}
});

import {test,expect} from '@playwright/test';
import {collectionHarness} from './collection-harness';
import {createSyntheticExecutor} from '../../tools/controlled-executor';

test('0.2.3本地单任务授权提示与旧合成能力测试分开记证，不联网不改人工验收',async({},info)=>{
 const h=await collectionHarness(),executor=await createSyntheticExecutor();let outgoing=0;
 try{
  await h.context.route(/^https?:\/\//,r=>{outgoing++;return r.abort();});
  const p=await h.context.newPage();await p.goto(`chrome-extension://${h.extensionId}/notes.html?handoff`);
  const panel=p.locator('[data-controlled-executor]');await expect(panel).toContainText('受控执行器 · 0.2.3');await expect(panel).toContainText('不提供OS级文件访问隔离');
  await panel.getByRole('button',{name:'检查真实执行安全门禁（不启动）'}).click();await expect(panel.getByRole('status')).toContainText('[LOCAL_TASK_APPROVAL_REQUIRED]');
  await panel.screenshot({path:info.outputPath('real-execution-blocked.png')});
  await expect(executor.run(null)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
  const preview=await executor.preview(),permit=await executor.authorize(preview,true),result=await executor.run(permit);
  expect(result.taskId).toBe(preview.snapshot.taskId);expect(result.deniedCapabilities).toContain('OUTSIDE_WRITE');expect(result.actualCodexStarted).toBe(false);expect(result.humanAcceptanceChanged).toBe(false);
  await expect(executor.run(permit)).rejects.toMatchObject({code:'AUTH_USED'});await expect(executor.runReal()).rejects.toMatchObject({code:'REAL_EXECUTOR_DISABLED'});
  await info.attach('local-fixed-guest-result',{body:JSON.stringify(result),contentType:'application/json'});
  await p.close();const q=await h.context.newPage();await q.goto(`chrome-extension://${h.extensionId}/notes.html?handoff`);
  await expect(q.locator('[data-controlled-executor]')).toContainText('尚未获得本次本地任务执行授权');await expect(q.locator('[data-handoff-package]')).toHaveCount(0);expect(outgoing).toBe(0);
 }finally{await h.context.close();await executor.close();}
});

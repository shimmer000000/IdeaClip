import {test,expect} from '@playwright/test';
import {collectionHarness} from './collection-harness';
test('GitHub只读Mock：权限、短SHA、手动刷新去重、重开持久化与总览，状态不自动完成',async({},info)=>{
 const h=await collectionHarness();let requests=0,fail=false;const sha='a'.repeat(40);try{
 await h.context.addInitScript(()=>{chrome.permissions.request=async p=>p.origins?.[0]==='https://api.github.com/*';chrome.permissions.contains=async()=>true;});
 await h.context.route('https://api.github.com/**',async r=>{requests++;if(fail){await r.fulfill({status:404,body:'{}'});return;}expect(r.request().method()).toBe('GET');expect(r.request().headers().authorization).toBeUndefined();await r.fulfill({status:200,headers:{etag:'"v1"'},contentType:'application/json',body:JSON.stringify({sha,html_url:'https://github.com/example/repo/commit/'+sha,commit:{message:'合成提交',committer:{date:'2026-11-08T00:00:00Z'}}})});});
 const p=await h.context.newPage();await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();await p.getByRole('button',{name:'新增任务',exact:true}).click();await p.getByLabel('任务标题',{exact:true}).fill('合成Commit只读验收');await p.getByRole('button',{name:'添加 GitHub 关联'}).click();await p.getByLabel('GitHub 仓库地址').fill('https://github.com/example/repo');await p.getByLabel('Commit SHA',{exact:true}).fill('aaaaaaa');await p.getByRole('button',{name:'保存任务',exact:true}).click();
 const card=p.locator('.project-board article');await expect(card).toContainText('尚未查询');await card.getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(card).toContainText('远程已核实');await expect(card).toContainText(sha);expect(requests).toBe(1);await card.getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(card.getByRole('button',{name:'刷新 GitHub 状态'})).toBeEnabled();expect(requests).toBe(1);await expect(p.getByText('完成 0 / 1，进度 0%',{exact:true})).toBeVisible();
 await p.reload();await p.getByRole('button',{name:/新孵化项目 ·/}).click();await expect(p.locator('.project-board article')).toContainText('远程已核实');expect(requests).toBe(1);await p.getByRole('heading',{name:'GitHub 开发状态总览'}).scrollIntoViewIfNeeded();await p.getByRole('heading',{name:'GitHub 开发状态总览'}).locator('..').getByText('新孵化项目 / 合成Commit只读验收',{exact:true}).click();await expect(p.getByRole('heading',{name:'GitHub 开发状态总览'}).locator('..')).toContainText('合成提交');
 await p.locator('.project-board').screenshot({path:info.outputPath('github-readonly-mock.png')});
 await p.evaluate(async()=>{const d=await new Promise<IDBDatabase>(resolve=>{const q=indexedDB.open('ideaclip');q.onsuccess=()=>resolve(q.result);});await new Promise<void>(resolve=>{const tx=d.transaction('projects','readwrite'),store=tx.objectStore('projects'),q=store.getAll();q.onsuccess=()=>{for(const project of q.result){for(const task of project.tasks??[])if(task.githubRemote){task.githubRemote.attemptAt=0;task.githubRemote.historical=true;}store.put(project);}};tx.oncomplete=()=>resolve();});d.close();});
 await p.reload();await p.getByRole('button',{name:/新孵化项目 ·/}).click();await expect(p.locator('.project-board article')).toContainText('历史结果已过期');fail=true;await p.locator('.project-board article').getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(p.locator('.project-board article')).toContainText('NOT_FOUND');await expect(p.locator('.project-board article')).toContainText('私有仓库未授权');expect(requests).toBe(2);
 }finally{await h.context.close();}
});

test('0.1.5统一状态：Issue/PR独立显示、15分钟本地到期零网络、失败保留成功时间',async({},info)=>{
 const h=await collectionHarness();let requests=0,phase=0;const sha='b'.repeat(40),repo='https://github.com/example/repo';try{
 await h.context.route(/^https?:\/\//,r=>r.abort());
 await h.context.addInitScript(()=>{chrome.permissions.request=async()=>true;chrome.permissions.contains=async()=>true;});
 await h.context.route('https://api.github.com/**',async route=>{
  requests++;expect(route.request().method()).toBe('GET');expect(route.request().headers().authorization).toBeUndefined();
  if(phase===4){await route.fulfill({status:404,body:'{}'});return;}
  const url=route.request().url(),issue=url.includes('/issues/'),commit=url.includes('/commits/');
  const payload=commit?{sha,html_url:repo+'/commit/'+sha,commit:{message:'合成提交',committer:{date:'2026-11-08T00:00:00Z'}}}:{number:issue?1:2,html_url:repo+(issue&&phase!==2?'/issues/1':issue?'/pull/1':'/pull/2'),state:issue?(phase===0?'open':'closed'):(phase<2?'open':'closed'),title:issue?'合成Issue':'合成PR',updated_at:'2026-11-08T00:00:00Z',draft:!issue&&phase===0,merged_at:!issue&&phase===3?'2026-11-08T00:00:00Z':null,...(issue&&phase===2?{pull_request:{}}:{})};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
 const p=await h.context.newPage();await p.clock.install({time:new Date('2026-11-08T10:00:00Z')});await p.goto(`chrome-extension://${h.extensionId}/notes.html?projects`);
 await p.getByRole('button',{name:'创建孵化项目',exact:true}).click();await p.getByRole('button',{name:'新增任务',exact:true}).click();await p.getByLabel('任务标题',{exact:true}).fill('三类状态合成验收');await p.getByRole('button',{name:'添加 GitHub 关联'}).click();await p.getByLabel('GitHub 仓库地址').fill(repo);await p.getByLabel('Issue 编号',{exact:true}).fill('1');await p.getByLabel('PR 编号',{exact:true}).fill('2');await p.getByLabel('Commit SHA',{exact:true}).fill(sha);await p.getByRole('button',{name:'保存任务',exact:true}).click();
 const card=p.locator('.project-board article'),issue=card.locator('[data-github-kind="issue"]'),pr=card.locator('[data-github-kind="pr"]');
 await expect(card).toContainText('链接格式已核对');await expect(issue).toContainText('Issue：尚未查询');expect(requests).toBe(0);
 await card.getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(issue).toContainText('Issue：远程已核实 · 开启');await expect(pr).toContainText('PR：远程已核实 · 草稿');await expect(card.locator('[data-github-kind="commit"]')).toContainText('提交真实存在');await expect(card).not.toContainText('远程状态未验证');expect(requests).toBe(3);
 await p.clock.fastForward(15*60*1000+10);await expect(issue).toContainText('历史结果已过期');await expect(pr).toContainText('历史结果已过期');expect(requests).toBe(3);
 for(const next of [1,2,3]){phase=next;await card.getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(pr).toContainText('PR：远程已核实 · '+({1:'开启',2:'关闭',3:'已合并'}[next]));await expect(issue).toContainText(next===2?'实际是PR':'关闭');await p.clock.fastForward(61_000);}
 const success=await pr.getByText(/^最近成功时间：/).textContent();phase=4;await card.getByRole('button',{name:'刷新 GitHub 状态'}).click();await expect(pr).toContainText('PR：查询失败');await expect(pr).toContainText('NOT_FOUND');await expect(pr.getByText(/^最近成功时间：/)).toHaveText(success!);await expect(card).toContainText('最近查询时间：');await expect(p.getByText('完成 0 / 1，进度 0%',{exact:true})).toBeVisible();expect(requests).toBe(15);
 await card.screenshot({path:info.outputPath('github-unified-status-mock.png')});
 await p.reload();await p.getByRole('button',{name:/新孵化项目 ·/}).click();await expect(p.locator('.project-board article')).toContainText('查询失败');expect(requests).toBe(15);
 }finally{await h.context.close();}
});

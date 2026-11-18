import { test, expect } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { collectionHarness } from './collection-harness';
import { noteDefaults } from '../../src/inspiration/model';

test('MoneyRadar本地集成：五条合成记录，新建/重复/中文/服务关闭/响应丢失后安全重试',async({},info)=>{
  test.setTimeout(150000);
  const mr=process.env.MONEYRADAR_DIR;
  if(!mr)throw new Error('Set MONEYRADAR_DIR to the existing MoneyRadar checkout (build it first).');
  const server:ChildProcess=fork(join(resolve(mr),'scripts/ideaclip-test-server.mjs'),[],{stdio:['ignore','ignore','ignore','ipc']});
  let seq=0;
  const call=(command:string,extra:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{server.off('message',listener);reject(new Error('Isolated server timeout'));},10000);const listener=(m:any)=>{if(m.id===id){clearTimeout(timer);server.off('message',listener);if(m.error)reject(new Error(m.error));else resolve(m);}};server.on('message',listener);server.send({id,command,...extra});});
  const port=await new Promise<number>((resolve,reject)=>{server.once('error',reject);server.once('exit',()=>reject(new Error('Isolated server exited')));server.on('message',(m:any)=>{if(m.event==='ready')resolve(m.port);});});
  const base='http://127.0.0.1:'+port, h=await collectionHarness();
  let external=0,imports=0, dropNext=false;
  try {
    await h.context.route(/^https?:\/\//,async route=>{
      const u=new URL(route.request().url());if(u.origin!==base){external++;await route.abort();return;}
      if(u.pathname==='/api/ideaclip/import' && route.request().method()==='POST') {
        imports++;const body=route.request().postData()||'';expect(body).not.toContain('PRIVATE-THOUGHT');expect(body).not.toContain('PRIVATE-AI-REPORT');expect(body).not.toContain('PRIVATE-SCREENSHOT');
        if(dropNext){dropNext=false;await route.fetch();await route.abort();return;}
      }
      await route.continue();
    });
    const seed=await h.context.newPage();await seed.goto(`chrome-extension://${h.extensionId}/notes.html`);
    await expect(seed.locator('main')).toBeVisible();
    await seed.evaluate(async(defaults)=>{
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('ideaclip');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const tx=db.transaction(['notes','noteDrafts','analyses'],'readwrite');const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
      for(let i=1;i<=5;i++) {
        const id='mr-demo-'+i,url='https://example.com/mr-demo/'+(i===2?1:i),title=['','演示 · 新收藏','演示 · 重复收藏','演示 · 中文工具与数字产品','演示 · 服务关闭','演示 · 响应丢失'][i];
        const n={...defaults,id,url,title,content:'演示公开摘要 '+i+'；无真实收入或付费记录。',body:'PRIVATE-THOUGHT-'+i,tags:['演示','中文'],status:'inbox',createdAt:i,updatedAt:i,revision:1,screenshotIds:['PRIVATE-SCREENSHOT-'+i]};
        tx.objectStore('notes').put(n);tx.objectStore('analyses').put({id:'a-'+i,noteId:id,createdAt:i,content:'PRIVATE-AI-REPORT-'+i});
        tx.objectStore('noteDrafts').put({id,entryKey:'note:'+id,input:{title,url,platform:n.platform,author:null,publishedAt:null,content:n.content,body:n.body,researchQuestions:'',category:'',tagsText:n.tags.join(', '),screenshotIds:n.screenshotIds,captureIds:[],favorite:false,status:'inbox'},baseRevision:1,sourceTabId:null,sourcePageUrl:url,pendingCaptureId:null,hasChanges:false,createdAt:i,updatedAt:i});
      }
      await done;db.close();
    },noteDefaults());
    const editor=await h.context.newPage();
    const panel=editor.locator('[data-moneyradar]');
    async function preview(i:number) {await editor.goto(`chrome-extension://${h.extensionId}/note.html?id=mr-demo-${i}`);await panel.getByRole('button',{name:'发送到 MoneyRadar',exact:true}).click();await expect(panel.getByRole('dialog')).toBeVisible();await expect(panel.getByLabel('本次公开备注（默认空白，需手动填写）')).toHaveValue('');await expect(panel.getByLabel('公开正文摘要（最多3000字，请检查是否含私人信息）')).not.toHaveValue(/PRIVATE/);}
    async function confirm() {await panel.getByRole('checkbox',{name:/选择当前收藏/}).check();await panel.getByRole('checkbox',{name:'这是演示数据，保存为演示档案'}).check();await panel.getByRole('checkbox',{name:'我确认所选记录及以上内容可发送到本机 MoneyRadar'}).check();}
    await preview(1);await panel.getByLabel('MoneyRadar 本机地址').fill(base);
    // Native optional-permission prompt is outside the isolated DOM test. Mock only its approval;
    // pairing, CORS, HTTP, authentication, SQLite and workbench authorization below are real local code.
    await editor.evaluate(()=>{chrome.permissions.request=async()=>true;});
    await panel.getByRole('button',{name:'申请本地配对'}).click();
    await expect.poll(()=>h.context.pages().find(p=>p.url().startsWith(base+'/#ideaclip-pair/'))).toBeTruthy();
    const approval=h.context.pages().find(p=>p.url().startsWith(base+'/#ideaclip-pair/'))!;
    await approval.getByRole('checkbox',{name:'我已核对配对码和扩展 ID，授权本次连接'}).check();await approval.getByRole('button',{name:'授权 IdeaClip 收藏同步',exact:true}).click();await expect(approval.getByRole('status')).toContainText('已授权');
    await panel.getByRole('button',{name:'完成配对',exact:true}).click();await expect(panel.getByRole('status')).toContainText('配对完成');
    await confirm();await panel.getByRole('button',{name:'确认发送此收藏'}).click();await expect(panel.getByRole('status')).toContainText('成功保存');
    const open=panel.getByRole('link',{name:'打开 MoneyRadar 项目 ↗'});const url=await open.getAttribute('href');const target=await h.context.newPage();await target.goto(url!);await expect(target.getByRole('dialog')).toBeVisible();await expect(target.getByLabel('项目名称 *')).toHaveValue('演示 · 新收藏');
    await call('edit',{url:'https://example.com/mr-demo/1'});
    await preview(2);await confirm();await panel.getByRole('button',{name:'确认发送此收藏'}).click();await expect(panel.getByRole('status')).toContainText('识别重复');
    await preview(3);await confirm();await panel.getByRole('button',{name:'确认发送此收藏'}).click();await expect(panel.getByRole('status')).toContainText('成功保存');await panel.screenshot({path:info.outputPath('moneyradar-preview-synthetic.png')});
    await editor.setViewportSize({width:390,height:844});await editor.emulateMedia({colorScheme:'dark'});expect(await editor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:info.outputPath('moneyradar-preview-mobile-dark-synthetic.png')});await editor.setViewportSize({width:1100,height:800});await editor.emulateMedia({colorScheme:'light'});
    await preview(4);await confirm();await call('stop');await panel.getByRole('button',{name:'确认发送此收藏'}).click();await expect(panel.getByRole('status')).toContainText('本地连接失败');await expect(panel.getByRole('button',{name:'手动查询并安全重试'})).toBeVisible();await call('start');await panel.getByRole('button',{name:'手动查询并安全重试'}).click();await expect(panel.getByRole('status')).toContainText('重试保存成功');
    await preview(5);await confirm();dropNext=true;const before=imports;await panel.getByRole('button',{name:'确认发送此收藏'}).click();await expect(panel.getByRole('status')).toContainText('本地连接失败');await panel.getByRole('button',{name:'手动查询并安全重试'}).click();await expect(panel.getByRole('status')).toContainText('已确认上次保存结果');expect(imports-before).toBe(1);
    const result=await call('verify');expect(result.projects).toHaveLength(4);const duplicate=result.projects.find((p:any)=>p.url==='https://example.com/mr-demo/1');expect(duplicate.analysis.mvp).toContain('人工MVP');expect(duplicate.name).toBe('演示 · MoneyRadar人工命名');expect(duplicate.tags).toEqual(['人工标签']);expect(duplicate.sources.filter((s:any)=>s.ideaclip)).toHaveLength(2);
    for(const p of result.projects){expect(p.demo).toBe(true);expect(p.evidence).toHaveLength(0);expect(JSON.stringify(p)).not.toMatch(/PRIVATE-THOUGHT|PRIVATE-AI-REPORT|PRIVATE-SCREENSHOT/);}
    expect(external).toBe(0);
    const original=await seed.evaluate(async()=>{const d=await new Promise<IDBDatabase>(r=>{const q=indexedDB.open('ideaclip');q.onsuccess=()=>r(q.result);});const tx=d.transaction(['notes','analyses','aiTasks'],'readonly');const read=(table:string)=>new Promise<any[]>(r=>{const q=tx.objectStore(table).getAll();q.onsuccess=()=>r(q.result);});const [notes,analyses,jobs]=await Promise.all([read('notes'),read('analyses'),read('aiTasks')]);d.close();return {notes,analyses,jobs};});
    expect(original.notes).toHaveLength(5);expect(original.notes.every(n=>n.body.startsWith('PRIVATE-THOUGHT'))).toBe(true);expect(original.analyses).toHaveLength(5);expect(original.jobs).toHaveLength(0);
    await info.attach('local-integration-summary',{body:JSON.stringify({syntheticNotes:5,projects:4,duplicate:1,externalRequests:external,paidRequests:0,nativePermissionPrompt:'Mock approval; not native verification'}),contentType:'application/json'});
  } finally {await h.context.close();await call('shutdown').catch(()=>server.disconnect());}
});

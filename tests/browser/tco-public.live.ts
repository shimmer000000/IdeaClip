import {test,expect} from '@playwright/test';
import {collectionHarness} from './collection-harness';
import {emptyPage} from '../../src/collection/model';
test('仅显式授权的公开t.co：生产后台GET解析，不访问目标项目',async()=>{
 const short=process.env.IDEACLIP_TCO_LIVE,expected=process.env.IDEACLIP_TCO_EXPECTED;
 test.skip(!short||!expected,'需明确指定已授权的公开短链和预期仓库');
 const h=await collectionHarness(undefined,false,true);const network:{url:string;method:string}[]=[];h.context.on('request',r=>{if(/^https?:/.test(r.url()))network.push({url:r.url(),method:r.method()});});try{const page=await h.context.newPage();await page.goto(`chrome-extension://${h.extensionId}/notes.html`);await expect(page.getByRole('heading',{name:'灵感管理中心',exact:true})).toBeVisible();
 const row={...emptyPage('https://x.com/fixture/status/123','授权短链验收合成记录',''),platform:'x',id:'tco-live-fixture',originalUrl:'https://x.com/fixture/status/123',sourceTabId:null,screenshotIds:[],noteId:null,updatedAt:Date.now(),textOrigin:'extracted',links:[{url:short!,text:'公开授权短链'}]};
 await page.evaluate(async row=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('ideaclip');r.onsuccess=()=>resolve(r.result);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('contentCaptures','readwrite');tx.objectStore('contentCaptures').put(row);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},row);
 await page.goto(`chrome-extension://${h.extensionId}/collection.html?id=tco-live-fixture`);await expect(page.getByRole('link',{name:expected!,exact:true})).toBeVisible({timeout:15000});await expect(page.getByLabel('外部链接（每行一个 HTTP / HTTPS URL）')).toHaveValue(new RegExp('github.com'));await page.reload();await expect(page.getByRole('link',{name:expected!,exact:true})).toBeVisible();expect(network).toEqual([{url:short!,method:'GET'}]);
 }finally{await h.context.close();}
});

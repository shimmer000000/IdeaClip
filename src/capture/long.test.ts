import {afterEach,expect,it,vi} from 'vitest';
import {checkLongPage,longSlice,stitchLongPage,segmentRange,LONG_MAX_BYTES} from './long';
import {validateCaptureRange} from './range';
import {portableRow} from '../backup/model';
import type {LongPage} from './long-page';
import {IdeaClipDB,saveScreenshot} from '../storage';
import {exportBackup,prepareBackup,restoreBackup,discardBackup} from '../backup/service';
const page:LongPage={width:1000,height:700,pageHeight:1800,pageWidth:1000,scrollX:0,scrollY:0,dpr:1.5,scale:1,href:'https://example.com/long'};
afterEach(()=>vi.unstubAllGlobals());
it('长图最后一屏重叠只拼未覆盖部分，不留重复或空隙',()=>{
 expect(longSlice(1400,{...page,scrollY:1100})).toEqual({from:1400,to:1800});
 expect(()=>longSlice(700,{...page,scrollY:800})).toThrow('连续');expect(()=>longSlice(700,page)).toThrow('连续');
});
it('分数缩放下末屏浮点误差收敛到页面边缘',()=>expect(longSlice(2800,{...page,pageHeight:3000,height:533.3333129882812,scrollY:2466.666748046875})).toEqual({from:2800,to:3000}));
for(const patch of [{pageHeight:20001},{pageWidth:1100},{height:20},{scale:2},{width:NaN}])it('拒绝超限/横向/缩放尺寸 '+JSON.stringify(patch),()=>expect(()=>checkLongPage({...page,...patch})).toThrow());
it('高度、URL、DPR变化拒绝，不静默保存部分',()=>{for(const patch of [{pageHeight:1801},{href:'https://other.test'},{dpr:2}])expect(()=>checkLongPage(page,{...page,...patch})).toThrow('变化');});
function harness(options:{change?:boolean;large?:boolean;cancelEncoding?:boolean;page?:LongPage}={}){
 const draw=vi.fn(),close=vi.fn(),calls:string[]=[];let cancelled=false;
 vi.stubGlobal('createImageBitmap',async()=>({width:1500,height:1050,close}));
 vi.stubGlobal('OffscreenCanvas',class{constructor(public width:number,public height:number){}getContext(){return {drawImage:draw};}async convertToBlob(){if(options.cancelEncoding)cancelled=true;return options.large?new Blob([new Uint8Array(LONG_MAX_BYTES+1)]):new Blob(['encoded'],{type:'image/webp'});}});
 const initial=options.page??page;let current={...initial};const control=vi.fn(async(action:string,_id:string,y=0)=>{calls.push(action);if(cancelled&&action!=='end')throw new Error('已取消');if(action==='frame')current={...initial,scrollY:Math.min(y,initial.pageHeight-initial.height)};if(action==='check'&&options.change)current={...current,pageHeight:1900};return current;});
 const capture=vi.fn(async()=>'data:image/png;base64,YQ==');return {draw,close,control,capture,calls};
}
it('按实际位图比例拼接，逐帧释放且总在finally恢复页面',async()=>{
 const h=harness(),result=await stitchLongPage(h.control,h.capture,async()=>{});expect(result).toMatchObject({width:1500,height:2700,originalBytes:3});expect(h.draw).toHaveBeenCalledTimes(3);expect(h.draw.mock.calls.at(-1)?.slice(1)).toEqual([0,448.5,1500,601.5,0,2099,1500,601]);expect(h.close).toHaveBeenCalledTimes(3);expect(h.calls.at(-1)).toBe('end');expect(h.capture).toHaveBeenCalledTimes(3);
});
for(const [name,options]of [['页面变化',{change:true}],['体积超限',{large:true}],['压缩时取消',{cancelEncoding:true}]] as const)it(name+'时不返回半成品，仍恢复且不重试截图',async()=>{
 const h=harness(options);await expect(stitchLongPage(h.control,h.capture,async()=>{})).rejects.toThrow();expect(h.calls.at(-1)).toBe('end');expect(h.capture.mock.calls.length).toBeLessThanOrEqual(3);
});
it('失去活动标签时停止，不截图其他页面',async()=>{const h=harness();await expect(stitchLongPage(h.control,h.capture,async()=>{throw new Error('切换页面');})).rejects.toThrow('切换');expect(h.capture).not.toHaveBeenCalled();expect(h.calls.at(-1)).toBe('end');});
it('full截图Blob和类型可重开及ZIP恢复，旧visible图片同时保留',async()=>{
 const source=new IdeaClipDB('long-source-'+crypto.randomUUID()),target=new IdeaClipDB('long-target-'+crypto.randomUUID());let backup;
 try{const blob=new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'});const image={id:'full-test',blob,kind:'full' as const,width:1,height:1,originalBytes:68,sourceTabId:12,sourceUrl:page.href,sourceTitle:'合成长图',createdAt:1};await saveScreenshot(image,source);await saveScreenshot({...image,id:'old',kind:'visible'},source);await saveScreenshot({...image,id:'segment-test',kind:'segment',captureRange:segmentRange({...page,pageHeight:23000})},source);source.close();await source.open();expect((await source.screenshots.get('full-test'))?.kind).toBe('full');backup=await prepareBackup(await exportBackup(source));await restoreBackup(backup,'merge',target);expect((await target.screenshots.get('full-test'))?.kind).toBe('full');expect(await target.screenshots.count()).toBe(3);expect((await target.screenshots.get('segment-test'))?.captureRange).toEqual(segmentRange({...page,pageHeight:23000}));expect(await (await target.screenshots.get('full-test'))!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());}finally{if(backup)await discardBackup(backup);await source.delete();await target.delete();}
});

it('超长页分段从当前位置开始，并仅显式继续到旧段末尾',async()=>{
 const initial={...page,pageHeight:23000,scrollY:310};const a=segmentRange(initial);expect(a).toMatchObject({startY:310,endY:20310,pageHeight:23000});const b=segmentRange(initial,a);expect(b).toMatchObject({startY:20310,endY:23000});expect(()=>segmentRange(initial,b)).toThrow();expect(()=>segmentRange({...initial,width:900,pageWidth:900},a)).toThrow('变化');expect(()=>segmentRange({...initial,pageHeight:24000},a)).toThrow('变化');
 const h=harness({page:initial}),result=await stitchLongPage(h.control,h.capture,async()=>{},true);expect(result.captureRange).toEqual(a);expect(h.capture.mock.calls.length).toBeLessThanOrEqual(40);expect(h.calls.at(-1)).toBe('end');const last=h.control.mock.calls.filter(c=>c[0]==='frame').at(-1)!;expect(last[2]).toBeLessThan(a.endY);
 const tail=harness({page:initial}),next=await stitchLongPage(tail.control,tail.capture,async()=>{},true,a);expect(next.captureRange).toEqual(b);expect(tail.calls.at(-1)).toBe('end');
});
it('小视口分段长度按40帧计算，不放宽全页原有限制',()=>{
 const initial={...page,height:300,pageHeight:50000};expect(()=>checkLongPage(initial)).toThrow('分段截长图');const r=segmentRange(initial);expect(r.endY-r.startY).toBe(11960);expect(r.endY-r.startY).toBeLessThanOrEqual(20000);
});
for(const patch of [{startY:-1},{endY:24000},{endY:22000},{viewportHeight:0},{pageHeight:NaN},{extra:'untrusted'}])it('分段元数据拒绝越界或未知字段 '+JSON.stringify(patch),()=>{
 expect(()=>validateCaptureRange({...segmentRange({...page,pageHeight:23000}),...patch})).toThrow();
});
it('分段元数据白名单备份，旧截图不新增伪造范围',()=>{
 const range=segmentRange({...page,pageHeight:23000}),row={id:'segment',kind:'segment',captureRange:range,width:1000,height:20000,originalBytes:100,sourceTabId:7,sourceUrl:page.href,sourceTitle:'合成',createdAt:1};expect(portableRow('screenshots',row)).toMatchObject({kind:'segment',captureRange:range,sourceTabId:0});expect(portableRow('screenshots',{...row,kind:'full'})).not.toHaveProperty('captureRange');expect(()=>portableRow('screenshots',{...row,captureRange:{...range,endY:50000}})).toThrow();
});

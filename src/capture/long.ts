import {sameViewport} from './geometry';
import {decodeCapture} from './image';
import type {LongPage,LongAction} from './long-page';
import {validateCaptureRange,type CaptureRange} from './range';
export const LONG_MAX_HEIGHT=20000,LONG_MAX_TILES=40,LONG_MAX_BYTES=6*1024*1024;
export function checkLongPage(initial:LongPage,current=initial,segmented=false){
 if(![current.width,current.height,current.pageHeight,current.pageWidth,current.dpr].every(n=>Number.isFinite(n)&&n>0)||current.scale!==1)throw new Error('无法确定长截图尺寸或缩放，请重试。');
 if(!segmented&&(current.pageHeight>LONG_MAX_HEIGHT||Math.ceil(current.pageHeight/current.height)>LONG_MAX_TILES))throw new Error('网页过长：整页长图最多20000 CSS像素、40屏；请点击“分段截长图”。');
 if(current.pageWidth>current.width+2)throw new Error('页面存在横向滚动，请调整网页宽度后重试；未裁掉横向内容。');
 const size=(n:number)=>Math.round(n*100)/100;
 const reason=initial.href!==current.href?'网页地址发生变化':initial.dpr!==current.dpr?'网页缩放发生变化':initial.width!==current.width||initial.height!==current.height?`可视区域发生变化（${size(initial.width)}×${size(initial.height)} → ${size(current.width)}×${size(current.height)} CSS像素）`:initial.pageWidth!==current.pageWidth?'网页宽度发生变化':initial.pageHeight!==current.pageHeight?`网页高度发生变化（${size(initial.pageHeight)} → ${size(current.pageHeight)} CSS像素）`:null;
 if(reason)throw new Error(`${reason}；请等待加载完成，或改用可见页面/区域截图；未保存不完整图片。`);
}
export function segmentRange(page:LongPage,previous?:CaptureRange):CaptureRange{
 checkLongPage(page,page,true);if(previous){validateCaptureRange(previous);if(previous.pageHeight!==page.pageHeight||previous.viewportWidth!==page.width||previous.viewportHeight!==page.height)throw new Error('网页高度或排版已变化，不能延续旧分段；请从当前位置重新分段截图。');}
 const startY=previous?.endY??page.scrollY,span=Math.min(LONG_MAX_HEIGHT,Math.floor((page.height-1)*LONG_MAX_TILES));
 return validateCaptureRange({startY,endY:Math.min(page.pageHeight,startY+span),pageHeight:page.pageHeight,viewportWidth:page.width,viewportHeight:page.height});
}
export function longSlice(covered:number,page:LongPage){
 const edge=page.scrollY+page.height,from=Math.max(covered,page.scrollY),to=Math.abs(page.pageHeight-edge)<0.01?page.pageHeight:Math.min(page.pageHeight,edge);
 if(page.scrollX!==0||page.scrollY>covered+0.01||to<=covered||from<0)throw new Error('页面无法连续滚动，长截图已停止；请使用区域截图。');
 return {from,to};
}
type LongControl=(action:LongAction,id:string,y?:number)=>Promise<LongPage>;
export async function prepareLongPage(control:LongControl,id:string,initial:LongPage,assertActive:()=>Promise<void>,segmented=false,previous?:CaptureRange){
 checkLongPage(initial,initial,segmented);
 const requested=segmented?segmentRange(initial,previous):{startY:0,endY:initial.pageHeight};
 let y=requested.startY;
 for(let warm=0;;warm++){
  if(warm>=LONG_MAX_TILES)throw new Error('网页持续加载或准备超过40屏，未开始拼图；请缩小范围，或使用可见页面/区域截图。');
  await assertActive();const current=await control('frame',id,y);
  // Only document height may settle before any pixels are captured. Identity and viewport remain strict.
  checkLongPage({...initial,pageHeight:current.pageHeight},current,segmented);
  const end=segmented?Math.min(current.pageHeight,requested.endY):current.pageHeight;
  // No pixels are taken here. Reserve one CSS pixel for fractional scroll quantization,
  // just as the actual capture loop does with its overlap.
  const bottom=longSlice(y+1,current).to;
  if(bottom>=end-0.01)break;
  const next=bottom-1;if(next<=y)throw new Error('网页无法连续预加载，未开始拼图；请使用区域截图。');y=next;
 }
 await assertActive();await control('frame',id,requested.startY);
 const settled=await control('settle',id);await assertActive();
 checkLongPage({...initial,pageHeight:settled.pageHeight},settled,segmented);
 // A continued segment must still match its saved layout after preparation.
 if(segmented&&previous)segmentRange(settled,previous);
 return settled;
}
export async function stitchLongPage(control:LongControl,capture:()=>Promise<string>,assertActive:()=>Promise<void>,segmented=false,previous?:CaptureRange){
 const id=crypto.randomUUID();let canvas:OffscreenCanvas|undefined,originalBytes=0;
 try{
  await assertActive();const starting=await control('start',id);const initial=await prepareLongPage(control,id,starting,assertActive,segmented,previous);
  const range=segmented?segmentRange(initial,previous):{startY:0,endY:initial.pageHeight},length=range.endY-range.startY;
  const check=(current:LongPage)=>checkLongPage(initial,current,segmented);
  let covered=range.startY,tiles=0;
  while(covered<range.endY){
   if(++tiles>LONG_MAX_TILES)throw new Error('长截图超过40屏，请分段截图。');
   // One CSS pixel overlap absorbs browser scroll quantization; only new pixels are drawn.
   await assertActive();const before=await control('frame',id,Math.max(0,covered-1));check(before);
   const data=await capture();const after=await control('check',id);await assertActive();check(after);
   if(!sameViewport(before,after))throw new Error('截图时页面位置发生变化，未保存不完整图片。');
   const original=decodeCapture(data),bitmap=await createImageBitmap(original);originalBytes+=original.size;
   try{
    if(bitmap.width*bitmap.height>100000000)throw new Error('页面分辨率过大，请降低窗口分辨率。');
    if(!canvas){const ratio=Math.min(bitmap.width/initial.width,1600/initial.width,24000/length,Math.sqrt(32000000/(initial.width*length)));canvas=new OffscreenCanvas(Math.max(1,Math.floor(initial.width*ratio)),Math.max(1,Math.floor(length*ratio)));}
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器无法拼接长图。');
    const slice=longSlice(covered,before),from=slice.from,to=Math.min(range.endY,slice.to),ratio=canvas.height/length,top=Math.round((from-range.startY)*ratio),bottom=Math.round((to-range.startY)*ratio);
    ctx.drawImage(bitmap,0,(from-before.scrollY)*bitmap.height/before.height,bitmap.width,(to-from)*bitmap.height/before.height,0,top,canvas.width,bottom-top);covered=to;
   }finally{bitmap.close();}
  }
  const final=await control('check',id);check(final);await assertActive();
  // Preserve readable dimensions; fail explicitly rather than silently shrinking a long document.
  for(const quality of [0.88,0.72,0.55]){const blob=await canvas!.convertToBlob({type:'image/webp',quality});if(blob.size&&blob.size<=LONG_MAX_BYTES){check(await control('check',id));await assertActive();return {blob,width:canvas!.width,height:canvas!.height,originalBytes,...(segmented?{captureRange:range as CaptureRange}:{})};}}
  throw new Error('长图压缩后仍超过6 MB，请分段截图。');
 }finally{await control('end',id).catch(()=>{});if(canvas){canvas.width=1;canvas.height=1;}}
}

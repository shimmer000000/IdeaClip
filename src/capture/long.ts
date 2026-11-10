import {sameViewport} from './geometry';
import {decodeCapture} from './image';
import type {LongPage} from './long-page';
export const LONG_MAX_HEIGHT=20000,LONG_MAX_TILES=40,LONG_MAX_BYTES=6*1024*1024;
export function checkLongPage(initial:LongPage,current=initial){
 if(![current.width,current.height,current.pageHeight,current.pageWidth,current.dpr].every(n=>Number.isFinite(n)&&n>0)||current.scale!==1)throw new Error('无法确定长截图尺寸或缩放，请重试。');
 if(current.pageHeight>LONG_MAX_HEIGHT||Math.ceil(current.pageHeight/current.height)>LONG_MAX_TILES)throw new Error('网页过长：最多20000 CSS像素、40屏，请分段使用区域截图。');
 if(current.pageWidth>current.width+2)throw new Error('页面存在横向滚动，请调整网页宽度后重试；未裁掉横向内容。');
 if(initial.width!==current.width||initial.height!==current.height||initial.dpr!==current.dpr||initial.href!==current.href||initial.pageHeight!==current.pageHeight||initial.pageWidth!==current.pageWidth)throw new Error('页面尺寸或内容高度发生变化，请等待加载完成后重截；未保存不完整图片。');
}
export function longSlice(covered:number,page:LongPage){
 const edge=page.scrollY+page.height,from=Math.max(covered,page.scrollY),to=Math.abs(page.pageHeight-edge)<0.01?page.pageHeight:Math.min(page.pageHeight,edge);
 if(page.scrollX!==0||page.scrollY>covered+0.01||to<=covered||from<0)throw new Error('页面无法连续滚动，长截图已停止；请使用区域截图。');
 return {from,to};
}
export async function stitchLongPage(control:(action:'start'|'frame'|'check'|'end',id:string,y?:number)=>Promise<LongPage>,capture:()=>Promise<string>,assertActive:()=>Promise<void>){
 const id=crypto.randomUUID();let canvas:OffscreenCanvas|undefined,originalBytes=0;
 try{
  await assertActive();const initial=await control('start',id);checkLongPage(initial);
  let covered=0,tiles=0;
  while(covered<initial.pageHeight){
   if(++tiles>LONG_MAX_TILES)throw new Error('长截图超过40屏，请分段截图。');
   // One CSS pixel overlap absorbs browser scroll quantization; only new pixels are drawn.
   await assertActive();const before=await control('frame',id,Math.max(0,covered-1));checkLongPage(initial,before);
   const data=await capture();const after=await control('check',id);await assertActive();checkLongPage(initial,after);
   if(!sameViewport(before,after))throw new Error('截图时页面位置发生变化，未保存不完整图片。');
   const original=decodeCapture(data),bitmap=await createImageBitmap(original);originalBytes+=original.size;
   try{
    if(bitmap.width*bitmap.height>100000000)throw new Error('页面分辨率过大，请降低窗口分辨率。');
    if(!canvas){const ratio=Math.min(bitmap.width/initial.width,1600/initial.width,24000/initial.pageHeight,Math.sqrt(32000000/(initial.width*initial.pageHeight)));canvas=new OffscreenCanvas(Math.max(1,Math.floor(initial.width*ratio)),Math.max(1,Math.floor(initial.pageHeight*ratio)));}
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器无法拼接长图。');
    const {from,to}=longSlice(covered,before),ratio=canvas.height/initial.pageHeight,top=Math.round(from*ratio),bottom=Math.round(to*ratio);
    ctx.drawImage(bitmap,0,(from-before.scrollY)*bitmap.height/before.height,bitmap.width,(to-from)*bitmap.height/before.height,0,top,canvas.width,bottom-top);covered=to;
   }finally{bitmap.close();}
  }
  const final=await control('check',id);checkLongPage(initial,final);await assertActive();
  // Preserve readable dimensions; fail explicitly rather than silently shrinking a long document.
  for(const quality of [0.88,0.72,0.55]){const blob=await canvas!.convertToBlob({type:'image/webp',quality});if(blob.size&&blob.size<=LONG_MAX_BYTES){checkLongPage(initial,await control('check',id));await assertActive();return {blob,width:canvas!.width,height:canvas!.height,originalBytes};}}
  throw new Error('长图压缩后仍超过6 MB，请分段截图。');
 }finally{await control('end',id).catch(()=>{});if(canvas){canvas.width=1;canvas.height=1;}}
}

import type {Viewport} from './geometry';
export interface LongPage extends Viewport {pageHeight:number;pageWidth:number}
export type LongAction='start'|'frame'|'settle'|'check'|'end';

// Self-contained isolated-world function: never fetches, reads form values or executes page code.
export async function longPage(action:LongAction,id:string,y=0):Promise<LongPage>{
 type State={id:string;end:()=>void;style:HTMLStyleElement;hidden:[HTMLElement,string,string][]};
 const scope=globalThis as typeof globalThis&{__icLong?:State;__ideaClipCancel?:()=>void};
 // At fractional browser zoom innerHeight is rounded, while the visible CSS height is not.
 const measure=()=>({width:innerWidth,height:visualViewport?.height??innerHeight,scrollX,scrollY,dpr:devicePixelRatio,scale:visualViewport?.scale??1,href:location.href,pageHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0,innerHeight),pageWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth??0,innerWidth)});
 if(action==='end'){if(scope.__icLong?.id===id)scope.__icLong.end();return measure();}
 if(action==='start'){
  scope.__ideaClipCancel?.();scope.__icLong?.end();
  if((visualViewport?.scale??1)!==1)throw new Error('请先退出触控捏合缩放，再截长图。');
  const elements=document.querySelectorAll('*');if(elements.length>20000)throw new Error('页面结构过于复杂，请使用区域截图。');
  for(const element of elements)if(element instanceof HTMLElement&&element!==document.body&&element!==document.documentElement&&element.clientHeight>innerHeight/2&&element.scrollHeight>element.clientHeight+2&&/auto|scroll/.test(getComputedStyle(element).overflowY))throw new Error('页面主要内容位于独立滚动容器，暂不支持长图；请使用区域截图。');
  const original={x:scrollX,y:scrollY},style=document.createElement('style'),hidden:State['hidden']=[];
  style.textContent='html,body,*{scroll-behavior:auto!important;scroll-snap-type:none!important;animation-play-state:paused!important;transition:none!important}';
  document.documentElement.append(style);
  for(const element of elements)if(element instanceof HTMLElement&&['fixed','sticky'].includes(getComputedStyle(element).position)){
   hidden.push([element,element.style.getPropertyValue('visibility'),element.style.getPropertyPriority('visibility')]);element.style.setProperty('visibility','hidden','important');
  }
  let timer:ReturnType<typeof setTimeout>;
  const cancel=()=>end();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();end();}};
  const visibility=()=>{if(document.hidden)end();};
  function end(){clearTimeout(timer);for(const [e,value,priority]of hidden){if(value)e.style.setProperty('visibility',value,priority);else e.style.removeProperty('visibility');}scrollTo({left:original.x,top:original.y,behavior:'instant'});style.remove();window.removeEventListener('keydown',key,true);window.removeEventListener('wheel',cancel,true);window.removeEventListener('pointerdown',cancel,true);window.removeEventListener('pagehide',cancel);document.removeEventListener('visibilitychange',visibility);if(scope.__icLong?.id===id)delete scope.__icLong;}
  scope.__icLong={id,end,style,hidden};window.addEventListener('keydown',key,true);window.addEventListener('wheel',cancel,true);window.addEventListener('pointerdown',cancel,true);window.addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',visibility);timer=setTimeout(end,90000);
 }
 if(scope.__icLong?.id!==id)throw new Error('长截图已取消；未保存不完整图片。');
 if(action==='frame'){
  scrollTo({left:0,top:y,behavior:'instant'});
  await new Promise(resolve=>setTimeout(resolve,180));
  await Promise.race([new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('网页未及时渲染，长截图已停止。')),1500))]);
 }
 if(action==='settle'){
  let previous=measure(),stable=0;
  for(let sample=0;sample<10;sample++){
   await new Promise(resolve=>setTimeout(resolve,200));
   if(scope.__icLong?.id!==id)throw new Error('长截图已取消；未保存不完整图片。');
   const current=measure();
   stable=Object.keys(current).every(key=>current[key as keyof LongPage]===previous[key as keyof LongPage])?stable+1:0;
   if(stable>=3)return current;
   previous=current;
  }
  throw new Error('页面仍在加载或排版变化：2秒内尺寸未稳定，未开始拼图；请等待加载完成，或改用可见页面/区域截图。');
 }
 if(scope.__icLong?.id!==id)throw new Error('长截图已取消；未保存不完整图片。');
 return measure();
}

import {version} from '../../package.json';

export const CAPTURE_MODES = ['visible','region','full','segment'] as const;
export type CaptureMode = typeof CAPTURE_MODES[number];
export const captureBackendInfo = () => ({protocol:1,version,modes:[...CAPTURE_MODES]});
const unavailable = () => new Error(`截图后台未就绪或版本不一致（当前界面 v${version}）。请在 Chrome 扩展管理中重新加载 IdeaClip，再关闭并重开旧的插件页面；不要卸载，已有数据会保留。`);

export async function requestCapture(kind:CaptureMode,options:{screenshotId?:string;nextSegment?:boolean;draftId?:string}={}) {
 if(!globalThis.chrome?.runtime?.id)throw new Error('请在已安装的 IdeaClip 插件中使用截图功能。');
 if(chrome.runtime.getManifest().version!==version)throw unavailable();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const info=await Promise.race([
   chrome.runtime.sendMessage({type:'IC_CAPTURE_CAPABILITIES'}),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),3000);})
  ]);
  if(!info||info.protocol!==1||info.version!==version||!Array.isArray(info.modes)||!info.modes.includes(kind))throw unavailable();
 }catch{throw unavailable();}finally{clearTimeout(timer);}
 const response=await chrome.runtime.sendMessage({type:'IC_CAPTURE_START',kind,...options});
 if(!response?.ok){if(response?.error==='无效的截图方式。')throw unavailable();throw new Error(response?.error??'截图未完成，请重新点击插件后重试。');}
 return response.id as string|null;
}

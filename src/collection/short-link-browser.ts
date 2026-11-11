import { tcoUrl, resolveShortLinks, readTcoHtml } from './short-links';
// Ephemeral bounded cache, including failures, prevents StrictMode/reopen duplicate requests.
const cache=new Map<string,{at:number;value:Promise<string|null>}>();
export async function readTcoLocation(input:string,timeout:number):Promise<string|null>{
 const url=tcoUrl(input);if(!url)return null;
 if(!await chrome.permissions.contains({permissions:['webRequest'],origins:['https://t.co/*']}))return null;
 const old=cache.get(url);if(old&&Date.now()-old.at<60000)return old.value;
 if(cache.size>=200)cache.delete(cache.keys().next().value!);
 const value=(async()=>{
  let location:string|null=null;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  const origin=chrome.runtime.getURL('').replace(/\/$/,'');
  const listener=(details:chrome.webRequest.OnHeadersReceivedDetails):undefined=>{
   if(details.url!==url||details.method!=='GET'||details.initiator!==origin||![301,302,303,307,308].includes(details.statusCode))return;
   location=details.responseHeaders?.find(h=>h.name.toLowerCase()==='location')?.value??null;
  };
  chrome.webRequest.onHeadersReceived.addListener(listener,{urls:['https://t.co/*'],types:['xmlhttprequest']},['responseHeaders']);
  try{const response=await fetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});if(location){await response.body?.cancel();return location;}return await readTcoHtml(response);}
  catch{return null;}finally{clearTimeout(timer);chrome.webRequest.onHeadersReceived.removeListener(listener);}
 })();cache.set(url,{at:Date.now(),value});return value;
}
export const resolveBrowserShortLinks=(links:{url:string}[])=>resolveShortLinks(links,readTcoLocation);

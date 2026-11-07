import { proxyFailure } from './errors';
import { Readability } from '@mozilla/readability';
import { obj, txt, list, researchUrl, type Operation, type ResearchConfig } from './model';
export interface SourceData {url:string;title:string;content:string;publishedAt:string|null;status:'snippet'|'readable'|'partial'|'unreadable';type:'search'|'webpage'|'github';reason:string}
export interface ResearchAdapter {execute(operation:Operation,config:ResearchConfig,key:string,signal:AbortSignal):Promise<SourceData[]>}
function plainHtml(html:string){
 // Template contents remain inert: strip executable/resource elements and every
 // resource/event attribute BEFORE copying into an offscreen document for Readability.
 const template=document.createElement('template');template.innerHTML=html;
 template.content.querySelectorAll('script,style,link,meta,base,img,iframe,object,embed,video,audio,source,svg,math,form,input,textarea,button,noscript,nav,header,footer,aside,menu,dialog,[hidden],[inert],[aria-hidden="true"],[role="navigation"],[role="complementary"]').forEach(e=>e.remove());
 template.content.querySelectorAll('[style]').forEach(e=>{if(/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;}]|\s*$))/i.test(e.getAttribute('style')??''))e.remove();});
 template.content.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes])if(!['class','id'].includes(a.name))e.removeAttribute(a.name);});
 const doc=document.implementation.createHTMLDocument('');doc.body.append(template.content.cloneNode(true));const parsed=new Readability(doc).parse();return parsed?.textContent?.trim()??'';
}
export function parseProxyResponse(value:unknown,op:Operation,c:ResearchConfig):SourceData[]{
 const raw=obj(value);if(raw.version!==1)throw new Error('研究代理协议版本不兼容。');
 if(op.kind==='search')return list(raw.results,5).map(v=>{const r=obj(v);let url:string;try{url=researchUrl(r.url,c.hosts);}catch{return null;}const content=txt(r.snippet,30000);return {url,title:txt(r.title,1000),content:content.slice(0,c.maxText),publishedAt:date(r.publishedAt),status:'snippet' as const,type:'search' as const,reason:content.length>c.maxText?'搜索摘要已按本次长度限制截取。':'搜索摘要，不代表已读取原网页。'};}).filter((r):r is NonNullable<typeof r>=>r!==null);
 const url=researchUrl(raw.url,c.hosts);if(url!==op.value)throw new Error('代理返回的来源 URL 与确认的请求不一致。');
 if(!['readable','unreadable'].includes(String(raw.status)))throw new Error('来源读取状态无效。');
 let content=raw.status==='unreadable'?'':raw.html!==undefined?plainHtml(txt(raw.html,2*1024*1024)):txt(raw.text,30000);
 const truncated=raw.truncated===true||content.length>c.maxText;content=content.slice(0,c.maxText);
 return [{url,title:txt(raw.title,1000),content,publishedAt:date(raw.publishedAt),status:!content?'unreadable':truncated?'partial':'readable',type:op.kind==='github'?'github':'webpage',reason:!content?'未取得公开可读正文；不绕过登录或访问限制。':truncated?'正文已按本次长度上限截取，资料不完整。':'代理公开读取，尚未独立核验。'}];
}
function date(v:unknown){if(v===null||v===undefined||v==='')return null;const s=txt(v,100);if(!Number.isFinite(Date.parse(s)))throw new Error('来源时间无效。');return s;}
export async function proxyJSON(fetcher:typeof fetch,c:ResearchConfig,key:string,payload:unknown,signal:AbortSignal,maxBytes=2*1024*1024){
 const response=await fetcher(c.endpoint,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify(payload)});
 if(response.redirected||!response.headers.get('content-type')?.includes('application/json'))throw new Error('研究代理响应格式无效，未自动重试。');
 if(!response.body)throw new Error('研究响应为空。');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('研究响应超过安全上限。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(key&&text.includes(key))throw new Error('研究响应包含凭据，已丢弃。');const raw=obj(JSON.parse(text));if(!response.ok)throw proxyFailure(raw.error);return raw;
}
export function proxyAdapter(fetcher:typeof fetch=fetch):ResearchAdapter{return {async execute(op,c,key,signal){
 return parseProxyResponse(await proxyJSON(fetcher,c,key,{version:1,operation:op,allowHosts:c.hosts,maxText:c.maxText},signal),op,c);
}};}

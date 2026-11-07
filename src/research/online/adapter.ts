import { proxyFailure, ResearchFailure } from './errors';
import { Readability } from '@mozilla/readability';
import { researchDocument } from './safe-html';
import { obj, txt, list, researchUrl, type Operation, type ResearchConfig } from './model';
export interface SourceData {url:string;title:string;content:string;publishedAt:string|null;status:'snippet'|'readable'|'partial'|'unreadable';type:'search'|'webpage'|'github';reason:string}
export interface ResearchAdapter {execute(operation:Operation,config:ResearchConfig,key:string,signal:AbortSignal):Promise<SourceData[]>}
function plainHtml(html:string){
 const doc=researchDocument(html);
 // Product pages can put short price cards outside the long FAQ chosen by
 // Readability. Keep their sanitized static main content, without running JS
 // or treating DOM readability as a guarantee of completeness or truth.
 const root=doc.querySelector('main')??doc.body;const text=root.textContent??'';
 const pricing=!root.querySelector('article')&&root.querySelectorAll('h2,h3,h4').length>=2&&/(?:[$€£¥￥]\s*\d|\d[\d.,]*\s*(?:USD|EUR|GBP|CNY)\b)/i.test(text)&&/\b(?:monthly|annually|annual|month|year|one[ -]time|billed)\b|月付|年付|每月|每年|一次性/i.test(text);
 if(pricing){const blocks=new Set(['H1','H2','H3','H4','H5','H6','P','DIV','SECTION','UL','OL','LI','DL','DT','DD','TABLE','TR','BR']);const plain=(node:Node):string=>node.nodeType===3?node.textContent??'':node.nodeType===1?(blocks.has(node.nodeName)?'\n':'')+[...node.childNodes].map(plain).join('')+(blocks.has(node.nodeName)?'\n':''):'';return {content:plain(root).replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim(),pricing:true};}
 const parsed=new Readability(doc).parse();return {content:parsed?.textContent?.trim()??'',pricing:false};
}
export function parseProxyResponse(value:unknown,op:Operation,c:ResearchConfig):SourceData[]{
 const raw=obj(value);if(raw.version!==1)throw new Error('研究代理协议版本不兼容。');
 if(op.kind==='search')return list(raw.results,5).map(v=>{const r=obj(v);let url:string;try{url=researchUrl(r.url,c.hosts);}catch{return null;}const content=txt(r.snippet,30000);return {url,title:txt(r.title,1000),content:content.slice(0,c.maxText),publishedAt:date(r.publishedAt),status:'snippet' as const,type:'search' as const,reason:content.length>c.maxText?'搜索摘要已按本次长度限制截取。':'搜索摘要，不代表已读取原网页。'};}).filter((r):r is NonNullable<typeof r>=>r!==null);
 const url=researchUrl(raw.url,c.hosts);if(url!==op.value)throw new Error('代理返回的来源 URL 与确认的请求不一致。');
 if(!['readable','unreadable'].includes(String(raw.status)))throw new Error('来源读取状态无效。');
 const html=raw.status==='readable'&&raw.html!==undefined?plainHtml(txt(raw.html,2*1024*1024)):null;
 let content=raw.status==='unreadable'?'':html?html.content:txt(raw.text,30000);
 const truncated=raw.truncated===true||content.length>c.maxText;content=content.slice(0,c.maxText);
 return [{url,title:txt(raw.title,1000),content,publishedAt:date(raw.publishedAt),status:!content?'unreadable':truncated?'partial':'readable',type:op.kind==='github'?'github':'webpage',reason:!content?'未取得公开可读正文；不绕过登录或访问限制。':truncated?'正文已按本次长度上限截取，资料不完整。':html?.pricing?'保留静态HTML中的定价卡片及正文；动态内容、计费条件和资料完整性仍需人工核对，尚未独立核验。':'代理公开读取，尚未独立核验。'}];
}
function date(v:unknown){if(v===null||v===undefined||v==='')return null;const s=txt(v,100);if(!Number.isFinite(Date.parse(s)))throw new Error('来源时间无效。');return s;}
export async function proxyJSON(fetcher:typeof fetch,c:ResearchConfig,key:string,payload:unknown,signal:AbortSignal,maxBytes=2*1024*1024){
 let response:Response;try{response=await fetcher(c.endpoint,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify(payload)});}catch{throw new ResearchFailure(signal.aborted?'REQUEST_CANCELLED':'PROXY_UNREACHABLE');}
 if(response.status===401||response.status===403){await response.body?.cancel().catch(()=>{});throw new ResearchFailure('PROXY_AUTH_FAILED');}
 if(response.redirected||!response.headers.get('content-type')?.includes('application/json'))throw new ResearchFailure('SEARCH_RESPONSE_INVALID');
 if(!response.body)throw new ResearchFailure('SEARCH_RESPONSE_INVALID');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('研究响应超过安全上限。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ResearchFailure('SEARCH_RESPONSE_INVALID');}if(key&&text.includes(key))throw new Error('研究响应包含凭据，已丢弃。');let raw:Record<string,unknown>;try{raw=obj(JSON.parse(text));}catch{throw new ResearchFailure('SEARCH_RESPONSE_INVALID');}if(!response.ok)throw proxyFailure(raw.error,raw.diagnostic);return raw;
}
export function proxyAdapter(fetcher:typeof fetch=fetch):ResearchAdapter{return {async execute(op,c,key,signal){
 const raw=await proxyJSON(fetcher,c,key,{version:1,operation:op,allowHosts:c.hosts,maxText:c.maxText},signal);
 try{const results=parseProxyResponse(raw,op,c);return Object.assign(results,{searchStatus:raw.searchStatus==='SEARCH_RESULT_EMPTY'||raw.searchStatus==='SEARCH_RESULT_FILTERED'?raw.searchStatus:undefined});}catch{throw new ResearchFailure('SEARCH_RESPONSE_INVALID');}
}};}

import { parseFragment } from 'parse5';
import { githubProjects, type ExtractedPage } from './model';
export function tcoUrl(value:string):string|null {
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='t.co'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[a-zA-Z0-9]{1,100}$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export type LocationReader=(url:string,timeout:number)=>Promise<string|null>;
/** Only t.co is requested. GitHub is recognized from Location, never fetched. */
export async function resolveShortLinks(links:{url:string}[],read:LocationReader,now=Date.now):Promise<string[]> {
 const result=new Set<string>(),started=now();
 for(const first of [...new Set(links.map(l=>tcoUrl(l.url)).filter((u):u is string=>!!u))].slice(0,3)){
  let current=first;const seen=new Set<string>();
  for(let hop=0;hop<3;hop++){
   const remaining=10000-(now()-started);if(remaining<=0)return [...result];if(seen.has(current))break;seen.add(current);
   let location:string|null;try{location=await read(current,Math.min(3500,remaining));}catch{break;}
   if(!location||location.length>2048||/[\u0000-\u0020\u007f]/.test(location))break;
   let target:string;try{target=new URL(location,current).href;}catch{break;}
   const repo=githubProjects([target])[0];if(repo){result.add(repo);break;}
   const next=tcoUrl(target);if(!next)break;current=next;
  }
 }
 return [...result];
}
export function withResolvedProjects<T extends Pick<ExtractedPage,'links'|'githubLinks'|'warnings'>>(page:T,repositories:string[]):T{
 const verified=githubProjects(repositories),known=new Set(page.links.map(l=>l.url));
 if(page.links.length+verified.filter(u=>!known.has(u)).length>200)return {...page,warnings:[...new Set([...page.warnings,'短链目标已识别，但外部链接数量已达上限，请整理后重新采集；未截断旧链接。'])]};
 return {...page,links:[...page.links,...verified.filter(u=>!known.has(u)).map(url=>({url,text:'X短链跳转目标（仓库地址格式已核实，项目内容未读取）'}))].slice(0,200),githubLinks:githubProjects([...page.githubLinks,...verified]),warnings:[...new Set([...page.warnings,...(verified.length?['已读取X短链跳转地址并识别GitHub仓库；未访问仓库正文或执行项目。']:[])])]};
}

/** Parse only declarative redirect metadata from bounded t.co HTML; never run scripts. */
export function tcoMetaTarget(html:string):string|null{
 if(html.length>65536)return null;
 type Node={nodeName:string;attrs?:{name:string;value:string}[];childNodes?:Node[]};
 const pending:Node[]=[parseFragment(html,{scriptingEnabled:false})],targets=new Set<string>();let count=0;
 while(pending.length){if(++count>2000)return null;const node=pending.pop()!;
  if(node.nodeName==='meta'&&node.attrs?.find(a=>a.name==='http-equiv')?.value.trim().toLowerCase()==='refresh'){
   const content=node.attrs.find(a=>a.name==='content')?.value??'',match=/^\s*[0-5](?:\.0+)?\s*;\s*url\s*=\s*(.+?)\s*$/i.exec(content);if(!match)return null;
   targets.add(match[1].replace(/^(["'])(.*)\1$/,'$2'));if(targets.size>1)return null;
  }
  if(node.childNodes)pending.push(...node.childNodes);
 }
 return targets.size===1?[...targets][0]:null;
}
export async function readTcoHtml(response:Response):Promise<string|null>{
 if(response.status!==200||!response.headers.get('content-type')?.toLowerCase().startsWith('text/html')){await response.body?.cancel();return null;}
 const reader=response.body?.getReader();if(!reader)return null;const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>65536)return null;text+=decoder.decode(chunk.value,{stream:true});}return tcoMetaTarget(text+decoder.decode());}
 finally{await reader.cancel().catch(()=>{});}
}

import { githubProjects } from '../collection/model';
import { jsonBounded } from '../incubation/github-sync';
export interface Datum { value: string | number | null; source: string; collectedAt: number }
export interface PublicProject { repository:string; collectedAt:number; fields:Record<string,Datum>; errors:string[] }
const cooldown = new Map<string,number>(); let blockedUntil=0;
export async function collectPublicProject(input:string, fetcher:typeof fetch=fetch, now=Date.now(), timeout=10000):Promise<PublicProject> {
 const repository=githubProjects([input])[0]; if(!repository) throw Error('请输入完整 HTTPS GitHub 仓库地址。');
 if(now<blockedUntil || now<(cooldown.get(repository.toLowerCase())??0)) throw Error('请等待60秒冷却或GitHub限流结束后手动获取。');
 cooldown.set(repository.toLowerCase(),now+60000);
 const base='https://api.github.com/repos/'+repository.split('/').slice(-2).join('/');
 const result:PublicProject={repository,collectedAt:now,fields:{},errors:[]};
 const put=(key:string,value:unknown,source:string,max=4000)=>{result.fields[key]={value:typeof value==='string'?value.slice(0,max):typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null,source,collectedAt:now};};
 async function get(path:string){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try {const response=await fetcher(base+path,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'},signal:controller.signal});
   if(response.status===403||response.status===429){const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;blockedUntil=Math.max(now+60000,Math.min(Number.isFinite(reset)?reset:0,now+3600000));throw Error('限流或访问受限');}
   if(response.status===404)throw Error('未知：公开资料不可取得（404）');
   if(!response.ok)throw Error('GitHub请求失败');
   return await jsonBounded(response);
  }catch(e){if(controller.signal.aborted)throw Error('GitHub查询超时');throw e;}finally{clearTimeout(timer);}
 }
 const raw=await get('');
 if(raw.private!==false || typeof raw.full_name!=='string'||raw.full_name.toLowerCase()!==repository.slice(19).toLowerCase())throw Error('无法核实公开仓库归属，未保存资料。');
 for(const [key,value]of Object.entries({name:raw.full_name,description:raw.description,language:raw.language,topics:Array.isArray(raw.topics)?raw.topics.filter((x:unknown)=>typeof x==='string').slice(0,30).join(', '):null,stars:raw.stargazers_count,forks:raw.forks_count,openIssuesIncludingPRs:raw.open_issues_count,updatedAt:raw.updated_at,pushedAt:raw.pushed_at,homepage:raw.homepage,license:raw.license?.spdx_id==='NOASSERTION'?null:raw.license?.spdx_id}))put(key,value,base);
 for(const path of ['/readme','/releases/latest']){
  if(blockedUntil>now)break;
  try{const r=await get(path);if(path==='/readme'){
   if(r.encoding!=='base64'||typeof r.content!=='string'||r.content.length>180000)throw Error('README缺失或超过大小上限');
   const binary=atob(r.content.replace(/\s/g,''));const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));if(text.length>100000)throw Error('README超过100000字符上限');put('README',text,base+path,100000);
  }else{put('release',typeof r.tag_name==='string'?r.tag_name:null,base+path);put('releasePublishedAt',r.published_at,base+path);}}
  catch(e){result.errors.push((path==='/readme'?'README':'Release')+'：'+(e instanceof Error?e.message:'未知'));put(path==='/readme'?'README':'release',null,base+path);}
 }
 for(const [key,path] of [['README','/readme'],['release','/releases/latest'],['releasePublishedAt','/releases/latest']])if(!result.fields[key])put(key,null,base+path);
 return result;
}
export function publicText(p:PublicProject){return `公开项目事实（GitHub官方API返回；README为第三方披露，未独立核验）\n仓库：${p.repository}\n采集时间：${new Date(p.collectedAt).toISOString()}\n`+Object.entries(p.fields).map(([k,d])=>`${k}: ${d.value??'未知'}\n来源：${d.source}\n采集时间：${new Date(d.collectedAt).toISOString()}`).join('\n\n')+'\n'+p.errors.join('\n')+'\n收入、月活、客单价、客户人数、转化率、Star增长：没有证据。Open Issue数包含PR，更新时间不等于真实开发活跃度；官网仅展示，不自动访问。许可证未知不得默认允许商业二次开发。';}

export const sourceAppendix=(text:string)=>"\n\n## 公开资料与来源（不可信原始资料）\n\n"+text.split("\n").map(line=>"    "+line).join("\n");

// Optional self-hosted reference proxy. Never started by the extension/build/tests.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request } from 'node:https';
import { NetworkFailure, lookupPublic, connectionFailure, failure, safeEvent, diagnoseBrave, type Stage, type Event } from './research-diagnostics.ts';
import { BlockList, isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const blocked=new BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const)blocked.addSubnet(address,prefix,'ipv4');
const blocked6=new BlockList();
for(const [address,prefix]of [['2001::',23],['2001:db8::',32],['2002::',16],['3ffe::',16],['3fff::',20]] as const)blocked6.addSubnet(address,prefix,'ipv6');
export function publicAddress(address:string){if(address.includes('%'))return false;const family=isIP(address);if(family===4)return !blocked.check(address,'ipv4');if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!blocked6.check(address,'ipv6');return false;}
export function safeSourceUrl(value:unknown,hosts:string[]){
 if(typeof value!=='string'||value.length>4000)throw new Error('source');const u=new URL(value);
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||isIP(u.hostname)||u.hostname.endsWith('.')||!hosts.includes(u.hostname)||/\/(login|signin|account|admin|private|mail|bank|payment|checkout)([/?#]|$)/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>/token|secret|password|api.?key|authorization|credential|signature/i.test(k)))throw new Error('source');return u;
}
type Address={address:string;family:number};
export interface SafeResponse {status:number;headers:Record<string,string|string[]|undefined>;body:string}
type Connector=(url:URL,addresses:Address[],headers:Record<string,string>,signal:AbortSignal,observe?:(event:Event)=>void)=>Promise<SafeResponse>;
export const connect:Connector=(url,addresses,headers,signal,observe)=>new Promise((resolve,reject)=>{
 const start=Date.now();let stage:Stage='tcp';
 const a=addresses[0];const req=request(url,{agent:false,signal,servername:url.hostname,rejectUnauthorized:true,maxHeaderSize:16384,
   lookup:(_hostname,options,callback)=>{if(options.all)callback(null,[{address:a.address,family:a.family as 4|6}]);else callback(null,a.address,a.family);},
   headers:{'User-Agent':'IdeaClip-Public-Research/1','Accept-Encoding':'identity',...headers}},res=>{
   stage='http';const chunks:Buffer[]=[];let size=0;
   if((res.statusCode??0)>=300&&(res.statusCode??0)<400||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();reject(new Error('redirect-or-encoding'));return;}
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(new Error('response-limit'));}else chunks.push(chunk);});
   res.on('error',e=>reject(connectionFailure(e,'http',start,signal.aborted)));res.on('end',()=>resolve({status:res.statusCode??0,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
 });req.on('socket',socket=>{socket.once('connect',()=>{observe?.({stage:'tcp',code:'OK',elapsedMs:Date.now()-start});stage='tls';});socket.once('secureConnect',()=>{observe?.({stage:'tls',code:'OK',elapsedMs:Date.now()-start});stage='http';});});
 req.on('error',e=>reject(e instanceof NetworkFailure?e:connectionFailure(e,stage,start,signal.aborted)));req.end();
});
export async function secureGet(url:URL,headers:Record<string,string>,signal:AbortSignal,options:{lookup?:(host:string)=>Promise<Address[]>;connect?:Connector;observe?:(event:Event)=>void}={}):Promise<SafeResponse>{
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||isIP(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.'))throw new Error('unsafe-endpoint');
 const addresses=await lookupPublic(url.hostname,signal,publicAddress,options.lookup);
 options.observe?.({stage:'dns',code:'OK',elapsedMs:0});options.observe?.({stage:'safety',code:'OK',elapsedMs:0});
 const response=await(options.connect??connect)(url,addresses,headers,signal,options.observe);signal.throwIfAborted();
 if(response.status>=300&&response.status<400)throw new Error('redirect');return response;
}
interface ProxyOptions { token:string; origins:string[]; hosts:string[]; braveKey?:string; maxDailySearches?:number; get?:typeof secureGet; diagnose?:typeof diagnoseBrave; diagnostic?:(event:{stage:Stage;code:string;elapsedMs:number})=>void; timeoutMs?:number }
const object=(v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('body');return v as Record<string,unknown>;};
const str=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max)throw new Error('text');return v;};
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
async function body(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const part of req){size+=part.length;if(size>32768)throw new Error('body-size');chunks.push(part);}return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
function json(res:ServerResponse,status:number,value:unknown){if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export function createResearchProxy(options:ProxyOptions){
 if(!/^[\x21-\x7e]{16,1000}$/.test(options.token)||!options.origins.length||options.origins.some(o=>!/^chrome-extension:\/\/[a-p]{32}$/.test(o)))throw new Error('Configure a private token and exact extension origins.');
 const hosts=[...new Set(options.hosts.map(h=>h.toLowerCase().trim()))];if(!hosts.length||hosts.length>20||hosts.some(h=>!h.includes('.')||isIP(h)||!/^[a-z0-9.-]+$/.test(h)||/(^|\.)(localhost|local|internal|arpa|onion|test|invalid)$/.test(h)))throw new Error('Configure public source host allowlist.');
 if(options.braveKey&&!/^[\x21-\x7e]{8,1000}$/.test(options.braveKey))throw new Error('Invalid search configuration.');
 let day='',searches=0;const recent:{stage:Stage;code:string;elapsedMs:number}[]=[];const log=(stage:Stage,code:string,start:number)=>{const event={stage,code,elapsedMs:Math.min(120000,Math.max(0,Date.now()-start))};recent.push(event);if(recent.length>30)recent.shift();try{options.diagnostic?.({...event});}catch{/* Diagnostics must never break a request. */}};
 const server=createServer(async(req,res)=>{
  const send=(status:number,value:unknown)=>{const raw=JSON.stringify(value);if([options.token,options.braveKey].some(k=>k&&raw.includes(k)))json(res,400,{error:'credential-in-response'});else json(res,status,value);};
  const start=Date.now();const get=options.get??((u:URL,h:Record<string,string>,s:AbortSignal)=>secureGet(u,h,s,{observe:e=>log(e.stage,e.code,start)}));const origin=req.headers.origin??'';if(!options.origins.includes(origin)){log('auth','PROXY_AUTH_FAILED',start);send(403,{error:'PROXY_AUTH_FAILED'});return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, Authorization'});res.end();return;}
  if(req.method!=='POST'||req.url!=='/research'||!equal(req.headers.authorization??'',`Bearer ${options.token}`)){log('auth','PROXY_AUTH_FAILED',start);send(403,{error:'PROXY_AUTH_FAILED'});return;}
  log('proxy','OK',start);log('auth','OK',start);let cancelled=false;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(10,Math.min(options.timeoutMs??20000,20000)));res.on('close',()=>{if(!res.writableEnded){cancelled=true;controller.abort();}});
  try{
   const r=await body(req),op=object(r.operation);if(r.version!==1)throw new Error('version');
   if(op.kind==='health'){send(200,{version:1,service:'IdeaClipResearchProxy',noUpstreamRequests:true,search:{provider:'brave',configured:!!options.braveKey,verified:false},allowedHosts:hosts,usage:{day:new Date().toISOString().slice(0,10),searchRequests:day===new Date().toISOString().slice(0,10)?searches:0,searchLimit:options.maxDailySearches??50},diagnostics:recent.slice(-20)});return;}
   if(op.kind==='diagnose'){
    if(!['dns','tls','environment'].includes(String(op.mode)))throw new Error('diagnostic-mode');
    const result=await(options.diagnose??diagnoseBrave)(op.mode as 'dns'|'tls'|'environment',publicAddress,controller.signal);
    for(const event of result.stages)log(event.stage,event.code,start);
    send(200,result);return;
   }
   if(r.version!==1||!Array.isArray(r.allowHosts)||r.allowHosts.length>20||!r.allowHosts.length||r.allowHosts.some(h=>typeof h!=='string'||!hosts.includes(h)))throw new Error('allowlist');const allowed=r.allowHosts as string[];
   const value=str(op.value,4000);if(op.kind==='search'){
    if(!options.braveKey){send(400,{error:'search_not_configured'});return;}if(!value.trim()||value.length>500)throw new Error('search-config');const today=new Date().toISOString().slice(0,10);if(today!==day){day=today;searches=0;}if(searches>=(options.maxDailySearches??50)){send(429,{error:'search_budget'});return;}searches++;
    log('search','STARTED',start);const url=new URL('https://api.search.brave.com/res/v1/web/search');url.searchParams.set('q',value+' ('+allowed.map(h=>'site:'+h).join(' OR ')+')');url.searchParams.set('count','5');url.searchParams.set('safesearch','strict');
    const response=await get(url,{'Accept':'application/json','X-Subscription-Token':options.braveKey},controller.signal);if(response.status!==200){const code=[401,403].includes(response.status)?'SEARCH_AUTH_FAILED':[402,429].includes(response.status)?'SEARCH_QUOTA_EXCEEDED':'SEARCH_HTTP_ERROR';log('http',code,start);send(400,{error:code});return;}
    let results:unknown[];try{const payload=object(JSON.parse(response.body));const web=object(payload.web??{});if(web.results!==undefined&&!Array.isArray(web.results))throw new Error('results');results=Array.isArray(web.results)?web.results.slice(0,5):[];}catch{throw failure('SEARCH_RESPONSE_INVALID','parse',start);}
    const safe=results.flatMap(item=>{try{const x=object(item),u=safeSourceUrl(x.url,allowed);return [{url:u.href,title:str(x.title,1000),snippet:str(x.description??'',30000),publishedAt:null}];}catch{return [];}});const status=!results.length?'SEARCH_RESULT_EMPTY':!safe.length?'SEARCH_RESULT_FILTERED':'OK';log('parse',status,start);send(200,{version:1,results:safe,searchStatus:status});return;
   }
   const source=safeSourceUrl(value,allowed);
   if(op.kind==='github'){
    const match=/^\/([a-zA-Z0-9_.-]{1,100})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(source.pathname);if(source.hostname!=='github.com'||!match||source.search||source.hash)throw new Error('github-url');
    const response=await get(new URL(`https://api.github.com/repos/${match[1]}/${match[2]}`),{'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},controller.signal);
    if(response.status!==200){send(200,{version:1,url:source.href,title:'GitHub 公开仓库不可读取',status:'unreadable',text:'',publishedAt:null});return;}
    const repo=object(JSON.parse(response.body));if(repo.private!==false)throw new Error('private');
    const title=str(repo.full_name,300),publishedAt=typeof repo.created_at==='string'&&Number.isFinite(Date.parse(repo.created_at))?repo.created_at:null;
    const text=JSON.stringify({name:title,description:typeof repo.description==='string'?repo.description:'',stars:repo.stargazers_count,forks:repo.forks_count,archived:repo.archived,license:repo.license&&object(repo.license).spdx_id,pushedAt:repo.pushed_at,createdAt:publishedAt},null,2);
    send(200,{version:1,url:source.href,title,status:'readable',text,publishedAt});return;
   }
   if(op.kind!=='read')throw new Error('operation');const response=await get(source,{'Accept':'text/html, text/plain;q=0.8'},controller.signal);
   const contentType=String(response.headers['content-type']??'');const wall=/captcha|cf-chl-|<title[^>]*>\s*(?:just a moment|access denied|sign in|login|登录|访问受限)|id=["']paywall/i.test(response.body);
   if(response.status!==200||!/^text\/(html|plain)/i.test(contentType)||wall){send(200,{version:1,url:source.href,title:'公开内容不可读取',status:'unreadable',text:'',publishedAt:null});return;}
   const title=/<title[^>]*>([\s\S]{0,1000}?)<\/title>/i.exec(response.body)?.[1].replace(/<[^>]*>/g,'').trim()||source.hostname;
   const meta=(response.body.match(/<meta\b[^>]{0,2000}>/gi)??[]).slice(0,200).find(tag=>/(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["']/i.test(tag));const date=meta?/content=["']([^"']+)["']/i.exec(meta)?.[1]:null;const publishedAt=date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null;
   send(200,{version:1,url:source.href,title,status:'readable',...(contentType.startsWith('text/html')?{html:response.body}:{text:response.body.slice(0,30000),truncated:response.body.length>30000}),publishedAt});
  }catch(e){const f=cancelled?failure('REQUEST_CANCELLED','client',start):e instanceof NetworkFailure?e:failure(controller.signal.aborted?'UPSTREAM_TIMEOUT':'UNKNOWN',controller.signal.aborted?'http':'proxy',start);log(f.stage,f.code,start);send(400,{error:f.code,diagnostic:safeEvent(f)});}finally{clearTimeout(timer);}
 });server.requestTimeout=25000;server.headersTimeout=10000;server.maxRequestsPerSocket=20;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const server=createResearchProxy({token:process.env.IDEACLIP_RESEARCH_PROXY_TOKEN??'',origins:(process.env.IDEACLIP_RESEARCH_ORIGINS??'').split(',').filter(Boolean),hosts:(process.env.IDEACLIP_RESEARCH_HOSTS??'').split(',').filter(Boolean),braveKey:process.env.BRAVE_SEARCH_API_KEY,maxDailySearches:50});
 const port=Number(process.env.IDEACLIP_RESEARCH_PORT??8788);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid proxy port.');server.listen(port,'127.0.0.1',()=>process.stdout.write('IdeaClip research proxy ready on loopback. No request data is logged.\n'));
}

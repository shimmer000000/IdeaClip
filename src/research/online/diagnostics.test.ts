import { afterEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { connectionFailure, diagnoseBrave, lookupPublic, NetworkFailure, type tlsProbe } from '../../../tools/research-diagnostics';
import { createResearchProxy, publicAddress, secureGet } from '../../../tools/research-proxy';
import { checkNetwork, parseDiagnosticReport } from './diagnostics';
import { proxyAdapter, proxyJSON } from './adapter';
import { DEFAULT_RESEARCH } from './model';
import { ResearchFailure } from './errors';
const key='synthetic-ic016c-proxy-key',brave='synthetic-ic016c-brave-key',origin='chrome-extension://'+'a'.repeat(32);
const config={...DEFAULT_RESEARCH,endpoint:'http://127.0.0.1:1/research',hosts:['example.com']};
const servers:Server[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}});
const report=()=>({version:1 as const,free:true as const,searchAuthentication:'untested' as const,searchQuota:'unverified' as const,stages:[{stage:'dns' as const,code:'OK',elapsedMs:1},{stage:'safety' as const,code:'OK',elapsedMs:1},{stage:'tcp' as const,code:'OK',elapsedMs:2},{stage:'tls' as const,code:'OK',elapsedMs:3}],environment:{node:'24.22.0',httpProxyPresent:false,httpsProxyPresent:false,nodeEnvProxy:false,transport:'direct-pinned-https' as const}});
async function serve(options:Partial<Parameters<typeof createResearchProxy>[0]>={}){
 const get=vi.fn<typeof secureGet>(async()=>({status:200,headers:{'content-type':'application/json'},body:'{"web":{"results":[]}}'}));
 const s=createResearchProxy({token:key,origins:[origin],hosts:['example.com'],braveKey:brave,get,...options});servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const c={...config,endpoint:`http://127.0.0.1:${(s.address() as {port:number}).port}/research`};
 const call=(operation:unknown,token=key)=>fetch(c.endpoint,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`},body:JSON.stringify({version:1,operation,allowHosts:['example.com']})});return {get,c,call};
}
it('免费诊断无权限/无凭据零请求，拒绝陌生诊断字段，报告不包含额外秘密',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({...report(),secret:key}));const d={fetcher,permission:async()=>false,credential:async()=>({value:key,endpoint:config.endpoint,version:'v1'})};
 await expect(checkNetwork(config,new AbortController().signal,d)).rejects.toMatchObject({code:'PROXY_AUTH_FAILED'});expect(fetcher).not.toHaveBeenCalled();
 await expect(checkNetwork(config,new AbortController().signal,{...d,permission:async()=>true})).rejects.toThrow('凭据');
 fetcher.mockResolvedValue(Response.json({...report(),secret:'untrusted-extra-field'}));const r=await checkNetwork(config,new AbortController().signal,{...d,permission:async()=>true});expect(JSON.stringify(r)).not.toContain('untrusted-extra-field');expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({version:1,operation:{kind:'diagnose',mode:'tls'}});
 expect(()=>parseDiagnosticReport({...report(),stages:[{stage:'dns',code:key,elapsedMs:1}]})).toThrow();
});
it('诊断分支免费，无Brave头/搜索调用，无次数增加，认证拒绝不探测',async()=>{
 const diagnose=vi.fn(async()=>report());const {call,get,c}=await serve({diagnose});const raw=await(await call({kind:'diagnose',mode:'tls'})).json();expect(raw.free).toBe(true);expect(diagnose).toHaveBeenCalledTimes(1);expect(get).not.toHaveBeenCalled();expect(diagnose.mock.calls[0]).not.toContain(key);expect(diagnose.mock.calls[0]).not.toContain(brave);
 expect(await(await call({kind:'health'})).json()).toMatchObject({usage:{searchRequests:0}});
 expect((await call({kind:'diagnose',mode:'dns'},'wrong')).status).toBe(403);expect(diagnose).toHaveBeenCalledTimes(1);
 await expect(proxyJSON(fetch, c,'wrong',{version:1,operation:{kind:'health'}},new AbortController().signal)).rejects.toMatchObject({code:'PROXY_AUTH_FAILED'});
});
it('DNS失败和IPv4/IPv6混合私网均在连接前拒绝，公开双栈只连接第一个校验地址不回退',async()=>{
 const probe=vi.fn<typeof tlsProbe>(async()=>{});const failed=await diagnoseBrave('tls',publicAddress,new AbortController().signal,{resolve:async()=>{throw new Error('private details');},probe});expect(failed.stages).toMatchObject([{stage:'dns',code:'DNS_LOOKUP_FAILED'}]);
 const blocked=await diagnoseBrave('tls',publicAddress,new AbortController().signal,{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'::1',family:6}],probe});expect(blocked.stages.at(-1)?.code).toBe('DNS_ADDRESS_BLOCKED');expect(probe).not.toHaveBeenCalled();
 const resolve=async()=>[{address:'2606:4700:4700::1111',family:6},{address:'8.8.8.8',family:4}];await diagnoseBrave('tls',publicAddress,new AbortController().signal,{resolve,probe});expect(probe).toHaveBeenCalledTimes(1);expect(probe.mock.calls[0][0]).toEqual((await resolve())[0]);
});
it('DNS挂起被取消后及时返回，不连接，不输出解析错误正文',async()=>{
 const c=new AbortController();const p=lookupPublic('api.search.brave.com',c.signal,publicAddress,async()=>new Promise(()=>{}));c.abort();await expect(p).rejects.toMatchObject({code:'UPSTREAM_TIMEOUT',stage:'dns'});
});
it.each([['TCP_CONNECT_FAILED','tcp'],['TLS_HANDSHAKE_FAILED','tls'],['TLS_CERTIFICATE_FAILED','tls'],['UPSTREAM_TIMEOUT','http']] as const)('%s保留准确阶段，Mock搜索仅一次，健康只含脱敏阶段',async(code,stage)=>{
 const get=vi.fn<typeof secureGet>(async()=>{throw new NetworkFailure(code,stage,15);});const events:unknown[]=[];const {call,c}=await serve({get,diagnostic:e=>events.push(e)});
 const adapter=proxyAdapter((async(url,init)=>fetch(url,{...init,headers:{...init?.headers,Origin:origin}})) as typeof fetch);
 await expect(adapter.execute({kind:'search',value:'synthetic-private-query'},c,key,new AbortController().signal)).rejects.toMatchObject({code,stage});
 expect(get).toHaveBeenCalledTimes(1);const health=await(await call({kind:'health'})).json();expect(health.usage.searchRequests).toBe(1);for(const secret of [key,brave,'synthetic-private-query','X-Subscription'])expect(JSON.stringify(events)+JSON.stringify(health)).not.toContain(secret);expect(health.diagnostics).toContainEqual(expect.objectContaining({stage,code}));
});
it('代理总超时在客户端之前返回UPSTREAM_TIMEOUT，不重发已发请求',async()=>{
 const get=vi.fn<typeof secureGet>(async(_u,_h,s)=>new Promise((_r,reject)=>s.addEventListener('abort',()=>reject(new NetworkFailure('UPSTREAM_TIMEOUT','tcp',20)),{once:true})));
 const {call}=await serve({get,timeoutMs:20});const r=await(await call({kind:'search',value:'synthetic'})).json();expect(r).toMatchObject({error:'UPSTREAM_TIMEOUT',diagnostic:{stage:'tcp'}});expect(get).toHaveBeenCalledTimes(1);
});
it('非法Brave JSON/错误结构与真正空结果/过滤后空结果区分，不吞成成功',async()=>{
 for(const body of ['not-json','{"web":{"results":"invalid"}}']){const {call}=await serve({get:async()=>({status:200,headers:{},body})});expect(await(await call({kind:'search',value:'synthetic'})).json()).toMatchObject({error:'SEARCH_RESPONSE_INVALID'});}
 const empty=await serve();expect(await(await empty.call({kind:'search',value:'synthetic'})).json()).toMatchObject({results:[],searchStatus:'SEARCH_RESULT_EMPTY'});
 const filtered=await serve({get:async()=>({status:200,headers:{},body:JSON.stringify({web:{results:[{url:'https://evil.example/',title:'synthetic',description:'snippet'}]}})})});expect(await(await filtered.call({kind:'search',value:'synthetic'})).json()).toMatchObject({results:[],searchStatus:'SEARCH_RESULT_FILTERED'});
});
it('代理解析无效和不可达分开，客户端取消不冒充服务商认证失败',async()=>{
 await expect(proxyJSON(async()=>new Response('not JSON',{headers:{'content-type':'application/json'}}),config,key,{},new AbortController().signal)).rejects.toMatchObject({code:'SEARCH_RESPONSE_INVALID'});
 await expect(proxyJSON(async()=>{throw new TypeError('private');},config,key,{},new AbortController().signal)).rejects.toMatchObject({code:'PROXY_UNREACHABLE'});
 const c=new AbortController();c.abort();await expect(proxyJSON(async()=>{throw new Error('aborted');},config,key,{},c.signal)).rejects.toMatchObject({code:'REQUEST_CANCELLED'});
 expect(new ResearchFailure('DNS_LOOKUP_FAILED').mayHaveSent).toBe(false);expect(new ResearchFailure('CLIENT_TIMEOUT').outcomeUnknown).toBe(true);
});
it.each([['ECONNREFUSED','tcp','TCP_CONNECT_FAILED'],['ECONNRESET','tls','TLS_HANDSHAKE_FAILED'],['CERT_HAS_EXPIRED','tls','TLS_CERTIFICATE_FAILED'],['ERR_TLS_CERT_ALTNAME_INVALID','tls','TLS_CERTIFICATE_FAILED'],['SELF_SIGNED_CERT_IN_CHAIN','tls','TLS_CERTIFICATE_FAILED']] as const)('连接原生错误%s仅映射安全码，不输出原始异常', (code,stage,expected)=>{
 const e=connectionFailure({code,message:'private details'},stage,Date.now());expect(e.code).toBe(expected);expect(e.message).not.toContain('private details');expect(connectionFailure({code},stage,Date.now(),true).code).toBe('UPSTREAM_TIMEOUT');
});

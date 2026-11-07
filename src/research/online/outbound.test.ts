import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as tcpConnect, type Socket } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { secureGet } from '../../../tools/research-proxy';
import { validateOutbound, type Outbound } from '../../../tools/research-outbound';
import { serviceConfig } from '../../../tools/research-service';
import { parseDiagnosticReport } from './diagnostics';

const servers:Server[]=[];const sockets=new Set<Socket>();let fixtureDir='',certFile='',keyFile='',clientFile='';
const controller=()=>new AbortController();
const outbound=(port:number):Outbound=>({mode:'connect',endpoint:`http://127.0.0.1:${port}`,auth:'none',certificatePolicy:'node-default',approved:true});
const url=new URL('https://api.search.brave.com/synthetic-public');
const lookup=()=>vi.fn(async()=>[{address:'8.8.8.8',family:4}]);
async function listen(s:Server){servers.push(s);s.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return (s.address() as {port:number}).port;}
async function proxy(mode:'reject'|'redirect'|'head'|'hold'|'tls-hold'='reject'){
 const requests:{authority:string;headers:Record<string,unknown>}[]=[];
 const s=createServer();s.on('connect',(req,socket)=>{requests.push({authority:req.url!,headers:req.headers});if(mode==='hold')return;if(mode==='tls-hold'){socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');return;}socket.end(mode==='head'?'HTTP/1.1 200 Connection Established\r\n\r\nuntrusted':mode==='redirect'?'HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\n\r\n':'HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');});return {port:await listen(s),requests};
}
afterEach(async()=>{for(const socket of sockets)socket.destroy();for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}});
beforeAll(()=>{
 fixtureDir=mkdtempSync(join(tmpdir(),'ideaclip-outbound-'));certFile=join(fixtureDir,'synthetic-cert.pem');keyFile=join(fixtureDir,'synthetic-key.pem');clientFile=join(fixtureDir,'client.mjs');
 let openssl='openssl';if(process.platform==='win32'){const found=spawnSync('where.exe',['openssl'],{encoding:'utf8',windowsHide:true});if(found.status===0)openssl=found.stdout.trim().split(/\r?\n/)[0];else{const git=spawnSync('where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).stdout.trim().split(/\r?\n/)[0];openssl=join(dirname(dirname(git)),'usr/bin/openssl.exe');}}
 if(openssl!=='openssl'&&!existsSync(openssl))throw new Error('TLS mock tests require OpenSSL or Git-bundled OpenSSL; nothing was installed.');
 const r=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',keyFile,'-out',certFile,'-subj','/CN=api.search.brave.com','-addext','subjectAltName=DNS:api.search.brave.com'],{windowsHide:true,timeout:15000});expect(r.status,'Runtime synthetic certificate generation failed').toBe(0);
 // Only this synthetic child trusts this runtime-generated certificate. No global CA changes.
 writeFileSync(clientFile,`import {readFileSync} from 'node:fs';
const {secureGet}=await import(${JSON.stringify(pathToFileURL(resolve('tools/research-proxy.ts')).href)});
const c=JSON.parse(readFileSync(0,'utf8'));
try{const r=await secureGet(new URL('https://'+(c.testWrongHost?'wrong.example':'api.search.brave.com')+'/synthetic-public'),{'X-Subscription-Token':'synthetic-upstream-key'},AbortSignal.timeout(3000),{outbound:c.outbound,lookup:async()=>[{address:'8.8.8.8',family:4}]});process.stdout.write(JSON.stringify({status:r.status,body:r.body}));}catch(e){process.stdout.write(JSON.stringify({error:e.code??'rejected'}));}
`);
},20000);
afterAll(()=>{if(fixtureDir){const p=resolve(fixtureDir);if(dirname(p)!==resolve(tmpdir())||!basename(p).startsWith('ideaclip-outbound-'))throw new Error('Unsafe test cleanup path');rmSync(p,{recursive:true,force:true});}});
it('默认直连，不接受未批准、认证/远程/凭据URL或关闭证书校验的出站代理',()=>{
 expect(validateOutbound(undefined)).toEqual({mode:'direct'});expect(serviceConfig({token:'synthetic-token',origins:[],hosts:[]}).outbound).toEqual({mode:'direct'});
 const approved=outbound(23333);expect(validateOutbound(approved)).toEqual(approved);
 expect(validateOutbound({...approved,endpoint:'http://127.0.0.1:80/'})).toMatchObject({endpoint:'http://127.0.0.1:80'});
 for(const v of [{...approved,approved:false},{...approved,approved:'true'},{...approved,auth:'basic'},{...approved,certificatePolicy:'insecure'},{...approved,endpoint:'http://user:secret@127.0.0.1:23333'},{...approved,endpoint:'http://proxy.example:8080'},{...approved,endpoint:'https://127.0.0.1:23333'},{...approved,endpoint:'http://localhost:23333'},{...approved,endpoint:'socks5://127.0.0.1:23333'},{...approved,endpoint:'http://127.0.0.1:23333/?token=x'},{...approved,password:'must-reject'}])expect(()=>validateOutbound(v)).toThrow();
});
it.each(['reject','redirect','head'] as const)('CONNECT %s明确拒绝且无主机名回退、无Key/Proxy-Authorization',async mode=>{
 const p=await proxy(mode),resolve=lookup();const key='synthetic-brave-key';await expect(secureGet(url,{'X-Subscription-Token':key},controller().signal,{outbound:outbound(p.port),lookup:resolve})).rejects.toMatchObject({code:mode==='head'?'CONNECT_PROTOCOL_INVALID':'CONNECT_REJECTED'});
 expect(resolve).toHaveBeenCalledTimes(1);expect(p.requests).toHaveLength(1);expect(p.requests[0].authority).toBe('8.8.8.8:443');expect(p.requests[0].headers).not.toHaveProperty('proxy-authorization');expect(JSON.stringify(p.requests)).not.toContain(key);expect(JSON.stringify(p.requests)).not.toContain('api.search.brave.com');
});
it('出站代理不可达时不回退直连',async()=>{
 const s=createServer();const port=await listen(s);await new Promise<void>(r=>s.close(()=>r()));servers.splice(servers.indexOf(s),1);await expect(secureGet(url,{},controller().signal,{outbound:outbound(port),lookup:lookup()})).rejects.toMatchObject({code:'OUTBOUND_PROXY_UNREACHABLE',stage:'outbound'});
});
it.each(['hold','tls-hold'] as const)('代理阶段%s超时/取消销毁隧道，不重试',async mode=>{
 const p=await proxy(mode),c=controller();const task=secureGet(url,{},c.signal,{outbound:outbound(p.port),lookup:lookup()});setTimeout(()=>c.abort(),50);await expect(task).rejects.toMatchObject({code:'UPSTREAM_TIMEOUT',stage:mode==='hold'?'connect':'tls'});expect(p.requests).toHaveLength(1);
});
it('全部DNS回答校验，混合私网/IPv6保留/IP家族错误在CONNECT之前拒绝',async()=>{
 const p=await proxy();for(const address of [{address:'127.0.0.1',family:4},{address:'::1',family:6},{address:'2001:db8::1',family:6},{address:'8.8.8.8',family:6}])await expect(secureGet(url,{},controller().signal,{outbound:outbound(p.port),lookup:async()=>[{address:'8.8.8.8',family:4},address]})).rejects.toMatchObject({code:'DNS_ADDRESS_BLOCKED'});expect(p.requests).toHaveLength(0);
});
it('IPv6 CONNECT只使用带方括号数字地址，不发送域名',async()=>{
 const p=await proxy();await expect(secureGet(url,{},controller().signal,{outbound:outbound(p.port),lookup:async()=>[{address:'2606:4700:4700::1111',family:6}]})).rejects.toMatchObject({code:'CONNECT_REJECTED'});expect(p.requests[0].authority).toBe('[2606:4700:4700::1111]:443');
});
it('预先取消时不解析DNS也不连接代理',async()=>{
 const p=await proxy(),c=controller(),resolve=lookup();c.abort();await expect(secureGet(url,{},c.signal,{outbound:outbound(p.port),lookup:resolve})).rejects.toThrow();expect(resolve).not.toHaveBeenCalled();expect(p.requests).toHaveLength(0);
});
async function tlsFixture(redirect=false){
 const received:{host:string|undefined;key:string|undefined}[]=[];const authorities:string[]=[];
 const target=httpsServer({key:readFileSync(keyFile),cert:readFileSync(certFile)},(req,res)=>{received.push({host:req.headers.host,key:req.headers['x-subscription-token'] as string|undefined});if(redirect){res.writeHead(302,{Location:'http://127.0.0.1/private'});res.end();}else{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"mock":true}');}});
 const targetPort=await listen(target);const proxy=createServer();proxy.on('connect',(req,client,head)=>{authorities.push(req.url!);expect(req.headers).not.toHaveProperty('x-subscription-token');expect(req.headers).not.toHaveProperty('proxy-authorization');const origin=tcpConnect(targetPort,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)origin.write(head);client.pipe(origin);origin.pipe(client);});sockets.add(origin);origin.on('close',()=>{sockets.delete(origin);client.destroy();});client.on('close',()=>origin.destroy());origin.on('error',()=>client.destroy());client.on('error',()=>origin.destroy());});return {port:await listen(proxy),received,authorities};
}
it('CONNECT成功后证书仍严格校验；失败前不发送Brave Key，DNS不二次解析',async()=>{
 const f=await tlsFixture();const resolve=lookup();resolve.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValue([{address:'127.0.0.1',family:4}]);
 await expect(secureGet(url,{'X-Subscription-Token':'synthetic-upstream-key'},controller().signal,{outbound:outbound(f.port),lookup:resolve})).rejects.toMatchObject({code:'TLS_CERTIFICATE_FAILED'});expect(resolve).toHaveBeenCalledTimes(1);expect(f.authorities).toEqual(['8.8.8.8:443']);expect(f.received).toHaveLength(0);
});
async function trustedChild(port:number,testWrongHost=false){
 return new Promise<Record<string,unknown>>((done,reject)=>{const child=spawn(process.execPath,[clientFile],{windowsHide:true,env:{...process.env,NODE_EXTRA_CA_CERTS:certFile},stdio:['pipe','pipe','ignore']});let raw='';child.stdout.on('data',b=>{raw+=b;if(raw.length>2048)child.kill();});child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(new Error('Synthetic TLS child failed'));else{try{done(JSON.parse(raw));}catch{reject(new Error('Synthetic TLS response invalid'));}}});child.stdin.end(JSON.stringify({outbound:outbound(port),testWrongHost}));});
}
it('严格TLS隧道成功：原始SNI/Host、Key仅发加密原站，HTTP响应可读',async()=>{
 const f=await tlsFixture();expect(await trustedChild(f.port)).toEqual({status:200,body:'{"mock":true}'});expect(f.authorities).toEqual(['8.8.8.8:443']);expect(f.received).toEqual([{host:'api.search.brave.com',key:'synthetic-upstream-key'}]);
});
it('CONNECT路径仍拒绝上游重定向，不访问Location或重发',async()=>{
 const f=await tlsFixture(true);expect(await trustedChild(f.port)).toHaveProperty('error');expect(f.authorities).toHaveLength(1);expect(f.received).toHaveLength(1);
});
it('即使证书被测试子进程信任，原始域名不匹配仍拒绝，不发送Key',async()=>{
 const f=await tlsFixture();expect(await trustedChild(f.port,true)).toEqual({error:'TLS_CERTIFICATE_FAILED'});expect(f.received).toHaveLength(0);expect(f.authorities).toHaveLength(1);
});
it('浏览器诊断区分代理路径，只允许新阶段/安全码，导出不带端点',()=>{
 const raw={version:1,free:true,searchAuthentication:'untested',searchQuota:'unverified',stages:[{stage:'connect',code:'CONNECT_REJECTED',elapsedMs:2}],environment:{node:'24.22.0',httpProxyPresent:false,httpsProxyPresent:false,nodeEnvProxy:false,transport:'http-connect-pinned-ip',endpoint:'http://127.0.0.1:23333'}};
 const report=parseDiagnosticReport(raw);expect(report.environment.transport).toBe('http-connect-pinned-ip');expect(JSON.stringify(report)).not.toContain('23333');
});

import { it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createSshGateway, numericAuthority, sshArguments, validateSshGateway } from '../../../tools/research-ssh-gateway';
import { secureGet } from '../../../tools/research-proxy';
const config={server:'8.8.8.8',port:22,user:'ideaclip-egress',identityFile:resolve('package.json'),knownHostsFile:resolve('package.json'),sshPath:process.execPath};
it('SSH出口只接受专用账户、显式公共IP及文件路径，不接受凭据字段',()=>{
 expect(validateSshGateway(config)).toEqual(config);
 for(const patch of [{server:'127.0.0.1'},{server:'example.com'},{user:'root'},{port:0},{password:'must-reject'},{identityFile:'relative'}])expect(()=>validateSshGateway({...config,...patch})).toThrow();
 const args=sshArguments(config).join(' ');for(const flag of ['StrictHostKeyChecking=yes','PasswordAuthentication=no','BatchMode=yes','ProxyCommand=none','ClearAllForwardings=yes','ideaclip-relay-v1'])expect(args).toContain(flag);
});
it('CONNECT只接受公共字面IP的443，拒绝域名/映射/私网/保留地址及注入',()=>{
 expect(numericAuthority('8.8.8.8:443')).toBe('8.8.8.8');expect(numericAuthority('[2606:4700:4700::1111]:443')).toContain(':');
 for(const value of ['localhost:443','example.com:443','127.0.0.1:443','169.254.169.254:443','198.18.0.1:443','[::ffff:8.8.8.8]:443','[2001:db8::1]:443','8.8.8.8:22','8.8.8.8:443\r\nX:bad'])expect(()=>numericAuthority(value)).toThrow();
});
function fakeChild(reply:Buffer|string){const events=new EventEmitter();const child=Object.assign(events,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),killed:false,kill(){this.killed=true;events.emit('mockKilled');}});let received='';child.stdin.once('data',chunk=>{received+=chunk;queueMicrotask(()=>child.stdout.write(reply));});return {child:child as unknown as ChildProcessWithoutNullStreams,getHeader:()=>received};}
async function connect(port:number,path:string){return new Promise<{status:number;socket:import('node:stream').Duplex}>((done,reject)=>{const req=request({host:'127.0.0.1',port,method:'CONNECT',path,headers:{Host:path}});req.on('connect',(res,socket)=>done({status:res.statusCode!,socket}));req.on('error',reject);req.end();});}
it('SSH READY后才返回200，原样双向转发；取消只终止自己的SSH',async()=>{
 const f=fakeChild('READY\n');const gateway=createSshGateway(config,{launch:()=>f.child});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{const r=await connect((gateway.server.address() as {port:number}).port,'8.8.8.8:443');expect(r.status).toBe(200);expect(f.getHeader()).toBe('IDEACLIP/1 8.8.8.8\n');const reply=new Promise<Buffer>(done=>r.socket.once('data',done));(f.child.stdout as PassThrough).write(Buffer.from([0,255,17]));expect(await reply).toEqual(Buffer.from([0,255,17]));r.socket.destroy();}finally{await gateway.stop();}expect(f.child.killed).toBe(true);
});
it('拒绝私网时零SSH进程，不存在直连或主机名回退',async()=>{
 let launches=0;const gateway=createSshGateway(config,{launch:()=>{launches++;throw new Error('not-called');}});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{const r=await connect((gateway.server.address() as {port:number}).port,'127.0.0.1:443');expect(r.status).toBe(403);r.socket.destroy();expect(launches).toBe(0);}finally{await gateway.stop();}
});
it('拒绝异常READY数据，SSH失败/超时不重试',async()=>{
 const f=fakeChild('READY\nuntrusted');let launches=0;const gateway=createSshGateway(config,{launch:()=>{launches++;return f.child;},timeoutMs:100});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{await expect(connect((gateway.server.address() as {port:number}).port,'8.8.8.8:443')).rejects.toThrow();expect(launches).toBe(1);expect(f.child.killed).toBe(true);}finally{await gateway.stop();}
});
it('自有SSH解析只返回受限公共地址，本机再固定IP；不在失败后切换解析器',async()=>{
 const commands:string[]=[];const gateway=createSshGateway(config,{launch:args=>{const command=args[args.length-1];commands.push(command);const f=fakeChild(command==='ideaclip-resolve-v1'?'{"addresses":[{"address":"8.8.8.8","family":4}]}':'REJECTED\n');if(command==='ideaclip-resolve-v1')f.child.stdin.once('data',()=>setImmediate(()=>{f.child.stdout.emit('end');f.child.emit('close',0);}));return f.child;}});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{const port=(gateway.server.address() as {port:number}).port;await expect(secureGet(new URL('https://example.com/'),{},new AbortController().signal,{outbound:{mode:'connect',endpoint:`http://127.0.0.1:${port}`,auth:'none',certificatePolicy:'node-default',approved:true,resolver:'ssh-gateway'}})).rejects.toThrow();expect(commands).toEqual(['ideaclip-resolve-v1','ideaclip-relay-v1']);}finally{await gateway.stop();}
});
it('SSH解析拒绝私网返回及非法主机，解析失败零目标连接',async()=>{
 let calls=0;const gateway=createSshGateway(config,{launch:()=>{calls++;const f=fakeChild('{"addresses":[{"address":"127.0.0.1","family":4}]}');f.child.stdin.once('data',()=>setImmediate(()=>f.child.emit('close',0)));return f.child;}});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{const port=(gateway.server.address() as {port:number}).port;for(const hostname of ['example.com','127.0.0.1','internal.local']){const r=await fetch(`http://127.0.0.1:${port}/resolve`,{method:'POST',body:JSON.stringify({hostname})});expect(r.status).toBe(400);}expect(calls).toBe(1);}finally{await gateway.stop();}
});
it('等待SSH超时销毁自己的进程，不重试',async()=>{
 const f=fakeChild('');let calls=0;const gateway=createSshGateway(config,{launch:()=>{calls++;return f.child;},timeoutMs:30});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{await expect(connect((gateway.server.address() as {port:number}).port,'8.8.8.8:443')).rejects.toThrow();expect(calls).toBe(1);expect(f.child.killed).toBe(true);}finally{await gateway.stop();}
});
it('取消DNS请求立即停止自己的SSH，服务仍可独立停止，未启动目标连接',async()=>{
 const f=fakeChild(''),controller=new AbortController();let calls=0;const killed=new Promise<void>(done=>f.child.once('mockKilled',done));
 f.child.stdin.once('data',()=>controller.abort());const gateway=createSshGateway(config,{launch:()=>{calls++;return f.child;}});await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));
 try{await expect(fetch(`http://127.0.0.1:${(gateway.server.address() as {port:number}).port}/resolve`,{method:'POST',body:JSON.stringify({hostname:'example.com'}),signal:controller.signal})).rejects.toThrow();await killed;expect(f.child.killed).toBe(true);expect(calls).toBe(1);}finally{await gateway.stop();}
});
it('远端Python公共IP规则拒绝SSRF，受限命令无法执行Shell；不访问任何外网',()=>{
 const code=`import importlib.util,json\ns=importlib.util.spec_from_file_location('relay','tools/research-ssh-relay.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nvalues=['8.8.8.8','127.0.0.1','169.254.169.254','198.18.0.1','::1','::ffff:8.8.8.8','2001:db8::1','example.com','8.8.8.8:22']\nout=[]\nfor v in values:\n try:m.target(('IDEACLIP/1 '+v+'\\n').encode());out.append(True)\n except Exception:out.append(False)\nprint(json.dumps(out))`;
 const r=spawnSync('python',['-c',code],{encoding:'utf8',windowsHide:true});expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toEqual([true,false,false,false,false,false,false,false,false]);
 const reject=spawnSync('python',['tools/research-ssh-relay.py'],{input:'ignored',encoding:'utf8',windowsHide:true,env:{...process.env,SSH_ORIGINAL_COMMAND:'sh -c arbitrary'}});expect(reject.status).toBe(1);expect(reject.stdout).toBe('REJECTED\n');
});
it('远端DNS只处理公共域名，全部回答校验，混入私网时整体拒绝',()=>{
 const code=`import importlib.util,json,socket\ns=importlib.util.spec_from_file_location('relay','tools/research-ssh-relay.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.socket.getaddrinfo=lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,0,'',('8.8.8.8',443))]\nassert m.resolve_public(b'IDEACLIP-DNS/1 example.com\\n')==[{'address':'8.8.8.8','family':4}]\nm.socket.getaddrinfo=lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,0,'',('127.0.0.1',443))]\nfor h in [b'IDEACLIP-DNS/1 example.com\\n',b'IDEACLIP-DNS/1 internal.local\\n',b'IDEACLIP-DNS/1 127.0.0.1\\n']:\n try:m.resolve_public(h);raise AssertionError('accepted')\n except ValueError:pass\nprint('DNS_GUARD_OK')`;
 const r=spawnSync('python',['-c',code],{encoding:'utf8',windowsHide:true});expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('DNS_GUARD_OK');
});
it.skipIf(process.platform!=='win32')('SSH出口Windows窗口默认不启动，不读取服务商凭据',()=>{
 const r=spawnSync(resolve(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',resolve('windows/SSH-Egress.ps1'),'-SmokeUI'],{encoding:'utf8',windowsHide:true,timeout:15000});expect(r.status,r.stdout+r.stderr).toBe(0);expect(r.stdout).toContain('SSH_EGRESS_UI_OK');
});
it.skipIf(process.platform!=='win32')('Windows UTF8中文路径配置与CRLF安全启停，不建立SSH或外网连接',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ideaclip-ssh-test-'));const cfg=join(dir,'synthetic.json'),script=join(dir,'test.ps1');
 try{writeFileSync(cfg,'\uFEFF'+JSON.stringify({...config,listenPort:0}));writeFileSync(script,'param([string]$Entry,[string]$Cfg)\n. $Entry -LibraryOnly\n$c = Start-IdeaClipSshEgress $Cfg\ntry { Write-Output "SSH_SYNTHETIC_START_OK" } finally { Stop-IdeaClipSshEgress $c }\n');
 const start=Date.now();const r=spawnSync(resolve(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Entry',resolve('windows/SSH-Egress.ps1'),'-Cfg',cfg],{encoding:'utf8',windowsHide:true,timeout:15000});expect(r.status,r.stdout+r.stderr).toBe(0);expect(r.stdout).toContain('SSH_SYNTHETIC_START_OK');expect(Date.now()-start).toBeLessThan(5000);
 }finally{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('ideaclip-ssh-test-'))throw new Error('unsafe-cleanup');rmSync(dir,{recursive:true,force:true});}
},20000);

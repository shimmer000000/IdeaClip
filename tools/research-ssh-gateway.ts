// Optional, explicitly started loopback CONNECT bridge over a restricted SSH key.
// No API keys, passwords, shell execution, automatic retries or system networking changes.
import { createServer } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { publicAddress } from './research-proxy.ts';

export interface SshGatewayConfig { server:string; port:number; user:string; identityFile:string; knownHostsFile:string; sshPath:string; listenPort?:number }
export function validateSshGateway(raw:unknown):SshGatewayConfig {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid-ssh-config');
 const c=raw as Record<string,unknown>;const paths=['identityFile','knownHostsFile','sshPath'];const keys=['server','port','user',...paths,'listenPort'];
 if(Object.keys(c).some(k=>!keys.includes(k))||typeof c.server!=='string'||!publicAddress(c.server)||!Number.isInteger(c.port)||Number(c.port)<1||Number(c.port)>65535||typeof c.user!=='string'||!/^ideaclip-[a-z0-9-]{1,24}$/.test(c.user)||c.listenPort!==undefined&&(!Number.isInteger(c.listenPort)||Number(c.listenPort)!==0&&(Number(c.listenPort)<1024||Number(c.listenPort)>65535))||paths.some(k=>typeof c[k]!=='string'||!isAbsolute(String(c[k]))||!existsSync(String(c[k]))))throw new Error('invalid-ssh-config');
 return {...c} as unknown as SshGatewayConfig;
}
export function numericAuthority(value:string):string {
 const match=/^(\[[0-9a-fA-F:]+\]|[0-9.]+):443$/.exec(value);
 if(!match)throw new Error('unsafe-target');const ip=match[1].replace(/^\[|\]$/g,'');
 if(!isIP(ip)||!publicAddress(ip))throw new Error('unsafe-target');return ip;
}
export function sshArguments(c:SshGatewayConfig,command:'ideaclip-relay-v1'|'ideaclip-resolve-v1'='ideaclip-relay-v1'){return ['-F',process.platform==='win32'?'NUL':'/dev/null','-T','-a','-x','-p',String(c.port),'-i',c.identityFile,
 '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','PreferredAuthentications=publickey','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',
 '-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ssh-ed25519','-o',`UserKnownHostsFile=${c.knownHostsFile}`,'-o',`GlobalKnownHostsFile=${process.platform==='win32'?'NUL':'/dev/null'}`,
 '-o','ProxyCommand=none','-o','ProxyJump=none','-o','ClearAllForwardings=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=1',`${c.user}@${c.server}`,command];}
export function createSshGateway(raw:unknown,options:{launch?:(args:string[])=>ChildProcessWithoutNullStreams;timeoutMs?:number}={}){
 const c=validateSshGateway(raw);const children=new Set<ChildProcessWithoutNullStreams>();const sockets=new Set<import('node:net').Socket>();
 const launch=(command:'ideaclip-relay-v1'|'ideaclip-resolve-v1')=>options.launch?options.launch(sshArguments(c,command)):spawn(c.sshPath,sshArguments(c,command),{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/resolve'){res.writeHead(404).end();return;}
  let child:ChildProcessWithoutNullStreams|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const close=()=>{if(timer)clearTimeout(timer);if(child){children.delete(child);child.kill();}};
  const fail=()=>{close();if(!res.destroyed&&!res.writableEnded)res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"error":"DNS_LOOKUP_FAILED"}');};
  try{let body='';for await(const part of req){body+=part;if(body.length>512)throw new Error('limit');}
   const value=JSON.parse(body);const host=value?.hostname;if(!value||Object.keys(value).length!==1||typeof host!=='string'||host.length>253||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)||isIP(host)||/(^|\.)(local|localhost|internal|arpa|test|invalid|onion)$/i.test(host)||children.size>=4)throw new Error('host');
   child=launch('ideaclip-resolve-v1');children.add(child);child.stderr.resume();child.stdin.on('error',fail);child.once('error',fail);timer=setTimeout(fail,options.timeoutMs??20000);res.once('close',close);
   let raw='';child.stdout.on('data',part=>{raw+=part;if(raw.length>8192)fail();});child.once('close',code=>{if(res.writableEnded||res.destroyed)return;if(code!==0){fail();return;}
    try{const parsed=JSON.parse(raw);if(!Array.isArray(parsed.addresses)||!parsed.addresses.length||parsed.addresses.length>32)throw new Error('dns');const addresses=parsed.addresses.map((r:{address:unknown;family:unknown})=>{if(typeof r.address!=='string'||!publicAddress(r.address)||isIP(r.address)!==r.family)throw new Error('ip');return {address:r.address,family:r.family};});close();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({addresses}));}catch{fail();}
   });child.stdin.end(`IDEACLIP-DNS/1 ${host}\n`);
  }catch{fail();}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',(req,socket,head)=>{
  let ip:string;try{ip=numericAuthority(req.url??'');if(head.length||req.headers.host!==req.url||req.headers['proxy-authorization']||children.size>=4)throw new Error('reject');}catch{socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');return;}
  let child:ChildProcessWithoutNullStreams;
  try{child=launch('ideaclip-relay-v1');}catch{socket.destroy();return;}
  children.add(child);let ready=false,closed=false;let pending=Buffer.alloc(0);
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);child.kill();children.delete(child);socket.destroy();};
  const timer=setTimeout(close,options.timeoutMs??20000);
  child.stderr.resume();child.once('error',close);child.once('close',close);child.stdin.on('error',close);socket.once('error',close);socket.once('close',close);
  const handshake=(chunk:Buffer)=>{pending=Buffer.concat([pending,chunk]);if(pending.length>128){close();return;}const newline=pending.indexOf(10);if(newline<0)return;
   if(pending.toString('ascii')!=='READY\n'){close();return;}ready=true;child.stdout.removeListener('data',handshake);
   socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');child.stdout.pipe(socket);socket.pipe(child.stdin);
  };
  child.stdout.on('data',handshake);child.stdout.on('end',()=>{if(!ready)close();});
  // Header only; the relay validates again and connects before accepting TLS bytes.
  child.stdin.write(`IDEACLIP/1 ${ip}\n`);
 });
 server.headersTimeout=10000;server.requestTimeout=15000;
 return {server,stop:async()=>{for(const child of children)child.kill();for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let input='';let instance:ReturnType<typeof createSshGateway>|undefined;let started=false;
 process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{input+=chunk;if(input.length>8192)process.exit(1);const end=input.indexOf('\n');if(end<0)return;const line=input.slice(0,end).trim();input='';if(started){if(line==='stop')void instance?.stop().then(()=>process.exit(0));return;}started=true;
  try{const config=validateSshGateway(JSON.parse(line.replace(/^\uFEFF/,'')));instance=createSshGateway(config);instance.server.once('error',()=>{process.stdout.write('{"event":"error","code":"gateway_unavailable"}\n');process.exit(1);});instance.server.listen(config.listenPort??23334,'127.0.0.1',()=>process.stdout.write(JSON.stringify({event:'ready',transport:'restricted-ssh-pinned-ip',port:(instance!.server.address() as {port:number}).port})+'\n'));}catch{process.stdout.write('{"event":"error","code":"invalid_config"}\n');process.exit(1);}
 });process.stdin.on('end',()=>{if(instance)void instance.stop().then(()=>process.exit(0));else process.exit(0);});
}

import { createResearchProxy } from './research-proxy.ts';
import { pathToFileURL } from 'node:url';
import { validateOutbound } from './research-outbound.ts';
export function serviceConfig(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-config');const c=value as Record<string,unknown>;
 if(typeof c.token!=='string'||!Array.isArray(c.origins)||!Array.isArray(c.hosts)||c.origins.some(x=>typeof x!=='string')||c.hosts.some(x=>typeof x!=='string')||c.braveKey!==undefined&&typeof c.braveKey!=='string')throw new Error('invalid-config');
 return {token:c.token,origins:c.origins as string[],hosts:c.hosts as string[],braveKey:c.braveKey as string|undefined,outbound:validateOutbound(c.outbound)};
}
export async function managedService(value:unknown,port=8788){
 const server=createResearchProxy(serviceConfig(value));
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 return {server,stop:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
// A dedicated child process. Credentials arrive on anonymous stdin, never argv/files.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let service:Awaited<ReturnType<typeof managedService>>|undefined;let input='',configured=false,ending=false;
 const stop=async()=>{ending=true;await service?.stop();process.exit(0);};
 process.stdin.setEncoding('utf8');process.stdin.on('data',async(chunk:string)=>{
  input+=chunk;if(input.length>32768){process.stdout.write('{"event":"error","code":"invalid_config"}\n');await stop();return;}
  const newline=input.indexOf('\n');if(newline<0)return;const line=input.slice(0,newline).trim();input=input.slice(newline+1);
  if(configured){if(line==='stop')await stop();return;}configured=true;
  try{const value=JSON.parse(line);input='';service=await managedService(value);if(ending){await service.stop();return;}process.stdout.write('{"event":"ready"}\n');}
  catch(e){process.stdout.write(JSON.stringify({event:'error',code:(e as {code?:string})?.code==='EADDRINUSE'?'port_busy':'invalid_config'})+'\n');await stop();}
 });
 process.stdin.on('end',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
}

// Fixed-host diagnostic entry point. Never reads keys or accepts a URL/query.
import { diagnoseBrave } from './research-diagnostics.ts';
import { publicAddress } from './research-proxy.ts';
import { validateOutbound, type Outbound } from './research-outbound.ts';
const mode=process.argv[2];
if(!['dns','tls','environment'].includes(mode)||process.argv[3]!==undefined&&process.argv[3]!=='--configured'||process.argv.length>4){process.stdout.write('{"error":"UNKNOWN"}\n');process.exitCode=1;}
else {
 let outbound:Outbound={mode:'direct'};
 if(process.argv[3]==='--configured'){
  try{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>4096)throw new Error('limit');}outbound=validateOutbound(JSON.parse(raw));}
  catch{process.stdout.write('{"error":"INVALID_OUTBOUND_CONFIG"}\n');process.exit(1);}
 }
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{process.stdout.write(JSON.stringify(await diagnoseBrave(mode as 'dns'|'tls'|'environment',publicAddress,controller.signal,{outbound}))+'\n');}
 catch{process.stdout.write('{"error":"UNKNOWN"}\n');process.exitCode=1;}
 finally{clearTimeout(timer);}
}

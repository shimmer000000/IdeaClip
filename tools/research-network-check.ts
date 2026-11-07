// Fixed-host diagnostic entry point. Never reads keys or accepts a URL/query.
import { diagnoseBrave } from './research-diagnostics.ts';
import { publicAddress } from './research-proxy.ts';
const mode=process.argv[2];
if(!['dns','tls','environment'].includes(mode)){process.stdout.write('{"error":"UNKNOWN"}\n');process.exitCode=1;}
else {
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{process.stdout.write(JSON.stringify(await diagnoseBrave(mode as 'dns'|'tls'|'environment',publicAddress,controller.signal))+'\n');}
 catch{process.stdout.write('{"error":"UNKNOWN"}\n');process.exitCode=1;}
 finally{clearTimeout(timer);}
}

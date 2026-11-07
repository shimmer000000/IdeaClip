import { lookup } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import { isIP } from 'node:net';

export type Stage = 'proxy'|'auth'|'search'|'dns'|'safety'|'tcp'|'tls'|'http'|'parse'|'client'|'environment'|'outbound'|'connect';
export interface Event {stage:Stage;code:string;elapsedMs:number}
export class NetworkFailure extends Error {
  readonly code:string;readonly stage:Stage;readonly elapsedMs:number;
  constructor(code:string,stage:Stage,elapsedMs:number) { super(code);this.code=code;this.stage=stage;this.elapsedMs=elapsedMs; }
}
export const failure=(code:string,stage:Stage,start:number)=>new NetworkFailure(code,stage,Math.max(0,Date.now()-start));
export const certificateError=(e:unknown)=>/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER|ALTNAME/.test(String((e as {code?:unknown})?.code??''));
export function connectionFailure(e:unknown,stage:Stage,start:number,aborted=false){return failure(aborted?'UPSTREAM_TIMEOUT':certificateError(e)?'TLS_CERTIFICATE_FAILED':stage==='tcp'?'TCP_CONNECT_FAILED':stage==='tls'?'TLS_HANDSHAKE_FAILED':'UNKNOWN',stage,start);}
export function safeEvent(e:NetworkFailure):Event {return {stage:e.stage,code:e.code,elapsedMs:Math.min(120000,Math.max(0,Math.round(e.elapsedMs)))};}
export interface Address {address:string;family:number}
export const BRAVE_HOST='api.search.brave.com';
export async function lookupPublic(host:string,signal:AbortSignal,allowed:(address:string)=>boolean,resolve:(host:string)=>Promise<Address[]>=h=>lookup(h,{all:true,verbatim:true})) {
  const start=Date.now();signal.throwIfAborted();
  let addresses:Address[];
  try {addresses=await new Promise<Address[]>((done,reject)=>{const abort=()=>reject(failure('UPSTREAM_TIMEOUT','dns',start));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();resolve(host).then(done,reject).finally(()=>signal.removeEventListener('abort',abort));});}
  catch(e){throw e instanceof NetworkFailure?e:failure('DNS_LOOKUP_FAILED','dns',start);}
  if(signal.aborted)throw failure('UPSTREAM_TIMEOUT','dns',start);
  if(!addresses.length||addresses.length>32||addresses.some(a=>!allowed(a.address)||isIP(a.address)!==a.family))throw failure('DNS_ADDRESS_BLOCKED','safety',start);
  return addresses;
}
// Only TLS handshake: no HTTP path/query/headers, no credentials or search request.
export async function tlsProbe(address:Address,signal:AbortSignal,onStage:(stage:Stage)=>void=()=>{}) {
  signal.throwIfAborted();const start=Date.now();let stage:Stage='tcp';onStage(stage);
  await new Promise<void>((resolve,reject)=>{
    const socket=tlsConnect({host:address.address,port:443,servername:BRAVE_HOST,rejectUnauthorized:true});
    const abort=()=>{socket.destroy();reject(failure('UPSTREAM_TIMEOUT',stage,start));};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    socket.once('connect',()=>{stage='tls';onStage(stage);});
    socket.once('secureConnect',()=>{socket.destroy();resolve();});
    socket.once('error',e=>reject(connectionFailure(e,stage,start,signal.aborted)));
    socket.once('close',()=>signal.removeEventListener('abort',abort));
  });
}
export interface DiagnosticReport {version:1;free:true;searchAuthentication:'untested';searchQuota:'unverified';stages:Event[];environment:{node:string;httpProxyPresent:boolean;httpsProxyPresent:boolean;nodeEnvProxy:boolean;transport:'direct-pinned-https'|'http-connect-pinned-ip'}}
export async function diagnoseBrave(mode:'dns'|'tls'|'environment',allowed:(address:string)=>boolean,signal:AbortSignal,overrides:{resolve?:(host:string)=>Promise<Address[]>;probe?:typeof tlsProbe;outbound?:import('./research-outbound.ts').Outbound}={}):Promise<DiagnosticReport>{
  const {validateOutbound,targetTls}=await import('./research-outbound.ts');const outbound=validateOutbound(overrides.outbound);
  const report:DiagnosticReport={version:1,free:true,searchAuthentication:'untested',searchQuota:'unverified',stages:[],environment:{node:process.versions.node,httpProxyPresent:!!process.env.HTTP_PROXY||!!process.env.http_proxy,httpsProxyPresent:!!process.env.HTTPS_PROXY||!!process.env.https_proxy,nodeEnvProxy:process.env.NODE_USE_ENV_PROXY==='1',transport:outbound.mode==='connect'?'http-connect-pinned-ip':'direct-pinned-https'}};
  if(mode==='environment'){report.stages.push({stage:'environment',code:'OK',elapsedMs:0});return report;}
  const start=Date.now();let stage:Stage='dns';
  try{
    const addresses=await lookupPublic(BRAVE_HOST,signal,allowed,overrides.resolve);
    report.stages.push({stage:'dns',code:'OK',elapsedMs:Date.now()-start},{stage:'safety',code:'OK',elapsedMs:Date.now()-start});
    if(mode==='tls'){
      if(outbound.mode==='connect'){const socket=await targetTls(BRAVE_HOST,addresses,signal,outbound,allowed,e=>report.stages.push(e));socket.destroy();return report;}
      await(overrides.probe??tlsProbe)(addresses[0],signal,s=>{if(stage==='tcp'&&s==='tls')report.stages.push({stage:'tcp',code:'OK',elapsedMs:Date.now()-start});stage=s;});
      report.stages.push({stage:'tls',code:'OK',elapsedMs:Date.now()-start});
    }
  }catch(e){const f=e instanceof NetworkFailure?e:failure('UNKNOWN',stage,start);if(f.code==='DNS_ADDRESS_BLOCKED')report.stages.push({stage:'dns',code:'OK',elapsedMs:f.elapsedMs});report.stages.push(safeEvent(f));}
  return report;
}

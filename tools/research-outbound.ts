import { request } from 'node:http';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { isIP } from 'node:net';
import { connectionFailure, failure, type Address, type Event, type Stage } from './research-diagnostics.ts';

export type Outbound = {mode:'direct'} | {mode:'connect';endpoint:string;auth:'none';certificatePolicy:'node-default';approved:true;addressFamily?:'ipv4';resolver?:'ssh-gateway'};
export function validateOutbound(value:unknown):Outbound {
  if(value===undefined)return {mode:'direct'};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-outbound');
  const r=value as Record<string,unknown>;
  if(r.mode==='direct'&&Object.keys(r).every(k=>k==='mode'))return {mode:'direct'};
  // No DNS for the proxy itself; no implicit system/PAC/environment proxy use.
  // Remote and authenticated proxies require a separate reviewed implementation.
  if(r.mode!=='connect'||r.approved!==true||r.auth!=='none'||r.certificatePolicy!=='node-default'||r.addressFamily!==undefined&&r.addressFamily!=='ipv4'||r.resolver!==undefined&&r.resolver!=='ssh-gateway'||typeof r.endpoint!=='string'||!/^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/?$/.test(r.endpoint)||Object.keys(r).some(k=>!['mode','endpoint','auth','certificatePolicy','approved','addressFamily','resolver'].includes(k)))throw new Error('invalid-outbound');
  const u=new URL(r.endpoint);if(Number(u.port||80)<1||Number(u.port||80)>65535)throw new Error('invalid-outbound');
  return {mode:'connect',endpoint:'http://'+u.hostname+':'+(u.port||80),auth:'none',certificatePolicy:'node-default',approved:true,...(r.addressFamily==='ipv4'?{addressFamily:'ipv4' as const}:{}),...(r.resolver==='ssh-gateway'?{resolver:'ssh-gateway' as const}:{})};
}
// Explicit per-service resolver. No OS DNS changes or automatic fallback.
export async function gatewayAddresses(hostname:string,signal:AbortSignal,outbound:Outbound):Promise<Address[]> {
 const c=validateOutbound(outbound),start=Date.now();if(c.mode!=='connect'||c.resolver!=='ssh-gateway')throw new Error('resolver-not-approved');
 if(hostname.length>253||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostname)||isIP(hostname))throw failure('DNS_LOOKUP_FAILED','dns',start);
 const url=new URL(c.endpoint);const body=JSON.stringify({hostname});
 return new Promise((resolve,reject)=>{
  const bad=()=>reject(failure(signal.aborted?'UPSTREAM_TIMEOUT':'DNS_LOOKUP_FAILED','dns',start));
  const req=request({hostname:url.hostname.replace(/^\[|\]$/g,''),port:url.port,path:'/resolve',method:'POST',agent:false,signal,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
   if(res.statusCode!==200){res.destroy();bad();return;}let text='';res.on('data',part=>{text+=part;if(text.length>8192){res.destroy();bad();}});res.on('error',bad);
   res.on('end',()=>{try{const raw=JSON.parse(text);if(!Array.isArray(raw.addresses)||!raw.addresses.length||raw.addresses.length>32)throw new Error('dns');resolve(raw.addresses.map((r:{address:unknown;family:unknown})=>{if(typeof r.address!=='string'||isIP(r.address)!==r.family)throw new Error('ip');return {address:r.address,family:Number(r.family)};}));}catch{bad();}});
  });req.on('error',bad);req.end(body);
 });
}
// Only numeric CONNECT authority. Never fall back to hostname CONNECT or direct.
export async function targetTls(hostname:string,addresses:Address[],signal:AbortSignal,outbound:Outbound,allowed:(ip:string)=>boolean,observe?:(event:Event)=>void):Promise<TLSSocket> {
  const c=validateOutbound(outbound),start=Date.now();signal.throwIfAborted();
  if(c.mode!=='connect')throw new Error('connect-mode-required');
  if(!addresses.length||addresses.length>32||addresses.some(a=>!allowed(a.address)||isIP(a.address)!==a.family))throw failure('DNS_ADDRESS_BLOCKED','safety',start);
  if(isIP(hostname)||!/^[a-z0-9.-]+$/i.test(hostname)||!hostname.includes('.')||hostname.endsWith('.'))throw failure('DNS_ADDRESS_BLOCKED','safety',start);
  const address=c.addressFamily==='ipv4'?addresses.find(a=>a.family===4):addresses[0];
  if(!address)throw failure('DNS_ADDRESS_FAMILY_UNAVAILABLE','dns',start);
  const authority=(address.family===6?'['+address.address+']':address.address)+':443';
  const proxy=new URL(c.endpoint);let stage:Stage='outbound';
  return new Promise<TLSSocket>((resolve,reject)=>{
    let tunnel:import('node:stream').Duplex|undefined,secure:TLSSocket|undefined,settled=false;
    const req=request({hostname:proxy.hostname.replace(/^\[|\]$/g,''),port:proxy.port,method:'CONNECT',path:authority,agent:false,maxHeaderSize:16384,headers:{Host:authority}});
    const clean=()=>signal.removeEventListener('abort',abort);
    const fail=(e:Error)=>{if(settled)return;settled=true;clean();secure?.destroy();tunnel?.destroy();req.destroy();reject(e);};
    const abort=()=>{const e=failure('UPSTREAM_TIMEOUT',stage,start);if(settled){secure?.destroy();tunnel?.destroy();req.destroy();clean();}else fail(e);};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    req.on('socket',s=>s.once('connect',()=>{observe?.({stage:'outbound',code:'OK',elapsedMs:Date.now()-start});stage='connect';}));
    req.once('error',()=>fail(failure(signal.aborted?'UPSTREAM_TIMEOUT':stage==='outbound'?'OUTBOUND_PROXY_UNREACHABLE':'CONNECT_REJECTED',stage,start)));
    req.once('response',r=>{r.destroy();fail(failure('CONNECT_REJECTED','connect',start));});
    req.once('connect',(response,socket,head)=>{
      if(settled){socket.destroy();return;}
      tunnel=socket;
      if(response.statusCode!==200){fail(failure('CONNECT_REJECTED','connect',start));return;}
      if(head.length){fail(failure('CONNECT_PROTOCOL_INVALID','connect',start));return;}
      if(signal.aborted){abort();return;}
      observe?.({stage:'connect',code:'OK',elapsedMs:Date.now()-start});observe?.({stage:'tcp',code:'OK',elapsedMs:Date.now()-start});stage='tls';
      secure=tlsConnect({socket,servername:hostname,rejectUnauthorized:true,ALPNProtocols:['http/1.1']});
      secure.once('error',e=>fail(connectionFailure(e,'tls',start,signal.aborted)));
      secure.once('secureConnect',()=>{
        if(signal.aborted){abort();return;}if(!secure!.authorized){fail(failure('TLS_CERTIFICATE_FAILED','tls',start));return;}
        settled=true;observe?.({stage:'tls',code:'OK',elapsedMs:Date.now()-start});resolve(secure!);
      });
      secure.once('close',clean);
    });
    req.end();
  });
}

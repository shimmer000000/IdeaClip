/** Fixed WebAssembly test guest. No WASI, filesystem, socket, process or dynamic-code imports.
 * This capability test is NOT an OS sandbox capable of hosting Codex/Node/shell programs. */
const section=(id:number,bytes:number[])=>[id,bytes.length,...bytes];
const name=(s:string)=>[s.length,...Array.from(s,c=>c.charCodeAt(0))];
const body=(bytes:number[])=>[bytes.length,...bytes];
export const SYNTHETIC_WASM=new Uint8Array([
 0,97,115,109,1,0,0,0,
 ...section(1,[2,96,1,127,1,127,96,0,0]),
 ...section(2,[1,...name('cap'),...name('request'),0,0]),
 ...section(3,[3,0,1,1]),
 ...section(7,[3,...name('attempt'),0,1,...name('spin'),0,2,...name('trap'),0,3]),
 ...section(10,[3,...body([0,32,0,16,0,11]),...body([0,3,64,12,0,11,11]),...body([0,0,11])]),
]);
export interface CapabilityGuest {attempt:(id:number)=>number;spin:()=>void;trap:()=>void}
export async function fixedCapabilityGuest(){
 const attempts:number[]=[];
 const module=await WebAssembly.compile(SYNTHETIC_WASM);
 const instance=await WebAssembly.instantiate(module,{cap:{request:(id:number)=>{attempts.push(id);return id===0?0:-1;}}});
 return {guest:instance.exports as unknown as CapabilityGuest,attempts,imports:WebAssembly.Module.imports(module)};
}
export const REAL_EXECUTION_BLOCKERS=['REAL_EXECUTOR_DISABLED','OS_FILESYSTEM_ISOLATION_UNVERIFIED','NETWORK_ISOLATION_UNVERIFIED'] as const;
export function realExecutionPreview(){return {authorized:false,launchable:false,mode:'blocked' as const,blockers:[...REAL_EXECUTION_BLOCKERS],possibleModelUsage:true,plannedArguments:['exec','--cd','<isolated-workspace>','--sandbox','workspace-write','--json','-'],notice:'仅参数设计，不是可执行命令。workspace-write不等于子目录隔离；未验证OS文件/网络边界，禁止启动。'};}

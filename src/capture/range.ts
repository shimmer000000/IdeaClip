export interface CaptureRange {startY:number;endY:number;pageHeight:number;viewportWidth:number;viewportHeight:number}
export function validateCaptureRange(value:unknown):CaptureRange{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('分段长图范围无效。');
 const r=value as Record<string,unknown>,keys=['startY','endY','pageHeight','viewportWidth','viewportHeight'] as const;
 if(Object.keys(r).length!==keys.length||keys.some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k])||(r[k] as number)<0||(r[k] as number)>10000000))throw new Error('分段长图范围无效。');
 const out=Object.fromEntries(keys.map(k=>[k,r[k]])) as unknown as CaptureRange;
 if(out.endY<=out.startY||out.endY>out.pageHeight||out.endY-out.startY>20000||out.viewportWidth<=0||out.viewportHeight<=1||out.startY>=out.pageHeight)throw new Error('分段长图范围越界。');
 return out;
}

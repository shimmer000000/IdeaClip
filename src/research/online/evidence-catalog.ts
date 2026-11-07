import type { ResearchSource } from './model';
import { ResearchReportError } from './report-errors';
export interface EvidenceRef { id:string; sourceId:string; quote:string }
const prefix='ic-evidence:';
// Snapshot-local capabilities, not executable instructions or persisted evidence.
export function evidenceCatalog(sources:ResearchSource[]):EvidenceRef[]{
 const nonce=crypto.randomUUID();const out:EvidenceRef[]=[];
 for(const s of sources)for(let start=0;start<s.content.length;){
  let end=Math.min(start+800,s.content.length);const newline=s.content.lastIndexOf('\n',end-1);if(end<s.content.length&&newline>start+100)end=newline+1;
  if(end<s.content.length&&/[\uD800-\uDBFF]/.test(s.content[end-1]))end--;
  const quote=s.content.slice(start,end);if(quote.trim())out.push({id:prefix+nonce+':'+out.length,sourceId:s.id,quote});start=end;
  if(out.length>500)throw new ResearchReportError('research_evidence_ref');
 }
 return out;
}
// Only resolve a known capability bound to this exact source. Never normalize,
// fuzzy-match or search for a replacement for a model-generated quotation.
export function resolveEvidence(value:unknown,refs:EvidenceRef[],sources:ResearchSource[]):unknown {
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const copy=structuredClone(value) as {sections?:unknown};
 if(!copy.sections||typeof copy.sections!=='object'||Array.isArray(copy.sections))return copy;
 for(const items of Object.values(copy.sections))if(Array.isArray(items))for(const item of items){
  if(!item||typeof item!=='object'||typeof item.quote!=='string'||!item.quote.startsWith(prefix))continue;
  const ref=refs.find(r=>r.id===item.quote);const source=sources.find(s=>s.id===item.sourceId);
  if(!ref||ref.sourceId!==item.sourceId||!source||!source.content.includes(ref.quote))throw new ResearchReportError('research_evidence_ref');
  if(item.kind==='original'&&item.text===item.quote)item.text=ref.quote;
  item.quote=ref.quote;
 }
 return copy;
}

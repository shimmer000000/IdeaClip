import type {Task} from './model';
import {referenceKey} from './github-sync';

export const GITHUB_FRESH_MS=15*60*1000;
export const GITHUB_KINDS=['issue','pr','commit'] as const;
export type GitHubKind=typeof GITHUB_KINDS[number];
export const GITHUB_KIND_LABELS={issue:'Issue',pr:'PR',commit:'Commit'};
export const GITHUB_STATE_LABELS={open:'开启',closed:'关闭',draft:'草稿',merged:'已合并',exists:'提交真实存在',issue_is_pr:'该编号实际是PR，不能作为普通Issue'};

// Display-only: never fetch, persist, or change a task/review decision.
export function githubStatus(task:Task,now=Date.now()) {
 const g=task.github,r=task.githubRemote;
 let matches=false;try{matches=!!g&&!!r&&referenceKey(g)===r.key;}catch{/* Invalid links cannot be verified. */}
 const linked=GITHUB_KINDS.filter(k=>!!g&&(k==='issue'?!!g.issueNumber:k==='pr'?!!g.prNumber:!!g.commitSha));
 const expiredAt=(at:number)=>now<at||now-at>=GITHUB_FRESH_MS;
 const historical=!!r&&(!matches||r.historical||expiredAt(r.attemptAt));
 return {attemptAt:r?.attemptAt,queryError:r?.errors.query,historical,items:linked.map(kind=>{
  const item=r?.items[kind],error=r?.errors[kind]??r?.errors.query;
  const status=error?'查询失败':!r?'尚未查询':historical||!!item&&expiredAt(item.checkedAt)?'历史结果已过期':item?'远程已核实':'尚未查询';
  return {kind,item,error,status};
 })};
}

// Next local UI deadline only; no background network polling.
export function nextGitHubExpiry(task:Task,now:number):number|undefined {
 const r=task.githubRemote;if(!r)return undefined;
 const deadlines=[r.attemptAt,...Object.values(r.items).map(i=>i.checkedAt)].map(at=>at+GITHUB_FRESH_MS).filter(at=>at>now);
 return deadlines.length?Math.min(...deadlines):undefined;
}

import {it,expect} from 'vitest';
import {githubStatus,nextGitHubExpiry,GITHUB_FRESH_MS,GITHUB_STATE_LABELS} from './github-status';
import {parseRemote,referenceKey,type RemoteSnapshot} from './github-sync';
import type {Task} from './model';
const now=2_000_000,repo='https://github.com/example/repo';
const task=():Task=>({id:'t',title:'合成验收',kind:'validation',status:'done',priority:'normal',due:'',notes:'',noteIds:[],milestone:'testing',acceptance:'',reviewed:true,acceptanceReview:{state:'passed',notes:'人工结果',tests:'人工检查'},github:{repository:repo,issueNumber:1,prNumber:2,commitSha:'a'.repeat(40),linkedAt:1}});
function snapshot(t:Task):RemoteSnapshot{return {key:referenceKey(t.github!),source:'https://api.github.com',attemptAt:now,blockedUntil:0,historical:false,errors:{},items:{issue:{state:'open',summary:'合成Issue',updatedAt:'2026-11-08T00:00:00Z',checkedAt:now},pr:{state:'merged',summary:'合成PR',updatedAt:'2026-11-08T00:00:00Z',checkedAt:now},commit:{state:'exists',sha:'a'.repeat(40),summary:'合成提交',updatedAt:'2026-11-08T00:00:00Z',checkedAt:now}}};}
it('只显示实际关联的三类状态，旧任务尚未查询，纯展示不改变人工验收或完成状态',()=>{const t=task(),before=structuredClone(t);expect(githubStatus(t,now).items.map(i=>i.status)).toEqual(['尚未查询','尚未查询','尚未查询']);t.githubRemote=snapshot(t);const saved=structuredClone(t);expect(githubStatus(t,now).items.map(i=>i.status)).toEqual(['远程已核实','远程已核实','远程已核实']);expect(t).toEqual(saved);expect(t.acceptanceReview).toEqual(before.acceptanceReview);expect(t.status).toBe('done');delete t.github!.issueNumber;delete t.github!.prNumber;expect(githubStatus(t,now).items.map(i=>i.kind)).toEqual(['commit']);});
it('15分钟精确边界及单项最近成功时间独立过期',()=>{const t=task();t.githubRemote=snapshot(t);expect(githubStatus(t,now+GITHUB_FRESH_MS-1).items.every(i=>i.status==='远程已核实')).toBe(true);expect(githubStatus(t,now+GITHUB_FRESH_MS).items.every(i=>i.status==='历史结果已过期')).toBe(true);t.githubRemote.items.issue!.checkedAt=now-GITHUB_FRESH_MS;expect(githubStatus(t,now).items.map(i=>i.status)).toEqual(['历史结果已过期','远程已核实','远程已核实']);});
it('部分失败保留旧成功时间；全局失败不得冒充核实',()=>{const t=task();t.githubRemote=snapshot(t);t.githubRemote.errors.issue='NOT_FOUND';t.githubRemote.attemptAt=now+1;const v=githubStatus(t,now+1);expect(v.attemptAt).toBe(now+1);expect(v.items[0]).toMatchObject({status:'查询失败',error:'NOT_FOUND',item:{checkedAt:now}});expect(v.items[1].status).toBe('远程已核实');t.githubRemote.errors.query='PERMISSION';expect(githubStatus(t,now+1).items.every(i=>i.status==='查询失败')).toBe(true);});
it('恢复、关联变化及系统时间倒退均不声称最新核实',()=>{const t=task();t.githubRemote=snapshot(t);t.githubRemote.historical=true;expect(githubStatus(t,now).historical).toBe(true);t.githubRemote.historical=false;t.github!.issueNumber=99;expect(githubStatus(t,now).items.every(i=>i.status==='历史结果已过期')).toBe(true);t.github=task().github;expect(githubStatus(t,now-1).historical).toBe(true);});
it('本地计时取最近成功或查询到期点，已过期无重复计时，不发送请求',()=>{const t=task();expect(nextGitHubExpiry(t,now)).toBeUndefined();t.githubRemote=snapshot(t);t.githubRemote.items.issue!.checkedAt=now-100;expect(nextGitHubExpiry(t,now)).toBe(now-100+GITHUB_FRESH_MS);expect(nextGitHubExpiry(t,now+GITHUB_FRESH_MS)).toBeUndefined();});
it.each([
 ['issue','open',false,null,false,'open','开启'],['issue','closed',false,null,false,'closed','关闭'],
 ['issue','open',true,null,false,'issue_is_pr','该编号实际是PR，不能作为普通Issue'],
 ['pr','open',false,null,true,'draft','草稿'],['pr','open',false,null,false,'open','开启'],
 ['pr','closed',false,null,false,'closed','关闭'],['pr','closed',false,'2026-11-08T00:00:00Z',false,'merged','已合并']
] as const)('%s/%s/draft=%s 状态解析与展示一致', (kind,state,isPr,merged,draft,expected,label)=>{
 const t=task(),number=kind==='issue'?1:2;
 const result=parseRemote(kind,{number,state,html_url:repo+`/${kind==='issue'&&!isPr?'issues':'pull'}/${number}`,title:'合成样本',updated_at:'2026-11-08T00:00:00Z',merged_at:merged,draft,...(isPr?{pull_request:{}}:{})},t.github!,now);
 expect(result.state).toBe(expected);expect(GITHUB_STATE_LABELS[result.state]).toBe(label);
});

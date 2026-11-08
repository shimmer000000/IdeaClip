import type { GitHubReference, Task } from './model';

export const REVIEW_STATES = {pending:'待开发',awaiting:'待验收',passed:'验收通过',failed:'验收失败'};
// No fetch, credential access or GitHub mutation: these are local syntax checks only.
const repositoryPattern = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})\/?$/;
export function githubRepository(value:string):string {
  if(typeof value!=='string'||value.length>300)throw new Error('请填写合法的 GitHub HTTPS 仓库地址。');
  const match=value.match(repositoryPattern);
  if(!match||/[\s\x00-\x1f]/.test(value))throw new Error('只接受 github.com 的 HTTPS 仓库地址，禁止凭据、参数和额外路径。');
  const repo=match[2].replace(/\.git$/,'');
  if(!repo||repo==='.'||repo==='..')throw new Error('GitHub 仓库名称无效。');
  return `https://github.com/${match[1]}/${repo}`;
}
export function normalizeGitHub(value:GitHubReference):GitHubReference {
  if(!value||typeof value!=='object')throw new Error('GitHub 关联格式无效。');
  const repository=githubRepository(value.repository);
  if(!Number.isSafeInteger(value.linkedAt)||value.linkedAt<0||!Number.isFinite(new Date(value.linkedAt).getTime()))throw new Error('GitHub 关联时间无效。');
  const result:GitHubReference={repository,linkedAt:value.linkedAt};
  for(const [numberKey,urlKey,path] of [['issueNumber','issueUrl','issues'],['prNumber','prUrl','pull']] as const){
    const number=value[numberKey],url=value[urlKey]; let fromUrl:number|undefined;
    if(url!==undefined&&url!==''){
      if(typeof url!=='string'||url.length>400||/\s/.test(url))throw new Error('GitHub 关联链接无效。');
      const m=url.match(/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/(issues|pull)\/([1-9][0-9]*)$/);
      if(!m||m[3]!==path||`https://github.com/${m[1]}/${m[2]}`.toLowerCase()!==repository.toLowerCase())throw new Error('Issue / PR 链接必须属于指定仓库且类型正确。');
      fromUrl=Number(m[4]);
    }
    const n=number??fromUrl;
    if(n!==undefined){if(!Number.isSafeInteger(n)||n<=0||(fromUrl!==undefined&&n!==fromUrl))throw new Error('Issue / PR 编号无效或与链接不一致。');result[numberKey]=n;result[urlKey]=`${repository}/${path}/${n}`;}
  }
  let sha=value.commitSha,urlSha:string|undefined;
  if(value.commitUrl!==undefined&&value.commitUrl!==''){
    if(typeof value.commitUrl!=='string'||value.commitUrl.length>450||/\s/.test(value.commitUrl))throw new Error('Commit 链接无效。');
    const m=value.commitUrl.match(/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/commit\/([a-fA-F0-9]{7,40})$/);
    if(!m||`https://github.com/${m[1]}/${m[2]}`.toLowerCase()!==repository.toLowerCase())throw new Error('Commit 链接必须属于指定仓库。');
    urlSha=m[3].toLowerCase();
  }
  if(sha===undefined||sha==='')sha=urlSha;
  if(sha!==undefined){if(typeof sha!=='string'||!(/^[a-fA-F0-9]{7,40}$/).test(sha)||urlSha!==undefined&&sha.toLowerCase()!==urlSha)throw new Error('Commit SHA 须为7～40位十六进制，且与链接一致。');result.commitSha=sha.toLowerCase();result.commitUrl=`${repository}/commit/${sha.toLowerCase()}`;}
  return result;
}
export function validateTaskDelivery(task:Task){
  if(task.github)task.github=normalizeGitHub(task.github);
  for(const value of [task.codexSummary,task.acceptanceReview?.notes,task.acceptanceReview?.tests])if(value!==undefined&&(typeof value!=='string'||value.length>10000))throw new Error('开发摘要或验收记录无效或过长。');
  if(task.acceptanceReview&&(!Object.hasOwn(REVIEW_STATES,task.acceptanceReview.state)||typeof task.acceptanceReview.notes!=='string'||typeof task.acceptanceReview.tests!=='string'))throw new Error('人工验收状态或说明无效。');
}
export function taskMaterial(task:Task){
  const g=task.github?normalizeGitHub(task.github):undefined;
  return JSON.stringify({title:task.title,kind:task.kind,notes:task.notes,noteIds:task.noteIds,milestone:task.milestone,acceptance:task.acceptance,codexSummary:task.codexSummary??'',github:g?{...g,linkedAt:0}:null});
}
export interface TaskSaveConfirmation {reviewTaskId?:string;completeTaskId?:string}
export function applyTaskReview(next:Task,old:Task|undefined,confirmation:TaskSaveConfirmation,boundaryChanged:boolean):Task {
  const changed=!!old&&(taskMaterial(next)!==taskMaterial(old)||boundaryChanged);
  const result={...next};
  if(changed){
    result.reviewed=false;
    if(old!.status==='done'&&next.status==='done')throw new Error('已完成任务的输入或交付已变化，请先将看板状态改为待处理或进行中再保存。');
    if(result.acceptanceReview||old!.acceptanceReview)result.acceptanceReview={...(result.acceptanceReview??old!.acceptanceReview!),state:result.github?.prNumber||result.github?.commitSha||result.codexSummary?'awaiting':'pending'};
    if(confirmation.reviewTaskId===next.id)throw new Error('任务资料已变化，请先保存，再重新人工验收。');
  }
  const review=result.acceptanceReview;
  const reviewChanged=JSON.stringify(review)!==JSON.stringify(old?.acceptanceReview);
  if(review&&(review.state==='passed'||review.state==='failed')&&reviewChanged){
    if(confirmation.reviewTaskId!==next.id)throw new Error('验收通过或失败须人工勾选确认并保存。');
    if(!old||changed)throw new Error('请先保存任务资料，再进行人工验收。');
    if(!review.notes.trim()||!review.tests.trim())throw new Error('请填写验收说明与测试结果；未测试请明确说明。');
  }
  if(next.status==='done'&&old?.status!=='done'&&(confirmation.completeTaskId!==next.id||old?.acceptanceReview?.state!=='passed'||review?.state!=='passed'||changed||reviewChanged))throw new Error('先保存人工验收通过，再明确点击“设为已完成”；录入结果不会自动完成。');
  if(old?.status==='done'&&next.status==='done'&&old.acceptanceReview?.state==='passed'&&review?.state!=='passed')throw new Error('撤销已完成任务的验收前，请先调整看板状态。');
  return result;
}

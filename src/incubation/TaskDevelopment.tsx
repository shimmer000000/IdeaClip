import type { GitHubReference, Task, Workspace } from './model';
import { githubRepository, normalizeGitHub, REVIEW_STATES } from './github';

export function GitHubLinks({value}:{value?:GitHubReference}) {
  if(!value)return <p>GitHub：未关联（可选）</p>;
  let g:GitHubReference;try{g=normalizeGitHub(value);}catch{return <p>GitHub 关联格式待核对，请编辑后保存。</p>;}
  return <div className="task-github-links"><p>GitHub：链接格式已核对。</p>{[['仓库',g.repository],[`Issue #${g.issueNumber}`,g.issueUrl],[`PR #${g.prNumber}`,g.prUrl],[`Commit ${g.commitSha}`,g.commitUrl]].map(([label,url])=>url&&<p key={label}><a href={url} target="_blank" rel="noopener noreferrer">{label}</a></p>)}<p>关联时间：{g.linkedAt?new Date(g.linkedAt).toLocaleString('zh-CN'):'保存后记录'}</p></div>;
}
export function TaskDevelopment({task,workspace,change,confirmed,confirm}:{task:Task;workspace?:Workspace;change:(task:Task)=>void;confirmed:boolean;confirm:(value:boolean)=>void}) {
  let boundRepository='';try{boundRepository=githubRepository(workspace?.repository??'');}catch{/* A non-GitHub workspace is not a GitHub binding. */}
  const g=task.github,review=task.acceptanceReview??{state:'pending' as const,notes:'',tests:''};
  const patch=(value:Partial<GitHubReference>)=>change({...task,reviewed:false,github:{...g!,...value}});
  return <fieldset><legend>GitHub 开发关联与人工验收</legend><p>只保存本地引用，不访问GitHub、不创建Issue/PR、不合并或关闭。先保存任务输入和交付，再单独记录人工验收。</p>
    {!g?<button type="button" onClick={()=>{let repository='';try{repository=githubRepository(workspace?.repository??'');}catch{/* Optional binding can be filled manually. */}change({...task,github:{repository,linkedAt:0},reviewed:false});}}>添加 GitHub 关联</button>:<>
      <label>GitHub 仓库地址<input aria-label="GitHub 仓库地址" maxLength={300} value={g.repository} onChange={e=>patch({repository:e.target.value})}/></label>
      {boundRepository&&<button type="button" onClick={()=>patch({repository:boundRepository})}>使用项目绑定仓库</button>}
      <label>Issue 编号<input aria-label="Issue 编号" type="number" min={1} step={1} value={g.issueNumber??''} onChange={e=>patch({issueNumber:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      <label>Issue 链接<input aria-label="Issue 链接" maxLength={400} value={g.issueUrl??''} onChange={e=>patch({issueUrl:e.target.value})}/></label>
      <label>PR 编号<input aria-label="PR 编号" type="number" min={1} step={1} value={g.prNumber??''} onChange={e=>patch({prNumber:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      <label>PR 链接<input aria-label="PR 链接" maxLength={400} value={g.prUrl??''} onChange={e=>patch({prUrl:e.target.value})}/></label>
      <label>Commit SHA<input aria-label="Commit SHA" maxLength={40} value={g.commitSha??''} onChange={e=>patch({commitSha:e.target.value})}/></label>
      <label>Commit 链接<input aria-label="Commit 链接" maxLength={450} value={g.commitUrl??''} onChange={e=>patch({commitUrl:e.target.value})}/></label>
      <p>编号或链接可只填一项；同时填写时必须一致。SHA接受7～40位十六进制，短SHA不代表已验证唯一提交。清除关联项时请同时清空其编号和链接。</p>
      <button type="button" onClick={()=>change({...task,github:undefined,reviewed:false})}>删除 GitHub 关联（保存后生效）</button>
    </>}
    <label>Codex 开发结果摘要<textarea aria-label="Codex 开发结果摘要" maxLength={10000} value={task.codexSummary??''} onChange={e=>change({...task,codexSummary:e.target.value,reviewed:false})}/></label>
    <label>开发验收状态<select aria-label="开发验收状态" value={review.state} onChange={e=>change({...task,acceptanceReview:{...review,state:e.target.value as typeof review.state}})}>{Object.entries(REVIEW_STATES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>验收说明<textarea aria-label="验收说明" maxLength={10000} value={review.notes} onChange={e=>change({...task,acceptanceReview:{...review,notes:e.target.value}})}/></label>
    <label>测试结果<textarea aria-label="开发验收测试结果" maxLength={10000} value={review.tests} onChange={e=>change({...task,acceptanceReview:{...review,tests:e.target.value}})}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/>我已人工核对本任务交付、验收说明和测试结果，确认本次验收结论</label>
    <p>验收通过/失败须勾选人工确认；保存“通过”不会自动改变看板状态。已完成任务需先改为进行中再修改输入/交付或撤销验收。</p>
  </fieldset>;
}

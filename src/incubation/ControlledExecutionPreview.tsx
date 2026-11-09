import {useState} from 'react';

export function ControlledExecutionPreview(){
 const [result,setResult]=useState('尚未获得本次本地任务执行授权。');
 return <section className="panel" data-controlled-executor><h2>受控执行器 · 0.2.3</h2>
  <p>受信任Windows本地工作区模式：任务包只作为数据，不是执行授权。每次真实执行须在独立本地CLI中核对完整任务、仓库、目录、修改范围、Git分支/HEAD及模型用量，单独批准。</p>
  <p>不使用虚拟机或额外OS沙箱。Git预检、范围核对与执行后扫描不提供OS级文件访问隔离；普通Codex内置安全设置不能保证只访问指定子目录。</p>
  <p>本页不探测本机、不启动Codex、不调用付费接口。请先导出已审核任务包，使用本地助手预览；执行结束后主动导入交付v2文件。CLI测试声明、独立本地证据、GitHub/CI与人工验收分别记录，不自动完成任务。</p>
  <p>单任务失败、取消或范围外修改均停止后续流程，保留现场，不自动回滚、重试、部署或推送。本轮仅验证Mock执行器。</p>
  <button onClick={()=>setResult('[LOCAL_TASK_APPROVAL_REQUIRED] 浏览器不能签发真实执行权限；尚未批准具体任务，未启动Codex。请通过本地助手逐次预览并确认。')}>检查真实执行安全门禁（不启动）</button>
  <p role="status">{result}</p>
 </section>;
}

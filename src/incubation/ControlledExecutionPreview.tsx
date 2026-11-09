import {useState} from 'react';
import {realExecutionPreview} from './synthetic-capability';

export function ControlledExecutionPreview(){
 const [result,setResult]=useState('尚未检查真实执行阻塞项。');
 const preview=realExecutionPreview();
 return <section className="panel" data-controlled-executor><h2>受控执行器 · 0.2.2</h2>
  <p>真实Codex执行：禁止。{preview.blockers.join(' / ')}。当前没有可用的真实执行授权，也没有浏览器到系统命令的桥接。</p>
  <p>本地合成执行器只操作自己新建的临时Git样本：固定WebAssembly程序只获得单一写入能力，拒绝范围外写入、主机文件读取、网络和进程能力。这不是可运行Codex的Windows沙箱；执行后扫描不能替代运行期间边界。</p>
  <p>本页只展示阻塞策略，不探测本机、不读写本机文件、不启动本地执行器、不执行任务JSON、不使用模型。当前任务的单次Mock授权仍在下方详情中独立确认，不影响人工验收。</p>
  <button onClick={()=>setResult('真实执行已拒绝：[REAL_EXECUTOR_DISABLED]。本机文件/网络隔离尚未取得独立证据；浏览器不能签发本地执行权限，未启动Codex。')}>检查真实执行安全门禁（不启动）</button>
  <p role="status">{result}</p>
 </section>;
}

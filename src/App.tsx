import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, setAIEnabled } from './storage';
import { openPage } from './browser';
import { CaptureButtons, RecentCapture } from './capture/Capture';
import { CollectButton } from './collection/Collection';
import { EditorEntry, PendingDrafts } from './inspiration/Entry';

const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

function Header({ compact = false }: { compact?: boolean }) {
  return <header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip<span className="version">初始版</span></a>{!compact && <nav aria-label="主导航"><a href="notes.html">灵感库</a><a href="settings.html">设置</a></nav>}</header>;
}

export function Popup() {

  const [error, setError] = useState('');
  return <div className="popup"><Header compact /><main><p className="eyebrow">CAPTURE A SPARK</p><h1>留住这一刻的灵感。</h1><p className="muted">先收藏，再让想法慢慢生长。</p><EditorEntry target={{ kind: "active" }} closePopup>收藏当前网页</EditorEntry><p className="muted">在独立编辑页整理，未提交编辑会自动保留。</p><CaptureButtons /><RecentCapture /><CollectButton /><p className="capture-hint">截图自动压缩并保存在本地；区域选择时按 Esc 取消。</p><PendingDrafts /></main><footer><button onClick={() => { void openPage('notes').catch(e => setError(messageOf(e))); }}>打开灵感库 ↗</button><button onClick={() => { void openPage('settings').catch(e => setError(messageOf(e))); }}>设置</button></footer>{error && <p role="alert">{error}</p>}</div>;
}

export function Settings() {
  const settings = useLiveQuery(() => getSettings());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!settings) return;
    setBusy(true); setError('');
    try { await setAIEnabled(!settings.aiEnabled); } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <div className="shell"><Header /><main className="settings"><p className="eyebrow">MAKE IT YOURS</p><h1>你的灵感，你来掌控。</h1><p className="muted">本地优先，从最少的权限开始。</p><section className="panel"><span className="badge">分析偏好</span><h2>AI 商业模式分析</h2><p>总开关默认关闭。开启仅保存偏好；AI 服务尚未接入，当前不会发送笔记，也不会生成分析。</p><div className="toggle-row"><label htmlFor="ai-toggle">AI 分析总开关</label><button id="ai-toggle" role="switch" aria-checked={settings?.aiEnabled ?? false} disabled={!settings || busy} onClick={() => { void toggle(); }}>{settings?.aiEnabled ? '已开启' : '已关闭'}</button></div>{error && <p role="alert" className="error">{error}</p>}</section><section className="panel"><h2>数据与隐私</h2><p>笔记、标签与设置保存在当前浏览器的 IndexedDB 中，不会同步到 GitHub。</p><p>当前版本不提供 API Key 输入、不接入云服务、不自动抓取网页正文。卸载插件或清除扩展数据将丢失本地笔记。</p></section><p className="muted">IdeaClip 0.1.0 · 项目初始化</p></main></div>;
}

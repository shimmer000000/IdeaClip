import React from 'react';
import ReactDOM from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { Popup, Settings } from './App';
import { Library as Notes } from './library/Library';
import { CapturePreview } from './capture/Capture';
import { CollectionPreview } from './collection/Collection';
import { NoteEditor } from './inspiration/Editor';
import { AnalysisPage } from './ai/AnalysisPage';
import { TaskCenter } from './automation/TaskCenter';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="panel" role="alert"><h1>暂时无法读取灵感</h1><p>请确认浏览器允许 IndexedDB，或重新打开插件。已有数据不会被自动清除。</p></main>;
    return this.props.children;
  }
}

const page = window.location.pathname.split('/').pop();
const App = page === 'tasks.html' ? TaskCenter : page === 'analysis.html' ? AnalysisPage : page === 'notes.html' ? Notes : page === 'settings.html' ? Settings : page === 'capture.html' ? CapturePreview : page === 'collection.html' ? CollectionPreview : page === 'note.html' ? NoteEditor : Popup;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
);

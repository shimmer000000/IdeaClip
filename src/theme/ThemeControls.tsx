import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { readTheme, setTheme, type ThemePreference } from './init';
export function ThemeControls() {
 const [host,setHost]=useState<HTMLElement|null>(null),[preference,setPreference]=useState(readTheme),[error,setError]=useState('');
 useEffect(()=>{
  setHost(document.querySelector('header'));
  const refresh=()=>setPreference(readTheme());
  window.addEventListener('storage',refresh);window.addEventListener('ideaclip-theme',refresh);
  return()=>{window.removeEventListener('storage',refresh);window.removeEventListener('ideaclip-theme',refresh);};
 },[]);
 return host?createPortal(<div className="theme-control"><label><span className="sr-only">外观模式</span><select aria-label="外观模式" value={preference} onChange={e=>{try{setTheme(e.target.value as ThemePreference);setError('');}catch{setError('外观偏好保存失败，请检查浏览器本地存储。');}}}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>{error&&<span role="alert">{error}</span>}</div>,host):null;
}

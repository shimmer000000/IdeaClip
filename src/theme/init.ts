export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'ideaclip-appearance';
export function readTheme():ThemePreference {
 try { const value=localStorage.getItem(KEY); return value==='light'||value==='dark'?value:'system'; }
 catch { return 'system'; }
}
export function applyTheme() {
 const preference=readTheme();
 document.documentElement.dataset.theme=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;
}
export function setTheme(preference:ThemePreference) {
 localStorage.setItem(KEY,preference);
 applyTheme();
 window.dispatchEvent(new Event('ideaclip-theme'));
}
applyTheme();
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null)applyTheme();});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);

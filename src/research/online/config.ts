import { db } from '../../storage';
import { endpointOf, permissionOrigin } from '../../ai/config';
import { announceAIChange } from '../../ai/events';
import { DEFAULT_RESEARCH, validateResearchConfig, type ResearchConfig } from './model';
const KEY='ideaclip-research-credential';
export const researchConfig=async(database=db)=>(await database.researchConfig.get('online'))??{...DEFAULT_RESEARCH};
export function changed(){announceAIChange();}
export async function researchCredential(endpoint:string){if(!globalThis.chrome?.storage)return null;const values=await chrome.storage.session.get(KEY);const c=values[KEY] as {endpoint:string;value:string;version:string}|undefined;return c?.endpoint===endpoint?c:null;}
export async function saveResearchConfig(value:ResearchConfig,key:string,database=db){
 const c=validateResearchConfig(value);endpointOf(c.endpoint);
 if(!globalThis.chrome?.runtime?.id||!await chrome.permissions.request({origins:[permissionOrigin(c.endpoint)]}))throw new Error('研究代理域名授权被拒绝，未启用。');
 const previous=await researchCredential(c.endpoint);const secret=key||previous?.value||'';
 if(!/^[\x21-\x7e]{16,1000}$/.test(secret))throw new Error('请填写研究代理的有效访问密钥（仅存会话）。');
 await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
 changed();await chrome.storage.session.set({[KEY]:{endpoint:c.endpoint,value:secret,version:crypto.randomUUID()}});
 await database.researchConfig.put({...c,enabled:false,version:crypto.randomUUID()});changed();
}
export async function setResearchEnabled(enabled:boolean,database=db){const c=await researchConfig(database);if(enabled){validateResearchConfig(c);if(!await researchCredential(c.endpoint)||!await chrome.permissions.contains({origins:[permissionOrigin(c.endpoint)]}))throw new Error('请重新保存并授权研究代理。');}await database.researchConfig.put({...c,enabled,version:crypto.randomUUID()});changed();}
export async function clearResearchCredential(database=db){const c=await researchConfig(database);await setResearchEnabled(false,database);await chrome.storage.session.remove(KEY);if(c.endpoint)await chrome.permissions.remove({origins:[permissionOrigin(c.endpoint)]});changed();}

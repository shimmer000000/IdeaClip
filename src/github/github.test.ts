import { JSDOM } from 'jsdom';
import { extractFromDocument } from '../collection/extract';
import { describe,it,expect,vi } from 'vitest';
import { githubProjects,githubTextLinks } from '../collection/model';
import { collectPublicProject,publicText } from './public';
import { localReport } from './local';
import { GITHUB_SKILL } from './skill';
import { validateSkillReport } from '../skills/model';
let serial=0;const url=()=>`https://github.com/fixture/repo${++serial}`;
const response=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status});
function mock(u:string,license:unknown={spdx_id:'MIT'}){return vi.fn<typeof fetch>(async input=>String(input).endsWith('/readme')?response({encoding:'base64',content:btoa('A CLI workflow automation tool')}):String(input).endsWith('/releases/latest')?response({tag_name:'v1',published_at:'2026-01-01T00:00:00Z'}):response({private:false,full_name:u.slice(19),description:'workflow automation tool',license,stargazers_count:5,forks_count:2,open_issues_count:1}));}
describe('GitHub入口与采集',()=>{
 it.each(['https://github.com/o/repo','github.com/o/repo','https://github.com/o/repo.git','https://github.com/o/repo/issues/1'])('接受完整仓库 %s',s=>expect(githubProjects([s])).toEqual(['https://github.com/o/repo']));
 it.each(['https://github.com.evil/o/r','https://github.com@evil.com/o/r','http://github.com/o/r','https://github.com/o/r…','github.com/o/re...','https://t.co/abc','https://github.com/topics/ai','https://github.com/o/%72','https://github.com/o/..'])('拒绝不可信地址 %s',s=>expect(githubProjects([s])).toEqual([]));
 it('正文完整地址与截断不猜测',()=>expect(githubTextLinks('github.com/o/repo… github.com/a/real')).toEqual(['https://github.com/a/real']));
 it('官方三次GET、来源时间、README和Release',async()=>{const u=url(),f=mock(u),p=await collectPublicProject(u,f,100000);expect(f).toHaveBeenCalledTimes(3);expect(p.fields.stars.value).toBe(5);expect(p.fields.README.value).toContain('CLI');expect(p.fields.release.value).toBe('v1');for(const d of Object.values(p.fields)){expect(d.source).toContain('https://api.github.com/repos/');expect(d.collectedAt).toBe(100000);}expect(f.mock.calls[0][1]).toMatchObject({method:'GET',credentials:'omit',redirect:'error'});expect(publicText(p)).toContain('没有证据');await expect(collectPublicProject(u,f,100001)).rejects.toThrow('冷却');});
 it.each([404,403,429])('失败状态%d不重试',async status=>{const f=vi.fn<typeof fetch>(async()=>response({},status));await expect(collectPublicProject(url(),f,200000+serial*100000)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);});
 it('超时不重试',async()=>{const f=vi.fn<typeof fetch>((_,init)=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted')))));await expect(collectPublicProject(url(),f,20000000,5)).rejects.toThrow('超时');expect(f).toHaveBeenCalledTimes(1);});
 it('README缺失及许可证缺失显示未知与风险',async()=>{const u=url(),base=mock(u,null),f=vi.fn<typeof fetch>((input,init)=>String(input).endsWith('/readme')?Promise.resolve(response({},404)):base(input,init));const p=await collectPublicProject(u,f,30000000);expect(p.fields.README.value).toBeNull();expect(p.fields.license.value).toBeNull();const r=localReport(p);expect(r.sections.costs[0].text).toContain('许可证未知');expect(r.sections.business[0].text).toContain('暂不建议');expect(validateSkillReport(r,GITHUB_SKILL,publicText(p))).toEqual(r);});
 it('八栏合法报告与禁止编造收入',async()=>{const u=url(),p=await collectPublicProject(u,mock(u),40000000);const r=localReport(p);expect(Object.keys(r.sections)).toHaveLength(8);expect(validateSkillReport(r,GITHUB_SKILL,publicText(p))).toEqual(r);r.sections.business=[{kind:'inference',text:'收入100万元',evidence:null}];expect(()=>validateSkillReport(r,GITHUB_SKILL,publicText(p))).toThrow('商业数字');});
 it('私有和不匹配仓库拒绝',async()=>{await expect(collectPublicProject(url(),async()=>response({private:true,full_name:'fixture/x'}),50000000)).rejects.toThrow('公开仓库');});
});

it.each([
 ['href="https://t.co/a" data-expanded-url="https://github.com/real/full"','github.com/real/f…',['https://github.com/real/full']],
 ['href="https://t.co/a" title="https://github.com/real/full"','github.com/real/f…',['https://github.com/real/full']],
 ['href="https://t.co/a"','github.com/real/full',['https://github.com/real/full']],
 ['href="https://t.co/a"','github.com/real/f…',[]]
])('X主帖完整属性及短链待核实 %s', (attrs,text,expected)=>{
 const u='https://x.com/test/status/123';const doc=new JSDOM(`<article><a href="/test/status/123"><time></time></a><div data-testid="tweetText"><a ${attrs}>${text}</a></div><div data-testid="quoteTweet"><a href="https://github.com/wrong/quote">quote</a></div></article><article><a href="https://github.com/wrong/comment">comment</a></article>`,{url:u}).window.document;
 const p=extractFromDocument(doc,u);expect(p.githubLinks).toEqual(expected);if(!expected.length)expect(p.warnings.join('')).toContain('待核实');
});

it('超大响应拒绝且不自动重试',async()=>{const f=vi.fn<typeof fetch>(async()=>new Response('x'.repeat(2*1024*1024+1)));await expect(collectPublicProject(url(),f,60000000)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);});

import {test,expect} from '@playwright/test';
import {collectionHarness} from './collection-harness';
import {readFile} from 'node:fs/promises';
test('0.2.18 手动地址、官方Mock、八栏折叠导出、孵化与重开，零付费调用',async({},info)=>{
 let h=await collectionHarness();const outbound:string[]=[];
 async function setup(){await h.context.route(/^https?:\/\//,async route=>{const u=route.request().url();outbound.push(u);if(!u.startsWith('https://api.github.com/repos/fixture/automation'))return route.abort();const body=u.endsWith('/readme')?{encoding:'base64',content:btoa('workflow automation tool')}:u.endsWith('/releases/latest')?{tag_name:'v1',published_at:'2026-01-01T00:00:00Z'}:{private:false,full_name:'fixture/automation',description:'workflow automation tool',license:null,stargazers_count:8,forks_count:2,open_issues_count:1};await route.fulfill({json:body});});}
 await setup();let page=await h.context.newPage();const root=`chrome-extension://${h.extensionId}`;
 try{await page.goto(root+'/notes.html');await page.getByRole('link',{name:'GitHub项目分析',exact:true}).click();
 const field=page.getByRole('textbox',{name:'完整GitHub仓库地址'});await field.fill('https://github.com.evil/fixture/automation');await expect(page.getByRole('button',{name:'获取公开项目资料',exact:true})).toBeDisabled();await field.fill('https://t.co/test');await expect(page.getByRole('button',{name:'获取公开项目资料',exact:true})).toBeDisabled();await field.fill('github.com/fixture/automation');expect(outbound).toHaveLength(0);
 await page.evaluate(()=>{chrome.permissions.contains=async()=>true;});
 await page.getByRole('button',{name:'获取公开项目资料',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');expect(outbound).toHaveLength(3);
 await page.getByRole('link',{name:'查看报告、证据与AI费用预览'}).click();await expect(page.locator('.ai-section-toggle')).toHaveCount(8);await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'公开资料证据与采集时间'})).toBeVisible();await page.getByText('查看本次公开资料、来源与采集时间',{exact:true}).click();await expect(page.locator('pre').first()).toContainText('没有证据');
 await page.locator('.ai-section-toggle').first().click();await expect(page.locator('.ai-section-content').first()).toBeVisible();await page.getByRole('button',{name:'全部展开',exact:true}).click();await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(8);await expect(page.locator('.ai-report')).toContainText('许可证未知');await page.getByRole('button',{name:'全部折叠',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Markdown'}).click();const f=await download,p=info.outputPath('github-report.md');await f.saveAs(p);const md=await readFile(p,'utf8');expect(md).toContain('30天推广与收费实验');expect(md).toContain('https://api.github.com');
 const reportUrl=page.url();await page.getByRole('link',{name:'从报告创建项目',exact:true}).click();await page.getByRole('button',{name:'创建孵化项目',exact:true}).click();await expect(page.getByRole('status')).toContainText('项目已创建');
 await page.goto(reportUrl);await page.locator('.ai-report').screenshot({path:info.outputPath('github-eight-collapsed.png')});
 const profile=h.profile;await h.context.close();h=await collectionHarness(profile);await setup();page=await h.context.newPage();await page.goto(reportUrl);await expect(page.locator('.ai-section-toggle')).toHaveCount(8);await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);expect(outbound).toHaveLength(3);
 }finally{await h.context.close();}
});

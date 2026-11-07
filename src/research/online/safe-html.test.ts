import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { researchDocument } from './safe-html';
let dom:JSDOM;
beforeEach(()=>{dom=new JSDOM('');vi.stubGlobal('document',dom.window.document);});
afterEach(()=>{dom.window.close();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('不把远程HTML传入原生HTML解析入口，文本/实体与价格保留',()=>{
 vi.spyOn(dom.window.Element.prototype,'innerHTML','set').mockImplementation(()=>{throw new Error('不准原生HTML解析');});
 const d=researchDocument('<main onclick="alert(1)"><h2>Sync</h2><p>$7 &amp; USD &#x1f600; &nbsp; monthly</p></main>');
 expect(d.body.textContent).toContain('$7 & USD 😀 \u00a0 monthly');expect(d.querySelector('main')?.hasAttribute('onclick')).toBe(false);
});
it('阻止脚本、资源、事件、外部URL、自定义元素和外部命名空间进入原生DOM',()=>{
 const d=researchDocument(`<body onload="alert(1)"><main id="content" class="article" style="background:url(https://blocked.example/a)"><x-widget onload="x()"><p>可读正文</p></x-widget><a href="javascript:alert(1)" onmouseover="x()">链接文字</a><img src="https://blocked.example/x" onerror="x()"><iframe srcdoc="<script>x()</script>"></iframe><svg><foreignObject><p>外部命名空间</p></foreignObject></svg><script>x()</script></main></body>`);
 expect(d.body.textContent).toBe('可读正文链接文字');expect(d.querySelector('main')?.id).toBe('content');expect(d.querySelector('main')?.className).toBe('article');
 expect(d.querySelector('img,iframe,svg,script,x-widget')).toBeNull();for(const e of d.querySelectorAll('*'))for(const a of [...e.attributes])expect(['id','class']).toContain(a.name);
});
it('过滤隐藏节点和不相关区域，保持表格及畸形HTML文本顺序',()=>{
 const d=researchDocument('<nav>广告</nav><main><div hidden>隐藏</div><p style="display:none">隐藏</p><aside>推荐</aside><p>首段<p>次段<table><tr><td>套餐<td>$7</table></main>');
 expect(d.body.textContent).toBe('首段次段套餐$7');expect(d.querySelector('table td')?.textContent).toBe('套餐');
});
it('拒绝过深嵌套，不把截断内容标为完整',()=>{expect(()=>researchDocument('<div>'.repeat(130)+'正文'+'</div>'.repeat(130))).toThrow('嵌套');});
it('拒绝过量节点',()=>{expect(()=>researchDocument('<br>'.repeat(50001))).toThrow('节点');});
it('按UTF-8字节限制输入',()=>{expect(()=>researchDocument('中'.repeat(700000))).toThrow('安全上限');});

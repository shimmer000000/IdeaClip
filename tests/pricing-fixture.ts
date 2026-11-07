// Synthetic layout regression: deliberately different prices from any live product.
export const pricingHtml=`<html><head><title>合成产品定价</title></head><body>
<nav>导航广告 $999 USD monthly</nav><main><h1>公开产品</h1>
<section><h2>同步服务</h2><div><h3>Sync</h3><p>$7 USD</p><p>Per user, per month, billed annually</p><p>$9 USD</p><p>Per user, per month, billed monthly</p></div></section>
<section><h2>发布服务</h2><div><h3>Publish</h3><p>$11 USD</p><p>Per site, per month, billed annually</p><p>$13 USD</p><p>Per site, per month, billed monthly</p></div></section>
<section><h2>FAQ</h2><h3>商业使用是否必须购买许可？</h3><p>${'作者说明许可是可选支持，不能据此推断真实营收或市场规模。'.repeat(35)}</p></section>
<div hidden>隐藏收费 $888 USD monthly</div><div style="display:none">隐藏收费 $887 USD monthly</div><form>私人表单 $886 USD monthly<input value="private-form"></form><script>fetch('https://blocked.example/leak')</script><img src="https://blocked.example/image" onerror="alert(1)"></main>
<details open ontoggle="alert(2)"><summary>费用说明</summary><p>合成计费条款</p></details><iframe src="https://blocked.example/frame"></iframe><x-product onload="alert(3)">合成文本</x-product>
<footer>页脚推广 $885 USD monthly</footer></body></html>`;

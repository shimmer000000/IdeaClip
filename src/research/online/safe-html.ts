import { parse, type DefaultTreeAdapterMap } from 'parse5';

type TreeNode=DefaultTreeAdapterMap['node'];
const allowed=new Set('main article section div span p h1 h2 h3 h4 h5 h6 blockquote pre code strong em b i u s small sub sup ul ol li dl dt dd table caption thead tbody tfoot tr th td br hr a figure figcaption'.split(' '));
const blocked=new Set('head script style link meta base img iframe frame frameset object embed video audio source track svg math form input textarea button select option noscript nav header footer aside menu dialog template canvas'.split(' '));
const hiddenStyle=/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;}]|\s*$))/i;

// Raw remote HTML is parsed only as a JS tree. Never give it to innerHTML,
// DOMParser or a live document: Chrome may compile event attributes while
// parsing even before they are removed. Build only inert, allowlisted nodes.
export function researchDocument(html:string):Document {
 if(new TextEncoder().encode(html).length>2*1024*1024)throw new Error('研究HTML超过安全上限。');
 const tree=parse(html,{scriptingEnabled:false});const doc=document.implementation.createHTMLDocument('');
 const pending:{node:TreeNode;parent:Node;depth:number}[]=[{node:tree,parent:doc.body,depth:0}];let count=0;
 while(pending.length){const {node,parent,depth}=pending.pop()!;if(++count>50000||depth>128)throw new Error('研究HTML节点或嵌套超过安全上限。');
  if(node.nodeName==='#text'){parent.appendChild(doc.createTextNode((node as DefaultTreeAdapterMap['textNode']).value));continue;}
  let target=parent;
  if('tagName' in node){const tag=node.tagName;const attributes=Object.fromEntries(node.attrs.map(a=>[a.name,a.value]));
   if(node.namespaceURI!=='http://www.w3.org/1999/xhtml'||blocked.has(tag)||Object.hasOwn(attributes,'hidden')||Object.hasOwn(attributes,'inert')||attributes['aria-hidden']==='true'||['navigation','complementary'].includes(attributes.role)||hiddenStyle.test(attributes.style??''))continue;
   if(allowed.has(tag)){const element=doc.createElement(tag);for(const name of ['class','id'])if(attributes[name]&&attributes[name].length<=2048)element.setAttribute(name,attributes[name]);parent.appendChild(element);target=element;}
  }
  if('childNodes' in node)for(let i=node.childNodes.length-1;i>=0;i--)pending.push({node:node.childNodes[i],parent:target,depth:depth+1});
 }
 return doc;
}

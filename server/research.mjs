import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import {load} from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {AppError,cleanError} from './config.mjs';
const privateIp=ip=>{const p=ip.split('.').map(Number);return p.length!==4||p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19));};
export async function publicFetch(raw,{maxBytes=2_500_000,timeout=16000,redirects=3}={}){
 const url=new URL(raw);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new AppError('仅支持公开 HTTP / HTTPS 链接');
 const addresses=await dns.lookup(url.hostname,{all:true,family:4});if(!addresses.length||addresses.some(x=>privateIp(x.address)))throw new AppError('该链接不是公开网站');
 const address=addresses[0].address;
 const result=await new Promise((resolve,reject)=>{const req=(url.protocol==='https:'?https:http).request(url,{method:'GET',headers:{'User-Agent':'Mozilla/5.0 (compatible; QuoteResearch/1.0)','Accept':'text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.5','Accept-Encoding':'identity'},lookup:(_host,options,cb)=>{if(options.all)cb(null,[{address,family:4}]);else cb(null,address,4);}},res=>{let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new AppError('网页内容超过读取上限'));return;}chunks.push(chunk);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8'),url:url.href}));});req.setTimeout(timeout,()=>req.destroy(new AppError('网页读取超时')));req.on('error',reject);req.end();});
 if([301,302,303,307,308].includes(result.status)&&result.headers.location){if(!redirects)throw new AppError('网页跳转次数过多');return publicFetch(new URL(result.headers.location,url).href,{maxBytes,timeout,redirects:redirects-1});}
 if(result.status<200||result.status>=300)throw new AppError('网页返回 HTTP '+result.status);
 return result;
}
export async function readPage(url){const r=await publicFetch(url);const $=load(r.body);const title=$('head > title').first().text().trim();const publishedAt=$('meta[property="article:published_time"]').attr('content')||$('meta[name="date"]').attr('content')||null;$('script,style,nav,footer,header,noscript,svg,form').remove();const text=$('main,article').first().text()||$('body').text();return {url:r.url,title:title||new URL(url).hostname,publishedAt,text:text.replace(/\s+/g,' ').trim().slice(0,18000)};}
export async function searchWeb(q){
 if(process.env.TAVILY_API_KEY){const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:q,max_results:4,include_answer:false}),signal:AbortSignal.timeout(18000)});if(!r.ok)throw new AppError('搜索服务 HTTP '+r.status);const j=await r.json();return (j.results||[]).map(x=>({title:x.title,url:x.url,snippet:x.content}));}
 if(process.env.SERPER_API_KEY){const r=await fetch('https://google.serper.dev/search',{method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':process.env.SERPER_API_KEY},body:JSON.stringify({q,num:4}),signal:AbortSignal.timeout(18000)});if(!r.ok)throw new AppError('搜索服务 HTTP '+r.status);const j=await r.json();return (j.organic||[]).map(x=>({title:x.title,url:x.link,snippet:x.snippet}));}
 const r=await publicFetch('https://www.bing.com/search?format=rss&q='+encodeURIComponent(q));const j=new XMLParser().parse(r.body);const items=j.rss?.channel?.item;if(!items)throw new AppError('公开搜索未返回可用结果');return (Array.isArray(items)?items:[items]).slice(0,4).map(x=>({title:String(x.title||''),url:String(x.link||''),snippet:String(x.description||''),publishedAt:x.pubDate||null}));
}
export async function collectResearch(input,onStage,signal){
 const sources=[],warnings=[],queries=[];const now=new Date().toISOString();
 if(input.researchCompany&&input.customerName)queries.push({kind:'company',q:`${input.customerName} ${input.country||''} 官网 产品 业务`});
 if(input.researchCost)queries.push({kind:'cost',q:input.researchKeywords?`${input.researchKeywords} official pricing 价格`:`${input.types.includes('model')?'GPU 云计算 模型训练':input.licenseProduct||'软件开发'} official pricing 成本`});
 if(input.researchMarket)queries.push({kind:'market',q:`${(input.researchKeywords||input.projectName).slice(0,90)} 项目 中标 成交 金额`});
 const direct=[...(input.researchCompany&&input.website?[{kind:'company',url:input.website}]:[]),...String(input.sourceLinks||'').split(/\s+/).filter(x=>/^https?:\/\//.test(x)).slice(0,5).map(url=>({kind:'specified',url}))];
 const results=await Promise.allSettled(queries.map(async query=>({...query,results:await searchWeb(query.q)})));
 results.forEach((r,i)=>{if(r.status==='rejected')warnings.push(`${queries[i].kind==='company'?'客户':queries[i].kind==='cost'?'成本':'相似项目'}检索：${cleanError(r.reason)}`);else for(const item of r.value.results.slice(0,3))direct.push({...item,kind:r.value.kind,query:r.value.q});});
 const unique=[...new Map(direct.map(x=>[x.url,x])).values()].slice(0,12);
 await onStage('读取公开来源',32);
 for(let i=0;i<unique.length;i+=3){if(signal?.aborted)throw new AppError('分析已取消');await Promise.all(unique.slice(i,i+3).map(async x=>{try{const page=await readPage(x.url);sources.push({...x,...page,id:'src-'+(sources.length+1),retrievedAt:now,access:'page'});}catch(e){if(x.snippet)sources.push({...x,id:'src-'+(sources.length+1),text:x.snippet,retrievedAt:now,access:'snippet',warning:'仅获取搜索摘要，正文未验证'});else warnings.push(`${x.title||x.url}：${cleanError(e)}`);}}));}
 let fx=null;
 if(input.researchFX&&input.currency!=='CNY'){
  for(const provider of ['https://open.er-api.com/v6/latest/CNY','https://www.floatrates.com/daily/cny.json']){try{const r=await publicFetch(provider,{timeout:9000});const j=JSON.parse(r.body),entry=j[input.currency.toLowerCase()];const rate=Number(j.rates?.[input.currency]||entry?.rate),dateValue=j.time_last_update_utc||entry?.date;if(!(rate>0)||!dateValue)throw new Error('暂无该币种汇率');fx={base:'CNY',quote:input.currency,rate,date:new Date(dateValue).toISOString().slice(0,10),source:provider,provider:j.rates?'ExchangeRate-API':'FloatRates'};break;}catch(e){if(provider.includes('floatrates'))warnings.push('参考汇率暂不可用，请人工填写');}}
 }

 return {sources,queries,fx,warnings,retrievedAt:now};
}

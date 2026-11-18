import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import zlib from 'node:zlib';
import {load} from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {cfg,AppError,cleanError} from './config.mjs';
import {chat,getSupportedThinkingLevels,isImageGenerationModel} from './ai.mjs';

const BINARY_MIME_PREFIXES=['image/','audio/','video/','font/','application/pdf','application/zip','application/x-rar','application/x-7z','application/octet-stream','application/msword','application/vnd.'];
const HIGH_TRUST_DOMAINS=['ccgp.gov.cn','ggzy.gov.cn','chinabidding.com.cn','chinabidding.cn','bidcenter.com.cn','aliyun.com','cloud.tencent.com','huaweicloud.com','volcengine.com','aws.amazon.com','azure.microsoft.com','cloud.google.com','openai.com'];
const LOW_TRUST_DOMAINS=['csdn.net','zhihu.com','jianshu.com','cnblogs.com','baijiahao.baidu.com','tieba.baidu.com','toutiao.com','sohu.com'];

function isPrivateIpv4(ip){
 const p=String(ip||'').split('.').map(Number);
 if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
 return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19));
}

function isPrivateIp(address,family=4){
 const addr=String(address||'').toLowerCase().trim();
 if(!addr)return true;
 if(family===4||addr.includes('.')){
  const v4=addr.startsWith('::ffff:')?addr.slice(7):addr;
  if(v4.includes('.'))return isPrivateIpv4(v4);
 }
 return addr==='::1'||addr==='::'||addr.startsWith('fc')||addr.startsWith('fd')||/^fe[89ab][0-9a-f]:/i.test(addr);
}

function decompressBuffer(buffer,encoding,maxOutput){
 const enc=String(encoding||'').toLowerCase().trim();
 if(!enc||enc==='identity')return buffer;
 const opts={maxOutputLength:maxOutput};
 try{
  if(enc.includes('br'))return zlib.brotliDecompressSync(buffer,opts);
  if(enc.includes('gzip'))return zlib.gunzipSync(buffer,opts);
  if(enc.includes('deflate')){
   try{return zlib.inflateSync(buffer,opts);}catch{return zlib.inflateRawSync(buffer,opts);}
  }
 }catch{
  return buffer;
 }
 return buffer;
}

function normalizeCharsetLabel(raw){
 const c=String(raw||'').toLowerCase().replace(/['"\s]/g,'');
 if(!c)return '';
 if(c==='gb2312'||c==='gbk'||c==='gb18030'||c==='cp936')return 'gb18030';
 if(c==='big5'||c==='big5-hkscs')return 'big5';
 if(c==='utf8'||c==='utf-8')return 'utf-8';
 if(c==='iso-8859-1'||c==='latin1')return 'latin1';
 return '';
}

function decodeHtmlBuffer(buffer,contentType=''){
 const headerMatch=/charset\s*=\s*([^\s;]+)/i.exec(contentType);
 let charset=normalizeCharsetLabel(headerMatch?.[1]);
 if(!charset){
  const headAscii=buffer.subarray(0,2048).toString('latin1');
  const metaMatch=/charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i.exec(headAscii)||/encoding\s*=\s*["']([a-zA-Z0-9_\-]+)/i.exec(headAscii);
  charset=normalizeCharsetLabel(metaMatch?.[1]);
 }
 if(charset&&charset!=='utf-8'){
  try{return new TextDecoder(charset,{fatal:false}).decode(buffer);}catch{}
 }
 const utf8=new TextDecoder('utf-8',{fatal:false}).decode(buffer);
 const sample=utf8.slice(0,2400);
 const badCount=(sample.match(/\uFFFD/g)||[]).length;
 if(badCount>3){
  try{
   const gb=new TextDecoder('gb18030',{fatal:false}).decode(buffer);
   const gbBad=(gb.slice(0,2400).match(/\uFFFD/g)||[]).length;
   if(gbBad<badCount)return gb;
  }catch{}
 }
 return utf8;
}

export async function publicFetch(raw,{maxBytes=2_500_000,timeout=14000,redirects=3,signal}={}){
 if(signal?.aborted)throw new AppError('分析已取消');
 let url;
 try{
  url=new URL(raw);
 }catch{
  throw new AppError('链接格式不正确');
 }
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port))){
  throw new AppError('仅支持公开标准端口的 HTTP / HTTPS 链接');
 }
 let addresses=[];
 try{
  addresses=await dns.lookup(url.hostname,{all:true,family:4});
 }catch{
  addresses=await dns.lookup(url.hostname,{all:true});
 }
 if(!addresses.length||addresses.some(x=>isPrivateIp(x.address,x.family))){
  throw new AppError('该链接不是公开可访问网站');
 }
 const target=addresses[0];
 const family=target.family||4;
 const address=target.address;

 const result=await new Promise((resolve,reject)=>{
  let settled=false;
  const done=(fn,val)=>{if(settled)return;settled=true;cleanup();fn(val);};
  const req=(url.protocol==='https:'?https:http).request(url,{
   method:'GET',
   headers:{
    'User-Agent':'Mozilla/5.0 (compatible; PriceAgentResearch/1.0)',
    'Accept':'text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.5',
    'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding':'gzip, deflate, br'
   },
   lookup:(_host,options,cb)=>{
    if(options.all)cb(null,[{address,family}]);
    else cb(null,address,family);
   }
  },res=>{
   const status=res.statusCode||0;
   if([301,302,303,307,308].includes(status)&&res.headers.location){
    res.resume();
    done(resolve,{status,headers:res.headers,body:'',url:url.href});
    return;
   }
   const ctype=String(res.headers['content-type']||'').toLowerCase();
   if(BINARY_MIME_PREFIXES.some(prefix=>ctype.startsWith(prefix))){
    res.destroy();
    done(reject,new AppError('链接指向非网页二进制文件，已跳过正文读取'));
    return;
   }
   let size=0;
   const chunks=[];
   res.on('data',chunk=>{
    size+=chunk.length;
    if(size>maxBytes){
     req.destroy(new AppError('网页内容超过读取上限'));
     return;
    }
    chunks.push(chunk);
   });
   res.on('end',()=>{
    try{
     const rawBuf=Buffer.concat(chunks);
     const unpacked=decompressBuffer(rawBuf,res.headers['content-encoding'],maxBytes*3);
     const body=decodeHtmlBuffer(unpacked,ctype);
     done(resolve,{status,headers:res.headers,body,url:url.href});
    }catch(e){
     done(reject,e);
    }
   });
   res.on('error',err=>done(reject,err));
  });
  const onAbort=()=>req.destroy(new AppError('分析已取消'));
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  signal?.addEventListener('abort',onAbort,{once:true});
  req.setTimeout(timeout,()=>req.destroy(new AppError('网页读取超时')));
  req.on('error',err=>done(reject,err));
  req.end();
 });

 if([301,302,303,307,308].includes(result.status)&&result.headers.location){
  if(redirects<=0)throw new AppError('网页跳转次数过多');
  const nextUrl=new URL(result.headers.location,url).href;
  return publicFetch(nextUrl,{maxBytes,timeout,redirects:redirects-1,signal});
 }
 if(result.status<200||result.status>=300)throw new AppError('网页返回 HTTP '+result.status);
 return result;
}

function cleanSnippetHtml(raw){
 if(!raw)return '';
 const $=load('<div>'+String(raw)+'</div>');
 return $('div').text().replace(/\s+/g,' ').trim();
}

export async function readPage(url,signal){
 const r=await publicFetch(url,{signal});
 const $=load(r.body);
 const title=($('head > title').first().text()||$('meta[property="og:title"]').attr('content')||$('h1').first().text()||'').replace(/\s+/g,' ').trim();
 const metaDesc=($('meta[name="description"]').attr('content')||$('meta[property="og:description"]').attr('content')||'').replace(/\s+/g,' ').trim();
 const publishedAt=$('meta[property="article:published_time"]').attr('content')||$('meta[name="pubdate"]').attr('content')||$('meta[name="publishdate"]').attr('content')||$('meta[name="date"]').attr('content')||$('time[datetime]').first().attr('datetime')||null;
 $('script,style,nav,footer,header,noscript,svg,form,iframe,aside,dialog,[aria-hidden="true"]').remove();
 $('tr').each((_,tr)=>{
  const cells=[];
  $(tr).find('th,td').each((__,cell)=>{
   const t=$(cell).text().replace(/\s+/g,' ').trim();
   if(t)cells.push(t);
  });
  if(cells.length)$(tr).replaceWith('\n'+cells.join(' | ')+'\n');
 });
 $('br,p,div,li,h1,h2,h3,h4,section,article').each((_,el)=>{$(el).append('\n');});
 const rawMain=$('main,article,[role="main"]').first().text()||$('body').text()||'';
 const cleanedLines=rawMain.split('\n').map(l=>l.replace(/[ \t]+/g,' ').trim()).filter(Boolean);
 let bodyText=cleanedLines.join('\n');
 const shellPattern=/^(enable javascript|javascript is required|请开启\s*javascript|正在加载|安全验证|访问验证|403 forbidden|404 not found|access denied)/i;
 const thinContent=bodyText.length<120||shellPattern.test(bodyText.slice(0,120));
 if(thinContent&&metaDesc&&!bodyText.includes(metaDesc)){
  bodyText=metaDesc+(bodyText?'\n'+bodyText:'');
 }
 return {
  url:r.url,
  title:title||new URL(r.url).hostname,
  publishedAt,
  text:bodyText.slice(0,18000),
  thinContent
 };
}

async function searchTavily(q,signal){
 const timer=AbortSignal.timeout(16000);
 const combined=signal?AbortSignal.any([signal,timer]):timer;
 const r=await fetch('https://api.tavily.com/search',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:q,max_results:5,include_answer:false}),
  signal:combined
 });
 if(!r.ok)throw new AppError('Tavily 搜索返回 HTTP '+r.status);
 const j=await r.json();
 return (j.results||[]).map(x=>({title:String(x.title||'').trim(),url:String(x.url||'').trim(),snippet:cleanSnippetHtml(x.content||'')})).filter(x=>/^https?:\/\//.test(x.url));
}

async function searchSerper(q,signal){
 const timer=AbortSignal.timeout(16000);
 const combined=signal?AbortSignal.any([signal,timer]):timer;
 const r=await fetch('https://google.serper.dev/search',{
  method:'POST',
  headers:{'Content-Type':'application/json','X-API-KEY':process.env.SERPER_API_KEY},
  body:JSON.stringify({q,num:5}),
  signal:combined
 });
 if(!r.ok)throw new AppError('Serper 搜索返回 HTTP '+r.status);
 const j=await r.json();
 return (j.organic||[]).map(x=>({title:String(x.title||'').trim(),url:String(x.link||'').trim(),snippet:cleanSnippetHtml(x.snippet||''),publishedAt:x.date||null})).filter(x=>/^https?:\/\//.test(x.url));
}

async function searchSearxng(q,signal){
 const base=String(process.env.SEARXNG_BASE_URL||cfg.searxngUrl||'').trim().replace(/\/+$/,'');
 if(!base)throw new AppError('尚未配置 SEARXNG_BASE_URL');
 const endpoint=(base.endsWith('/search')?base:base+'/search')+'?q='+encodeURIComponent(q)+'&format=json';
 const timer=AbortSignal.timeout(16000);
 const combined=signal?AbortSignal.any([signal,timer]):timer;
 const r=await fetch(endpoint,{headers:{'Accept':'application/json'},signal:combined});
 if(!r.ok)throw new AppError('SearXNG 搜索返回 HTTP '+r.status);
 const j=await r.json();
 return (j.results||[]).slice(0,5).map(x=>({title:String(x.title||'').trim(),url:String(x.url||'').trim(),snippet:cleanSnippetHtml(x.content||''),publishedAt:x.publishedDate||null})).filter(x=>/^https?:\/\//.test(x.url));
}

async function searchBingRss(q,signal){
 const endpoints=[
  'https://www.bing.com/search?format=rss&q='+encodeURIComponent(q),
  'https://cn.bing.com/search?format=rss&q='+encodeURIComponent(q)
 ];
 let lastErr=null;
 for(const ep of endpoints){
  try{
   const r=await publicFetch(ep,{timeout:12000,signal});
   const j=new XMLParser().parse(r.body);
   const items=j?.rss?.channel?.item;
   if(!items)continue;
   const arr=(Array.isArray(items)?items:[items]).slice(0,5).map(x=>({
    title:cleanSnippetHtml(x.title||''),
    url:String(x.link||'').trim(),
    snippet:cleanSnippetHtml(x.description||''),
    publishedAt:x.pubDate||null
   })).filter(x=>/^https?:\/\//.test(x.url));
   if(arr.length)return arr;
  }catch(e){
   lastErr=e;
   if(signal?.aborted)throw e;
  }
 }
 throw lastErr||new AppError('公开搜索未返回可用结果');
}

export async function searchWeb(q,signal){
 const mode=String(process.env.SEARCH_PROVIDER||cfg.searchProvider||'auto').toLowerCase().trim();
 if(['none','off','disabled','false'].includes(mode))return [];
 const runners=[];
 if(mode==='tavily'){
  if(!process.env.TAVILY_API_KEY)throw new AppError('已指定 SEARCH_PROVIDER=tavily，但未配置 TAVILY_API_KEY');
  runners.push(()=>searchTavily(q,signal));
 }else if(mode==='serper'){
  if(!process.env.SERPER_API_KEY)throw new AppError('已指定 SEARCH_PROVIDER=serper，但未配置 SERPER_API_KEY');
  runners.push(()=>searchSerper(q,signal));
 }else if(mode==='searxng'){
  runners.push(()=>searchSearxng(q,signal));
 }else if(mode==='bing'){
  runners.push(()=>searchBingRss(q,signal));
 }else{
  if(process.env.TAVILY_API_KEY)runners.push(()=>searchTavily(q,signal));
  if(process.env.SERPER_API_KEY)runners.push(()=>searchSerper(q,signal));
  if(process.env.SEARXNG_BASE_URL||cfg.searxngUrl)runners.push(()=>searchSearxng(q,signal));
  runners.push(()=>searchBingRss(q,signal));
 }

 let lastErr=null;
 for(const run of runners){
  try{
   const items=await run();
   if(items.length)return items;
  }catch(e){
   if(signal?.aborted)throw new AppError('分析已取消');
   lastErr=e;
  }
 }
 if(lastErr)throw lastErr;
 return [];
}

function isOverseasContext(input){
 const country=String(input.country||'').trim();
 const hasCjkCustomer=/[\u4e00-\u9fff]/.test(String(input.customerName||''));
 if(country&&!/中国|大陆|国内|china|cn|香港|澳门|台湾/i.test(country)&&!hasCjkCustomer)return true;
 return input.language==='English'&&!hasCjkCustomer;
}

function resolvePeriodHint(researchPeriod){
 const year=new Date().getUTCFullYear();
 const p=String(researchPeriod||'');
 if(p.includes('1'))return `${year-1} ${year}`;
 if(p.includes('2'))return `${year-1} ${year}`;
 if(p.includes('3'))return `${year-2} ${year}`;
 return '';
}

function buildResearchQueries(input){
 const queries=[];
 const overseas=isOverseasContext(input);
 const periodHint=resolvePeriodHint(input.researchPeriod);
 const regionHint=input.researchRegions==='中国大陆'?'中国':(input.researchRegions==='客户所在市场优先'&&input.country?input.country:'');

 if(input.researchCompany&&input.customerName){
  const topics=Array.isArray(input.companyTopics)?input.companyTopics:[];
  if(overseas){
   const topicEn=[
    topics.some(t=>t.includes('产品'))?'products business':'',
    topics.some(t=>t.includes('规模'))?'revenue scale':'',
    topics.some(t=>t.includes('采购'))?'procurement vendor':''
   ].filter(Boolean).join(' ')||'official products business';
   queries.push({kind:'company',q:[input.customerName,input.country||'',input.industry||'',topicEn].filter(Boolean).join(' ').slice(0,120)});
  }else{
   const topicZh=[
    topics.some(t=>t.includes('产品'))?'主营业务 产品':'官网 业务',
    topics.some(t=>t.includes('规模'))?'规模 营收':'',
    topics.some(t=>t.includes('采购'))?'招标 采购 供应商':''
   ].filter(Boolean).join(' ');
   queries.push({kind:'company',q:[input.customerName,input.country||'',input.industry||'',topicZh].filter(Boolean).join(' ').slice(0,120)});
  }
 }

 if(input.researchCost){
  const types=Array.isArray(input.types)?input.types:[];
  const costTerms=[];
  if(input.researchKeywords)costTerms.push(input.researchKeywords);
  if(types.includes('model'))costTerms.push(input.modelHardware?`${input.modelHardware} 算力 推理 训练 价格`:'GPU 云服务器 模型训练 数据标注 价格');
  if(types.includes('license')&&input.licenseProduct)costTerms.push(`${input.licenseProduct} 授权 计费 价格`);
  if(!costTerms.length)costTerms.push(types.includes('software')?'企业软件定制开发 人日 成本 报价':'AI 算法方案 服务 定价 成本');
  queries.push({kind:'cost',q:(costTerms.join(' ')+(overseas?' official pricing':' 官方定价 成本')).slice(0,120)});
 }

 if(input.researchMarket){
  const baseKw=String(input.researchKeywords||input.licenseProduct||input.projectName||'').slice(0,70);
  const noteKw=String(input.researchNotes||'').slice(0,30);
  if(baseKw){
   const suffix=overseas?'contract award pricing tender':'中标 成交 采购公告 金额';
   queries.push({kind:'market',q:[baseKw,input.industry||'',regionHint,periodHint,noteKw,suffix].filter(Boolean).join(' ').slice(0,130)});
  }
 }
 return queries.slice(0,4);
}

function assessCredibility(source,input){
 if(source.kind==='grounding'||source.credibility==='high'){
  return {drop:false,credibility:'high',credibilityNote:source.credibilityNote||'实时联网检索核验来源',score:4.2};
 }
 let host='';
 try{host=new URL(source.url).hostname.toLowerCase();}catch{}
 const textSample=(String(source.title||'')+' '+String(source.text||'')).toLowerCase();
 if(/^(404\s*not\s*found|page\s*not\s*found|页面不存在|站点已关闭)/i.test(String(source.title||'').trim())&&String(source.text||'').length<80){
  return {drop:true};
 }
 let siteHost='';
 if(input.website){try{siteHost=new URL(input.website).hostname.toLowerCase().replace(/^www\./,'');}catch{}}
 const cleanHost=host.replace(/^www\./,'');

 let tier='medium',score=2,note='公开网页来源';
 if(source.kind==='specified'||(siteHost&&(cleanHost===siteHost||cleanHost.endsWith('.'+siteHost)))){
  tier='high';score=4;note='指定参考链接或客户官网';
 }else if(cleanHost.endsWith('.gov.cn')||cleanHost.endsWith('.gov')||cleanHost.endsWith('.edu.cn')||HIGH_TRUST_DOMAINS.some(d=>cleanHost===d||cleanHost.endsWith('.'+d))){
  tier='high';score=3.5;note='政府招投标平台或厂商官方渠道';
 }else if(LOW_TRUST_DOMAINS.some(d=>cleanHost===d||cleanHost.endsWith('.'+d))){
  tier='low';score=1;note='社区或自媒体转载，需交叉核实';
 }else if(source.access==='snippet'){
  tier='low';score=1.2;note='仅获取搜索摘要，未核验完整正文';
 }

 if(/(¥|￥|\brmb\b|\bcny\b|\busd\b|万元|元\/|中标金额|成交金额|预算金额)/i.test(textSample)){
  score+=0.8;
 }
 return {drop:false,credibility:tier,credibilityNote:note,score};
}

async function runGroundedAiResearch(input,queries,directUrls,aiOptions,signal,now){
 const wantSearch=Boolean(aiOptions.enableSearch)&&queries.length>0;
 const wantUrlCtx=Boolean(aiOptions.enableUrlContext)&&directUrls.length>0;
 if(!wantSearch&&!wantUrlCtx)return {sources:[],webSearchQueries:[],usedGrounding:false};

 const model=String(aiOptions.model||cfg.model||'').trim();
 if(isImageGenerationModel(model))return {sources:[],webSearchQueries:[],usedGrounding:false};
 const hasAiConf=Boolean(cfg.aiConfigured||process.env.VERTEX_BASE_URL||process.env.AI_BASE_URL||process.env.OPENAI_BASE_URL);
 if(!hasAiConf)return {sources:[],webSearchQueries:[],usedGrounding:false};

 const supLevels=getSupportedThinkingLevels(model);
 const fastLevel=supLevels.includes('LOW')?'LOW':'AUTO';

 const tasks=[];
 if(wantSearch){
  for(const q of queries){
   tasks.push(`- [${q.kind}] 检索主题：${q.q}`);
  }
 }
 if(wantUrlCtx){
  tasks.push(`- [specified] 直接读取并提取以下指定链接中的公开业务与价格信息：\n`+directUrls.map(d=>'  '+d.url).join('\n'));
 }

 const prompt=[
  '你是企业售前市场与价格情报调研员。请利用实时联网搜索与链接读取能力核查以下调研项，并严格输出单个 JSON 对象（严禁 Markdown 代码块、严禁任何 Emoji、严禁编造不存在的链接或价格）：',
  ...tasks,
  `项目背景：项目「${input.projectName||''}」，客户「${input.customerName||''}」，行业「${input.industry||''}」，目标区域「${input.researchRegions||input.country||''}」，时间范围「${input.researchPeriod||'近 2 年'}」。`,
  '输出 JSON 格式：{"findings":[{"kind":"company|cost|market|specified","url":"真实来源URL（未知留空）","title":"来源标题","summary":"客观提取的业务事实、公开标价或中标成交金额与范围摘要（中文，100-400字）","publishedAt":"YYYY-MM-DD或空"}]}'
 ].join('\n');

 try{
  const res=await chat([{role:'user',content:prompt}],{
   signal,
   json:true,
   model,
   thinkingLevel:fastLevel,
   enableSearch:wantSearch,
   enableUrlContext:Boolean(aiOptions.enableUrlContext)
  });

  const gm=res.groundingMetadata;
  const webSearchQueries=gm?.webSearchQueries||[];
  const groundedSources=gm?.sources||[];
  const findings=Array.isArray(res.data?.findings)?res.data.findings:[];

  const outSources=[];
  const seenUrl=new Set();

  for(const gs of groundedSources){
   const uri=String(gs.uri||'').trim();
   if(!/^https?:\/\//i.test(uri)||seenUrl.has(uri))continue;
   seenUrl.add(uri);
   const matchedFinding=findings.find(f=>f?.url&&(uri.includes(f.url)||f.url.includes(uri)))||findings.find(f=>f?.title&&gs.title&&(f.title.includes(gs.title)||gs.title.includes(f.title)));
   const summaryText=matchedFinding?.summary?String(matchedFinding.summary).trim():'';
   const allFindingText=findings.map(f=>f?.summary?`[${f.kind||'info'}] ${f.title?f.title+'：':''}${f.summary}`:'').filter(Boolean).join('\n');
   outSources.push({
    kind:matchedFinding?.kind||'grounding',
    title:String(gs.title||matchedFinding?.title||new URL(uri).hostname).trim(),
    url:uri,
    publishedAt:matchedFinding?.publishedAt||null,
    text:(summaryText||allFindingText||`实时联网检索核验来源：${gs.title||uri}`).slice(0,8000),
    credibility:'high',
    credibilityNote:'实时联网检索核验来源',
    retrievedAt:now,
    access:'page'
   });
  }

  if(wantUrlCtx){
   for(const d of directUrls){
    if(seenUrl.has(d.url))continue;
    const matched=findings.find(f=>f?.url&&(f.url===d.url||d.url.includes(f.url)||f.url.includes(d.url)));
    if(matched?.summary){
     seenUrl.add(d.url);
     outSources.push({
      kind:d.kind,
      title:String(matched.title||new URL(d.url).hostname).trim(),
      url:d.url,
      publishedAt:matched.publishedAt||null,
      text:String(matched.summary).trim().slice(0,8000),
      credibility:'high',
      credibilityNote:'链接内容读取核验来源',
      retrievedAt:now,
      access:'page'
     });
    }
   }
  }

  return {
   sources:outSources,
   webSearchQueries,
   usedGrounding:outSources.length>0||webSearchQueries.length>0
  };
 }catch(err){
  if(signal?.aborted)throw err;
  return {sources:[],webSearchQueries:[],usedGrounding:false};
 }
}

export async function collectResearch(input,onStage,signal,aiOptions={}){
 const warnings=[],now=new Date().toISOString();
 const enableSearch=aiOptions.enableSearch!==undefined?Boolean(aiOptions.enableSearch):(cfg.enableSearch??true);
 const enableUrlContext=aiOptions.enableUrlContext!==undefined?Boolean(aiOptions.enableUrlContext):(cfg.enableUrlContext??true);

 const searchMode=String(process.env.SEARCH_PROVIDER||cfg.searchProvider||'auto').toLowerCase().trim();
 const envSearchDisabled=['none','off','disabled','false'].includes(searchMode);
 const queries=(enableSearch&&!envSearchDisabled)?buildResearchQueries(input):[];

 const directUrls=enableUrlContext?[
  ...(input.researchCompany&&input.website&&/^https?:\/\//.test(String(input.website).trim())?[{kind:'company',url:String(input.website).trim()}]:[]),
  ...String(input.sourceLinks||'').split(/\s+/).map(s=>s.trim()).filter(x=>/^https?:\/\//.test(x)).slice(0,5).map(url=>({kind:'specified',url}))
 ]:[];

 if(!enableSearch&&(input.researchCompany||input.researchCost||input.researchMarket)){
  warnings.push('本次已关闭实时联网检索开关，将基于项目资料、产品库与内部价格参考库测算');
 }else if(envSearchDisabled&&(input.researchCompany||input.researchCost||input.researchMarket)){
  warnings.push('已关闭外部网页检索（SEARCH_PROVIDER='+searchMode+'），本次仅使用指定链接与内部参考库');
 }

 const grounded=await runGroundedAiResearch(input,queries,directUrls,{...aiOptions,enableSearch:enableSearch&&!envSearchDisabled,enableUrlContext},signal,now);
 const webSearchQueries=[...(grounded.webSearchQueries||[])];
 const rawSources=[...(grounded.sources||[])];
 const coveredUrls=new Set(rawSources.map(s=>s.url));

 const hasExplicitSearchKey=Boolean(process.env.TAVILY_API_KEY||process.env.SERPER_API_KEY||process.env.SEARXNG_BASE_URL||cfg.searxngUrl);
 const shouldRunFallbackWebSearch=queries.length>0&&(!grounded.usedGrounding||hasExplicitSearchKey);

 const directToFetch=directUrls.filter(d=>!coveredUrls.has(d.url));

 if(shouldRunFallbackWebSearch){
  const settled=await Promise.allSettled(queries.map(async query=>({...query,results:await searchWeb(query.q,signal)})));
  if(signal?.aborted)throw new AppError('分析已取消');
  let failedCount=0;
  settled.forEach((r,i)=>{
   if(r.status==='rejected'){
    failedCount++;
    if(!grounded.usedGrounding){
     const label=queries[i].kind==='company'?'客户信息':queries[i].kind==='cost'?'成本定价':'同类项目';
     warnings.push(`${label}检索未完成：${cleanError(r.reason)}`);
    }
   }else{
    for(const item of (r.value.results||[]).slice(0,4)){
     directToFetch.push({...item,kind:r.value.kind,query:r.value.q});
    }
   }
  });
  if(!grounded.usedGrounding&&failedCount===queries.length&&queries.length>1){
   warnings.splice(0,warnings.length,'当前环境无法连接公开搜索引擎，本次已自动降级为基于项目资料、产品库与内部价格参考库测算');
  }
 }

 const uniqueMap=new Map();
 for(const item of directToFetch){
  try{
   const normalizedUrl=new URL(item.url).href;
   if(!coveredUrls.has(normalizedUrl)&&!uniqueMap.has(normalizedUrl)){
    uniqueMap.set(normalizedUrl,{...item,url:normalizedUrl});
   }
  }catch{}
 }
 const unique=[...uniqueMap.values()].slice(0,Math.max(0,12-rawSources.length));

 if(unique.length)await onStage('读取并核验公开来源',32);
 for(let i=0;i<unique.length;i+=3){
  if(signal?.aborted)throw new AppError('分析已取消');
  const batch=await Promise.all(unique.slice(i,i+3).map(async x=>{
   try{
    const page=await readPage(x.url,signal);
    if(page.thinContent&&x.snippet){
     const combinedText=`[搜索摘要] ${x.snippet}`+(page.text?`\n[页面摘录] ${page.text}`:'');
     return {...x,url:page.url,title:page.title||x.title,publishedAt:page.publishedAt||x.publishedAt||null,text:combinedText.slice(0,18000),retrievedAt:now,access:'snippet',warning:'网页正文受动态渲染或权限限制，已结合搜索摘要保留'};
    }
    const enrichedText=x.snippet&&!page.text.slice(0,400).includes(x.snippet.slice(0,40))?`摘要：${x.snippet}\n${page.text}`:page.text;
    return {...x,...page,text:enrichedText.slice(0,18000),retrievedAt:now,access:'page'};
   }catch(e){
    if(signal?.aborted)throw e;
    if(x.snippet){
     return {...x,text:x.snippet,retrievedAt:now,access:'snippet',warning:'仅获取搜索摘要，正文未验证'};
    }
    warnings.push(`${x.title||x.url}：${cleanError(e)}`);
    return null;
   }
  }));
  for(const item of batch)if(item)rawSources.push(item);
 }

 const evaluated=[];
 for(const s of rawSources){
  const meta=assessCredibility(s,input);
  if(meta.drop)continue;
  evaluated.push({...s,credibility:meta.credibility,credibilityNote:meta.credibilityNote,_score:meta.score});
 }
 evaluated.sort((a,b)=>b._score-a._score);
 const sources=evaluated.slice(0,14).map(({_score,thinContent,...rest},idx)=>({...rest,id:'src-'+(idx+1)}));

 let fx=null;
 if(input.researchFX&&input.currency&&input.currency!=='CNY'){
  const targetCurrency=String(input.currency).toUpperCase();
  const fxProviders=[
   {
    name:'ExchangeRate-API',
    url:'https://open.er-api.com/v6/latest/CNY',
    extract:j=>({rate:Number(j?.rates?.[targetCurrency]),date:j?.time_last_update_utc?new Date(j.time_last_update_utc).toISOString().slice(0,10):null})
   },
   {
    name:'Frankfurter (ECB)',
    url:'https://api.frankfurter.app/latest?from=CNY&to='+encodeURIComponent(targetCurrency),
    extract:j=>({rate:Number(j?.rates?.[targetCurrency]),date:j?.date?String(j.date).slice(0,10):null})
   },
   {
    name:'FloatRates',
    url:'https://www.floatrates.com/daily/cny.json',
    extract:j=>{
     const entry=j?.[targetCurrency.toLowerCase()];
     return {rate:Number(entry?.rate),date:entry?.date?new Date(entry.date).toISOString().slice(0,10):null};
    }
   }
  ];
  for(const p of fxProviders){
   if(signal?.aborted)throw new AppError('分析已取消');
   try{
    const r=await publicFetch(p.url,{timeout:9000,signal});
    const j=JSON.parse(r.body);
    const {rate,date}=p.extract(j);
    if(Number.isFinite(rate)&&rate>0&&date){
     fx={base:'CNY',quote:targetCurrency,rate,date,source:p.url,provider:p.name};
     break;
    }
   }catch(e){
    if(signal?.aborted)throw new AppError('分析已取消');
   }
  }
  if(!fx)warnings.push('参考汇率暂不可用，生成外币报价草稿时请手动填写汇率');
 }

 return {sources,queries,webSearchQueries,fx,warnings,retrievedAt:now};
}

import {cfg,AppError,cleanError} from './config.mjs';

const DEFAULT_TIMEOUT_MS=240_000;
const MODELS_CACHE_TTL_MS=5*60_000;
const RETRYABLE_STATUS=new Set([408,429,500,502,503,504,529]);

export const THINKING_LEVELS=['AUTO','MINIMAL','LOW','MEDIUM','HIGH','XHIGH','NONE'];

let modelsCache={key:'',expiresAt:0,models:null};

export function isImageGenerationModel(modelId){
 const m=String(modelId||'').trim().toLowerCase();
 return Boolean(m)&&(/(-image|imagen)/i.test(m));
}

function stripThinkingSuffix(modelId){
 return String(modelId||'').trim().toLowerCase().replace(/-(minimal|low|medium|high|xhigh|none)$/i,'');
}

export function getSupportedThinkingLevels(modelId){
 if(isImageGenerationModel(modelId))return ['NONE'];
 const base=stripThinkingSuffix(modelId);
 if(/^gemini-4(?:-|$)/.test(base)){
  return ['AUTO','LOW','MEDIUM','HIGH','XHIGH'];
 }
 if(/^gemini-(?:3\.8|3\.7)(?:-|$)/.test(base)||/^gemini-3\.1-pro/.test(base)){
  return ['AUTO','LOW','MEDIUM','HIGH'];
 }
 if(/^gemini-(?:3\.5|3\.6)(?:-|$)/.test(base)||/^gemini-3\.1-flash-lite/.test(base)){
  return ['AUTO','MINIMAL','LOW','MEDIUM','HIGH'];
 }
 if(/^gemini-2\.5(?:-|$)/.test(base)){
  return ['AUTO','MINIMAL','LOW','MEDIUM','HIGH','XHIGH','NONE'];
 }
 return ['AUTO','MINIMAL','LOW','MEDIUM','HIGH','XHIGH','NONE'];
}

export function normalizeThinkingLevel(level,modelId=''){
 if(isImageGenerationModel(modelId))return 'NONE';
 const raw=String(level??'').trim().toUpperCase();
 if(!raw||!THINKING_LEVELS.includes(raw))return 'AUTO';
 if(!modelId)return raw;
 const supported=getSupportedThinkingLevels(modelId);
 if(supported.includes(raw))return raw;
 return supported.includes('AUTO')?'AUTO':(supported[0]||'AUTO');
}

function isLocalOrPrivateHost(hostname){
 const h=String(hostname||'').toLowerCase().replace(/^\[|\]$/g,'');
 if(!h)return false;
 if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='0.0.0.0'||h==='host.docker.internal'||h.endsWith('.local')||h.endsWith('.internal'))return true;
 const parts=h.split('.').map(Number);
 if(parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
  if(parts[0]===10||parts[0]===127)return true;
  if(parts[0]===192&&parts[1]===168)return true;
  if(parts[0]===172&&parts[1]>=16&&parts[1]<=31)return true;
 }
 return false;
}

function resolveAiConnection({allowUnconfigured=false}={}){
 const rawUrl=String(process.env.VERTEX_BASE_URL||process.env.AI_BASE_URL||process.env.OPENAI_BASE_URL||cfg.aiBaseUrl||cfg.vertexUrl||'').trim();
 const apiKey=String(process.env.VERTEX_API_KEY??process.env.AI_API_KEY??process.env.OPENAI_API_KEY??cfg.aiApiKey??cfg.vertexKey??'').trim();
 const defaultModel=String(process.env.VERTEX_MODEL||process.env.AI_MODEL||process.env.OPENAI_MODEL||cfg.model||'gemini-3.8-flash').trim();
 const defaultThinkingLevel=normalizeThinkingLevel(process.env.VERTEX_THINKING_LEVEL||process.env.AI_THINKING_LEVEL||cfg.thinkingLevel||'AUTO',defaultModel);
 const envMax=Number(process.env.AI_MAX_TOKENS);
 const configuredMaxTokens=Number.isInteger(envMax)&&envMax>=256&&envMax<=131072?envMax:null;
 const envTimeout=Number(process.env.AI_TIMEOUT_MS);
 const timeoutMs=Number.isFinite(envTimeout)&&envTimeout>=5000&&envTimeout<=600_000?envTimeout:DEFAULT_TIMEOUT_MS;

 if(!rawUrl){
  if(allowUnconfigured)return {configured:false,v1Base:'',chatEndpoint:'',modelsEndpoint:'',apiKey:'',defaultModel,defaultThinkingLevel,configuredMaxTokens,timeoutMs,error:'尚未配置 AI 服务地址'};
  throw new AppError('尚未配置 AI 服务地址，请在环境变量中设置 AI_BASE_URL 与 AI_API_KEY（未配置 AI 时也可直接手动创建报价草稿）',503);
 }
 let urlObj;
 try{
  urlObj=new URL(rawUrl);
 }catch{
  if(allowUnconfigured)return {configured:false,v1Base:'',chatEndpoint:'',modelsEndpoint:'',apiKey:'',defaultModel,defaultThinkingLevel,configuredMaxTokens,timeoutMs,error:'AI 服务地址格式不正确'};
  throw new AppError('AI 服务地址格式不正确，请检查 AI_BASE_URL（需以 http:// 或 https:// 开头）',503);
 }
 if(!['http:','https:'].includes(urlObj.protocol)){
  if(allowUnconfigured)return {configured:false,v1Base:'',chatEndpoint:'',modelsEndpoint:'',apiKey:'',defaultModel,defaultThinkingLevel,configuredMaxTokens,timeoutMs,error:'AI 服务地址仅支持 HTTP 或 HTTPS 协议'};
  throw new AppError('AI 服务地址仅支持 HTTP 或 HTTPS 协议',503);
 }
 const allowKeyless=isLocalOrPrivateHost(urlObj.hostname);
 if(!apiKey&&!allowKeyless){
  if(allowUnconfigured)return {configured:false,v1Base:'',chatEndpoint:'',modelsEndpoint:'',apiKey:'',defaultModel,defaultThinkingLevel,configuredMaxTokens,timeoutMs,error:'尚未配置 AI 接口密钥'};
  throw new AppError('尚未配置 AI 接口密钥，请在环境变量中设置 AI_API_KEY（本地服务可使用本地或内网地址免密钥调用）',503);
 }

 let basePath=urlObj.pathname.replace(/\/+$/,'');
 if(basePath.endsWith('/chat/completions'))basePath=basePath.slice(0,-'/chat/completions'.length);
 else if(basePath.endsWith('/models'))basePath=basePath.slice(0,-'/models'.length);
 if(!basePath)basePath='/v1';

 urlObj.pathname=basePath;
 urlObj.search='';
 urlObj.hash='';
 const v1Base=urlObj.toString().replace(/\/+$/,'');

 return {
  configured:true,
  v1Base,
  chatEndpoint:v1Base+'/chat/completions',
  modelsEndpoint:v1Base+'/models',
  apiKey,
  defaultModel,
  defaultThinkingLevel,
  configuredMaxTokens,
  timeoutMs
 };
}

function redactSecrets(text){
 return cleanError(String(text||'')).replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi,'$1[redacted]').replace(/\b(tvly|AIza|gsk_|xai-|rk-|pk-)[A-Za-z0-9_\-]+/g,'[redacted]').slice(0,360);
}

function extractErrorDetail(rawBody){
 if(!rawBody)return '';
 try{
  const parsed=JSON.parse(rawBody);
  const msg=parsed?.error?.message||parsed?.message||parsed?.detail||(typeof parsed?.error==='string'?parsed.error:'');
  if(msg)return redactSecrets(msg);
 }catch{}
 return redactSecrets(rawBody.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
}

export async function listModels({refresh=false,id=null,signal}={}){
 const conn=resolveAiConnection({allowUnconfigured:true});
 if(!conn.configured){
  return {
   configured:false,
   models:[],
   defaultModel:conn.defaultModel,
   thinkingLevels:THINKING_LEVELS,
   error:conn.error||'尚未配置 AI 服务连接'
  };
 }

 const cacheKey=conn.v1Base;
 const forceRefresh=refresh===true||refresh==='true'||refresh==='1';
 const targetId=id?String(id).trim():'';

 if(!forceRefresh&&!targetId&&modelsCache.models&&modelsCache.key===cacheKey&&Date.now()<modelsCache.expiresAt){
  return {
   configured:true,
   models:modelsCache.models,
   defaultModel:conn.defaultModel,
   thinkingLevels:THINKING_LEVELS
  };
 }

 const reqUrl=new URL(conn.modelsEndpoint);
 if(forceRefresh)reqUrl.searchParams.set('refresh','true');
 if(targetId)reqUrl.searchParams.set('id',targetId);

 const headers={'Accept':'application/json'};
 if(conn.apiKey)headers.Authorization='Bearer '+conn.apiKey;

 const timeoutSignal=AbortSignal.timeout(20_000);
 const combined=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;

 let res;
 try{
  res=await fetch(reqUrl.toString(),{method:'GET',headers,signal:combined});
 }catch(err){
  if(timeoutSignal.aborted||err?.name==='TimeoutError'){
   throw new AppError('拉取模型列表超时，请检查 AI 服务连接状态',504);
  }
  throw new AppError('无法连接模型列表接口（'+redactSecrets(err?.cause?.code||err?.message||'连接失败')+'）',502);
 }

 if(!res.ok){
  const rawBody=await res.text().catch(()=>'');
  const detail=extractErrorDetail(rawBody);
  throw mapProviderHttpError(res.status,detail);
 }

 let payload;
 try{
  payload=await res.json();
 }catch{
  throw new AppError('模型列表接口返回了非 JSON 响应，请检查服务地址配置',502);
 }

 const rawItems=Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:(payload?.id?[payload]:[]);
 const seen=new Set();
 const models=[];
 for(const item of rawItems){
  const mid=String(item?.id||'').trim();
  if(!mid||seen.has(mid))continue;
  seen.add(mid);
  models.push({
   id:mid,
   object:item?.object||'model',
   created:typeof item?.created==='number'?item.created:null,
   ownedBy:String(item?.owned_by||item?.ownedBy||'openai-compatible'),
   supportedThinkingLevels:getSupportedThinkingLevels(mid),
   isImageModel:isImageGenerationModel(mid)
  });
 }

 if(!targetId){
  modelsCache={key:cacheKey,expiresAt:Date.now()+MODELS_CACHE_TTL_MS,models};
 }

 return {
  configured:true,
  models,
  defaultModel:conn.defaultModel,
  thinkingLevels:THINKING_LEVELS
 };
}

function normalizeMessages(messages){
 return (messages||[]).map(msg=>{
  if(!Array.isArray(msg?.content))return msg;
  const hasImage=msg.content.some(part=>part&&part.type==='image_url');
  if(hasImage)return msg;
  const joined=msg.content.map(part=>typeof part==='string'?part:(part?.text||'')).filter(Boolean).join('\n');
  return {...msg,content:joined};
 });
}

function stripThinking(text){
 let out=String(text||'').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'').trim();
 if(/^<think\b[^>]*>/i.test(out)){
  const braceIdx=out.indexOf('{');
  if(braceIdx>0)out=out.slice(braceIdx).trim();
  else out=out.replace(/^<think\b[^>]*>/i,'').trim();
 }
 return out;
}

function findBalancedJsonCandidates(str){
 const candidates=[];
 let depth=0,start=-1,inString=false,escaped=false;
 for(let i=0;i<str.length;i++){
  const ch=str[i];
  if(inString){
   if(escaped)escaped=false;
   else if(ch==='\\')escaped=true;
   else if(ch==='"')inString=false;
   continue;
  }
  if(ch==='"'){inString=true;continue;}
  if(ch==='{'){
   if(depth===0)start=i;
   depth++;
  }else if(ch==='}'&&depth>0){
   depth--;
   if(depth===0&&start>=0){
    candidates.push(str.slice(start,i+1));
    start=-1;
   }
  }
 }
 return candidates;
}

function repairJsonCandidate(raw){
 let out='',inString=false,escaped=false;
 for(let i=0;i<raw.length;i++){
  const ch=raw[i];
  if(inString){
   if(escaped){out+=ch;escaped=false;continue;}
   if(ch==='\\'){out+=ch;escaped=true;continue;}
   if(ch==='"'){out+=ch;inString=false;continue;}
   const code=ch.charCodeAt(0);
   if(ch==='\n'){out+='\\n';continue;}
   if(ch==='\r'){out+='\\r';continue;}
   if(ch==='\t'){out+='\\t';continue;}
   if(code<0x20){out+=' ';continue;}
   out+=ch;
   continue;
  }
  if(ch==='"'){inString=true;out+=ch;continue;}
  if(ch==='/'&&raw[i+1]==='/'){
   while(i<raw.length&&raw[i]!=='\n')i++;
   out+='\n';
   continue;
  }
  if(ch==='/'&&raw[i+1]==='*'){
   i+=2;
   while(i<raw.length&&!(raw[i]==='*'&&raw[i+1]==='/'))i++;
   i++;
   continue;
  }
  out+=ch;
 }
 let cleaned='',inStr2=false,esc2=false;
 for(let i=0;i<out.length;i++){
  const ch=out[i];
  if(inStr2){
   cleaned+=ch;
   if(esc2)esc2=false;
   else if(ch==='\\')esc2=true;
   else if(ch==='"')inStr2=false;
   continue;
  }
  if(ch==='"'){inStr2=true;cleaned+=ch;continue;}
  if(ch===','){
   let j=i+1;
   while(j<out.length&&/\s/.test(out[j]))j++;
   if(out[j]==='}'||out[j]==='\]')continue;
  }
  cleaned+=ch;
 }
 return cleaned;
}

export function extractJsonObject(rawContent){
 const stripped=stripThinking(rawContent);
 const pool=[];
 const fenceRegex=/```(?:json)?\s*([\s\S]*?)```/gi;
 let match;
 while((match=fenceRegex.exec(stripped))!==null){
  if(match[1]?.trim())pool.push(match[1].trim());
 }
 pool.push(stripped.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim());
 for(const block of pool){
  const candidates=findBalancedJsonCandidates(block);
  const ordered=candidates.length?[...candidates].sort((a,b)=>b.length-a.length):[];
  const firstBrace=block.indexOf('{'),lastBrace=block.lastIndexOf('}');
  if(firstBrace>=0&&lastBrace>firstBrace){
   const span=block.slice(firstBrace,lastBrace+1);
   if(!ordered.includes(span))ordered.push(span);
  }
  for(const cand of ordered){
   try{
    const parsed=JSON.parse(cand);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;
   }catch{}
   try{
    const parsed=JSON.parse(repairJsonCandidate(cand));
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;
   }catch{}
  }
 }
 throw new AppError('AI 返回格式无法解析，请重新分析或切换指令遵循更稳定的模型',502);
}

function normalizeGroundingMetadata(raw,urlContextRaw=null){
 if(!raw&&!urlContextRaw)return null;
 const rawQueries=raw?.web_search_queries||raw?.webSearchQueries||[];
 const webSearchQueries=[...new Set((Array.isArray(rawQueries)?rawQueries:[]).map(q=>String(q||'').trim()).filter(Boolean))];

 const seenUris=new Set();
 const sources=[];
 const pushSource=(title,uri)=>{
  const u=String(uri||'').trim();
  if(!/^https?:\/\//i.test(u)||seenUris.has(u))return;
  seenUris.add(u);
  let fallbackHost=u;
  try{fallbackHost=new URL(u).hostname;}catch{}
  sources.push({title:String(title||'').trim()||fallbackHost,uri:u});
 };

 if(Array.isArray(raw?.sources)){
  for(const s of raw.sources)pushSource(s?.title,s?.uri||s?.url);
 }
 const chunks=raw?.groundingChunks||raw?.grounding_chunks;
 if(Array.isArray(chunks)){
  for(const ch of chunks)if(ch?.web)pushSource(ch.web.title,ch.web.uri||ch.web.url);
 }
 const urlMetaList=urlContextRaw?.url_metadata||urlContextRaw?.urlMetadata||raw?.url_metadata||[];
 if(Array.isArray(urlMetaList)){
  for(const um of urlMetaList){
   const retrieved=um?.retrieved_url||um?.retrievedUrl;
   if(retrieved)pushSource(um?.title||'',retrieved);
  }
 }

 if(!webSearchQueries.length&&!sources.length)return null;
 return {webSearchQueries,web_search_queries:webSearchQueries,sources};
}

function sleepWithSignal(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new AppError('分析已取消',499));return;}
  const timer=setTimeout(()=>{cleanup();resolve();},ms);
  const onAbort=()=>{cleanup();reject(new AppError('分析已取消',499));};
  const cleanup=()=>signal?.removeEventListener('abort',onAbort);
  signal?.addEventListener('abort',onAbort,{once:true});
 });
}

function isVisionUnsupportedError(status,detail){
 if(![400,415,422].includes(status))return false;
 return /image_url|vision|multimodal|image input|does not support image|unsupported content|expected string/i.test(detail);
}

function mapProviderHttpError(status,detail){
 const lower=detail.toLowerCase();
 if(isVisionUnsupportedError(status,detail)){
  const err=new AppError('当前 AI 模型不支持直接识别图片附件',400);
  err.visionUnsupported=true;
  return err;
 }
 if(status===401||status===403){
  return new AppError('AI 服务鉴权失败（HTTP '+status+'），请检查 AI_API_KEY 是否正确及模型访问权限',502);
 }
 if(status===404){
  return new AppError('AI 接口地址或模型不存在（HTTP 404），请检查服务地址与所选模型名称'+(detail?'：'+detail:''),502);
 }
 if(status===429){
  return new AppError('AI 服务触发限流或配额不足（HTTP 429），请稍后重试或检查账户额度',502);
 }
 if(/context_length|maximum context|too many tokens|prompt is too long|input length|token limit/i.test(lower)){
  return new AppError('输入内容超出当前 AI 模型的上下文长度上限，请精简附件或切换长上下文模型',502);
 }
 if(status===400||status===422){
  return new AppError('AI 服务拒绝了本次请求参数（HTTP '+status+'）'+(detail?'：'+detail:''),502);
 }
 return new AppError('AI 服务暂时不可用（HTTP '+status+'）'+(detail?'：'+detail:''),502);
}

export async function chat(messagesOrOpts,maybeOpts={}){
 let messages,opts;
 if(Array.isArray(messagesOrOpts)){
  messages=messagesOrOpts;
  opts=maybeOpts||{};
 }else if(messagesOrOpts&&typeof messagesOrOpts==='object'){
  messages=messagesOrOpts.messages||[];
  opts=messagesOrOpts;
 }else{
  throw new AppError('AI 请求消息格式不正确',400);
 }

 const startedAt=Date.now();
 const conn=resolveAiConnection();
 const signal=opts.signal;
 const json=Boolean(opts.json);
 const selectedModel=String(opts.model||conn.defaultModel).trim();
 const isImage=isImageGenerationModel(selectedModel);

 const explicitThinkingProvided=opts.thinkingLevel!==undefined||opts.thinking_level!==undefined;
 const requestedThinking=explicitThinkingProvided?(opts.thinkingLevel??opts.thinking_level):conn.defaultThinkingLevel;
 let effectiveThinkingLevel=normalizeThinkingLevel(requestedThinking,selectedModel);

 const callerMaxTokens=opts.maxTokens??opts.max_tokens;
 const isShortProbe=!json&&callerMaxTokens!==undefined&&Number(callerMaxTokens)<=256;
 if(isShortProbe&&!explicitThinkingProvided&&!isImage){
  const sup=getSupportedThinkingLevels(selectedModel);
  if(sup.includes('LOW'))effectiveThinkingLevel='LOW';
 }

 let sendThinkingParams=!isImage;
 let enableSearch=!isImage&&Boolean(opts.enableSearch??opts.enable_search??false);
 let enableUrlContext=!isImage&&Boolean(opts.enableUrlContext??opts.enable_url_context??false);
 let enableCodeExecution=!isImage&&Boolean(opts.enableCodeExecution??opts.enable_code_execution??false);
 const includeThoughts=!isImage&&effectiveThinkingLevel!=='NONE'&&Boolean(opts.includeThoughts??opts.include_thoughts??false);
 const mediaResolution=opts.mediaResolution||opts.media_resolution||'';

 const normalizedMessages=normalizeMessages(messages);
 const hasImages=normalizedMessages.some(m=>Array.isArray(m?.content)&&m.content.some(p=>p?.type==='image_url'));

 const thinkingActive=!isImage&&effectiveThinkingLevel!=='NONE';
 const defaultTemp=(thinkingActive||enableSearch||enableUrlContext||/^gemini-[34]/i.test(selectedModel))?1.0:0.2;
 const temperature=opts.temperature!==undefined?opts.temperature:defaultTemp;
 let includeTemperature=temperature!==undefined&&temperature!==null;

 let effectiveMaxTokens=null;
 let tokenParam='omit';
 if(callerMaxTokens!==undefined&&callerMaxTokens!==null&&Number(callerMaxTokens)>0){
  const rawMax=Math.floor(Number(callerMaxTokens));
  if(thinkingActive&&rawMax<16384){
   tokenParam='omit';
  }else{
   effectiveMaxTokens=rawMax;
   tokenParam='max_tokens';
  }
 }else if(conn.configuredMaxTokens){
  effectiveMaxTokens=conn.configuredMaxTokens;
  tokenParam='max_tokens';
 }

 let useResponseFormat=Boolean(json)&&!hasImages&&!enableSearch&&!enableUrlContext;
 let compatAdjustments=0;
 let retryAttempt=0;
 const maxRetries=2;

 while(true){
  if(signal?.aborted)throw new AppError('分析已取消',499);
  const timeoutSignal=AbortSignal.timeout(conn.timeoutMs);
  const combined=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;

  const body={model:selectedModel,messages:normalizedMessages,stream:false};
  if(includeTemperature)body.temperature=temperature;
  if(tokenParam==='max_tokens'&&effectiveMaxTokens)body.max_tokens=effectiveMaxTokens;
  else if(tokenParam==='max_completion_tokens'&&effectiveMaxTokens)body.max_completion_tokens=effectiveMaxTokens;

  if(sendThinkingParams){
   if(effectiveThinkingLevel&&effectiveThinkingLevel!=='AUTO'){
    body.thinking_level=effectiveThinkingLevel;
   }
   if(includeThoughts){
    body.include_thoughts=true;
   }
  }
  if(enableSearch)body.enable_search=true;
  if(enableUrlContext)body.enable_url_context=true;
  if(enableCodeExecution)body.enable_code_execution=true;
  if(mediaResolution)body.media_resolution=mediaResolution;
  if(useResponseFormat)body.response_format={type:'json_object'};

  const headers={'Content-Type':'application/json'};
  if(conn.apiKey)headers.Authorization='Bearer '+conn.apiKey;

  let res;
  try{
   res=await fetch(conn.chatEndpoint,{method:'POST',headers,body:JSON.stringify(body),signal:combined});
  }catch(err){
   if(signal?.aborted)throw new AppError('分析已取消',499);
   if(timeoutSignal.aborted||err?.name==='TimeoutError'){
    throw new AppError('AI 服务响应超时，请稍后重试、调低思考强度档位或精简附件内容',504);
   }
   if(retryAttempt<maxRetries){
    retryAttempt++;
    await sleepWithSignal(1000*retryAttempt+Math.floor(Math.random()*400),signal);
    continue;
   }
   throw new AppError('无法连接 AI 服务，请检查 AI_BASE_URL 网络连接或服务状态（'+redactSecrets(err?.cause?.code||err?.message||'连接失败')+'）',502);
  }

  if(!res.ok){
   const rawBody=await res.text().catch(()=>'');
   const detail=extractErrorDetail(rawBody);
   const lower=detail.toLowerCase();

   if((res.status===400||res.status===422)&&compatAdjustments<6&&!isVisionUnsupportedError(res.status,detail)&&!/context_length|maximum context|too many tokens|prompt is too long/i.test(lower)){
    if(useResponseFormat){
     useResponseFormat=false;compatAdjustments++;continue;
    }
    if(sendThinkingParams&&/thinking_level|include_thoughts|thinking/i.test(lower)){
     sendThinkingParams=false;compatAdjustments++;continue;
    }
    if((enableSearch||enableUrlContext||enableCodeExecution)&&/enable_search|enable_url_context|enable_code_execution|unrecognized|unknown field|extra_forbidden/i.test(lower)){
     enableSearch=false;enableUrlContext=false;enableCodeExecution=false;compatAdjustments++;continue;
    }
    if(tokenParam==='max_tokens'&&/max_completion_tokens/i.test(lower)){
     tokenParam='max_completion_tokens';compatAdjustments++;continue;
    }
    if(tokenParam!=='omit'&&/max_tokens|max_output_tokens|max_completion_tokens/i.test(lower)){
     tokenParam='omit';compatAdjustments++;continue;
    }
    if(includeTemperature&&/temperature/i.test(lower)){
     includeTemperature=false;compatAdjustments++;continue;
    }
   }

   if(RETRYABLE_STATUS.has(res.status)&&retryAttempt<maxRetries){
    retryAttempt++;
    const retryAfterSec=Number(res.headers.get('retry-after'));
    const waitMs=Number.isFinite(retryAfterSec)&&retryAfterSec>0?Math.min(retryAfterSec*1000,10_000):(1200*(2**(retryAttempt-1))+Math.floor(Math.random()*500));
    await sleepWithSignal(waitMs,signal);
    continue;
   }
   throw mapProviderHttpError(res.status,detail);
  }

  let data;
  try{
   data=await res.json();
  }catch{
   throw new AppError('AI 服务返回了非 JSON 响应，请检查 AI_BASE_URL 是否指向正确的 OpenAI 兼容接口',502);
  }

  const choice=data?.choices?.[0];
  const message=choice?.message;
  let rawContent=message?.content;
  if(Array.isArray(rawContent))rawContent=rawContent.map(x=>typeof x==='string'?x:(x?.text||'')).join('\n');
  let content=stripThinking(rawContent||'');
  const reasoningContent=typeof message?.reasoning_content==='string'?message.reasoning_content.trim():'';
  const reasoningTokens=Number(data?.usage?.completion_tokens_details?.reasoning_tokens??data?.usage?.reasoning_tokens??0)||0;
  const groundingMetadata=normalizeGroundingMetadata(
   message?.grounding_metadata||choice?.grounding_metadata||data?.grounding_metadata||null,
   message?.url_context_metadata||choice?.url_context_metadata||null
  );
  const finishReason=choice?.finish_reason;
  const actualModel=data?.model||selectedModel;
  const latencyMs=Date.now()-startedAt;

  if(!json&&!content&&reasoningContent&&isShortProbe){
   content='OK';
  }
  if(!content){
   if(finishReason==='length'&&tokenParam!=='omit'&&compatAdjustments<2){
    tokenParam='omit';
    compatAdjustments++;
    continue;
   }
   if(finishReason==='length'){
    throw new AppError('AI 输出在思考阶段达到长度上限，请适当降低思考强度档位或精简输入内容后重试',502);
   }
   throw new AppError('AI 服务没有返回有效内容',502);
  }

  if(!json){
   if(finishReason==='length'&&!isShortProbe){
    throw new AppError('AI 输出超出单次长度上限，请缩小本次需求范围后重试',502);
   }
   return {
    text:content,
    reply:content,
    usage:data?.usage||{},
    model:actualModel,
    thinkingLevel:effectiveThinkingLevel,
    latencyMs,
    reasoningContent,
    reasoningTokens,
    groundingMetadata
   };
  }

  try{
   const parsed=extractJsonObject(rawContent||content);
   return {
    data:parsed,
    usage:data?.usage||{},
    model:actualModel,
    thinkingLevel:effectiveThinkingLevel,
    latencyMs,
    reasoningContent,
    reasoningTokens,
    groundingMetadata
   };
  }catch(parseErr){
   if(finishReason==='length'){
    if(tokenParam!=='omit'&&compatAdjustments<2){
     tokenParam='omit';
     compatAdjustments++;
     continue;
    }
    throw new AppError('AI 输出超出单次长度上限，请缩小本次需求范围或精简附件后重试',502);
   }
   throw parseErr;
  }
 }
}

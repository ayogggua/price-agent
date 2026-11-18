import {cfg,AppError} from './config.mjs';
export async function chat(messages,{signal,maxTokens=11000,json=false}={}){
 if(!cfg.vertexKey||!cfg.vertexUrl)throw new AppError('尚未配置 AI 服务',503);
 const timeout=AbortSignal.timeout(180000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const body={model:cfg.model,messages,stream:false,thinking_level:'',temperature:0.2,max_tokens:maxTokens};
 const r=await fetch(cfg.vertexUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.vertexKey},body:JSON.stringify(body),signal:combined});
 if(!r.ok){await r.text();throw new AppError('AI 服务返回 HTTP '+r.status,502);}
 const data=await r.json();const message=data.choices?.[0]?.message;let content=message?.content;if(Array.isArray(content))content=content.map(x=>x.text||'').join('\n');if(!content)throw new AppError('AI 服务没有返回有效内容',502);
 if(data.choices?.[0]?.finish_reason==='length')throw new AppError('AI 输出超出长度，请缩小本次需求范围后重试',502);
 if(!json)return {text:content,usage:data.usage||{},model:data.model||cfg.model};
 const raw=content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();const start=raw.indexOf('{'),end=raw.lastIndexOf('}');try{return {data:JSON.parse(raw.slice(start,end+1)),usage:data.usage||{},model:data.model||cfg.model};}catch{throw new AppError('AI 返回格式无法解析，请重新分析',502);}
}

window.PriceUI=(()=>{
 let csrf='';
 const api=async(url,body,method)=>{const options={method:method||(body?'POST':'GET'),headers:{},credentials:'same-origin'};if(body){options.headers['X-CSRF-Token']=csrf;if(body instanceof FormData)options.body=body;else{options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}}const r=await fetch(window.appPath('/api'+url),options);const j=await r.json();if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('price-auth-expired'));throw new Error(j.error||'请求未完成');}if(j.csrf)csrf=j.csrf;return j;};
 const go=(view,id)=>{location.hash=view+(id?'?id='+encodeURIComponent(id):'');window.scrollTo({top:0,behavior:'instant'});};
 const money=(value,currency='CNY')=>new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value)||0);
 const date=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
 const statuses={draft:'草稿',analyzing:'分析中',ready:'已分析',quoted:'已报价',review:'待审核',approved:'已批准',sent:'已标记发送',won:'已成交',lost:'未成交',queued:'排队中',running:'分析中',completed:'分析完成',failed:'分析失败',canceled:'已取消'};
 const roleNames={admin:'管理员',reviewer:'审核人',presales:'售前',sales:'销售',engineer:'研发'};
 const Status=({value})=><span className={'status-badge status-'+value}>{statuses[value]||value}</span>;
 const ErrorBox=({error})=>error?<div className="app-error" role="alert">{error}</div>:null;
 const Empty=({title,description,action})=><div className="empty-state"><QuoteIcon name="file" size={28}/><h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>;
 const Loading=()=> <div className="page-loading">正在读取…</div>;
 const Field=({label,children,wide})=><label className={'simple-field'+(wide?' full':'')}><span>{label}</span>{children}</label>;
 const Confirm=({title,children,onClose,onConfirm,busy})=><QuoteOverlay compact title={title} onClose={onClose} footer={<><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy?'处理中…':'确认'}</button></>}>{children}</QuoteOverlay>;
 const useLoad=(url)=>{const [data,setData]=React.useState(null),[error,setError]=React.useState('');const reload=React.useCallback(async()=>{try{const d=await api(url);setData(d);setError('');return d;}catch(e){setError(e.message);}},[url]);React.useEffect(()=>{setData(null);reload();},[reload]);return {data,error,reload,setData,setError};};
 const PageTitle=({title,description,children})=><div className="app-page-heading"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div><div className="page-actions">{children}</div></div>;
 return {api,go,money,date,statuses,roleNames,Status,ErrorBox,Empty,Loading,Field,Confirm,useLoad,PageTitle};
})();

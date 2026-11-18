const {useState,useEffect,useRef} = React;
const {sections,types,schemas,readinessFields,fresh,example} = window.QuoteData;
const Brand=window.QuoteBrandMark, I=window.QuoteIcon, F=window.QuoteField, S=window.QuoteSection, Switch=window.QuoteSwitch, Overlay=window.QuoteOverlay;
const STORAGE_KEY='price-agent.quote-input.v1';
const money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const labels={CNY:'人民币 CNY',USD:'美元 USD',EUR:'欧元 EUR',GBP:'英镑 GBP',HKD:'港币 HKD',JPY:'日元 JPY',SGD:'新加坡元 SGD'};
const loadDraft=()=>{try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(raw?.version===1&&raw.data&&Array.isArray(raw.data.types))return {data:window.QuoteData.normalizeDraft(raw.data),savedAt:raw.savedAt};}catch(e){}return {data:fresh(),savedAt:null};};

function QuoteApp({project=null,onBack,onSave,onAnalyze,attachments=[],onRemoveAttachment,assets=[]}){
  const [initial]=useState(()=>project?{data:window.QuoteData.normalizeDraft(project.input),savedAt:project.updatedAt}:loadDraft());
  const [pending,setPending]=useState(false);
  const [d,setD]=useState(initial.data);
  const [savedAt,setSavedAt]=useState(initial.savedAt);
  const [dirty,setDirty]=useState(false);
  const [active,setActive]=useState('project');
  const [toast,setToast]=useState(null);
  const [preview,setPreview]=useState(false);
  const [confirm,setConfirm]=useState(null);
  const [pendingBudgetCurrency,setPendingBudgetCurrency]=useState(null);
  const [errors,setErrors]=useState({});
  const [files,setFiles]=useState([]);
  const [dragging,setDragging]=useState(false);
  const fileRef=useRef(null);
  const change=(key,value)=>{setD(old=>({...old,[key]:value}));setDirty(true);setErrors(old=>{const next={...old};delete next[key];return next;});};
  const notify=(message,type='ok')=>setToast({message,type,key:Date.now()});
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),3600);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{
    const handler=()=>{let current='project';sections.forEach(s=>{const el=document.getElementById(s.id);if(el&&el.getBoundingClientRect().top<=170)current=s.id;});setActive(current);};
    window.addEventListener('scroll',handler,{passive:true});return()=>window.removeEventListener('scroll',handler);
  },[]);
  useEffect(()=>{const handler=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  const field=(id,label,props={})=><F key={id} id={id} label={label} value={d[id]} onChange={v=>change(id,v)} error={errors[id]} required={requiredKeys.has(id)} customOptions={d.customOptions[id]||[]} onCustomAdd={v=>addCustomOption(id,v)} onCustomRemove={v=>removeCustomOption(id,v)} {...props}/>;
  const schemaField=def=>{const {id,label,advanced,...props}=def;return field(id,label,props);};
  const readiness=t=><details className="product-readiness" open><summary><I name="layers" size={15}/><span>现有产品基础与开发进度</span><I name="down" size={14} className="chev"/></summary>{assets.some(a=>a.service_kind===t.id||t.custom&&a.service_kind==='custom')&&<div className="asset-import"><label htmlFor={t.id+'-asset'}>从产品库带入</label><select id={t.id+'-asset'} value="" onChange={e=>{const a=assets.find(a=>a.id===e.target.value);if(a){setD(old=>({...old,[t.id+'-productStage']:a.stage,[t.id+'-productProgress']:a.progress??'',[t.id+'-existingProduct']:a.name+' '+a.version,[t.id+'-completedWork']:a.completed_work,[t.id+'-remainingWork']:a.remaining_work}));setDirty(true);}}}><option value="">选择已有产品</option>{assets.filter(a=>a.service_kind===t.id||t.custom&&a.service_kind==='custom').map(a=><option key={a.id} value={a.id}>{a.name} {a.version}</option>)}</select></div>}<div className="fields-grid">{readinessFields(t.id).map(schemaField)}</div><p className="readiness-note">进度按已有产品范围填写，本次新增工作单独说明。</p></details>;
  const jump=id=>{setPreview(false);setTimeout(()=>{document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});setActive(id);},30);};
  const toggleType=id=>{change('types',d.types.includes(id)?d.types.filter(x=>x!==id):[...d.types,id]);const keys=new Set((schemas[id]||[]).map(f=>f.id));setErrors(old=>Object.fromEntries(Object.entries(old).filter(([key])=>key!=='types'&&!keys.has(key)&&!key.startsWith(id+'-'))));};
  const allTypes=window.QuoteData.allTypes(d);
  const critical=window.QuoteData.requirements(d);
  const requiredKeys=new Set(critical.map(r=>r.key));
  const businessRequired=critical.slice(6);
  const checklist=[...critical.slice(0,6),...(businessRequired.length?[{key:'business-details',label:`业务必填信息（${businessRequired.filter(r=>r.done).length}/${businessRequired.length}）`,done:businessRequired.every(r=>r.done)}]:[])];
  const done=critical.filter(x=>x.done).length;
  const boundKnown=key=>!d[key+'Unknown']&&d[key]!=='';
  const boundText=key=>boundKnown(key)?money(d[key])+' '+d.budgetCurrency:'未知';
  const knownLabor=d.roles.reduce((sum,row)=>sum+(Number(row.days)>0&&Number(row.rate)>=0&&row.rate!==''?Number(row.days)*Number(row.rate):0),0);
  const researchCount=[d.researchCompany,d.researchCost,d.researchMarket,d.researchFX&&d.currency!=='CNY'].filter(Boolean).length;
  const validate=()=>{
    const e={};critical.filter(r=>!r.done).forEach(r=>{e[r.key]=r.key==='types'?'请至少选择一类报价业务':'请填写'+r.label;});
    const nonnegative=['otherCost','riskReserve','supportPeriod',...(d.budgetStatus==='已有预算'?['budgetMin','budgetMax'].filter(boundKnown):[])];nonnegative.forEach(k=>{if(d[k]!==''&&(!Number.isFinite(Number(d[k]))||Number(d[k])<0))e[k]='请输入大于或等于 0 的数字';});
    if(d.budgetStatus==='已有预算'&&boundKnown('budgetMin')&&boundKnown('budgetMax')&&Number(d.budgetMin)>Number(d.budgetMax))e.budgetMax='预算上限应大于或等于下限';
    if(d.margin!==''&&(!Number.isFinite(Number(d.margin))||Number(d.margin)<0||Number(d.margin)>=100))e.margin='目标毛利率应在 0% 到 100% 之间';
    if(d.taxMode==='含税报价'&&d.taxRate!==''&&(!Number.isFinite(Number(d.taxRate))||Number(d.taxRate)<0||Number(d.taxRate)>100))e.taxRate='税率应在 0% 到 100% 之间';
    if(d.validity!==''&&(!Number.isInteger(Number(d.validity))||Number(d.validity)<=0))e.validity='有效期应为大于 0 的整数天数';
    if(d.startDate&&d.deliveryDate&&d.deliveryDate<d.startDate)e.deliveryDate='交付日期不能早于启动日期';
    for(const type of d.types)for(const def of schemas[type]||[])if(def.type==='number'&&d[def.id]!==undefined&&d[def.id]!==''&&(!Number.isFinite(Number(d[def.id]))||Number(d[def.id])<(def.min||0)))e[def.id]='请输入有效的正数';
    for(const type of d.types){const key=type+'-productProgress',value=d[key];if(value!==undefined&&value!==''&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100))e[key]='当前产品完成进度应在 0% 到 100% 之间';}
    for(const row of d.roles)if([row.days,row.rate].some(v=>v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)))e.roles='内部工时与单价不能为负数';
    return e;
  };
  const showPreview=()=>{setErrors(validate());setPreview(true);};
  const save=async()=>{if(onSave){setPending(true);try{await onSave(d,files);setFiles([]);setSavedAt(new Date().toISOString());setDirty(false);notify('需求已保存');}catch(e){notify(e.message,'warn');}finally{setPending(false);}return;}try{const at=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,data:d,savedAt:at}));setSavedAt(at);setDirty(false);notify(files.length?'输入已保存，所选文件刷新后需重新选择':'草稿已保存到当前浏览器');}catch(e){notify('当前浏览器无法保存草稿，请保留此页面','warn');}};
  const analyze=async()=>{const found=validate();setErrors(found);if(Object.keys(found).length){setPreview(true);return;}setPending(true);try{await onAnalyze(d,files);setDirty(false);}catch(e){notify(e.message,'warn');}finally{setPending(false);}};
  const loadExample=()=>{setD(example());setFiles([]);setErrors({});setDirty(true);setConfirm(null);jump('project');notify('已填入示例需求，可继续修改');};
  const reset=()=>{setD(fresh());setFiles([]);setErrors({});setDirty(true);setConfirm(null);jump('project');notify('已清空当前输入');};
  const requestExample=()=>{if(d.projectName||d.customerName||d.projectBrief||dirty)setConfirm('example');else loadExample();};
  const changeBudgetCurrency=value=>{const next=Object.keys(labels).find(k=>labels[k]===value);if(boundKnown('budgetMin')||boundKnown('budgetMax')){setPendingBudgetCurrency(next);setConfirm('budget-currency');}else change('budgetCurrency',next);};
  const applyBudgetCurrency=()=>{setD(old=>({...old,budgetCurrency:pendingBudgetCurrency,budgetMin:'',budgetMax:'',budgetMinUnknown:true,budgetMaxUnknown:true}));setDirty(true);setConfirm(null);setErrors(old=>{const next={...old};delete next.budgetMin;delete next.budgetMax;return next;});notify('预算币种已切换，预算金额暂设为未知');};
  const setUnknown=(key,unknown)=>{setD(old=>({...old,[key+'Unknown']:unknown,...(unknown?{[key]:''}:{})}));setDirty(true);setErrors(old=>{const next={...old};delete next.budgetMin;delete next.budgetMax;return next;});};
  const budgetField=(key,label)=>field(key,label,{type:'number',placeholder:d[key+'Unknown']?'未知':'填写已知金额，可留空',disabled:d[key+'Unknown'],min:0,suffix:d.budgetCurrency,labelAction:<label className="unknown-control"><input type="checkbox" id={key+'Unknown'} checked={d[key+'Unknown']} onChange={e=>setUnknown(key,e.target.checked)} aria-label={label+'未知'}/>未知</label>});
  const addCustomType=()=>{const id='custom-'+crypto.randomUUID();setD(old=>({...old,customTypes:[...old.customTypes,{id,name:'',description:'',deliverables:'',pricing:''}],types:[...old.types,id]}));setDirty(true);setErrors(old=>{const next={...old};delete next.types;return next;});setTimeout(()=>document.getElementById(id+'-name')?.focus(),40);};
  const updateCustomType=(id,key,value)=>{setD(old=>({...old,customTypes:old.customTypes.map(t=>t.id===id?{...t,[key]:value}:t)}));setDirty(true);setErrors(old=>{const next={...old};delete next[id+'-'+key];return next;});};
  const removeCustomType=id=>{setD(old=>{const next={...old,types:old.types.filter(t=>t!==id),customTypes:old.customTypes.filter(t=>t.id!==id)};readinessFields(id).forEach(f=>delete next[f.id]);return next;});setDirty(true);setErrors(old=>Object.fromEntries(Object.entries(old).filter(([key])=>!key.startsWith(id+'-'))));};
  const addCustomOption=(id,text)=>{setD(old=>{const builtins=Object.values(schemas).flat().find(f=>f.id===id)?.options||[];return {...old,customOptions:{...old.customOptions,[id]:[...new Set([...(old.customOptions[id]||[]),...(builtins.includes(text)?[]:[text])])]},[id]:[...new Set([...(old[id]||[]),text])]};});setDirty(true);};
  const removeCustomOption=(id,text)=>{setD(old=>({...old,customOptions:{...old.customOptions,[id]:(old.customOptions[id]||[]).filter(x=>x!==text)},[id]:(old[id]||[]).filter(x=>x!==text)}));setDirty(true);};
  const customBusiness=t=>{const value=d.customTypes.find(x=>x.id===t.id);return <details className="business-panel custom-business" key={t.id} open><summary><I name="edit" size={16}/>{t.name}<span className="custom-type-badge">自定义</span><I name="down" size={15} className="chev"/></summary><div className="business-body"><div className="fields-grid">
    <F id={t.id+'-name'} label="业务名称" value={value.name} onChange={v=>updateCustomType(t.id,'name',v)} required error={errors[t.id+'-name']} placeholder="例如：数据标注、现场集成、技术培训" wide/>
    <F id={t.id+'-description'} label="服务范围与需求" type="textarea" value={value.description} onChange={v=>updateCustomType(t.id,'description',v)} required error={errors[t.id+'-description']} placeholder="描述需要完成的工作、服务对象和范围" wide/>
    <F id={t.id+'-deliverables'} label="交付成果" type="textarea" value={value.deliverables} onChange={v=>updateCustomType(t.id,'deliverables',v)} placeholder="具体交付什么，数量或验收方式是什么" wide/>
    <F id={t.id+'-pricing'} label="计费方式 / 数量说明" value={value.pricing} onChange={v=>updateCustomType(t.id,'pricing',v)} placeholder="例如：按数据条数、服务人日、项目或次数；未知可留空" wide/>
    </div>{readiness(t)}<div className="custom-business-actions"><button type="button" className="text-button danger-text" aria-label={'删除自定义业务：'+t.name} onClick={()=>removeCustomType(t.id)}><I name="trash" size={13}/>删除这项业务</button></div></div></details>;};
  const updateRole=(id,key,value)=>change('roles',d.roles.map(r=>r.id===id?{...r,[key]:value}:r));
  const addFiles=chosen=>{
    const list=Array.from(chosen||[]);const valid=list.filter(f=>/\.(pdf|docx|xlsx|csv|txt|md|png|jpe?g|webp)$/i.test(f.name)&&f.size<=20*1024*1024);
    const merged=[...files];for(const f of valid)if(!merged.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))merged.push(f);
    setFiles(merged.slice(0,10));
    if(valid.length<list.length)notify('部分文件格式不支持或超过 20 MB','warn');else if(merged.length>10)notify('最多选择 10 个文件','warn');else if(valid.length)notify(`已选择 ${valid.length} 个文件`);
    if(fileRef.current)fileRef.current.value='';
  };
  const renderRows=pairs=><dl>{pairs.map(([label,value],idx)=>{const text=Array.isArray(value)?value.join('、'):value;return <React.Fragment key={label+idx}><dt>{label}</dt><dd className={!text?'pending':''}>{text||'待补充 / 待确认'}</dd></React.Fragment>;})}</dl>;
  const status=dirty?'有未保存的修改':savedAt?`${onSave?'需求':'草稿'}已保存 · ${new Date(savedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`:'尚未保存草稿';
  const hasNumbersErrors=Object.keys(errors).filter(k=>!requiredKeys.has(k));
  return <>
    <header className="topbar"><div className="brand"><Brand/><span className="brandname">报价工作台</span></div><span className="workspace-tag">内部工作空间</span><div className="topbar-end"><span className="top-label">售前与商业方案</span><span className="avatar" title="内部成员">内</span></div></header>
    <aside className="sidebar"><div className="nav-caption">报价信息</div><nav aria-label="报价信息分区">{sections.map((s,index)=><a className={'nav-item'+(active===s.id?' active':'')} key={s.id} href={'#'+s.id} onClick={e=>{e.preventDefault();jump(s.id);}} aria-current={active===s.id?'location':undefined}><I name={s.icon} size={18}/><span><strong>{s.name}</strong><small>{s.detail}</small></span></a>)}</nav><div className="sidebar-bottom"><p><I name="lock" size={13}/>内部报价资料</p><small>{onSave?'需求保存在公司工作台':'草稿保存在当前浏览器'}</small></div></aside>
    <main className="workspace" data-screen-label="新建报价输入页">
      <div className="breadcrumb">{onBack?<button type="button" className="text-button" onClick={()=>{if(!dirty||window.confirm('离开将放弃尚未保存的修改，是否继续？'))onBack();}}>返回项目报价</button>:<span>项目报价</span>}<I name="chevron" size={12}/><span>{project?'编辑需求':'新建报价'}</span></div>
      <div className="page-heading"><div><div className="heading-title"><h1>{project?'编辑项目需求':'新建报价'}</h1><span className="quiet-badge">草稿</span></div><p>从项目需求出发，准备一份有依据的报价。</p></div><div className="heading-actions"><button type="button" className="button ghost" id="fill-example" onClick={requestExample}><I name="file" size={15}/>填入示例</button><button type="button" className="button" id="save-draft" disabled={pending} onClick={save}><I name="save" size={14}/>{onSave?'保存需求':'保存草稿'}</button></div></div>
      <div className="workflow" aria-label="报价流程"><div className="workflow-item active"><span className="step-dot">1</span>填写需求</div><span className="workflow-line"></span><div className="workflow-item"><span className="step-dot">2</span>分析与测算</div><span className="workflow-line"></span><div className="workflow-item"><span className="step-dot">3</span>确认报价</div><span className="workflow-note"><span className="required">*</span> 为必填，其余可稍后补充</span></div>
      <nav className="mobile-nav" aria-label="快速跳转">{sections.map(s=><a key={s.id} href={'#'+s.id} className={active===s.id?'active':''} onClick={e=>{e.preventDefault();jump(s.id);}}>{s.name}</a>)}</nav>
      <div className="content-grid"><form className="form-column" noValidate onSubmit={e=>{e.preventDefault();showPreview();}}>
        <S id="project" title="项目与客户" description="明确这次报价服务于谁、解决什么问题。" action={<span className="section-tag">基础信息</span>}>
          <div className="fields-grid">
            {field('projectName','项目名称',{placeholder:'为这次报价起一个清晰的名称',required:true,wide:true})}
            {field('customerName','客户公司',{placeholder:'公司完整名称',required:true})}
            {field('country','客户所在国家 / 地区',{type:'select',options:['中国','中国香港','中国台湾','美国','英国','德国','法国','新加坡','日本','韩国','澳大利亚','加拿大','其他 / 多个地区']})}
            {d.country==='其他 / 多个地区'&&field('countryDetails','具体国家 / 地区',{placeholder:'例如：荷兰、阿联酋，或客户覆盖的多个市场',wide:true})}
            {field('website','客户官网',{type:'url',placeholder:'https://',hint:'用于后续研究客户的公开业务信息'})}
            {field('industry','客户行业',{type:'select',options:['智能硬件 / 物联网','制造 / 工业','零售 / 消费','互联网 / 软件','汽车 / 交通','医疗 / 健康','安防 / 公共服务','金融 / 企业服务','教育 / 科研','其他']})}
            {field('customerRelation','合作阶段',{type:'select',options:['首次合作','已沟通需求','已完成试用 / PoC','已有客户续约','已有客户增购']})}
            {field('customerContact','对接部门 / 联系人',{placeholder:'例如：产品部 / 张经理'})}
            {field('projectBrief','项目目标与需求概述',{type:'textarea',placeholder:'客户希望实现什么？当前遇到什么问题？已有的方案、数据或系统有哪些？',required:true,wide:true})}
          </div>
        </S>
        <S id="scope" title="报价业务" required description="至少选择一类，也可添加自定义业务。" action={<span className="section-tag">已选 {d.types.length} 类</span>}>
          <div className="type-grid" role="group" aria-label="选择报价业务（必填）" aria-describedby={errors.types?'types-error':undefined}>{allTypes.map(t=><button type="button" key={t.id} id={'type-'+t.id} className={'type-card'+(d.types.includes(t.id)?' selected':'')} aria-pressed={d.types.includes(t.id)} onClick={()=>toggleType(t.id)}><span className="type-icon"><I name={t.icon} size={22}/></span><span className="type-copy"><strong>{t.name}</strong><small>{t.detail}</small></span><span className="type-check">{d.types.includes(t.id)&&<I name="check" size={11}/>}</span></button>)}</div>
          <button type="button" className="add-business" id="add-custom-business" onClick={addCustomType}><I name="plus" size={16}/>添加自定义业务</button>
          {errors.types&&<p className="field-error" id="types-error">{errors.types}</p>}
          {!d.types.length&&<div className="empty-selection">选择业务类型后，填写对应的需求信息。</div>}
          {allTypes.filter(t=>d.types.includes(t.id)).map(t=>t.custom?customBusiness(t):<details className="business-panel" key={t.id} open><summary><I name={t.icon} size={16}/>{t.name}<I name="down" size={15} className="chev"/></summary><div className="business-body"><div className="fields-grid">{schemas[t.id].filter(x=>!x.advanced).map(schemaField)}</div>{readiness(t)}<details className="advanced"><summary><I name="down" size={14}/>{t.id==='license'?'授权权益与限制':t.id==='software'?'交付权利与补充要求':t.id==='model'?'评测、算力与成果归属':'验证与后续开发'}</summary><div className="fields-grid">{schemas[t.id].filter(x=>x.advanced).map(schemaField)}</div></details></div></details>)}
        </S>
        <S id="delivery" title="交付与验收" description="交期、运行环境和验收标准会影响工作量。">
          <div className="fields-grid">
            {field('startDate','预计启动日期',{type:'date'})}{field('deliveryDate','期望交付日期',{type:'date'})}
            {field('deployment','部署方式',{type:'select',options:['待确认','客户本地 / 私有化','客户云账号','我们托管云服务','端侧 / 嵌入式','混合部署']})}
            {field('hardwareProvider','运行硬件 / 云资源由谁提供',{type:'select',options:['待确认','客户提供','我们采购并报价','沿用已有资源','需共同评估']})}
            {field('deliveryLocation','部署地区 / 现场位置',{placeholder:'例如：上海总部、德国工厂'})}
            {field('onsite','现场交付要求',{type:'select',options:['待确认','远程交付','需要','远程为主，必要时到场']})}
            {d.onsite==='需要'&&field('onsiteDetails','现场实施与差旅范围',{placeholder:'地点、预计人数与天数；差旅费用由谁承担',wide:true})}
            {field('supportPeriod','维护支持周期',{type:'number',placeholder:'待确认',min:0,suffix:'个月'})}
            {field('sla','响应与支持要求',{placeholder:'例如：工作日支持 / 7×24 小时'})}
            {field('acceptance','验收标准与交付节点',{type:'textarea',placeholder:'需交付哪些成果？如何验收？是否分 PoC、试点、正式上线等阶段？',wide:true})}
          </div>
        </S>
        <S id="commercial" title="商务与成本" description="确定报价口径，并补充已知的成本与商务条件。">
          <div className="fields-grid">
            <F id="currency" label="报价币种" type="select" required error={errors.currency} value={labels[d.currency]} options={Object.values(labels)} onChange={v=>change('currency',Object.keys(labels).find(k=>labels[k]===v))}/>
            {field('language','报价单语言',{type:'select',options:['中文','English','中英双语']})}
            {field('budgetStatus','客户预算',{type:'select',options:['预算未知','未披露','已有预算','希望我们建议预算']})}
            {field('priority','客户优先考虑',{type:'select',options:['价格与交付平衡','控制初期投入','尽快上线','效果与稳定性','长期总体成本','待确认']})}
            {d.budgetStatus==='已有预算'&&<>
              <F id="budgetCurrency" label="预算币种" type="select" value={labels[d.budgetCurrency]} options={Object.values(labels)} onChange={changeBudgetCurrency}/>
              {field('budgetSource','预算信息来源',{type:'select',options:['客户确认','公开采购预算','销售预估']})}
              {budgetField('budgetMin','预算下限')}
              {budgetField('budgetMax','预算上限')}
              <p className="budget-hint">上下限都可未知，也可只填写一侧。</p>
            </>}
            {field('taxMode','税费口径',{type:'select',options:['待确认','未税报价','含税报价','税费另行说明']})}
            {d.taxMode==='含税报价'?field('taxRate','适用税率',{type:'number',min:0,max:100,placeholder:'由财务确认',suffix:'%'}):field('validity','报价有效期',{type:'number',min:1,suffix:'天'})}
            {d.taxMode==='含税报价'&&field('validity','报价有效期',{type:'number',min:1,suffix:'天'})}
            {field('paymentTerms','付款方式与节点',{type:'textarea',placeholder:'例如：启动款 30%，阶段验收 40%，最终验收 30%；是否有账期或保留款',wide:true})}
          </div>
          <details className="cost-block" id="internal-cost"><summary><I name="lock" size={15}/>内部成本与定价目标<span className="cost-badge">内部可见</span><I name="down" size={15} className="chev"/></summary><div className="cost-content">
            <div className="field-subheading">已有人员投入预估<span>成本币种：人民币 CNY</span></div>
            <table className="cost-table"><thead><tr><th>角色</th><th>投入人日</th><th>成本 / 人日</th><th>小计</th><th></th></tr></thead><tbody>{d.roles.map((r,idx)=><tr key={r.id}><td><input aria-label={`第 ${idx+1} 行角色`} value={r.role} onChange={e=>updateRole(r.id,'role',e.target.value)} placeholder="角色名称"/></td><td><input type="number" min="0" aria-label={`第 ${idx+1} 行人日`} value={r.days} onChange={e=>updateRole(r.id,'days',e.target.value)} placeholder="待估算"/></td><td><input type="number" min="0" aria-label={`第 ${idx+1} 行人日成本`} value={r.rate} onChange={e=>updateRole(r.id,'rate',e.target.value)} placeholder="待填写"/></td><td className="amount">{r.days!==''&&r.rate!==''&&Number(r.days)>=0&&Number(r.rate)>=0?'¥ '+money(Number(r.days)*Number(r.rate)):'—'}</td><td><button type="button" className="icon-button danger" aria-label={`删除第 ${idx+1} 行角色`} onClick={()=>change('roles',d.roles.filter(x=>x.id!==r.id))}><I name="close" size={13}/></button></td></tr>)}</tbody></table>
            {errors.roles&&<p className="field-error">{errors.roles}</p>}
            <div className="cost-bottom"><button type="button" className="text-button" onClick={()=>change('roles',[...d.roles,{id:crypto.randomUUID(),role:'',days:'',rate:''}])}><I name="plus" size={13}/>添加角色</button><span>已填写人力成本 <b>¥ {money(knownLabor)}</b></span></div>
            <div className="fields-grid">{field('otherCost','已知采购 / 算力等费用',{type:'number',placeholder:'未知可留空',min:0,suffix:'CNY'})}{field('margin','目标项目毛利率',{type:'number',placeholder:'例如：35',min:0,max:99.99,suffix:'%'})}{field('riskReserve','风险预留金额',{type:'number',placeholder:'未知可留空',min:0,suffix:'CNY'})}{field('costNotes','成本与定价补充',{type:'textarea',placeholder:'说明成本包含项、复用资产、价格限制或需单独核算的费用',wide:true})}</div>
          </div></details>
        </S>
        <S id="research" title="联网研究" description="选择后续分析需要查询的公开信息。" action={<span className="section-tag">已选 {researchCount} 项</span>}>
          <div className="research-list">
            <Switch id="researchCompany" label="研究客户公司" description="官网、产品、业务规模和公开采购信息" icon="building" checked={d.researchCompany} onChange={v=>change('researchCompany',v)}/>
            <Switch id="researchCost" label="查询成本依据" description="云资源、算力、模型 API 与第三方服务价格" icon="coins" checked={d.researchCost} onChange={v=>change('researchCost',v)}/>
            <Switch id="researchMarket" label="参考相似项目" description="公开中标、合同公告与同类服务价格" icon="layers" checked={d.researchMarket} onChange={v=>change('researchMarket',v)}/>
            {d.currency!=='CNY'&&<Switch id="researchFX" label="查询参考汇率" description={`人民币与 ${d.currency} 的报价参考汇率`} icon="globe" checked={d.researchFX} onChange={v=>change('researchFX',v)}/>}
          </div>
          {!!researchCount&&<div className="research-options"><div className="fields-grid">
            {d.researchCompany&&field('companyTopics','客户研究重点',{type:'chips',options:['主营业务与产品','业务规模与市场','融资与公开财报','历史采购与供应商','技术与产品线索'],wide:true})}
            {field('researchRegions','研究市场',{type:'select',options:['客户所在市场优先','中国市场','海外市场','全球市场']})}
            {field('researchPeriod','参考资料时间',{type:'select',options:['近 1 年','近 2 年','近 3 年','不限，标注资料日期']})}
            {field('researchKeywords','希望重点查询的内容',{placeholder:'例如：同类项目成交价、A10 云服务器成本',wide:true})}
            {field('sourceLinks','指定参考链接',{type:'textarea',placeholder:'可填写客户官网、产品页、采购公告或供应商报价链接，每行一条',wide:true})}
          </div><p className="inline-note"><I name="info" size={13}/>客户预算仍以已确认信息为准，公开信息用于提供参考依据。</p></div>}
        </S>
        <S id="materials" title="资料与补充" description="补充需求文件、参考资料或表单中未覆盖的信息。">
          <input className="hidden-file" ref={fileRef} type="file" multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={e=>addFiles(e.target.files)} aria-label="选择需求资料"/>
          <button type="button" className={'dropzone'+(dragging?' dragging':'')} onClick={()=>fileRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}><span className="dropzone-icon"><I name="upload" size={23}/></span><span><strong>点击选择文件，或拖拽到这里</strong><small>需求文档、参考报价、数据样例 · 单个文件 ≤ 20 MB</small></span></button>
          {!!attachments.length&&<div className="files-list">{attachments.map(file=><div className="file-item" key={file.id}><I name="file" size={18}/><div><a href={window.appPath('/api/files/download?id='+file.id)} target="_blank" rel="noopener"><strong>{file.name}</strong></a><small>{Math.ceil(file.size/1024)} KB · {file.parseStatus==='ready'?'已解析':file.parseStatus==='image'?'图片资料':'已保存，未能提取文本'}</small></div><button type="button" className="icon-button" aria-label={'删除附件 '+file.name} onClick={async()=>{try{await onRemoveAttachment(file.id);}catch(e){notify(e.message,'warn');}}}><I name="close" size={15}/></button></div>)}</div>}
          {!!files.length&&<div className="files-list">{files.map((file,i)=><div className="file-item" key={file.name+i}><I name="file" size={18}/><div><strong>{file.name}</strong><small>{file.size<1024*1024?Math.ceil(file.size/1024)+' KB':(file.size/1024/1024).toFixed(1)+' MB'} · 已选择</small></div><button type="button" className="icon-button" aria-label={'移除 '+file.name} onClick={()=>setFiles(files.filter((_,n)=>n!==i))}><I name="close" size={15}/></button></div>)}<small className="field-hint">{onSave?'保存需求时上传，已上传资料会用于 AI 分析。':'本页仅预览文件选择，刷新后需重新选择。'}</small></div>}
          <div className="field-separator"></div><div className="fields-grid">{field('notes','其他要求与假设',{type:'textarea',placeholder:'例如：分阶段报价、客户需配合的事项、尚未确定的条件，或希望 AI 特别考虑的问题',wide:true})}</div>
          {!!d.customFields.length&&<div style={{marginTop:20}}>{d.customFields.map((c,i)=><div className="custom-row" key={c.id}><F id={'custom-name-'+c.id} label="补充项名称" value={c.name} onChange={v=>change('customFields',d.customFields.map(x=>x.id===c.id?{...x,name:v}:x))} placeholder="例如：试用期限"/><F id={'custom-value-'+c.id} label="具体内容" value={c.value} onChange={v=>change('customFields',d.customFields.map(x=>x.id===c.id?{...x,value:v}:x))} placeholder="填写需要补充的信息"/><button type="button" className="icon-button danger" aria-label={`删除补充项 ${i+1}`} onClick={()=>change('customFields',d.customFields.filter(x=>x.id!==c.id))}><I name="trash" size={15}/></button></div>)}</div>}
          <div className="custom-intro"><p>还有需要纳入报价的维度？</p><button type="button" className="text-button" id="add-custom" onClick={()=>change('customFields',[...d.customFields,{id:crypto.randomUUID(),name:'',value:''}])}><I name="plus" size={14}/>添加补充项</button></div>
        </S>
      </form>
      <aside className="summary-column" aria-label="报价需求摘要"><div className="summary-card"><div className="summary-title"><I name="file" size={16}/>本次报价</div><div className="summary-content"><div className="summary-project">{d.projectName||'未命名项目'}</div><div className="summary-client">{d.customerName||'等待填写客户信息'}</div><div className="summary-label">报价业务</div><div className="summary-tags">{d.types.length?allTypes.filter(t=>d.types.includes(t.id)).map(t=><span key={t.id}>{t.name}</span>):<span>尚未选择</span>}</div><dl><div className="summary-row"><dt>报价币种</dt><dd>{labels[d.currency]}</dd></div><div className="summary-row"><dt>文档语言</dt><dd>{d.language}</dd></div><div className="summary-row"><dt>期望交付</dt><dd>{d.deliveryDate||'待确认'}</dd></div><div className="summary-row"><dt>联网研究</dt><dd>{researchCount?researchCount+' 项已选':'未选择'}</dd></div><div className="summary-row"><dt>附件资料</dt><dd>{(files.length+attachments.length)?(files.length+attachments.length)+' 个文件':'未添加'}</dd></div></dl><div className="summary-divider"></div><div className="progress-label"><span>必填信息</span><strong>{done} / {critical.length}</strong></div><div className="progress-track"><div style={{width:done/critical.length*100+'%'}}></div></div><div className="checklist">{checklist.map(c=><div className={'checklist-row'+(c.done?' done':'')} key={c.key}><span className="check-ring">{c.done&&<I name="check" size={9}/>}</span>{c.label}</div>)}</div></div><div className="summary-caption"><I name="lock" size={12}/>内部成本与定价目标仅用于内部评估。</div></div><div className="review-tip"><strong><I name="info" size={14}/>未标星的信息可稍后补充</strong><p>需求预览会保留待确认项，方便与客户和研发一起补充。</p><button className="text-button" type="button" onClick={showPreview}>查看当前输入<I name="arrow" size={13}/></button></div></aside></div>
    </main>
    <footer className="footer"><span className="footer-status"><I name={dirty?'edit':savedAt?'check':'clock'} size={14}/>{status}</span><div className="footer-actions"><span className="footer-hint">已填写 <strong>{done}</strong> / {critical.length} 项必填信息</span><button type="button" className="button ghost" id="reset-input" onClick={()=>setConfirm('reset')}>清空输入</button><button type="button" className={onAnalyze?"button ghost":"button primary large"} id="preview-input" onClick={showPreview}>预览报价需求{!onAnalyze&&<I name="arrow" size={15}/>}</button>{onAnalyze&&<button type="button" className="button primary large" id="start-analysis" disabled={pending} onClick={analyze}>{pending?'正在保存…':'开始 AI 分析'}<I name="arrow" size={15}/></button>}</div></footer>
    {toast&&<div key={toast.key} className={'toast'+(toast.type==='warn'?' warn':'')} role="status"><I name={toast.type==='warn'?'info':'check'} size={16}/>{toast.message}</div>}
    {confirm&&<Overlay title={confirm==='example'?'填入示例需求':confirm==='budget-currency'?'切换预算币种':'清空当前输入'} subtitle={confirm==='example'?'示例用于体验字段与组合报价。':undefined} compact onClose={()=>setConfirm(null)} footer={<><button className="button" onClick={()=>setConfirm(null)}>取消</button><button className="button primary" onClick={confirm==='example'?loadExample:confirm==='budget-currency'?applyBudgetCurrency:reset}>{confirm==='example'?'替换为示例':confirm==='budget-currency'?'切换并重新填写':'确认清空'}</button></>}><p>{confirm==='example'?'将替换当前已填写的信息；已保存的草稿不会自动覆盖。':confirm==='budget-currency'?'切换预算币种将清空已填写的预算金额，请按新币种重新输入。报价币种与内部成本不受影响。':'将清空当前表单及已选择的文件；已保存的草稿不会自动覆盖。'}</p></Overlay>}
    {preview&&<Overlay title="报价需求预览" subtitle="核对本次输入，待确认信息将保留在需求中。" onClose={()=>setPreview(false)} footer={<><button className="button" onClick={()=>setPreview(false)}>继续编辑</button><button className="button primary" onClick={save}><I name="save" size={14}/>保存这份需求</button></>}>
      <div className={'review-alert'+(done===critical.length&&!hasNumbersErrors.length?' ok':'')}><strong>{hasNumbersErrors.length?'有输入需要修正':done===critical.length?'必填信息已齐，可以继续完善详细条件':`还有 ${critical.length-done} 项必填信息待补充`}</strong><p>{hasNumbersErrors.length?hasNumbersErrors.map(k=>errors[k]).join('；'):done===critical.length?(onAnalyze?'确认输入后可开始 AI 分析。':'本次预览仅整理输入内容，尚未执行 AI 分析或生成报价。'):critical.filter(c=>!c.done).map(c=>c.label).join('、')}</p></div>
      <div className="review-section"><div className="review-section-heading"><h3>01 项目与客户</h3><button className="text-button" onClick={()=>jump('project')}>编辑</button></div>{renderRows([['项目名称',d.projectName],['客户公司',d.customerName],['国家 / 地区',d.country==='其他 / 多个地区'?d.countryDetails:d.country],['官网',d.website],['行业',d.industry],['合作阶段',d.customerRelation],['对接人 / 部门',d.customerContact],['项目目标',d.projectBrief]])}</div>
      <div className="review-section"><div className="review-section-heading"><h3>02 报价业务</h3><button className="text-button" onClick={()=>jump('scope')}>编辑</button></div>{!d.types.length&&<p className="review-footnote">尚未选择业务类型</p>}{allTypes.filter(t=>d.types.includes(t.id)).map(t=><div key={t.id}><h4 className="review-business">{t.name}{t.custom?' · 自定义':''}</h4>{renderRows(t.custom?[['业务名称',d.customTypes.find(x=>x.id===t.id).name],['服务范围与需求',t.description],['交付成果',t.deliverables],['计费方式 / 数量说明',t.pricing]]:schemas[t.id].map(f=>[f.label,d[f.id]]))}<h5 className="review-readiness">现有产品基础与开发进度</h5>{renderRows(readinessFields(t.id).map(f=>[f.label,d[f.id]!==undefined&&d[f.id]!==''?d[f.id]+(f.suffix||''):'']))}</div>)}</div>
      <div className="review-section"><div className="review-section-heading"><h3>03 交付与验收</h3><button className="text-button" onClick={()=>jump('delivery')}>编辑</button></div>{renderRows([['预计启动',d.startDate],['期望交付',d.deliveryDate],['部署方式',d.deployment],['硬件与资源',d.hardwareProvider],['部署位置',d.deliveryLocation],['现场要求',d.onsite],...(d.onsite==='需要'?[['现场实施',d.onsiteDetails]]:[]),['维护周期',d.supportPeriod!==''?d.supportPeriod+' 个月':''],['响应与支持',d.sla],['验收与节点',d.acceptance]])}</div>
      <div className="review-section"><div className="review-section-heading"><h3>04 商务与成本</h3><button className="text-button" onClick={()=>jump('commercial')}>编辑</button></div>{renderRows([['报价币种',labels[d.currency]],['文档语言',d.language],['预算情况',d.budgetStatus],...(d.budgetStatus==='已有预算'?[['预算下限',boundText('budgetMin')],['预算上限',boundText('budgetMax')],['预算来源',d.budgetSource]]:[]),['客户优先考虑',d.priority],['税费口径',d.taxMode],...(d.taxMode==='含税报价'?[['税率',d.taxRate!==''?d.taxRate+'%':'']]:[]),['报价有效期',d.validity?d.validity+' 天':''],['付款安排',d.paymentTerms],['目标毛利率',d.margin!==''?d.margin+'%':''],['已知采购费用',d.otherCost!==''?'CNY '+money(d.otherCost):''],['风险预留',d.riskReserve!==''?'CNY '+money(d.riskReserve):''],['成本补充',d.costNotes]])}{d.roles.some(r=>r.role||r.days||r.rate)&&<><h4 className="review-business">内部人员成本 · CNY</h4>{renderRows(d.roles.map((r,i)=>[r.role||'角色 '+(i+1),`${r.days||'待估算'} 人日 × ${r.rate!==''?'¥ '+r.rate:'待填写单价'}${r.days!==''&&r.rate!==''?' = ¥ '+money(Number(r.days)*Number(r.rate)):''}`]))}</>}</div>
      <div className="review-section"><div className="review-section-heading"><h3>05 联网研究</h3><button className="text-button" onClick={()=>jump('research')}>编辑</button></div>{renderRows([['客户研究',d.researchCompany?'已选择':'未选择'],['成本查询',d.researchCost?'已选择':'未选择'],['相似项目',d.researchMarket?'已选择':'未选择'],...(d.currency!=='CNY'?[['参考汇率',d.researchFX?'已选择':'未选择']]:[]),...(researchCount?[...(d.researchCompany?[['客户研究重点',d.companyTopics]]:[]),['研究市场',d.researchRegions],['资料时间',d.researchPeriod],['查询重点',d.researchKeywords],['指定来源',d.sourceLinks]]:[])])}</div>
      <div className="review-section"><div className="review-section-heading"><h3>06 资料与补充</h3><button className="text-button" onClick={()=>jump('materials')}>编辑</button></div>{renderRows([['已选择文件',[...attachments,...files].map(f=>f.name)],['补充要求',d.notes],...d.customFields.map(c=>[c.name||'未命名补充项',c.value])])}</div>
    </Overlay>}
  </>;
}
window.QuoteApp=QuoteApp;
if(!window.QUOTE_PLATFORM)ReactDOM.createRoot(document.getElementById('root')).render(<QuoteApp/>);

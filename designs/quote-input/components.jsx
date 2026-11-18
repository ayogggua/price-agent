const QuoteBrandMark=()=> <img className="brandmark" src={(window.APP_BASE||'')+'/quote-input/assets/habitax-symbol.svg'} alt="栖界" width="44" height="32"/>;
const QuoteIcon=({name,size=20,className=''})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><use href={(window.APP_BASE||'')+'/quote-input/vendor/icons.svg#'+name}/></svg>;
const QuoteEditableSelect = ({common,label,value,onChange,options,placeholder}) => {
  const [open,setOpen]=React.useState(false),[query,setQuery]=React.useState(''),[active,setActive]=React.useState(-1),[up,setUp]=React.useState(false);
  const input=React.useRef(null),list=React.useRef(null);
  const text=String(value??''),trimmed=text.trim();
  const choices=options.filter(o=>o.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if(trimmed&&!options.some(o=>o.toLocaleLowerCase()===trimmed.toLocaleLowerCase()))choices.push(trimmed);
  const show=()=>{const r=input.current.getBoundingClientRect(),bottom=document.querySelector('.footer')?.getBoundingClientRect().top||innerHeight;setUp(bottom-r.bottom<230&&r.top-110>bottom-r.bottom);setQuery('');setActive(-1);setOpen(true);};
  const choose=next=>{onChange(next);setOpen(false);setQuery('');setActive(-1);};
  React.useEffect(()=>{if(open&&active>=0)list.current?.children[active]?.scrollIntoView({block:'nearest'});},[active,open]);
  const keyDown=e=>{
    if(e.nativeEvent.isComposing||e.keyCode===229)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      if(!open){show();setActive(e.key==='ArrowDown'?0:options.length-1);}
      else setActive(i=>(i+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length);
    }else if(e.key==='Enter'&&open){e.preventDefault();e.stopPropagation();choose(choices[active]??trimmed);}
    else if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}
  };
  return <div className={'editable-select'+(open?' is-open':'')+(up?' opens-up':'')} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setQuery('');if(text!==trimmed)onChange(trimmed);}}}>
    <input {...common} ref={input} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open?common.id+'-options':undefined} aria-activedescendant={open&&active>=0&&choices[active]?common.id+'-option-'+active:undefined} autoComplete="off" value={text} placeholder={placeholder||'选择或直接输入'} onFocus={show} onClick={()=>{if(!open)show();}} onChange={e=>{onChange(e.target.value);setQuery(e.target.value);setActive(-1);setOpen(true);}} onKeyDown={keyDown}/>
    <button type="button" className="select-toggle" tabIndex={-1} disabled={common.disabled} aria-label={'选择'+label} aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>{input.current.focus();if(open)setOpen(false);else show();}}><QuoteIcon name="down" size={15}/></button>
    {open&&<div className="select-options" id={common.id+'-options'} role="listbox" aria-label={label+'选项'} ref={list}>{choices.map((o,index)=><button type="button" role="option" id={common.id+'-option-'+index} key={o} tabIndex={-1} aria-selected={text===o} className={'select-option'+(active===index?' active':'')} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(o)}><span>{o}</span>{!options.includes(o)?<small>自填</small>:text===o?<QuoteIcon name="check" size={13}/>:null}</button>)}</div>}
  </div>;
};
const QuoteField = ({id,label,type='text',value,onChange,options=[],placeholder='',hint,wide=false,required=false,error,min,max,suffix,disabled=false,labelAction,allowCustom=false,customOptions=[],onCustomAdd,onCustomRemove}) => {
  const [adding,setAdding]=React.useState(false),[customText,setCustomText]=React.useState(''),[customError,setCustomError]=React.useState('');
  const choices=[...new Set([...options,...customOptions,...(type==='chips'&&Array.isArray(value)?value:[])])];
  const add=()=>{const text=customText.trim();if(!text){setCustomError('请填写选项内容');return;}const existing=choices.find(o=>o.toLocaleLowerCase()===text.toLocaleLowerCase());onCustomAdd?.(existing||text);setCustomText('');setCustomError('');setAdding(false);};
  const common = {id,name:id,required,disabled,'aria-required':required||undefined,'aria-invalid':!!error,'aria-describedby':error?id+'-error':hint?id+'-hint':undefined};
  return <div className={'field'+(wide?' wide':'')+(error?' has-error':'')} data-field={id}>
    <div className="field-label"><label id={id+'-label'} htmlFor={type==='chips'?undefined:id}>{label}{required&&<span className="required" aria-label="必填">*</span>}</label>{labelAction||(type==='select'&&allowCustom?<span className="field-custom-label">可自填</span>:null)}</div>
    {type==='chips'?<>
      <div className="chips" id={id} role="group" aria-labelledby={id+'-label'} aria-describedby={error?id+'-error':undefined}>{choices.map(o=>{
        const selected=(value||[]).includes(o),custom=!options.includes(o);
        const chip=<button type="button" className={'chip'+(selected?' selected':'')} aria-pressed={selected} onClick={()=>onChange(selected?value.filter(x=>x!==o):[...(value||[]),o])}>{selected&&<QuoteIcon name="check" size={13}/>}<span>{o}</span></button>;
        return custom&&allowCustom?<span className={'custom-chip'+(selected?' selected':'')} key={o}>{chip}<button type="button" className="remove-chip" aria-label={'删除自填选项：'+o} onClick={()=>onCustomRemove?.(o)}><QuoteIcon name="close" size={12}/></button></span>:<React.Fragment key={o}>{chip}</React.Fragment>;
      })}{allowCustom&&!adding&&<button type="button" className="chip add-chip" id={id+'-add-option'} onClick={()=>setAdding(true)}><QuoteIcon name="plus" size={13}/>自填选项</button>}</div>
      {allowCustom&&adding&&<div className="custom-option-editor"><input id={id+'-custom-option'} aria-label={label+'自填选项'} autoFocus value={customText} maxLength={100} placeholder="填写新的选项" onChange={e=>{setCustomText(e.target.value);setCustomError('');}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();add();}if(e.key==='Escape'){e.preventDefault();setAdding(false);}}}/><button type="button" className="button small" onClick={add}>添加</button><button type="button" className="icon-button" aria-label={'取消'+label+'自填'} onClick={()=>setAdding(false)}><QuoteIcon name="close" size={15}/></button></div>}
      {customError&&adding&&<small className="field-error" role="alert">{customError}</small>}
    </>:
    type==='select'&&allowCustom?<QuoteEditableSelect common={common} label={label} value={value} onChange={onChange} options={options} placeholder={placeholder}/>:
    type==='select'?<div className="select-wrap"><select {...common} value={value??''} onChange={e=>onChange(e.target.value)}>{!options.includes('')&&<option value="" disabled>请选择</option>}{options.map(o=><option key={o} value={o}>{o}</option>)}</select><QuoteIcon name="down" size={15}/></div>:
    type==='textarea'?<textarea {...common} value={value??''} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={3}></textarea>:
    <div className={'input-wrap'+(suffix?' has-suffix':'')}><input {...common} type={type} value={value??''} onChange={e=>onChange(e.target.value)} placeholder={placeholder} min={min} max={max} step={type==='number'?'any':undefined}/>{suffix&&<span className="suffix">{suffix}</span>}</div>}
    {hint&&<small id={id+'-hint'} className="field-hint">{hint}</small>}{error&&<small id={id+'-error'} className="field-error">{error}</small>}
  </div>;
};
const QuoteSection = ({id,index,title,description,children,action,required=false}) => <section className="form-section" id={id} data-screen-label={title}>
  <div className="section-heading"><div className="section-heading-main"><div><h2>{title}{required&&<span className="required" aria-label="必填"> *</span>}</h2>{description&&<p>{description}</p>}</div></div>{action}</div>
  <div className="section-body">{children}</div>
</section>;
const QuoteSwitch = ({id,checked,onChange,label,description,icon}) => <div className={'research-toggle'+(checked?' enabled':'')}>
  <span className="research-icon"><QuoteIcon name={icon}/></span><div className="research-text"><label htmlFor={id}>{label}</label><p>{description}</p></div>
  <label className="switch"><input type="checkbox" role="switch" id={id} checked={checked} onChange={e=>onChange(e.target.checked)} aria-label={label}/><span></span></label>
</div>;
const QuoteOverlay = ({title,subtitle,onClose,children,footer,compact=false}) => {
  const ref=React.useRef(null);
  React.useEffect(()=>{
    const previous=document.activeElement;
    const old=document.body.style.overflow;document.body.style.overflow='hidden';
    ref.current?.querySelector('button')?.focus();
    const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){
      const nodes=[...ref.current.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]')].filter(x=>x.offsetParent!==null);
      if(!nodes.length)return;
      if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
    }};
    document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus();};
  },[]);
  return <div className={'overlay'+(compact?' compact':'')} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
    <div className="dialog-header"><div><h2 id="dialog-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><QuoteIcon name="close"/></button></div>
    <div className="dialog-content">{children}</div>{footer&&<div className="dialog-footer">{footer}</div>}
  </div></div>;
};
Object.assign(window,{QuoteBrandMark,QuoteIcon,QuoteField,QuoteSection,QuoteSwitch,QuoteOverlay});

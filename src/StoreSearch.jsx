import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchStores } from './store-directory.js';

// Combobox contrôlé : la saisie n'est pas une sélection tant qu'un résultat
// (et donc son identifiant immuable) n'a pas été choisi.
export function StoreSearch({stores,value,onChange,onUnselectedChange,onEdit,disabled=false,id='store-search'}) {
  const selected=stores.find(item=>item.id===value);
  const [query,setQuery]=useState(selected?.name||'');
  const [open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const input=useRef(null),listId=`${id}-list`,messageId=`${id}-message`;
  const results=searchStores(stores,query),shown=results.slice(0,30);
  useEffect(()=>{if(value&&selected)setQuery(selected.name);},[value,selected?.name]);
  useEffect(()=>{onUnselectedChange?.(!!query&&!value);},[query,value,onUnselectedChange]);
  useEffect(()=>{
    if(open&&active>=0)document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({block:'nearest'});
  },[open,active,id]);
  const choose=item=>{setQuery(item.name);setOpen(false);setActive(-1);onChange(item.id);};
  const change=event=>{
    onEdit?.();setQuery(event.target.value);setActive(-1);setOpen(true);
    if(value)onChange('');
  };
  const clear=()=>{onEdit?.();setQuery('');setActive(-1);setOpen(true);if(value)onChange('');input.current?.focus();};
  const keyDown=event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();setOpen(true);
      if(shown.length)setActive(current=>event.key==='ArrowDown'?Math.min(current+1,shown.length-1):current<0?shown.length-1:Math.max(current-1,0));
    } else if(event.key==='Enter'&&open&&active>=0&&shown[active]) {
      event.preventDefault();choose(shown[active]);
    } else if(event.key==='Escape'&&open) {
      event.preventDefault();event.stopPropagation();setOpen(false);setActive(-1);
    }
  };
  return <div className="store-search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <div className="select-wrap store-search-input"><Search size={16} aria-hidden="true"/><input ref={input} id={id} type="search" role="combobox" aria-label="Votre magasin Fnac" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-describedby={[open?messageId:null,onUnselectedChange&&query&&!value?`${id}-hint`:null].filter(Boolean).join(' ')||undefined} aria-invalid={!open&&!!query&&!value?true:undefined} aria-activedescendant={open&&active>=0?`${id}-option-${active}`:undefined} placeholder="Rechercher un magasin" value={query} onChange={change} onFocus={()=>setOpen(true)} onKeyDown={keyDown} autoComplete="off" disabled={disabled} required/>
      {!!query&&!disabled&&<button type="button" className="store-search-clear" aria-label="Effacer la recherche de magasin" onMouseDown={event=>event.preventDefault()} onClick={clear}><X size={15}/></button>}
    </div>
    {open&&<div className="store-search-dropdown"><div className="store-search-list" id={listId} role="listbox" aria-label="Magasins trouvés">
      {shown.map((item,index)=><button key={item.id} type="button" id={`${id}-option-${index}`} role="option" aria-selected={item.id===value} tabIndex={-1} className={`store-search-option ${index===active?'is-active':''}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(item)}><span>{item.name}</span>{item.directoryStatus==='historical'&&<small>Ancien catalogue</small>}</button>)}
    </div><p className="store-search-message" id={messageId} role="status">{!results.length?'Aucun magasin trouvé. Essayez un autre nom.':results.length>shown.length?`${shown.length} résultats affichés : précisez votre recherche.`:`${results.length} magasin${results.length>1?'s':''} trouvé${results.length>1?'s':''}.`}</p></div>}
  </div>;
}

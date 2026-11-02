import React, { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';

// Les profils suggérés ont déjà été limités au magasin et au département
// choisis. La saisie libre reste possible pour une première inscription.
function searchableName(value) {
  return String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/œ/g,'oe').replace(/æ/g,'ae').trim();
}
export function suggestedNames(sellers,value) {
  const query=searchableName(value);
  return (sellers||[]).filter(seller=>!query||searchableName(seller.name).includes(query));
}

export function NameSuggestions({sellers,value,onChange,disabled=false,id='seller-name'}) {
  const [open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const listId=`${id}-list`,messageId=`${id}-message`;
  const results=suggestedNames(sellers,value),shown=results.slice(0,30),expanded=open&&!disabled;
  useEffect(()=>{if(disabled){setOpen(false);setActive(-1);}},[disabled]);
  useEffect(()=>{
    if(expanded&&active>=0&&typeof document!=='undefined')document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({block:'nearest'});
  },[expanded,active,id]);
  useEffect(()=>{
    if(!expanded||typeof document==='undefined')return;
    const input=document.getElementById(id),list=document.getElementById(listId),content=input?.closest('.modal-content');
    if(!content||!list)return;
    // Faire de la place aux suggestions dans la modale sans cacher le champ.
    const field=input.getBoundingClientRect(),menu=list.parentElement.getBoundingClientRect(),box=content.getBoundingClientRect();
    const needed=menu.bottom-box.bottom+8,available=field.top-box.top-8;
    if(needed>0&&available>0)content.scrollTop+=Math.min(needed,available);
  },[expanded,shown.length,id,listId]);
  const choose=seller=>{onChange(seller.name);setOpen(false);setActive(-1);};
  const keyDown=event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();setOpen(true);
      if(shown.length)setActive(current=>event.key==='ArrowDown'?Math.min(current+1,shown.length-1):current<0?shown.length-1:Math.max(current-1,0));
    } else if(event.key==='Enter'&&expanded&&active>=0&&shown[active]) {
      event.preventDefault();choose(shown[active]);
    } else if(event.key==='Escape'&&expanded) {
      event.preventDefault();event.stopPropagation();setOpen(false);setActive(-1);
    }
  };
  const message=results.length===0?(value.trim()?'Aucun prénom trouvé dans ce département.':'Aucun prénom enregistré dans ce département.'):
    results.length>shown.length?`${shown.length} prénoms affichés : faites défiler ou précisez votre recherche.`:
    `${results.length} prénom${results.length>1?'s':''} proposé${results.length>1?'s':''}.${shown.length>5?' Faites défiler.':''}`;
  return <div className="session-field seller-field">
    <label htmlFor={id}>VOTRE PRÉNOM</label>
    <div className="name-suggestions" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setActive(-1);}}}>
      <div className="select-wrap name-wrap"><UserRound size={16} aria-hidden="true"/><input id={id} aria-label="Votre prénom" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId} aria-describedby={expanded?messageId:undefined} aria-activedescendant={expanded&&active>=0?`${id}-option-${active}`:undefined} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="words" maxLength={60} placeholder="Saisissez votre prénom" value={value} onChange={event=>{onChange(event.target.value);setActive(-1);setOpen(true);}} onFocus={()=>setOpen(true)} onKeyDown={keyDown} disabled={disabled} required/></div>
      {expanded&&<div className="store-search-dropdown name-suggestions-dropdown">
        <div className="store-search-list" id={listId} role="listbox" aria-label="Prénoms enregistrés">
          {shown.map((seller,index)=><button key={seller.id} type="button" id={`${id}-option-${index}`} role="option" aria-selected={index===active} tabIndex={-1} className={`store-search-option ${index===active?'is-active':''}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(seller)}><span>{seller.name}</span></button>)}
        </div>
        <p className="store-search-message" id={messageId} role="status">{message}</p>
      </div>}
    </div>
  </div>;
}

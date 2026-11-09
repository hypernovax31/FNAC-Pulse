import React, {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

const TABS=[['stores','Magasins'],['sellers','Vendeurs'],['goals','Objectifs'],['sales','Ventes'],['services','Services'],['departments','Départements'],['security','Administrateurs']];

// Les flèches n'apparaissent que lorsqu'il reste des onglets hors écran ; le
// défilement tactile et le clavier continuent à fonctionner naturellement.
export function AdminTabs({tab,onSelect,disabled=false}) {
  const scroll=useRef(null),[more,setMore]=useState({left:false,right:false});
  useEffect(()=>{
    const node=scroll.current;if(!node)return;
    const update=()=>{
      const left=node.scrollLeft>2,right=node.scrollLeft+node.clientWidth<node.scrollWidth-2;
      setMore(old=>old.left===left&&old.right===right?old:{left,right});
    };
    update();node.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(update):null;observer?.observe(node);
    const frame=window.requestAnimationFrame?.(update);
    return ()=>{node.removeEventListener('scroll',update);window.removeEventListener('resize',update);observer?.disconnect();if(frame)window.cancelAnimationFrame?.(frame);};
  },[]);
  function move(direction) {scroll.current?.scrollBy({left:direction*180,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  function onKeyDown(event,index) {
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||disabled)return;
    event.preventDefault();const next=(index+(event.key==='ArrowRight'?1:-1)+TABS.length)%TABS.length,node=scroll.current;
    const target=node?.querySelectorAll('[role="tab"]')[next];onSelect(TABS[next][0]);target?.focus({preventScroll:true});
    if(node&&target){const outer=node.getBoundingClientRect(),inner=target.getBoundingClientRect();
      const delta=inner.left<outer.left?inner.left-outer.left-8:inner.right>outer.right?inner.right-outer.right+8:0;
      if(delta)node.scrollBy({left:delta,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
  }
  return <div className="admin-tabs-shell">
    <div ref={scroll} className="admin-tabs" role="tablist" aria-label="Rubriques administration">
      {TABS.map(([key,label],index)=><button key={key} role="tab" aria-selected={tab===key} disabled={disabled} onClick={()=>onSelect(key)} onKeyDown={event=>onKeyDown(event,index)} className={tab===key?'active':''}>{label}</button>)}
    </div>
    {more.left&&<button type="button" className="admin-tabs-arrow is-left" aria-label="Voir les onglets précédents" disabled={disabled} onClick={()=>move(-1)}><ChevronLeft size={17}/></button>}
    {more.right&&<button type="button" className="admin-tabs-arrow is-right" aria-label="Voir les autres onglets" disabled={disabled} onClick={()=>move(1)}><ChevronRight size={17}/></button>}
  </div>;
}

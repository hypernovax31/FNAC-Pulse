import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, Zap, Trophy, ChartNoAxesCombined, Settings2, MapPin, ChevronDown, ChevronRight, ArrowRight,
  Activity, Bell, BellRing, BellOff, Plus, Minus, UserRound, UsersRound, Sparkles, Crosshair, CalendarDays,
  Check, MoreHorizontal, Play, Smartphone, MonitorSmartphone, ShieldCheck, PackageCheck, BadgePlus,
  Repeat2, RefreshCw, Tv, Wifi, Clock3, X, Download, Store, WifiOff, Info, CircleCheck, ArrowUpRight
} from 'lucide-react';
import Admin, { Modal } from './Admin';
import { api, uid, dateLabel, timeLabel, kmBetween } from './api';

const SESSION_KEY = 'fnac-pulse-session-v1';
const CACHE_KEY = 'fnac-pulse-last-view-v1';
const icons = { play:Play, phone:Smartphone, devices:MonitorSmartphone, shield:ShieldCheck, package:PackageCheck, badge:BadgePlus, repeat:Repeat2, refresh:RefreshCw, tv:Tv, wifi:Wifi, other:MoreHorizontal };
const iconColors = ['sun','lavender','blue','mint','peach','sun','lavender','mint','blue','peach','sun'];
const avatarColors = ['#f0c84e','#cbdacf','#d4dbed','#ead4bc','#e8cdd2','#d6d2e8','#d0e2df','#f3d7be'];
function getSession() { try { const a=JSON.parse(localStorage.getItem(SESSION_KEY));return a?.storeId&&a?.sellerId?a:null; } catch {return null;} }
function getCached() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch {return null;} }
function initial(name) {return (name || '?').trim().slice(0,1).toUpperCase();}
function Avatar({name,id,size='normal'}) {return <span className={`avatar avatar-${size}`} style={{backgroundColor:avatarColors[(Number(id)||0)%avatarColors.length]}}>{initial(name)}</span>}
function Brand({compact=false}) {return <div className={`brand ${compact?'brand-compact':''}`}><img src="/fnac.svg" alt="Fnac"/><div className="brand-word"><strong>pulse<span className="brand-period">.</span></strong>{!compact&&<span>ESPACE ÉQUIPE</span>}</div></div>}
function Dot() {return <span className="live-dot" aria-hidden="true"/>}

function SessionForm({data,initialSession,onSubmit,modal=false,onNotify}) {
  const [store,setStore]=useState(initialSession?.storeId||'');
  const [seller,setSeller]=useState(String(initialSession?.sellerId||''));
  const [geoText,setGeoText]=useState('');
  const [geoBusy,setGeoBusy]=useState(false);
  const locate=()=>{
    if(!navigator.geolocation){setGeoText('La géolocalisation n’est pas disponible sur cet appareil.');return;}
    setGeoBusy(true);setGeoText('Recherche du magasin le plus proche…');
    navigator.geolocation.getCurrentPosition(({coords})=>{
      const located=data.stores.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({ ...s, distance:kmBetween(coords.latitude,coords.longitude,s.lat,s.lon) })).sort((a,b)=>a.distance-b.distance);
      setGeoBusy(false);
      if(!located.length){setGeoText('Aucun magasin géolocalisé dans la liste.');return;}
      const nearest=located[0];setStore(nearest.id);
      setGeoText(`${nearest.name} proposé · à environ ${nearest.distance<1?`${Math.round(nearest.distance*1000)} m`:`${nearest.distance.toFixed(1).replace('.',',')} km`} (liste OpenStreetMap).`);
    },err=>{setGeoBusy(false);setGeoText(err.code===1?'Géolocalisation refusée. Vous pouvez choisir votre magasin dans la liste.':'Position indisponible. Choisissez votre magasin dans la liste.');},
    {enableHighAccuracy:false,timeout:12000,maximumAge:300000});
  };
  return <form className={`session-form ${modal?'session-form-modal':''}`} onSubmit={e=>{e.preventDefault();if(store&&seller)onSubmit({storeId:store,sellerId:Number(seller)});}}>
    <div className="session-fields">
      <label className="session-field store-field"><span>VOTRE MAGASIN</span><div className="select-wrap"><MapPin size={16}/><select aria-label="Votre magasin Fnac" value={store} onChange={e=>{setStore(e.target.value);setGeoText('');}} required><option value="">Choisir un magasin</option>{data.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><ChevronDown size={15} className="select-chevron"/></div></label>
      <button type="button" className={`locate-button ${geoBusy?'locating':''}`} onClick={locate} aria-label="Trouver le magasin le plus proche" title="Trouver le magasin le plus proche" disabled={geoBusy}><Crosshair size={17}/></button>
      <label className="session-field seller-field"><span>VOTRE PROFIL</span><div className="select-wrap"><UserRound size={16}/><select aria-label="Votre profil vendeur" value={seller} onChange={e=>setSeller(e.target.value)} required><option value="">Choisir un vendeur</option>{data.sellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><ChevronDown size={15} className="select-chevron"/></div></label>
      <button className="primary-button session-submit" type="submit" disabled={!store||!seller}>{modal?'Enregistrer':'C’est parti'} <ArrowRight size={16}/></button>
    </div>
    {geoText&&<div className="geo-message" role="status"><MapPin size={13}/>{geoText}</div>}
  </form>;
}
function WelcomePanel({data,onSubmit}) {
  return <section className="welcome-panel" id="selection">
    <div className="welcome-copy"><div className="welcome-icon"><Sparkles size={20}/></div><div><div className="micro-label">VOTRE ESPACE DE VENTE</div><h2>On se lance ?</h2><p>Choisissez votre magasin et votre profil.</p></div></div>
    <SessionForm data={data} onSubmit={onSubmit}/>
  </section>;
}
function Sidebar({onNavigate,onAdmin,onSession,onInstall,activeNav}) {
  const items=[['overview',LayoutDashboard,'Vue d’ensemble'],['services',Zap,'Mes services'],['ranking',Trophy,'Classement'],['summary',ChartNoAxesCombined,'Récapitulatifs']];
  return <aside className="sidebar">
    <div className="sidebar-brand"><Brand/></div>
    <div className="sidebar-group-label">VOTRE ESPACE</div>
    <nav className="side-nav" aria-label="Navigation principale">{items.map(([id,Icon,label])=><button key={id} className={`side-link ${activeNav===id?'is-active':''}`} onClick={()=>onNavigate(id)}><Icon size={18} strokeWidth={1.8}/><span>{label}</span>{activeNav===id&&<span className="nav-active-dot"/>}</button>)}</nav>
    <div className="sidebar-separator"/>
    <div className="sidebar-group-label">MON COMPTE</div>
    <nav className="side-nav"><button className="side-link" onClick={onSession}><UsersRound size={18} strokeWidth={1.8}/><span>Équipe & magasin</span></button><button className="side-link" onClick={onAdmin}><Settings2 size={18} strokeWidth={1.8}/><span>Administration</span></button></nav>
    <div className="sidebar-bottom"><div className="sidebar-tip"><div className="sidebar-tip-icon"><Zap size={16} fill="currentColor"/></div><strong>Chaque service compte.</strong><p>Ensemble, faisons la différence au quotidien.</p><span>À VOUS DE JOUER <ArrowUpRight size={12}/></span></div><button className="install-link" onClick={onInstall}><Download size={16}/> Installer l’application <ChevronRight size={14}/></button><div className="sidebar-copyright">FNAC PULSE <span>•</span> ESPACE ÉQUIPE</div></div>
  </aside>;
}
function Header({session,seller,store,connected,onBell,onSession,onAdmin}) {
  return <header className="topbar">
    <div className="mobile-brand"><Brand compact/></div>
    <div className="breadcrumbs"><span>Espace équipe</span><ChevronRight size={14}/><strong>Vue d’ensemble</strong></div>
    <div className="topbar-actions">
      <div className={`connection ${connected==='live'?'':'is-muted'}`} title={connected==='live'?'Mises à jour en direct':connected==='offline'?'Connexion interrompue':'En attente de votre sélection'}><Dot/><span>{connected==='live'?'En direct':connected==='offline'?'Hors connexion':'Votre espace'}</span></div>
      <span className="topbar-divider"/>
      <button className="icon-button top-bell" title="Notifications" aria-label="Notifications" onClick={onBell}><Bell size={19}/><span className="bell-marker"/></button>
      <button className="profile-trigger" onClick={onSession} aria-label={session?`Changer de profil, ${seller?.name||''}`:'Choisir mon profil'}>
        {seller?<Avatar name={seller.name} id={seller.id}/>:<span className="avatar avatar-blank"><UserRound size={17}/></span>}
        <span className="profile-text"><strong>{seller?.name||'Mon profil'}</strong><small>{store?.name||'Choisir mon espace'}</small></span><ChevronDown size={15}/>
      </button>
      <button className="icon-button mobile-settings" title="Administration" aria-label="Administration" onClick={onAdmin}><Settings2 size={19}/></button>
    </div>
  </header>;
}
function StatCard({label,value,detail,Icon,tone}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={17}/></span></div><div className="stat-value">{value??'—'}<span>{value===undefined||value===null?'':value>1?'services':'service'}</span></div><div className="stat-detail">{detail}</div></div>;
}
function ServiceCard({service,index,count,session,pending,onAdd,onRemove}) {
  const Icon=icons[service.icon]||MoreHorizontal;
  return <div className="service-card"><div className={`service-icon ${iconColors[index%iconColors.length]}`}><Icon size={19} strokeWidth={1.8}/></div><div className="service-copy"><strong title={service.name}>{service.name}</strong><span>{session?`${count} aujourd’hui`:'À déclarer'}</span></div><div className="service-controls">{session&&count>0&&<button className="minus-button" onClick={()=>onRemove(service)} disabled={pending} title={`Retirer une vente ${service.name}`} aria-label={`Retirer une vente ${service.name}`}><Minus size={15}/></button>}<button className="plus-button" onClick={()=>onAdd(service)} disabled={pending} title={`Ajouter une vente ${service.name}`} aria-label={`Ajouter une vente ${service.name}`}><Plus size={19} strokeWidth={2}/></button></div></div>;
}
function Ranking({leaders,hasSession}) {
  return <section className="panel ranking-panel" id="ranking"><div className="panel-heading"><div><div className="section-kicker"><span className="kicker-line"/> LES PERFORMANCES</div><h2>Top de l’équipe</h2><p>Les vendeurs à l’honneur aujourd’hui.</p></div><span className="panel-icon gold"><Trophy size={18}/></span></div>
    {leaders?.length>0 ? <div className="ranking-list">{leaders.map((leader,i)=><div className="ranking-row" key={leader.id}><span className={`rank-number rank-${i+1}`}>{String(i+1).padStart(2,'0')}</span><Avatar name={leader.name} id={leader.id}/><div className="rank-name"><strong>{leader.name}</strong><span>{i===0?'En tête du classement':i===1?'Sur la deuxième marche':'Sur le podium'}</span></div><div className="rank-total"><strong>{leader.count}</strong><span>{leader.count>1?'ventes':'vente'}</span></div></div>)}</div> : <div className="ranking-empty"><div className="empty-podium"><div className="podium-circle">1</div><div className="podium-circle">2</div><div className="podium-circle">3</div></div><strong>{hasSession?'À vous de jouer !':'Le podium vous attend'}</strong><p>{hasSession?'Les premières ventes feront apparaître le classement.':'Sélectionnez votre espace pour voir le classement.'}</p></div>}
    <div className="ranking-footer"><Dot/> {hasSession?'Classement mis à jour en direct':'Classement disponible après sélection'}</div>
  </section>;
}
function ActivityCard({activity,hasSession}) {
  return <section className="panel activity-panel"><div className="activity-heading"><div><div className="section-kicker"><span className="kicker-line"/> AU FIL DE LA JOURNÉE</div><h2>Activité récente</h2></div><span className="activity-live"><Dot/> EN DIRECT</span></div>
    {activity?.length>0?<div className="activity-list">{activity.map(item=><div className="activity-row" key={item.id}><Avatar name={item.sellerName} id={item.sellerId} size="small"/><div><p><strong>{item.sellerName}</strong> a ajouté <strong>{item.serviceName}</strong></p><span>Aujourd’hui · {timeLabel(item.createdAt)}</span></div><span className="activity-add">+1</span></div>)}</div>:<div className="activity-empty"><span><Activity size={19}/></span><p>{hasSession?'Les ventes de l’équipe apparaîtront ici en temps réel.':'L’activité de votre magasin apparaîtra ici.'}</p></div>}
  </section>;
}
function Summary({stats,hasSession}) {
  const [period,setPeriod]=useState('day');
  const labels={day:'Aujourd’hui',week:'Cette semaine',month:'Ce mois'};
  const current=stats?.[period];
  const max=Math.max(1,...(current?.byService||[]).map(s=>s.count));
  return <section className="panel summary-panel" id="summary"><div className="summary-heading"><div><div className="section-kicker"><span className="kicker-line"/> PRENDRE DU RECUL</div><h2>Le récap’ des services</h2><p>Retrouvez les résultats de votre équipe en un coup d’œil.</p></div><div className="period-tabs" role="tablist" aria-label="Période du récapitulatif">{Object.entries(labels).map(([id,label])=><button role="tab" aria-selected={period===id} key={id} className={period===id?'selected':''} onClick={()=>setPeriod(id)}>{label}</button>)}</div></div>
    <div className="summary-content"><div className="summary-total"><span className="summary-total-label">TOTAL ÉQUIPE</span><strong>{current?.total??'—'}</strong><span>{current?current.total>1?'services vendus':'service vendu':'Sélectionnez un magasin'}</span><div className="summary-date"><CalendarDays size={14}/>{current?`${dateLabel(current.start,{day:'numeric',month:'short'})}${current.start!==current.end?` — ${dateLabel(current.end,{day:'numeric',month:'short'})}`:''}`:'En attente'}</div></div>
      <div className="summary-breakdown">{current ? current.byService.map(s=><div className="breakdown-row" key={s.id}><div><span>{s.name}</span><strong>{s.count}</strong></div><div className="progress-track"><span style={{width:`${s.count?Math.max(3,s.count/max*100):0}%`}}/></div></div>) : <div className="summary-empty"><span className="summary-empty-icon"><ChartNoAxesCombined size={20}/></span><div><strong>Les chiffres arrivent bientôt.</strong><p>Choisissez votre magasin pour consulter son récapitulatif.</p></div></div>}</div>
    </div>
  </section>;
}
function MobileNav({onNavigate,onSession,active}) {
  return <nav className="mobile-nav" aria-label="Navigation mobile">{[['overview',LayoutDashboard,'Accueil'],['services',Zap,'Services'],['ranking',Trophy,'Classement'],['summary',ChartNoAxesCombined,'Bilan']].map(([id,Icon,name])=><button key={id} onClick={()=>onNavigate(id)} className={active===id?'active':''}><Icon size={19}/><span>{name}</span></button>)}<button onClick={onSession}><UserRound size={19}/><span>Profil</span></button></nav>;
}
function urlBase64ToUint8Array(base64) {const padding='='.repeat((4-base64.length%4)%4);const raw=atob((base64+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}

export default function App() {
  const [session,setSession]=useState(getSession);
  const [data,setData]=useState(()=>{const cached=getCached();return cached&&JSON.stringify(cached.session)===JSON.stringify(getSession())?cached.data:null;});
  const [loadFailed,setLoadFailed]=useState(false);
  const [connection,setConnection]=useState('waiting');
  const [activeNav,setActiveNav]=useState('overview');
  const [sessionModal,setSessionModal]=useState(false);
  const [adminModal,setAdminModal]=useState(false);
  const [notificationsModal,setNotificationsModal]=useState(false);
  const [installModal,setInstallModal]=useState(false);
  const [installPrompt,setInstallPrompt]=useState(null);
  const [notificationsEnabled,setNotificationsEnabled]=useState(false);
  const [notificationBusy,setNotificationBusy]=useState(false);
  const [pending,setPending]=useState({});
  const [toast,setToast]=useState(null);
  const requestNumber=useRef(0), pendingRef=useRef(new Set()), clientId=useRef(uid()), toastTimer=useRef(null);
  const store=data?.stores?.find(s=>s.id===session?.storeId), seller=data?.sellers?.find(s=>s.id===session?.sellerId);

  const flash=useCallback((message,options={})=>{clearTimeout(toastTimer.current);setToast({message,...options});toastTimer.current=setTimeout(()=>setToast(null),options.duration||5500);},[]);
  const refresh=useCallback(async()=>{
    const n=++requestNumber.current;
    const query=session?`?storeId=${encodeURIComponent(session.storeId)}&sellerId=${session.sellerId}`:'';
    try {
      const result=await api('/api/bootstrap'+query);
      if(n!==requestNumber.current)return;
      setData(result);setLoadFailed(false);
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({data:result,session}));}catch{}
      if(session&&(!result.stores.some(s=>s.id===session.storeId)||!result.sellers.some(s=>s.id===session.sellerId))){
        localStorage.removeItem(SESSION_KEY);setSession(null);flash('Votre profil ou votre magasin a été modifié. Sélectionnez à nouveau votre espace.');
      }
    } catch(e) {
      if(n!==requestNumber.current)return;
      setConnection('offline');setLoadFailed(true);
      const saved=getCached();
      if(saved && JSON.stringify(saved.session)===JSON.stringify(session))setData(saved.data);
    }
  },[session,flash]);
  useEffect(()=>{refresh();},[refresh]);
  useEffect(()=>{
    if(!session){setConnection('waiting');return;}
    const source=new EventSource(`/api/events?storeId=${encodeURIComponent(session.storeId)}`);
    source.addEventListener('ready',()=>{setConnection('live');refresh();});
    source.addEventListener('change',e=>{
      try {const event=JSON.parse(e.data);if(event.kind==='sale'&&event.clientId!==clientId.current) flash(`${event.sellerName} vient de vendre ${event.serviceName} !`,{tone:'celebrate'});} catch{}
      refresh();
    });
    source.onerror=()=>setConnection('offline');
    return ()=>source.close();
  },[session,refresh,flash]);
  useEffect(()=>{
    const onOnline=()=>refresh();window.addEventListener('online',onOnline);
    const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},60000);
    return ()=>{window.removeEventListener('online',onOnline);clearInterval(timer);};
  },[refresh]);
  useEffect(()=>{
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    const handler=e=>{e.preventDefault();setInstallPrompt(e)};
    window.addEventListener('beforeinstallprompt',handler);return ()=>window.removeEventListener('beforeinstallprompt',handler);
  },[]);
  useEffect(()=>{
    if(!session||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)||Notification.permission!=='granted'){setNotificationsEnabled(false);return;}
    let cancelled=false;
    navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(async sub=>{
      if(!sub){if(!cancelled)setNotificationsEnabled(false);return;}
      await api('/api/push/subscribe',{method:'POST',body:{storeId:session.storeId,sellerId:session.sellerId,subscription:sub.toJSON()}});
      if(!cancelled)setNotificationsEnabled(true);
    }).catch(()=>{if(!cancelled)setNotificationsEnabled(false)});
    return ()=>{cancelled=true};
  },[session]);
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);

  function selectSession(next){
    localStorage.setItem(SESSION_KEY,JSON.stringify(next));
    setData(d=>d?{...d,stats:null}:d);setSession(next);setSessionModal(false);setActiveNav('overview');
    window.scrollTo({top:0,behavior:'smooth'});
    const person=data?.sellers.find(s=>s.id===next.sellerId);flash(`Bienvenue${person?`, ${person.name}`:''} ! Votre espace est prêt.`);
  }
  function changeSession(){if(session)setSessionModal(true);else {document.getElementById('selection')?.scrollIntoView({behavior:'smooth',block:'center'});document.querySelector('[aria-label="Votre magasin Fnac"]')?.focus();}}
  function navigate(id){setActiveNav(id);document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});}
  async function addSale(service){
    if(!session){flash('Choisissez d’abord votre magasin et votre profil.',{tone:'warning'});changeSession();return;}
    if(connection==='offline'){flash('Connexion interrompue : la vente n’a pas été enregistrée.',{tone:'warning'});return;}
    if(pendingRef.current.has(service.id))return;
    pendingRef.current.add(service.id);setPending(p=>({...p,[service.id]:true}));
    try {
      const result=await api('/api/sales',{method:'POST',body:{...session,serviceId:service.id,requestId:uid(),clientId:clientId.current}});
      await refresh();
      flash(`${service.name} ajouté à votre journée.`,{tone:'success',actionLabel:'Annuler',action:async()=>{
        try {await api(`/api/sales/${result.id}`,{method:'DELETE',body:session});await refresh();flash('Vente annulée.');}
        catch(e){flash(e.message,{tone:'warning'});}
      },duration:8000});
    } catch(e){flash(e.message,{tone:'warning'});} finally{pendingRef.current.delete(service.id);setPending(p=>({...p,[service.id]:false}));}
  }
  async function removeSale(service){
    if(!session||pendingRef.current.has(service.id))return;
    if(connection==='offline'){flash('Connexion interrompue : aucune vente n’a été modifiée.',{tone:'warning'});return;}
    pendingRef.current.add(service.id);setPending(p=>({...p,[service.id]:true}));
    try{await api('/api/sales/remove',{method:'POST',body:{...session,serviceId:service.id}});await refresh();flash(`Une vente ${service.name} a été retirée.`);}
    catch(e){flash(e.message,{tone:'warning'});}finally{pendingRef.current.delete(service.id);setPending(p=>({...p,[service.id]:false}));}
  }
  async function enableNotifications(){
    if(!session){setNotificationsModal(false);flash('Choisissez d’abord votre magasin et votre profil.',{tone:'warning'});changeSession();return;}
    if(!window.isSecureContext||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) {flash('Notifications indisponibles ici : utilisez une connexion HTTPS et un navigateur compatible.',{tone:'warning',duration:8000});return;}
    setNotificationBusy(true);
    try {
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error(permission==='denied'?'Notifications bloquées. Autorisez-les dans les réglages du navigateur.':'Autorisation de notification non accordée.');
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(data.pushPublicKey)});
      await api('/api/push/subscribe',{method:'POST',body:{storeId:session.storeId,sellerId:session.sellerId,subscription:subscription.toJSON()}});
      setNotificationsEnabled(true);setNotificationsModal(false);flash('Notifications activées sur cet appareil.',{tone:'success'});
    } catch(e){flash(e.message||'Impossible d’activer les notifications sur cet appareil.',{tone:'warning',duration:8000});}
    finally{setNotificationBusy(false);}
  }
  async function disableNotifications(){
    setNotificationBusy(true);
    try {const registration=await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription();if(sub){await api('/api/push/subscribe',{method:'DELETE',body:{endpoint:sub.endpoint}});await sub.unsubscribe();}setNotificationsEnabled(false);setNotificationsModal(false);flash('Notifications désactivées sur cet appareil.');}
    catch(e){flash('Impossible de désactiver les notifications.',{tone:'warning'});}finally{setNotificationBusy(false);}
  }
  async function installApp(){if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);setInstallModal(false);}else setInstallModal(true);}

  if(!data)return <div className="app-loading"><Brand/>{loadFailed?<><p>Connexion indisponible. Vérifiez votre réseau pour ouvrir votre espace.</p><button className="primary-button" onClick={refresh}>Réessayer</button></>:<p>Préparation de votre espace…</p>}</div>;
  const stats=data.stats, counts=Object.fromEntries((stats?.mine||[]).map(c=>[c.serviceId,c.count]));
  return <div className="app-shell">
    <Sidebar onNavigate={navigate} onAdmin={()=>setAdminModal(true)} onSession={changeSession} onInstall={installApp} activeNav={activeNav}/>
    <div className="main-shell"><Header session={session} seller={seller} store={store} connected={connection} onBell={()=>setNotificationsModal(true)} onSession={changeSession} onAdmin={()=>setAdminModal(true)}/>
      <main className="content" id="overview">
        {connection==='offline'&&session&&<div className="offline-banner"><WifiOff size={16}/><div><strong>Connexion interrompue.</strong> Les dernières données restent visibles, mais la saisie est suspendue jusqu’au retour de la connexion.</div><button onClick={refresh}>Réessayer</button></div>}
        <div className="page-intro"><div><div className="eyebrow"><span/> VOTRE TABLEAU DE BORD</div><h1>Bonjour{seller?`, ${seller.name}`:', l’équipe'}<span className="hello-dot">.</span></h1><p>Ensemble, faisons de chaque service une réussite.</p></div><div className="date-chip"><span className="date-icon"><CalendarDays size={17}/></span><div><span>AUJOURD’HUI</span><strong>{dateLabel(data.today)}</strong></div></div></div>
        {!session?<WelcomePanel data={data} onSubmit={selectSession}/>:<div className="session-strip"><div className="strip-icon"><Store size={18}/></div><div className="strip-copy"><span>VOTRE ESPACE DE VENTE</span><strong>{store?.name||'Votre magasin'}</strong></div><div className="strip-divider"/><div className="strip-user"><Avatar name={seller?.name} id={seller?.id} size="small"/><span>Connecté en tant que <strong>{seller?.name}</strong></span></div><button className="text-button" onClick={()=>setSessionModal(true)}>Changer <ArrowRight size={14}/></button></div>}
        <div className="section-overline"><div><span className="kicker-line"/> EN UN COUP D’ŒIL</div><span>{session?'Les chiffres de votre magasin':'Choisissez votre espace pour démarrer'}</span></div>
        <section className="stats-grid" aria-label="Chiffres clés"><StatCard label="AUJOURD’HUI" value={stats?.day.total} detail="Ventes de l’équipe" Icon={Zap} tone="gold"/><StatCard label="MA JOURNÉE" value={stats?.mineTotal} detail="Mes services enregistrés" Icon={UserRound} tone="soft-blue"/><StatCard label="CETTE SEMAINE" value={stats?.week.total} detail="Depuis lundi" Icon={ChartNoAxesCombined} tone="soft-green"/><StatCard label="CE MOIS-CI" value={stats?.month.total} detail="Ventes de l’équipe" Icon={CalendarDays} tone="soft-purple"/></section>
        <div className="dashboard-grid"><div className="main-column"><section className="panel services-panel" id="services"><div className="panel-heading"><div><div className="section-kicker"><span className="kicker-line"/> PLACE À L’ACTION</div><h2>Ajouter un service</h2><p>Une vente ? Un clic et c’est enregistré.</p></div><span className="service-count">{data.services.length} SERVICES</span></div><div className="services-grid">{data.services.map((s,i)=><ServiceCard key={s.id} service={s} index={i} count={counts[s.id]||0} session={session} pending={pending[s.id]} onAdd={addSale} onRemove={removeSale}/>)}</div><div className="service-hint"><Info size={14}/><span>Une erreur ? Utilisez le bouton <strong>−</strong> pour retirer votre dernière vente du service.</span></div></section>
          <Summary stats={stats} hasSession={!!session}/>
        </div><div className="right-column"><Ranking leaders={stats?.leaderboard} hasSession={!!session}/><ActivityCard activity={stats?.activity} hasSession={!!session}/><div className="notification-card"><span className="notification-icon"><BellRing size={18}/></span><div><strong>{notificationsEnabled?'Vous êtes dans la boucle !':'Restez dans la boucle'}</strong><p>{notificationsEnabled?'Notifications activées sur cet appareil.':'Soyez prévenu des ventes de votre équipe.'}</p></div><button onClick={()=>setNotificationsModal(true)}>{notificationsEnabled?'Gérer':'Activer'} <ArrowRight size={13}/></button></div></div></div>
        <footer className="page-footer"><span>Fnac Pulse <span>•</span> Chaque service compte.</span><span>Fait pour les équipes, avec <span className="footer-heart">♥</span></span></footer>
      </main>
    </div>
    <MobileNav onNavigate={navigate} onSession={changeSession} active={activeNav}/>
    {sessionModal&&<Modal title="Changer d’espace" subtitle="Sélectionnez votre magasin et votre profil vendeur." onClose={()=>setSessionModal(false)}><SessionForm data={data} initialSession={session} modal onSubmit={selectSession}/><p className="modal-hint"><MapPin size={14}/> La position est utilisée uniquement pour proposer le magasin le plus proche parmi ceux référencés.</p></Modal>}
    {adminModal&&<Admin onClose={()=>setAdminModal(false)} data={data} session={session} onChanged={refresh}/>}
    {notificationsModal&&<Modal title="Notifications d’équipe" subtitle="Ne manquez aucune nouvelle vente de votre magasin." onClose={()=>setNotificationsModal(false)}><div className="notification-modal-hero"><div className="notification-hero-icon"><BellRing size={25}/></div><div><strong>{notificationsEnabled?'Notifications activées':'Un petit signal, une belle dynamique.'}</strong><p>Chaque nouvelle vente peut vous être signalée sur cet appareil, même lorsque l’application est fermée.</p></div></div><div className="notification-details"><div><Check size={16}/> Une notification pour chaque nouvelle vente</div><div><Check size={16}/> Uniquement pour le magasin sélectionné</div><div><Check size={16}/> Activation individuelle sur chaque appareil</div></div><div className="notification-device-note"><Info size={15}/><span>Sur iPhone et iPad, installez d’abord l’application sur l’écran d’accueil (iOS/iPadOS 16.4 ou plus). Une connexion HTTPS et un navigateur compatible sont nécessaires.</span></div><button className={notificationsEnabled?'outline-button full-button':'primary-button full-button'} disabled={notificationBusy} onClick={notificationsEnabled?disableNotifications:enableNotifications}>{notificationBusy?'Un instant…':notificationsEnabled?'Désactiver sur cet appareil':'Activer les notifications'} {notificationsEnabled?<BellOff size={16}/>:<Bell size={16}/>}</button></Modal>}
    {installModal&&<Modal title="Installer Fnac Pulse" subtitle="Votre espace d’équipe toujours à portée de main." onClose={()=>setInstallModal(false)}><div className="install-steps"><div><span>1</span><p><strong>Sur iPhone ou iPad</strong><br/>Dans Safari, touchez Partager, puis « Sur l’écran d’accueil ».</p></div><div><span>2</span><p><strong>Sur Android ou ordinateur</strong><br/>Ouvrez le menu du navigateur, puis choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p></div></div><p className="modal-hint"><Info size={14}/> L’installation et les notifications nécessitent une adresse HTTPS et un navigateur compatible.</p><button className="primary-button full-button" onClick={()=>setInstallModal(false)}>J’ai compris <Check size={16}/></button></Modal>}
    {toast&&<div className={`toast toast-${toast.tone||'default'}`} role="status"><span className="toast-icon">{toast.tone==='warning'?<Info size={17}/>:<CircleCheck size={17}/>}</span><span>{toast.message}</span>{toast.action&&<button onClick={()=>{const action=toast.action;setToast(null);action();}}>{toast.actionLabel}</button>}<button className="toast-close" aria-label="Fermer" onClick={()=>setToast(null)}><X size={16}/></button></div>}
  </div>;
}

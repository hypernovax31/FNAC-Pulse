import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Target, Zap, Trophy, ChartNoAxesCombined, Settings2, MapPin, ChevronDown, ChevronRight, ArrowRight,
  Activity, Bell, BellOff, Plus, Minus, UserRound, UsersRound, Sparkles, Crosshair, CalendarDays,
  Check, MoreHorizontal, Play, Smartphone, MonitorSmartphone, Shield, ShieldCheck, HardHat, IdCard, DollarSign, PackageCheck, BadgePlus,
  Repeat2, RefreshCw, Tv, Wifi, Clock3, X, Download, Store, WifiOff, Info, CircleCheck, ArrowUpRight, SunMoon, Sun, Moon, Monitor, Volume2, VolumeX
} from 'lucide-react';
import Admin, { Modal } from './Admin';
import { api, uid, dateLabel, timeLabel, kmBetween } from './api';
import { CLOUD, observeVendor, sellerLogin, sellerChoosePin, sellerLogout, listenStore, subscribeFcm, unsubscribeFcm, notificationsWanted } from './cloud';
import { parisToday } from './cloud-stats';
import { sellerStoreId } from './catalog';
import { storeSelectionGroups } from './store-directory.js';
import { departmentsForStore, sellerDepartmentId, sellersForDepartment } from './departments';
import { serviceIconKey } from './service-icons';
import { THEME_KEY, readTheme, applyTheme } from './theme';
import { createSaleSound, saleSoundEnabled, saveSaleSound, SALE_SOUND_KEY } from './sale-sound';
import { calendarChip } from './calendar';
import { readDeviceProfile, saveDeviceProfile, clearDeviceProfile } from './device-profile';
import { GoalForm, GoalsPanel } from './Goals';
import { normalizeWorkdays } from './goals.js';
import { saleMessage } from './sale-message';
import { isStandalone, installPlatform, notificationBanner } from './install.js';
import { InstallDialog, NotificationsDialog } from './PwaDialogs';

const APP_BASE = import.meta.env.BASE_URL;
const SESSION_KEY = 'fnac-pulse-session-v1';
const CACHE_KEY = 'fnac-pulse-last-view-v1';
const GOALS_CACHE_KEY = 'fnac-pulse-personal-goals-v1';
const SUMMARY_CACHE_KEY = 'fnac-pulse-summary-goals-v1';
// Un marteau et une clé croisés, dans le même trait que les icônes Lucide.
function ToolsIcon({size=24,strokeWidth=2}) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    <g transform="translate(24 0) scale(-1 1)"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></g>
  </svg>;
}
const icons = { play:Play, phone:Smartphone, devices:MonitorSmartphone, shield:ShieldCheck, package:PackageCheck, badge:BadgePlus, repeat:Repeat2, refresh:RefreshCw, tv:Tv, wifi:Wifi, other:MoreHorizontal, tools:ToolsIcon, 'shield-plain':Shield, 'hard-hat':HardHat, 'id-card':IdCard, dollar:DollarSign };
const iconColors = ['sun','lavender','blue','mint','peach','sun','lavender','mint','blue','peach','sun'];
const avatarColors = ['#f0c84e','#cbdacf','#d4dbed','#ead4bc','#e8cdd2','#d6d2e8','#d0e2df','#f3d7be'];
function getSession() { try { const a=JSON.parse(localStorage.getItem(SESSION_KEY));return a?.storeId&&a?.sellerId?a:null; } catch {return null;} }
function getCached() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch {return null;} }
function goalOwnerKey(session) {return session?JSON.stringify([session.storeId,session.sellerId,session.uid||'',session.accessVersion||'']):'';}
function goalData(result) {return {goals:result?.goals||null,workdays:normalizeWorkdays(result?.workdays),workdaysRevision:result?.workdaysRevision||null};}
function getCachedGoals(owner) {
  try{const x=JSON.parse(localStorage.getItem(GOALS_CACHE_KEY));return goalData(x?.owner===owner?x:null);}catch{return goalData(null);}
}
function cacheGoals(owner,result) {try{localStorage.setItem(GOALS_CACHE_KEY,JSON.stringify({owner,...goalData(result)}));}catch{}}
function getCachedSummary(key) {
  try{const x=JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY));return x?.key===key?x.data:null;}catch{return null;}
}
function cacheSummary(key,data) {try{localStorage.setItem(SUMMARY_CACHE_KEY,JSON.stringify({key,data}));}catch{}}
function initial(name) {return (name || '?').trim().slice(0,1).toUpperCase();}
function Avatar({name,id,size='normal'}) {return <span className={`avatar avatar-${size}`} style={{backgroundColor:avatarColors[(Number(id)||0)%avatarColors.length]}}>{initial(name)}</span>}
function Brand({compact=false}) {return <div className={`brand ${compact?'brand-compact':''}`}><img src={`${APP_BASE}fnac.svg`} alt="Fnac"/><div className="brand-word"><strong>pulse<span className="brand-period">.</span></strong>{!compact&&<span>ESPACE ÉQUIPE</span>}</div></div>}
function Dot() {return <span className="live-dot" aria-hidden="true"/>}
function DateChip({today}) {
  const fullDate=dateLabel(today),parts=calendarChip(today);
  return <time className="date-chip" dateTime={today} title={`${fullDate} · semaine ${parts.week.slice(1)}`} aria-label={`${fullDate}, semaine ${parts.week.slice(1)}`}>
    <span className="date-week"><small>SEM.</small><strong>{parts.week}</strong></span><span className="date-parts"><strong>{parts.weekday}</strong><small>{parts.day} {parts.month}</small></span>
  </time>;
}

function SessionForm({data,initialSession,initialProfile,onSubmit,onForgetProfile,onRefreshProfile,modal=false}) {
  const rememberedPerson=initialProfile&&data.sellers.find(s=>Number(s.id)===Number(initialProfile.sellerId)&&sellerStoreId(s)===initialProfile.storeId);
  const rememberedStore=initialProfile&&data.stores.find(s=>s.id===initialProfile.storeId);
  const fixed=!!(CLOUD&&rememberedPerson&&rememberedStore);
  const unavailable=!!(CLOUD&&initialProfile&&!fixed);
  const start=initialProfile||initialSession;
  const initialPerson=data.sellers.find(s=>Number(s.id)===Number(start?.sellerId)&&sellerStoreId(s)===start?.storeId);
  const [store,setStore]=useState(start?.storeId||'');
  const [department,setDepartment]=useState(initialPerson?sellerDepartmentId(initialPerson):start?.departmentId||'');
  const [seller,setSeller]=useState(String(start?.sellerId||''));
  const [geoText,setGeoText]=useState(''),[geoBusy,setGeoBusy]=useState(false);
  const [pinMode,setPinMode]=useState(CLOUD?'idle':'login'),[statusError,setStatusError]=useState(''),[statusRetry,setStatusRetry]=useState(0);
  const [pin,setPin]=useState(''),[newPin,setNewPin]=useState(''),[confirmPin,setConfirmPin]=useState('');
  const [formBusy,setFormBusy]=useState(false),[formError,setFormError]=useState('');
  const geoRequest=useRef(0);
  useEffect(()=>()=>{geoRequest.current++;},[]);
  useEffect(()=>{if(fixed&&rememberedPerson)setDepartment(sellerDepartmentId(rememberedPerson));},[fixed,rememberedPerson?.departmentId]);
  useEffect(()=>{
    if(!CLOUD)return;
    if(unavailable||!store||!department||!seller){setPinMode('idle');setStatusError('');return;}
    const controller=new AbortController();let cancelled=false,timer,retries=0;
    setPinMode('loading');setStatusError('');setFormError('');
    const check=()=>api('/api/auth/status',{method:'POST',body:{storeId:store,departmentId:department,sellerId:Number(seller)},signal:controller.signal}).then(result=>{
      if(cancelled)return;
      if(typeof result?.needsPin!=='boolean')throw new Error('Vérification du profil impossible. Réessayez.');
      setPinMode(result.needsPin?'setup':'login');
    }).catch(error=>{
      if(cancelled)return;
      if(error.status===503&&retries++<8){timer=setTimeout(check,750);return;}
      setPinMode('error');setStatusError(error.message||'Vérification du profil impossible. Réessayez.');
    });
    check();return ()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[store,department,seller,statusRetry,unavailable]);
  const departments=store?departmentsForStore(data,store):[];
  const storeSellers=department?sellersForDepartment(data.sellers,store,department):[];
  const storeGroups=storeSelectionGroups(data.stores,data.sellers,{selectedId:store});
  function clearSecrets(){setPin('');setNewPin('');setConfirmPin('');setFormError('');}
  function cancelLocate(){geoRequest.current++;setGeoBusy(false);setGeoText('');}
  const changeStore=value=>{if(value!==store){setDepartment('');setSeller('');clearSecrets();}setStore(value);};
  const changeDepartment=value=>{if(value!==department){setSeller('');clearSecrets();}setDepartment(value);};
  const locate=()=>{
    if(!navigator.geolocation){setGeoText('La géolocalisation n’est pas disponible sur cet appareil.');return;}
    const request=++geoRequest.current;
    setGeoBusy(true);setGeoText('Recherche du magasin le plus proche…');
    navigator.geolocation.getCurrentPosition(({coords})=>{
      if(request!==geoRequest.current)return;
      const located=storeGroups.all.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({ ...s, distance:kmBetween(coords.latitude,coords.longitude,s.lat,s.lon) })).sort((a,b)=>a.distance-b.distance);
      setGeoBusy(false);
      if(!located.length){setGeoText('Aucun magasin géolocalisé dans la liste.');return;}
      const nearest=located[0];changeStore(nearest.id);
      setGeoText(`${nearest.name} proposé · à environ ${nearest.distance<1?`${Math.round(nearest.distance*1000)} m`:`${nearest.distance.toFixed(1).replace('.',',')} km`}. Certains magasins n’ont pas de coordonnées.`);
    },err=>{if(request!==geoRequest.current)return;setGeoBusy(false);setGeoText(err.code===1?'Géolocalisation refusée. Vous pouvez choisir votre magasin dans la liste.':'Position indisponible. Choisissez votre magasin dans la liste.');},
    {enableHighAccuracy:false,timeout:12000,maximumAge:300000});
  };
  async function submit(event) {
    event.preventDefault();if(!store||!department||!seller||formBusy)return;
    cancelLocate();const first=CLOUD&&pinMode==='setup';
    if(CLOUD&&!['setup','login'].includes(pinMode))return;
    if(first&&newPin!==confirmPin){setFormError('Les deux codes PIN ne correspondent pas.');return;}
    setFormBusy(true);setFormError('');
    const selection={storeId:store,departmentId:department,sellerId:Number(seller)};
    try {
      await onSubmit(selection,first?newPin:pin,first?{firstTime:true}:null);
      clearSecrets();
    } catch(error){
      if(first&&error.status===409){setPinMode('error');setStatusError(`${error.message} Vérifiez le profil avant de continuer.`);}
      else if(first&&(!error.status||error.status>=500)){
        setPinMode('error');setStatusError('Connexion interrompue. Vérifiez le profil : si votre PIN a été enregistré, reconnectez-vous avec ce code.');
      } else if(CLOUD&&!first&&error.status===401){
        // L'administrateur a peut-être réinitialisé l'accès pendant l'affichage du formulaire.
        try {const status=await api('/api/auth/status',{method:'POST',body:selection});
          if(status.needsPin){setPin('');setPinMode('setup');setFormError('Votre accès a été réinitialisé. Choisissez votre nouveau PIN.');}
          else setFormError(error.message);
        } catch {setFormError(error.message);}
      } else setFormError(error.message);
    }finally{setFormBusy(false);}
  }
  if(unavailable)return <div className="profile-unavailable" role="alert"><p>Le profil enregistré sur cet appareil n’est plus disponible. Contactez votre responsable.</p><button type="button" className="outline-button" onClick={onForgetProfile}>Retirer le profil de cet appareil</button></div>;
  return <form className={`session-form ${modal?'session-form-modal':''}`} onSubmit={submit}>
    {fixed&&<div className="remembered-profile"><Avatar name={rememberedPerson.name} id={rememberedPerson.id}/><div><span>VOTRE PROFIL SUR CET APPAREIL</span><strong>{rememberedPerson.name}</strong><small>{rememberedStore.name} · {departments.find(d=>d.id===department)?.name||'Votre département'}</small></div></div>}
    <div className="session-fields">
      {!fixed&&<>
        <label className="session-field store-field"><span>VOTRE MAGASIN</span><div className="select-wrap"><MapPin size={16}/><select aria-label="Votre magasin Fnac" value={store} onChange={e=>{cancelLocate();changeStore(e.target.value);}} disabled={formBusy} required><option value="">Choisir un magasin</option>{storeGroups.official.length>0&&<optgroup label="Annuaire Fnac">{storeGroups.official.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}{storeGroups.other.length>0&&<optgroup label="Magasins ajoutés ou historiques">{storeGroups.other.map(s=><option key={s.id} value={s.id}>{s.name}{s.directoryStatus==='historical'?' · ancien catalogue':''}</option>)}</optgroup>}{data.directoryRegions?.length>0&&<optgroup label="Régions sans fiche magasin · relevé 2026">{data.directoryRegions.map(name=><option key={name} value="" disabled>{name} · magasin non précisé</option>)}</optgroup>}</select><ChevronDown size={15} className="select-chevron"/></div></label>
        <button type="button" className={`locate-button ${geoBusy?'locating':''}`} onClick={locate} aria-label="Trouver un magasin proche" title="Trouver un magasin proche parmi ceux géolocalisés" disabled={geoBusy||formBusy}><Crosshair size={17}/></button>
        <label className="session-field department-field"><span>VOTRE DÉPARTEMENT</span><div className="select-wrap"><UsersRound size={16}/><select aria-label="Votre département" value={department} onChange={e=>{cancelLocate();changeDepartment(e.target.value);}} disabled={formBusy||!store||!departments.length} required><option value="">Choisir un département</option>{departments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select><ChevronDown size={15} className="select-chevron"/></div></label>
        <label className="session-field seller-field"><span>VOTRE PROFIL</span><div className="select-wrap"><UserRound size={16}/><select aria-label="Votre profil vendeur" value={seller} onChange={e=>{cancelLocate();setSeller(e.target.value);clearSecrets();}} disabled={formBusy||!department||!storeSellers.length} required><option value="">{department&&!storeSellers.length?'Aucun vendeur dans ce département':'Choisir un vendeur'}</option>{storeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><ChevronDown size={15} className="select-chevron"/></div></label>
      </>}
      {CLOUD&&pinMode==='login'&&<label className="session-field pin-field"><span>CODE PIN PERSONNEL</span><input className="text-input pin-input" aria-label="Code PIN personnel" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{8}" maxLength={8} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} placeholder="8 chiffres" disabled={formBusy} required/></label>}
      {(!CLOUD||pinMode==='login')&&<button className="primary-button session-submit" type="submit" disabled={!store||!department||!seller||formBusy||(CLOUD&&pin.length!==8)}>{formBusy?'Connexion…':modal?'Enregistrer':'Se connecter'} <ArrowRight size={16}/></button>}
    </div>
    {CLOUD&&pinMode==='loading'&&<p className="pin-status" role="status">Vérification de votre profil…</p>}
    {CLOUD&&pinMode==='error'&&<div className="profile-status-error" role="alert"><span>{statusError}</span><button type="button" className="text-button" onClick={()=>{clearSecrets();onRefreshProfile?.();setStatusRetry(x=>x+1);}}>Vérifier à nouveau</button></div>}
    {CLOUD&&pinMode==='setup'&&<div className="pin-setup">
      <div className="pin-setup-intro"><ShieldCheck size={19}/><div><strong>Première connexion : choisissez votre PIN</strong><p>Choisissez un code personnel de 8 chiffres et gardez-le secret. Il sera demandé après une déconnexion.</p></div></div>
      <div className="pin-setup-fields"><label><span className="form-label">VOTRE CODE PIN</span><input className="text-input" aria-label="Votre nouveau code PIN" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{8}" maxLength={8} placeholder="8 chiffres" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,''))} disabled={formBusy} required/></label><label><span className="form-label">CONFIRMER LE PIN</span><input className="text-input" aria-label="Confirmer votre code PIN" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{8}" maxLength={8} placeholder="8 chiffres" value={confirmPin} onChange={e=>setConfirmPin(e.target.value.replace(/\D/g,''))} disabled={formBusy} required/></label></div>
      <div className="pin-setup-actions"><button className="primary-button" type="submit" disabled={!store||!department||!seller||formBusy||newPin.length!==8||confirmPin.length!==8}>{formBusy?'Enregistrement…':'Enregistrer mon PIN'} <ArrowRight size={15}/></button></div>
    </div>}
    {CLOUD&&pinMode==='login'&&<p className="pin-help">PIN oublié ? Demandez à votre responsable de réinitialiser votre accès.</p>}
    {fixed&&<button type="button" className="profile-switch" disabled={formBusy} onClick={()=>{if(window.confirm('Changer de profil sur cet appareil ? Le profil mémorisé sera retiré de cet appareil.'))onForgetProfile?.();}}>Changer de profil sur cet appareil</button>}
    {department&&!storeSellers.length&&!fixed&&<p className="no-store-sellers">Aucun vendeur dans ce département. Un administrateur peut y affecter des profils.</p>}
    {formError&&<div className="form-error session-error" role="alert">{formError}</div>}
    {geoText&&<div className="geo-message" role="status"><MapPin size={13}/>{geoText}</div>}
  </form>;
}
function WelcomePanel({data,onSubmit,deviceProfile,onForgetProfile,onRefreshProfile}) {
  return <section className="welcome-panel" id="selection">
    <div className="welcome-copy"><div className="welcome-icon"><Sparkles size={20}/></div><div><div className="micro-label">VOTRE ESPACE DE VENTE</div><h2>On se lance ?</h2><p>{deviceProfile?'Retrouvez votre profil sur cet appareil.':'Choisissez votre magasin, votre département et votre profil.'}</p></div></div>
    <SessionForm key={deviceProfile?`${deviceProfile.storeId}:${deviceProfile.sellerId}`:'nouvel-appareil'} data={data} initialProfile={deviceProfile} onSubmit={onSubmit} onForgetProfile={onForgetProfile} onRefreshProfile={onRefreshProfile}/>
  </section>;
}
function Sidebar({onNavigate,onAdmin,onSession,onInstall,showInstall,activeNav}) {
  const items=[['objectifs',Target,'Objectifs'],['services',Zap,'Mes services'],['ranking',Trophy,'Classement'],['summary',ChartNoAxesCombined,'Récapitulatifs']];
  return <aside className="sidebar">
    <div className="sidebar-brand"><Brand/></div>
    <div className="sidebar-group-label">VOTRE ESPACE</div>
    <nav className="side-nav" aria-label="Navigation principale">{items.map(([id,Icon,label])=><button key={id} className={`side-link ${activeNav===id?'is-active':''}`} onClick={()=>onNavigate(id)}><Icon size={18} strokeWidth={1.8}/><span>{label}</span>{activeNav===id&&<span className="nav-active-dot"/>}</button>)}</nav>
    <div className="sidebar-separator"/>
    <div className="sidebar-group-label">MON COMPTE</div>
    <nav className="side-nav"><button className="side-link" onClick={onSession}><UsersRound size={18} strokeWidth={1.8}/><span>Équipe & magasin</span></button><button className="side-link" onClick={onAdmin}><Settings2 size={18} strokeWidth={1.8}/><span>Administration</span></button></nav>
    <div className="sidebar-bottom"><div className="sidebar-tip"><div className="sidebar-tip-icon"><Zap size={16} fill="currentColor"/></div><strong>Chaque service compte.</strong><p>Ensemble, faisons la différence au quotidien.</p><span>À VOUS DE JOUER <ArrowUpRight size={12}/></span></div>{showInstall&&<button className="install-link" onClick={onInstall}><Download size={16}/> Installer l’application <ChevronRight size={14}/></button>}<div className="sidebar-copyright">FNAC PULSE <span>•</span> ESPACE ÉQUIPE</div></div>
  </aside>;
}
function Header({session,seller,store,connected,notificationsEnabled,notificationError,notificationUnconfirmed,soundEnabled,onBell,onSound,onSession,onAdmin,onTheme,onInstall,showInstall}) {
  const soundLabel=soundEnabled?'Couper le son des ventes':'Activer le son des ventes';
  const bellLabel=notificationError?'État des notifications indisponible':notificationsEnabled===null?'Vérification des notifications':notificationUnconfirmed?'Activation des notifications à confirmer':notificationsEnabled?'Notifications activées':'Notifications non activées';
  return <header className="topbar">
    <div className="mobile-brand"><Brand compact/></div>
    <div className="breadcrumbs"><span>Espace équipe</span><ChevronRight size={14}/><strong>Vue d’ensemble</strong></div>
    <div className="topbar-actions">
      <div className={`connection ${connected==='live'?'':'is-muted'}`} title={connected==='live'?'Mises à jour en direct':connected==='offline'?'Connexion interrompue':'En attente de votre sélection'}><span>{connected==='live'?'En direct':connected==='offline'?'Hors connexion':'Votre espace'}</span></div>
      <span className="topbar-divider"/>
      <button className="icon-button theme-trigger" title="Apparence" aria-label="Apparence" onClick={onTheme}><SunMoon size={19}/></button>
      <button className="icon-button sound-trigger" title={soundLabel} aria-label={soundLabel} aria-pressed={soundEnabled} onClick={onSound}>{soundEnabled?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>
      <button className="icon-button top-bell" title={bellLabel} aria-label={bellLabel} onClick={onBell}>{notificationsEnabled===true||notificationsEnabled===null?<Bell size={19}/>:<BellOff size={19}/>}</button>
      {showInstall&&<button className="icon-button install-trigger" title="Installer Fnac Pulse" aria-label="Installer Fnac Pulse" onClick={onInstall}><Download size={19}/></button>}
      <button className="profile-trigger" onClick={onSession} aria-label={session?`Mon profil, ${seller?.name||''}`:'Choisir mon profil'}>
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
  const iconKey=serviceIconKey(service), Icon=icons[iconKey]||MoreHorizontal;
  return <div className="service-card"><div className={`service-icon ${iconColors[index%iconColors.length]}`} data-service-icon={iconKey} aria-hidden="true"><Icon size={19} strokeWidth={1.8}/></div><div className="service-copy"><strong title={service.name}>{service.name}</strong><span>{session?`${count} aujourd’hui`:'À déclarer'}</span></div><div className="service-controls">{session&&count>0&&<button className="minus-button" onClick={()=>onRemove(service)} disabled={pending} title={`Retirer une vente ${service.name}`} aria-label={`Retirer une vente ${service.name}`}><Minus size={15}/></button>}<button className="plus-button" onClick={()=>onAdd(service)} disabled={pending} title={`Ajouter une vente ${service.name}`} aria-label={`Ajouter une vente ${service.name}`}><Plus size={19} strokeWidth={2}/></button></div></div>;
}
function Ranking({leaders,hasSession}) {
  return <section className="panel ranking-panel" id="ranking"><div className="panel-heading"><div><div className="section-kicker"><span className="kicker-line"/> LES PERFORMANCES</div><h2>Top de l’équipe</h2><p>Les vendeurs à l’honneur aujourd’hui.</p></div><span className="panel-icon gold"><Trophy size={18}/></span></div>
    {leaders?.length>0 ? <div className="ranking-list">{leaders.map((leader,i)=><div className="ranking-row" key={leader.id}><span className={`rank-number rank-${i+1}`}>{String(i+1).padStart(2,'0')}</span><Avatar name={leader.name} id={leader.id}/><div className="rank-name"><strong>{leader.name}</strong><span>{i===0?'En tête du classement':i===1?'Sur la deuxième marche':'Sur le podium'}</span></div><div className="rank-total"><strong>{leader.count}</strong><span>{leader.count>1?'ventes':'vente'}</span></div></div>)}</div> : <div className="ranking-empty"><div className="empty-podium"><div className="podium-circle">1</div><div className="podium-circle">2</div><div className="podium-circle">3</div></div><strong>{hasSession?'À vous de jouer !':'Le podium vous attend'}</strong><p>{hasSession?'Les premières ventes feront apparaître le classement.':'Sélectionnez votre espace pour voir le classement.'}</p></div>}
    <div className="ranking-footer"><Dot/> {hasSession?'En direct · Égalités : DMax, puis FVD':'Classement disponible après sélection'}</div>
  </section>;
}
function ActivityRow({item}) {
  return <div className="activity-row"><Avatar name={item.sellerName} id={item.sellerId} size="small"/><div><p><strong>{item.sellerName}</strong> a ajouté <strong>{item.serviceName}</strong></p><span>Aujourd’hui · {timeLabel(item.createdAt)}</span></div><span className="activity-add">+1</span></div>;
}
function ActivityCard({activity,hasSession}) {
  const [expanded,setExpanded]=useState(false),items=activity||[];
  return <section className="panel activity-panel"><div className="activity-heading"><div><div className="section-kicker"><span className="kicker-line"/> AU FIL DE LA JOURNÉE</div><h2>Activité récente</h2></div><span className="activity-live"><Dot/> EN DIRECT</span></div>
    {items.length>0?<div className="activity-list">
      {items.slice(0,4).map(item=><ActivityRow key={item.id} item={item}/>)}
      {items.length>4&&<details className="activity-more" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary><span>{expanded?'Afficher moins':`Toute l’activité du jour (${items.length})`}</span><ChevronDown size={15}/></summary>{expanded&&<div className="activity-more-list">{items.slice(4).map(item=><ActivityRow key={item.id} item={item}/>)}</div>}</details>}
    </div>:<div className="activity-empty"><span><Activity size={19}/></span><p>{hasSession?'Les ventes de l’équipe apparaîtront ici en temps réel.':'L’activité de votre magasin apparaîtra ici.'}</p></div>}
  </section>;
}
function Summary({stats,hasSession,storeId,departments,goals,goalsLoading,goalsError,onRetry}) {
  const [period,setPeriod]=useState('day');
  const [scope,setScope]=useState('store');
  useEffect(()=>setScope('store'),[storeId]);
  const labels={day:'Aujourd’hui',week:'Cette semaine',month:'Ce mois'};
  const selected=scope==='store'?stats?.summary?.store:stats?.summary?.departments?.[scope];
  const current=selected?.[period]||(scope==='store'&&!stats?.summary?stats?.[period]:null);
  const goalScope=scope==='store'?goals?.store:goals?.departments?.[scope];
  return <section className="panel summary-panel" id="summary"><div className="summary-heading"><div><div className="section-kicker"><span className="kicker-line"/> PRENDRE DU RECUL</div><h2>Le récap’ des services</h2><p>Toutes les ventes du magasin et par département.</p></div></div>
    <div className="summary-controls">{hasSession&&<label className="summary-scope"><span>PÉRIMÈTRE DU RÉCAP’</span><div className="select-wrap"><UsersRound size={15}/><select aria-label="Périmètre du récapitulatif" value={scope} onChange={e=>setScope(e.target.value)}><option value="store">Tout le magasin</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}{d.active?'':' · archivé'}</option>)}</select><ChevronDown size={15} className="select-chevron"/></div></label>}
      <div className="period-tabs" role="tablist" aria-label="Période du récapitulatif">{Object.entries(labels).map(([id,label])=><button role="tab" aria-selected={period===id} key={id} className={period===id?'selected':''} onClick={()=>setPeriod(id)}>{label}</button>)}</div></div>
    <div className="summary-content"><div className="summary-total"><span className="summary-total-label">TOTAL VENTES</span><strong>{current?.total??'—'}</strong><span>{current?current.total>1?'services vendus':'service vendu':'Sélectionnez un magasin'}</span><div className="summary-date"><CalendarDays size={13} aria-hidden="true"/><span>{current?`${dateLabel(current.start,{day:'numeric',month:'short'})}${current.start!==current.end?` — ${dateLabel(current.end,{day:'numeric',month:'short'})}`:''}`:'En attente'}</span></div></div>
      <div className="summary-breakdown">{current ? current.byService.map(s=>{
        const target=goalScope?.byService?.[`s${s.id}`]?.[period]??null;
        const percent=target>0?Math.min(100,Math.round(s.count/target*100)):0;
        return <div className="breakdown-row" key={s.id}><div><span>{s.name}</span><strong>{s.count} <span className="summary-target">/ {target??'—'}</span></strong></div>
          <div className={`progress-track ${target===null?'is-unset':''} ${target>0&&s.count>=target?'is-reached':''}`}
            role={target>0?'progressbar':undefined} aria-label={target>0?`${s.name} : ventes et objectif`:undefined}
            aria-valuemin={target>0?0:undefined} aria-valuemax={target>0?target:undefined} aria-valuenow={target>0?Math.min(s.count,target):undefined}
            aria-valuetext={target>0?`${s.count} sur ${target}`:undefined}><span style={{width:`${percent}%`}}/></div>
        </div>;
      }) : <div className="summary-empty"><span className="summary-empty-icon"><ChartNoAxesCombined size={20}/></span><div><strong>Les chiffres arrivent bientôt.</strong><p>Choisissez votre magasin pour consulter son récapitulatif.</p></div></div>}</div>
    </div>
    {hasSession&&<div className="summary-caption"><span>{!goals?(goalsLoading?'Chargement des objectifs…':'Objectifs indisponibles.'):'Ventes / objectif · Les objectifs mensuels sont répartis selon les jours travaillés ; les jours fériés sont inclus. Les objectifs non renseignés ne sont pas inclus.'}</span>{goalsError&&<span className="summary-warning">{goals?'Dernières cibles disponibles · ':''}{goalsError} <button type="button" onClick={onRetry}>Réessayer</button></span>}</div>}
  </section>;
}
function MobileNav({onNavigate,onSession,active}) {
  return <nav className="mobile-nav" aria-label="Navigation mobile">{[['objectifs',Target,'Objectifs'],['services',Zap,'Services'],['ranking',Trophy,'Classement'],['summary',ChartNoAxesCombined,'Bilan']].map(([id,Icon,name])=><button key={id} onClick={()=>onNavigate(id)} className={active===id?'active':''}><Icon size={19}/><span>{name}</span></button>)}<button onClick={onSession}><UserRound size={19}/><span>Profil</span></button></nav>;
}
function urlBase64ToUint8Array(base64) {const padding='='.repeat((4-base64.length%4)%4);const raw=atob((base64+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
function readNotificationPermission() {return typeof Notification==='undefined'?'unsupported':Notification.permission;}

export { Header, DateChip, ActivityCard, Summary, MobileNav };
export default function App() {
  const [session,setSession]=useState(()=>CLOUD?null:getSession());
  const [deviceProfile,setDeviceProfile]=useState(()=>CLOUD?readDeviceProfile(undefined,getSession()):null);
  const [data,setData]=useState(()=>{if(CLOUD)return null;const cached=getCached();return cached&&JSON.stringify(cached.session)===JSON.stringify(getSession())?cached.data:null;});
  const [authReady,setAuthReady]=useState(!CLOUD);
  const [cloudDay,setCloudDay]=useState(parisToday);
  const [loadFailed,setLoadFailed]=useState(false);
  const [loadMessage,setLoadMessage]=useState('');
  const [connection,setConnection]=useState('waiting');
  const [activeNav,setActiveNav]=useState('objectifs');
  const [sessionModal,setSessionModal]=useState(false);
  const [adminModal,setAdminModal]=useState(false);
  const [notificationsModal,setNotificationsModal]=useState(false);
  const [installed,setInstalled]=useState(isStandalone);
  const [platform]=useState(installPlatform);
  const [installModal,setInstallModal]=useState(()=>typeof window!=='undefined'&&!isStandalone());
  const [installError,setInstallError]=useState('');
  const [themeModal,setThemeModal]=useState(false);
  const [goalModal,setGoalModal]=useState(null);
  const [goalState,setGoalState]=useState({owner:'',...goalData(null),loading:false,error:''});
  const [summaryState,setSummaryState]=useState({key:'',data:null,loading:false,error:''});
  const [theme,setTheme]=useState(readTheme);
  const [soundEnabled,setSoundEnabled]=useState(saleSoundEnabled);
  const [installPrompt,setInstallPrompt]=useState(()=>typeof window==='undefined'?null:window.__fnacInstallPrompt||null);
  const [notificationPermission,setNotificationPermission]=useState(readNotificationPermission);
  const [notificationsEnabled,setNotificationsEnabled]=useState(()=>readNotificationPermission()==='granted'?null:false);
  const [notificationError,setNotificationError]=useState('');
  const [notificationUnconfirmed,setNotificationUnconfirmed]=useState(false);
  const [notificationCheck,setNotificationCheck]=useState(0);
  const [notificationCheckedKey,setNotificationCheckedKey]=useState('');
  const [notificationBusy,setNotificationBusy]=useState(false);
  const [pending,setPending]=useState({});
  const [toast,setToast]=useState(null);
  const requestNumber=useRef(0), goalRequest=useRef(0), summaryRequest=useRef(0), summaryTimer=useRef(null), pendingRef=useRef(new Set()), clientId=useRef(uid()), toastTimer=useRef(null), sound=useRef(null), notificationPrompted=useRef(false), notificationAbort=useRef(null);
  const pushAvailable=typeof window!=='undefined'&&!(platform.os==='ios'&&!installed)&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const notificationKey=JSON.stringify([session?.storeId,session?.sellerId,session?.uid,session?.accessVersion,authReady,notificationPermission,pushAvailable,notificationCheck]);
  const checkingCurrent=notificationCheckedKey!==notificationKey;
  const displayedEnabled=checkingCurrent?(notificationPermission==='granted'?null:false):notificationsEnabled,displayedError=checkingCurrent?'':notificationError,displayedUnconfirmed=!checkingCurrent&&notificationUnconfirmed;
  const notificationNotice=notificationBanner({permission:notificationPermission,enabled:displayedEnabled,hasSession:!!session,platform,installed,error:displayedError,unconfirmed:displayedUnconfirmed,pushAvailable});
  const store=data?.stores?.find(s=>s.id===session?.storeId), seller=data?.sellers?.find(s=>s.id===session?.sellerId&&sellerStoreId(s)===session?.storeId);
  const activeDepartmentId=seller?sellerDepartmentId(seller):'';
  const departments=session?departmentsForStore(data||{},session.storeId,{activeOnly:false}):[];
  const department=departments.find(d=>d.id===activeDepartmentId);
  const owner=goalOwnerKey(session), ownerRef=useRef(owner);ownerRef.current=owner;
  const summaryKey=owner?JSON.stringify([owner,cloudDay]):'',summaryKeyRef=useRef(summaryKey);summaryKeyRef.current=summaryKey;
  const currentGoals=goalState.owner===owner?goalState.goals:null;
  const currentSummary=summaryState.key===summaryKey?summaryState.data:null;

  useEffect(()=>{
    applyTheme(theme);
    try {localStorage.setItem(THEME_KEY,theme);} catch {}
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    const update=()=>{if(theme==='system')applyTheme(theme);};
    media?.addEventListener?.('change',update);
    return ()=>media?.removeEventListener?.('change',update);
  },[theme]);
  useEffect(()=>{const sync=e=>{if(e.key===THEME_KEY)setTheme(readTheme());};window.addEventListener('storage',sync);return ()=>window.removeEventListener('storage',sync);},[]);
  useEffect(()=>{
    const player=createSaleSound({base:APP_BASE});sound.current=player;
    const sync=e=>{if(e.key===SALE_SOUND_KEY){const enabled=saleSoundEnabled();setSoundEnabled(enabled);player.setEnabled(enabled);if(!enabled)player.stop();}};
    window.addEventListener('storage',sync);
    return ()=>{window.removeEventListener('storage',sync);player.dispose();if(sound.current===player)sound.current=null;};
  },[]);
  useEffect(()=>{
    let timer,permissionStatus,cancelled=false;
    const sync=()=>{
      setNotificationPermission(readNotificationPermission());
      clearTimeout(timer);timer=setTimeout(()=>setNotificationCheck(n=>n+1),120);
    };
    const visible=()=>{if(document.visibilityState==='visible')sync();};
    window.addEventListener('focus',sync);window.addEventListener('online',sync);document.addEventListener('visibilitychange',visible);
    try {navigator.permissions?.query?.({name:'notifications'}).then(status=>{
      if(cancelled)return;permissionStatus=status;
      if(status.addEventListener)status.addEventListener('change',sync);else status.onchange=sync;
    }).catch(()=>{});} catch {}
    return ()=>{
      cancelled=true;clearTimeout(timer);window.removeEventListener('focus',sync);window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',visible);
      if(permissionStatus?.removeEventListener)permissionStatus.removeEventListener('change',sync);else if(permissionStatus)permissionStatus.onchange=null;
    };
  },[]);

  const flash=useCallback((message,options={})=>{clearTimeout(toastTimer.current);setToast({message,...options});toastTimer.current=setTimeout(()=>setToast(null),options.duration||5500);},[]);
  const refresh=useCallback(async()=>{
    if(CLOUD&&!authReady)return;
    const n=++requestNumber.current;
    const query=session?`?storeId=${encodeURIComponent(session.storeId)}${!CLOUD?`&sellerId=${session.sellerId}`:''}`:'';
    try {
      const result=await api('/api/bootstrap'+query);
      if(n!==requestNumber.current)return;
      if(CLOUD&&session)setData(old=>old?{...result,stats:old.stats,today:cloudDay}:result);
      else setData(result);
      setLoadFailed(false);setLoadMessage('');
      if(!CLOUD)try{localStorage.setItem(CACHE_KEY,JSON.stringify({data:result,session}));}catch{}
      if(session&&(!result.stores.some(s=>s.id===session.storeId)||!result.sellers.some(s=>s.id===session.sellerId&&sellerStoreId(s)===session.storeId))){
        localStorage.removeItem(SESSION_KEY);setSession(null);
        if(CLOUD)await sellerLogout();
        flash('Votre profil ou votre magasin a été modifié. Sélectionnez à nouveau votre espace.');
      }
    } catch(e) {
      if(n!==requestNumber.current)return;
      setConnection('offline');setLoadFailed(true);setLoadMessage(e.message);
      const saved=getCached();
      if(saved && JSON.stringify(saved.session)===JSON.stringify(session))setData(saved.data);
    }
  },[session,flash,authReady,cloudDay]);
  const loadGoals=useCallback(async()=>{
    if(!session)return;
    const targetOwner=goalOwnerKey(session),n=++goalRequest.current;
    setGoalState(old=>old.owner===targetOwner?{...old,loading:true,error:''}:{owner:targetOwner,...getCachedGoals(targetOwner),loading:true,error:''});
    try {
      const query=`?storeId=${encodeURIComponent(session.storeId)}&sellerId=${encodeURIComponent(session.sellerId)}`;
      const result=await api('/api/goals'+query);
      if(n!==goalRequest.current||ownerRef.current!==targetOwner)return;
      if(!result.goals||typeof result.goals!=='object'||Array.isArray(result.goals))throw new Error('Réponse des objectifs invalide.');
      setGoalState({owner:targetOwner,...goalData(result),loading:false,error:''});cacheGoals(targetOwner,result);
    } catch(e) {
      if(n!==goalRequest.current||ownerRef.current!==targetOwner)return;
      setGoalState(old=>({...(old.owner===targetOwner?old:{owner:targetOwner,...goalData(null)}),loading:false,error:e.message||'Objectifs indisponibles.'}));
    }
  },[owner]);
  useEffect(()=>{
    goalRequest.current++;setGoalModal(null);
    if(!owner){setGoalState({owner:'',...goalData(null),loading:false,error:''});return;}
    setGoalState({owner,...getCachedGoals(owner),loading:true,error:''});
    loadGoals();
    return ()=>{goalRequest.current++;};
  },[owner,loadGoals]);
  const loadSummaryGoals=useCallback(async()=>{
    if(!session||!summaryKey)return;
    const key=summaryKey,n=++summaryRequest.current;
    setSummaryState(old=>old.key===key?{...old,loading:true,error:''}:{key,data:getCachedSummary(key),loading:true,error:''});
    try {
      const result=await api(`/api/summary-goals?storeId=${encodeURIComponent(session.storeId)}`);
      if(n!==summaryRequest.current||summaryKeyRef.current!==key)return;
      if(result?.date!==cloudDay||!result.store?.byService||!result.departments)throw new Error('Cibles du jour indisponibles. Vérifiez la date de l’appareil.');
      setSummaryState({key,data:result,loading:false,error:''});cacheSummary(key,result);
    } catch(e) {
      if(n!==summaryRequest.current||summaryKeyRef.current!==key)return;
      setSummaryState(old=>({key,data:old.key===key?old.data:getCachedSummary(key),loading:false,error:e.message||'Objectifs indisponibles.'}));
    }
  },[summaryKey,cloudDay]);
  const queueSummary=useCallback(()=>{clearTimeout(summaryTimer.current);summaryTimer.current=setTimeout(loadSummaryGoals,200);},[loadSummaryGoals]);
  useEffect(()=>{
    summaryRequest.current++;clearTimeout(summaryTimer.current);
    if(!summaryKey){setSummaryState({key:'',data:null,loading:false,error:''});return;}
    setSummaryState({key:summaryKey,data:getCachedSummary(summaryKey),loading:true,error:''});queueSummary();
    return ()=>{summaryRequest.current++;clearTimeout(summaryTimer.current);};
  },[summaryKey,queueSummary]);
  useEffect(()=>{
    if(!CLOUD)return;
    let cancelled=false,timer,delay=1000;
    const initialize=async()=>{
      if(cancelled)return;
      try {await api('/api/auth/initialize',{method:'POST',body:{}});}
      catch {if(!cancelled){timer=setTimeout(initialize,delay);delay=Math.min(delay*2,30000);}}
    };
    initialize();return ()=>{cancelled=true;clearTimeout(timer);};
  },[]);
  useEffect(()=>{if(!CLOUD)return;return observeVendor(next=>{
    if(next){const profile=saveDeviceProfile(next);if(profile)setDeviceProfile(profile);}
    setSession(next);setAuthReady(true);if(!next)localStorage.removeItem(SESSION_KEY);
  });},[]);
  useEffect(()=>{refresh();},[refresh]);
  useEffect(()=>{
    if(!CLOUD||!session||!authReady)return;
    return listenStore(session,cloudDay,clientId.current,(next,live)=>{
      setData(next);setLoadFailed(false);setConnection(live?'live':'offline');
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({data:next,session}));}catch{}
    },sale=>{
      sound.current?.play();
      flash(saleMessage(sale.serviceName,sale.sellerName),{tone:'celebrate'});
    },error=>{
      setConnection('offline');
      if(error?.code==='permission-denied'){sellerLogout().catch(()=>{});setSession(null);setData(d=>d?{...d,stats:null}:d);localStorage.removeItem(SESSION_KEY);localStorage.removeItem(CACHE_KEY);localStorage.removeItem(GOALS_CACHE_KEY);localStorage.removeItem(SUMMARY_CACHE_KEY);flash('Votre accès a changé. Reconnectez-vous avec votre code PIN.',{tone:'warning'});}
      else flash('Connexion interrompue. Les données seront actualisées au retour du réseau.',{tone:'warning'});
    },()=>loadGoals(),queueSummary);
  },[session,authReady,cloudDay,flash,loadGoals,queueSummary]);
  useEffect(()=>{
    if(CLOUD)return;
    if(!session){setConnection('waiting');return;}
    const source=new EventSource(`/api/events?storeId=${encodeURIComponent(session.storeId)}`);
    source.addEventListener('ready',()=>{setConnection('live');refresh();queueSummary();});
    source.addEventListener('change',e=>{
      try {
        const event=JSON.parse(e.data);
        if(event.kind==='sale'&&event.clientId!==clientId.current&&(event.departmentId||'tech')===activeDepartmentId){sound.current?.play();flash(saleMessage(event.serviceName,event.sellerName),{tone:'celebrate'});}
        if(event.kind==='goals'&&Number(event.sellerId)===Number(session.sellerId))loadGoals();
        if(event.kind==='goals'||event.kind==='config')queueSummary();
      } catch{}
      refresh();
    });
    source.onerror=()=>setConnection('offline');
    return ()=>source.close();
  },[session,refresh,flash,loadGoals,queueSummary,activeDepartmentId]);
  useEffect(()=>{
    const syncDay=()=>setCloudDay(parisToday());
    const onOnline=()=>{syncDay();refresh();loadGoals();queueSummary();};
    const onVisible=()=>{if(document.visibilityState==='visible'){syncDay();if(!CLOUD)refresh();}};
    window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible);
    const timer=setInterval(()=>{syncDay();if(!CLOUD&&document.visibilityState==='visible')refresh();},60000);
    return ()=>{window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);clearInterval(timer);};
  },[refresh,loadGoals,queueSummary]);
  useEffect(()=>{
    if('serviceWorker' in navigator) navigator.serviceWorker.register(`${APP_BASE}sw.js`, {scope:APP_BASE}).catch(()=>{});
    const promptReady=()=>setInstallPrompt(window.__fnacInstallPrompt||null);
    const onInstalled=()=>{setInstalled(true);setInstallPrompt(null);setInstallError('');setInstallModal(false);};
    const displayChanged=()=>{if(isStandalone())onInstalled();};
    const media=['standalone','fullscreen','minimal-ui','window-controls-overlay'].map(mode=>window.matchMedia?.(`(display-mode: ${mode})`)).filter(Boolean);
    window.addEventListener('fnac-install-ready',promptReady);window.addEventListener('appinstalled',onInstalled);
    for(const item of media){if(item.addEventListener)item.addEventListener('change',displayChanged);else item.addListener?.(displayChanged);}
    promptReady();displayChanged();
    return ()=>{
      window.removeEventListener('fnac-install-ready',promptReady);window.removeEventListener('appinstalled',onInstalled);
      for(const item of media){if(item.removeEventListener)item.removeEventListener('change',displayChanged);else item.removeListener?.(displayChanged);}
    };
  },[]);
  useEffect(()=>{
    if(notificationBusy)return;
    if(!authReady){setNotificationError('');setNotificationUnconfirmed(false);setNotificationsEnabled(null);setNotificationCheckedKey('');return;}
    if(!session||!pushAvailable||notificationPermission!=='granted'){setNotificationError('');setNotificationUnconfirmed(false);setNotificationsEnabled(false);setNotificationCheckedKey(notificationKey);return;}
    let cancelled=false;const controller=new AbortController();notificationAbort.current=controller;
    setNotificationError('');setNotificationUnconfirmed(false);setNotificationsEnabled(null);setNotificationCheckedKey('');
    const timer=setTimeout(()=>{if(!cancelled){setNotificationError('timeout');setNotificationCheckedKey(notificationKey);}},12000);
    // Sans préférence d'activation enregistrée, ne pas réabonner silencieusement.
    // Une souscription navigateur existante seule ne prouve pas qu'elle est reliée
    // au profil Fnac Pulse : proposer une confirmation plutôt qu'affirmer son état.
    const check=CLOUD?(notificationsWanted()?subscribeFcm(api,{signal:controller.signal}).then(()=>({active:true})):navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(sub=>({active:false,unconfirmed:!!sub}))):navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(async sub=>{
      if(!sub||controller.signal.aborted)return {active:false};
      await api('/api/push/subscribe',{method:'POST',body:{storeId:session.storeId,sellerId:session.sellerId,subscription:sub.toJSON()},signal:controller.signal});
      return {active:true};
    });
    check.then(({active,unconfirmed})=>{if(!cancelled){setNotificationError('');setNotificationUnconfirmed(!!unconfirmed);setNotificationsEnabled(active);setNotificationCheckedKey(notificationKey);}})
      .catch(()=>{if(!cancelled&&!controller.signal.aborted){const currentPermission=readNotificationPermission();if(currentPermission!==notificationPermission){setNotificationPermission(currentPermission);return;}setNotificationError('unavailable');setNotificationsEnabled(null);setNotificationCheckedKey(notificationKey);}})
      .finally(()=>clearTimeout(timer));
    return ()=>{cancelled=true;controller.abort();if(notificationAbort.current===controller)notificationAbort.current=null;clearTimeout(timer);};
  },[session,authReady,pushAvailable,notificationPermission,notificationBusy,notificationCheck,notificationKey]);
  useEffect(()=>{
    // Une permission système ne peut pas être demandée sans geste utilisateur.
    // L'installation et l'activation ne doivent jamais ouvrir deux modales ensemble.
    if(!data||!session||!authReady||installModal||sessionModal||adminModal||themeModal||goalModal||notificationsModal||notificationBusy||notificationCheckedKey!==notificationKey||notificationsEnabled!==false||notificationPrompted.current)return;
    if(platform.os==='ios'&&!installed)return;
    notificationPrompted.current=true;setNotificationsModal(true);
  },[data,session,authReady,installModal,sessionModal,adminModal,themeModal,goalModal,notificationsModal,notificationBusy,notificationsEnabled,notificationCheckedKey,notificationKey,platform,installed,pushAvailable]);
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);

  async function selectSession(next,pin,setup=null){
    const authenticated=CLOUD?(setup?.firstTime?await sellerChoosePin(api,next,pin):await sellerLogin(api,next,pin)):next;
    if(CLOUD){const profile=saveDeviceProfile(authenticated);if(profile)setDeviceProfile(profile);}
    localStorage.setItem(SESSION_KEY,JSON.stringify(authenticated));
    setData(d=>d?{...d,stats:null}:d);setSession(authenticated);setSessionModal(false);setActiveNav('objectifs');
    window.scrollTo({top:0,behavior:'smooth'});
    const person=data?.sellers.find(s=>s.id===next.sellerId);flash(`Bienvenue${person?`, ${person.name}`:''} ! Votre espace est prêt.`);
  }
  function forgetDeviceProfile(){clearDeviceProfile();setDeviceProfile(null);}
  async function logoutSeller(){
    notificationAbort.current?.abort();setNotificationBusy(true);
    try {
      let warning=false;
      if(CLOUD&&notificationsWanted())try{await unsubscribeFcm(api);}catch{warning=true;}
      if(CLOUD)await sellerLogout();
      localStorage.removeItem(SESSION_KEY);localStorage.removeItem(CACHE_KEY);localStorage.removeItem(GOALS_CACHE_KEY);localStorage.removeItem(SUMMARY_CACHE_KEY);setSession(null);setData(d=>d?{...d,stats:null}:null);setSessionModal(false);
      flash(warning?'Déconnecté. Vérifiez les notifications de cet appareil lorsque la connexion revient.':'Vous êtes déconnecté.',warning?{tone:'warning'}:{});
    } finally {setNotificationBusy(false);}
  }
  function changeSession(){if(session)setSessionModal(true);else {document.getElementById('selection')?.scrollIntoView({behavior:'smooth',block:'center'});document.querySelector('[aria-label="Votre magasin Fnac"]')?.focus();}}
  function navigate(id){setActiveNav(id);if(id==='objectifs'&&!session){changeSession();return;}document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});}
  function toggleSound(){
    const next=!soundEnabled;saveSaleSound(next);setSoundEnabled(next);sound.current?.setEnabled(next);
    if(next)sound.current?.unlock();else sound.current?.stop();
  }
  async function savePersonalGoals(body){
    if(!session||connection==='offline')throw new Error('Connexion interrompue. Réessayez en ligne.');
    const targetOwner=goalOwnerKey(session);
    try {
      const result=await api('/api/goals',{method:'POST',body:{...body,storeId:session.storeId,sellerId:session.sellerId}});
      if(ownerRef.current!==targetOwner)throw new Error('Votre profil a changé. Sélectionnez-le à nouveau.');
      setGoalState({owner:targetOwner,...goalData(result),loading:false,error:''});cacheGoals(targetOwner,result);
      loadGoals();setGoalModal(null);flash('Objectifs enregistrés.',{tone:'success'});
      return result;
    } catch(e){if(e.status===409)await loadGoals();throw e;}
  }
  async function addSale(service){
    if(!session){flash('Choisissez d’abord votre magasin et votre profil.',{tone:'warning'});changeSession();return;}
    if(connection==='offline'){flash('Connexion interrompue : la vente n’a pas été enregistrée.',{tone:'warning'});return;}
    if(pendingRef.current.has(service.id))return;
    pendingRef.current.add(service.id);setPending(p=>({...p,[service.id]:true}));
    try {
      const result=await api('/api/sales',{method:'POST',body:{...session,serviceId:service.id,requestId:uid(),clientId:clientId.current}});
      sound.current?.play();
      await refresh();
      flash(saleMessage(service.name,seller?.name),{tone:'success',actionLabel:'Annuler',action:async()=>{
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
    notificationAbort.current?.abort();setNotificationBusy(true);
    try {
      const permission=await Notification.requestPermission();
      setNotificationPermission(permission);
      if(permission!=='granted')throw new Error(permission==='denied'?'Notifications bloquées. Autorisez-les dans les réglages de l’appareil ou du navigateur.':'Autorisation de notification non accordée.');
      if(CLOUD)await subscribeFcm(api);
      else {const registration=await navigator.serviceWorker.ready;
        let subscription=await registration.pushManager.getSubscription();
        if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(data.pushPublicKey)});
        await api('/api/push/subscribe',{method:'POST',body:{storeId:session.storeId,sellerId:session.sellerId,subscription:subscription.toJSON()}});}
      setNotificationsEnabled(true);setNotificationsModal(false);flash('Notifications activées sur cet appareil.',{tone:'success'});
    } catch(e){flash(e.message||'Impossible d’activer les notifications sur cet appareil.',{tone:'warning',duration:8000});}
    finally{setNotificationBusy(false);}
  }
  async function disableNotifications(){
    notificationAbort.current?.abort();setNotificationBusy(true);
    try {if(CLOUD)await unsubscribeFcm(api);else {const registration=await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription();if(sub){await api('/api/push/subscribe',{method:'DELETE',body:{endpoint:sub.endpoint}});await sub.unsubscribe();}}setNotificationsEnabled(false);setNotificationsModal(false);flash('Notifications désactivées sur cet appareil.');}
    catch(e){flash('Impossible de désactiver les notifications.',{tone:'warning'});}finally{setNotificationBusy(false);}
  }
  function openNotifications(){notificationPrompted.current=true;setNotificationsModal(true);}
  function retryNotifications(){setNotificationError('');setNotificationCheck(n=>n+1);}
  function openInstall(){setInstallError('');setNotificationsModal(false);setInstallModal(true);}
  async function installApp(){
    const prompt=installPrompt;if(!prompt)return;
    setInstallPrompt(null);setInstallError('');
    if(window.__fnacInstallPrompt===prompt)window.__fnacInstallPrompt=null;
    try {
      const result=await prompt.prompt();
      const choice=prompt.userChoice?await prompt.userChoice:result;
      if(choice?.outcome==='accepted')setInstallModal(false);
      else if(choice?.outcome==='dismissed')setInstallError('Installation annulée. Vous pouvez aussi utiliser le menu du navigateur.');
    } catch {setInstallError('Le navigateur n’a pas ouvert l’installation. Utilisez le menu indiqué ci-dessus.');}
  }
  const installationDialog=installModal&&<InstallDialog platform={platform} base={APP_BASE} promptAvailable={!!installPrompt} installError={installError} onInstall={installApp} onClose={()=>setInstallModal(false)}/>;
  if(!data)return <><div className="app-loading"><Brand/>{loadFailed?<><p>{loadMessage||'Connexion indisponible. Vérifiez votre réseau pour ouvrir votre espace.'}</p><button className="primary-button" onClick={refresh}>Réessayer</button></>:<p>Préparation de votre espace…</p>}</div>{installationDialog}</>;
  const stats=data.stats, counts=Object.fromEntries((stats?.mine||[]).map(c=>[c.serviceId,c.count]));
  return <><div className="app-shell">
    <Sidebar onNavigate={navigate} onAdmin={()=>setAdminModal(true)} onSession={changeSession} onInstall={openInstall} showInstall={!installed} activeNav={activeNav}/>
    <div className="main-shell"><Header session={session} seller={seller} store={store} connected={connection} notificationsEnabled={displayedEnabled} notificationError={displayedError} notificationUnconfirmed={displayedUnconfirmed} soundEnabled={soundEnabled} onBell={openNotifications} onSound={toggleSound} onSession={changeSession} onAdmin={()=>setAdminModal(true)} onTheme={()=>setThemeModal(true)} onInstall={openInstall} showInstall={!installed}/>
      <main className="content" id="overview">
        {connection==='offline'&&session&&<div className="offline-banner"><WifiOff size={16}/><div><strong>Connexion interrompue.</strong> Les dernières données restent visibles, mais la saisie est suspendue jusqu’au retour de la connexion.</div><button onClick={refresh}>Réessayer</button></div>}
        {notificationNotice&&<section className="notification-card notification-prompt" aria-label="Activation des notifications"><span className="notification-icon"><BellOff size={18}/></span><div><strong>Restez informés</strong><p>{notificationNotice.message}</p></div><button onClick={notificationNotice.action==='install'?openInstall:notificationNotice.action==='retry'?retryNotifications:openNotifications}>{notificationNotice.label} <ArrowRight size={13}/></button></section>}
        <div className="page-intro"><div><div className="eyebrow"><span/> VOTRE TABLEAU DE BORD</div><h1>Bonjour{seller?`, ${seller.name}`:', l’équipe'}<span className="hello-dot">.</span></h1><p>Ensemble, faisons de chaque service une réussite.</p></div><DateChip today={cloudDay}/></div>
        {!session?<WelcomePanel data={data} onSubmit={selectSession} deviceProfile={deviceProfile} onForgetProfile={forgetDeviceProfile} onRefreshProfile={refresh}/>:<div className="session-strip"><div className="strip-icon"><Store size={18}/></div><div className="strip-copy"><span>VOTRE ESPACE DE VENTE</span><strong>{store?.name||'Votre magasin'}{department?` · ${department.name}`:''}</strong></div><div className="strip-divider"/><div className="strip-user"><Avatar name={seller?.name} id={seller?.id} size="small"/><span>Connecté en tant que <strong>{seller?.name}</strong></span></div><button className="text-button" onClick={()=>setSessionModal(true)}>{CLOUD?'Mon profil':'Changer'} <ArrowRight size={14}/></button></div>}
        <div className="section-overline"><div><span className="kicker-line"/> EN UN COUP D’ŒIL</div><span>{session?'Les chiffres de votre département':'Choisissez votre espace pour démarrer'}</span></div>
        <section className="stats-grid" aria-label="Chiffres clés"><StatCard label="AUJOURD’HUI" value={stats?.day.total} detail="Ventes de l’équipe" Icon={Zap} tone="gold"/><StatCard label="MA JOURNÉE" value={stats?.mineTotal} detail="Mes services enregistrés" Icon={UserRound} tone="soft-blue"/></section>
        {session&&<GoalsPanel seller={seller} services={data.services} goals={currentGoals} workdays={goalState.workdays} workdaysDefault={!goalState.workdaysRevision} stats={stats} date={data.today} loading={goalState.loading} error={goalState.error} offline={connection==='offline'} onEdit={serviceId=>setGoalModal({serviceId})} onRetry={loadGoals}/>}
        <div className="dashboard-grid"><div className="main-column"><section className="panel services-panel" id="services"><div className="panel-heading"><div><div className="section-kicker"><span className="kicker-line"/> VENTE QUOTIDIENNE</div><h2>Ajouter un service</h2><p>Une vente de services ? Un clic et c’est enregistré.</p></div><span className="service-count">{data.services.length} SERVICES</span></div><div className="services-grid">{data.services.map((s,i)=><ServiceCard key={s.id} service={s} index={i} count={counts[s.id]||0} session={session} pending={pending[s.id]} onAdd={addSale} onRemove={removeSale}/>)}</div><div className="service-hint"><Info size={14}/><span>Une erreur ? Utilisez le bouton <strong>−</strong> pour retirer votre dernière vente du service.</span></div></section>
          <Summary stats={stats} hasSession={!!session} storeId={session?.storeId} departments={departments} goals={currentSummary} goalsLoading={summaryState.key===summaryKey&&summaryState.loading} goalsError={summaryState.key===summaryKey?summaryState.error:''} onRetry={loadSummaryGoals}/>
        </div><div className="right-column"><Ranking leaders={stats?.leaderboard} hasSession={!!session}/><ActivityCard activity={stats?.activity} hasSession={!!session}/></div></div>
        <footer className="page-footer">La vente, c’est notre rayon. Les services aussi. 😉</footer>
      </main>
    </div>
    <MobileNav onNavigate={navigate} onSession={changeSession} active={activeNav}/>
    {sessionModal&&<Modal title={CLOUD?'Mon profil':'Changer d’espace'} subtitle={CLOUD?'Votre espace sur cet appareil.':'Sélectionnez votre magasin, votre département et votre profil vendeur.'} onClose={()=>setSessionModal(false)}>
      {CLOUD?<><div className="account-profile"><Avatar name={seller?.name} id={seller?.id}/><div><strong>{seller?.name||'Votre profil'}</strong><span>{store?.name||'Votre magasin'}{department?` · ${department.name}`:''}</span></div></div><p className="account-help">Votre session reste ouverte lorsque vous fermez l’application. Après déconnexion, votre PIN sera demandé pour revenir.</p><button type="button" className="outline-button account-logout" onClick={()=>logoutSeller()}>Se déconnecter</button></>:<><SessionForm data={data} initialSession={session} modal onSubmit={selectSession}/><p className="modal-hint"><MapPin size={14}/> La position est utilisée uniquement pour proposer le magasin le plus proche parmi ceux référencés.</p></>}
    </Modal>}
    {goalModal&&session&&currentGoals&&<Modal title="Mes objectifs" subtitle="Choisissez un service et sa cible de référence." onClose={()=>setGoalModal(null)}><GoalForm services={data.services} goals={currentGoals} workdays={goalState.workdays} date={data.today} initialServiceId={goalModal.serviceId} onSave={savePersonalGoals} onCancel={()=>setGoalModal(null)} disabled={connection==='offline'}/></Modal>}
    {adminModal&&<Admin onClose={()=>setAdminModal(false)} data={data} session={session} onChanged={refresh}/>}
    {notificationsModal&&<NotificationsDialog permission={notificationPermission} enabled={displayedEnabled} checkError={displayedError} unconfirmed={displayedUnconfirmed} pushAvailable={pushAvailable} platform={platform} installed={installed} hasSession={!!session} busy={notificationBusy} onClose={()=>setNotificationsModal(false)} onEnable={enableNotifications} onDisable={disableNotifications} onRetry={retryNotifications} onInstall={openInstall} onSelectProfile={()=>{setNotificationsModal(false);changeSession();}}/>}
    {themeModal&&<Modal title="Apparence" subtitle="Vos préférences sur cet appareil." onClose={()=>setThemeModal(false)}>
      <div className="theme-options" role="radiogroup" aria-label="Thème de l’application">
        {[['system',Monitor,'Automatique','Suivre les réglages de l’appareil'],['light',Sun,'Clair','Toujours utiliser le thème clair'],['dark',Moon,'Sombre','Toujours utiliser le thème sombre']].map(([value,Icon,label,description])=><label key={value} className={`theme-option ${theme===value?'is-selected':''}`}>
          <input type="radio" name="theme" value={value} checked={theme===value} onChange={()=>setTheme(value)}/><Icon size={19}/><span><strong>{label}</strong><small>{description}</small></span><Check className="theme-check" size={17}/>
        </label>)}
      </div>
    </Modal>}
    {toast&&<div className={`toast toast-${toast.tone||'default'}`} role="status"><span className="toast-icon">{toast.tone==='warning'?<Info size={17}/>:<CircleCheck size={17}/>}</span><span>{toast.message}</span>{toast.action&&<button onClick={()=>{const action=toast.action;setToast(null);action();}}>{toast.actionLabel}</button>}<button className="toast-close" aria-label="Fermer" onClick={()=>setToast(null)}><X size={16}/></button></div>}
  </div>{installationDialog}</>;
}

import React, { useEffect, useRef, useState } from 'react';
import { X, LockKeyhole, ArrowRight, Plus, Check, Pencil, Archive, RotateCcw, LogOut, ShieldCheck, Store, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from './api';
import { CLOUD, adminLogin, adminLogout, changeAdminPassword } from './cloud';
import { sellersForStore, orderServices } from './catalog';
import { departmentsForStore, sellerDepartmentId } from './departments';
import { GoalForm, WorkdaysForm } from './Goals';
import { normalizeWorkdays } from './goals';

function Modal({title,subtitle,onClose,children,wide=false}) {
  const dialog=useRef(null),close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const previous=document.body.style.overflow,previousFocus=document.activeElement;
    document.body.style.overflow='hidden';
    if(!dialog.current?.contains(document.activeElement))dialog.current?.querySelector('.close-button')?.focus();
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();close.current();return;}
      if(event.key!=='Tab'||!dialog.current)return;
      const items=[...dialog.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href], [tabindex]:not([tabindex="-1"])')].filter(x=>x.getClientRects().length);
      if(!items.length)return;
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
    };
    document.addEventListener('keydown',onKeyDown);
    return ()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',onKeyDown);previousFocus?.focus?.();};
  },[]);
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget) onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'modal-wide':''}`}>
      <div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button close-button" aria-label="Fermer" onClick={onClose}><X size={19}/></button></div>
      <div className="modal-content">{children}</div>
    </div>
  </div>;
}

export default function Admin({onClose,data,session,onChanged}) {
  const [token,setToken]=useState(()=>sessionStorage.getItem('pulse-admin-token')||'');
  const [password,setPassword]=useState('');
  const [email,setEmail]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState(()=>session?.storeId?'sales':'stores');
  const [all,setAll]=useState({sellers:[],services:[],serviceOrders:{},departmentsByStore:{}});
  const [adminStore,setAdminStore]=useState(session?.storeId||'');
  const [adminSeller,setAdminSeller]=useState(session?.sellerId?String(session.sellerId):'');
  const [allLoaded,setAllLoaded]=useState(false);
  const [counts,setCounts]=useState({});
  const [countsFor,setCountsFor]=useState('');
  const [countsLoading,setCountsLoading]=useState(false);
  const [adminGoals,setAdminGoals]=useState(null);
  const [adminWorkdays,setAdminWorkdays]=useState(null);
  const [adminWorkdaysRevision,setAdminWorkdaysRevision]=useState(null);
  const [goalsFor,setGoalsFor]=useState('');
  const [goalsLoading,setGoalsLoading]=useState(false);
  const goalScope=useRef('');goalScope.current=`${adminStore}:${adminSeller}:${tab}`;
  const [name,setName]=useState('');
  const [newSellerDepartment,setNewSellerDepartment]=useState('');
  const [editing,setEditing]=useState(null);
  const [editName,setEditName]=useState('');
  const [newStore,setNewStore]=useState({name:'',lat:'',lon:''});
  const [oldPass,setOldPass]=useState('');
  const [newPass,setNewPass]=useState('');

  async function loadAll(auth=token) {
    try { const result=await api('/api/admin/all',{token:auth}); setAll(result);setAllLoaded(true); }
    catch(e) { if (/expirée/.test(e.message)) {setToken('');sessionStorage.removeItem('pulse-admin-token');} setError(e.message); }
  }
  useEffect(()=>{if(token) loadAll(token);},[token]);
  useEffect(()=>{
    if(allLoaded&&adminSeller&&!sellersForStore(all.sellers,adminStore).some(s=>String(s.id)===String(adminSeller)))setAdminSeller('');
  },[all,allLoaded,adminStore,adminSeller]);
  useEffect(()=>{
    if(!token||!adminStore||!adminSeller||tab!=='sales') return;
    let cancelled=false;setCountsFor('');setCountsLoading(true);
    api(`/api/admin/counts?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token}).then(result=>{
      if(!cancelled){setCounts(Object.fromEntries(result.counts.map(item=>[item.serviceId,item.count])));setCountsFor(`${adminStore}:${adminSeller}`);}
    }).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setCountsLoading(false)});
    return ()=>{cancelled=true};
  },[token,adminStore,adminSeller,tab]);

  function applyAdminGoals(result) {
    setAdminGoals(result.goals);setAdminWorkdays(normalizeWorkdays(result.workdays));setAdminWorkdaysRevision(result.workdaysRevision||null);
  }
  useEffect(()=>{
    if(!token||!adminStore||!adminSeller||tab!=='goals')return;
    let cancelled=false;setGoalsFor('');setAdminGoals(null);setAdminWorkdays(null);setGoalsLoading(true);
    api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token}).then(result=>{
      if(!cancelled){applyAdminGoals(result);setGoalsFor(`${adminStore}:${adminSeller}`);}
    }).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setGoalsLoading(false)});
    return ()=>{cancelled=true};
  },[token,adminStore,adminSeller,tab]);
  async function saveAdminGoals(body) {
    const scope=`${adminStore}:${adminSeller}:${tab}`;setBusy(true);setError('');setNotice('');
    try {
      const result=await api('/api/admin/goals',{method:'POST',token,body:{...body,storeId:adminStore,sellerId:Number(adminSeller)}});
      if(goalScope.current===scope)applyAdminGoals(result);
      onChanged();return result;
    } catch(e) {
      if(e.status===409&&goalScope.current===scope) {
        try{const latest=await api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token});if(goalScope.current===scope)applyAdminGoals(latest);}catch{}
      }
      throw e;
    } finally {setBusy(false);}
  }
  async function saveAdminWorkdays(body) {
    const scope=`${adminStore}:${adminSeller}:${tab}`;setBusy(true);setError('');setNotice('');
    try {
      const result=await api('/api/admin/workdays',{method:'POST',token,body:{...body,storeId:adminStore,sellerId:Number(adminSeller)}});
      if(goalScope.current===scope)applyAdminGoals(result);
      onChanged();return result;
    } catch(e) {
      if(e.status===409&&goalScope.current===scope) {
        try{const latest=await api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token});if(goalScope.current===scope)applyAdminGoals(latest);}catch{}
      }
      throw e;
    } finally {setBusy(false);}
  }
  async function login(e) {
    e.preventDefault();setBusy(true);setError('');
    try {
      let auth;
      if(CLOUD){auth=await adminLogin(email,password);try{await api('/api/admin/all',{token:auth});}catch(e){await adminLogout();throw e;}}
      else {const result=await api('/api/admin/login',{method:'POST',body:{password}});auth=result.token;}
      sessionStorage.setItem('pulse-admin-token',auth);setToken(auth);setPassword('');
    }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function logout() {
    try {if(CLOUD)await adminLogout();else await api('/api/admin/logout',{method:'POST',token,body:{}})} catch {}
    sessionStorage.removeItem('pulse-admin-token');setToken('');setNotice('');
  }
  async function run(work, success) {
    setBusy(true);setError('');setNotice('');
    try {await work();if(success)setNotice(success);await loadAll();onChanged();}
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  function switchTab(next){setTab(next);setCountsFor('');setError('');setNotice('');setEditing(null);setName('');}
  function changeStore(value){setAdminStore(value);setAdminSeller('');setCounts({});setCountsFor('');setEditing(null);setNewSellerDepartment('');setError('');setNotice('');}
  const activeSellers=sellersForStore(all.sellers,adminStore);
  const storeSellers=sellersForStore(all.sellers,adminStore,{activeOnly:false});
  const storeDepartments=adminStore?departmentsForStore(all,adminStore,{activeOnly:false}):[];
  const activeDepartments=storeDepartments.filter(d=>d.active);
  const departmentForNewSeller=activeDepartments.some(d=>d.id===newSellerDepartment)?newSellerDepartment:activeDepartments[0]?.id||'';
  const orderedServices=orderServices(all.services,all.serviceOrders,adminStore);
  const activeServices=orderedServices.filter(s=>s.active);
  const adminStoreName=data.stores.find(s=>s.id===adminStore)?.name||'';
  const needsStore=['sales','goals','departments','sellers','services','pins'].includes(tab);
  function moveService(index,offset) {
    const ids=orderedServices.map(s=>s.id),target=index+offset;
    if(target<0||target>=ids.length)return;
    [ids[index],ids[target]]=[ids[target],ids[index]];
    run(()=>api('/api/admin/services/order',{method:'POST',token,body:{storeId:adminStore,serviceIds:ids}}),'Ordre enregistré pour ce magasin.');
  }

  if(!token) return <Modal title="Espace administrateur" subtitle="Un accès réservé pour gérer votre espace." onClose={onClose}>
    <div className="admin-login-illustration"><div className="admin-lock"><LockKeyhole size={24}/></div><div><strong>Gardez la main sur votre équipe.</strong><p>Gérez les vendeurs, les services et les ventes du jour.</p></div></div>
    <form onSubmit={login} className="admin-login-form">
      {CLOUD&&<><label className="form-label" htmlFor="admin-email">E-mail administrateur</label><input id="admin-email" className="text-input" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus/></>}
      <label className="form-label" htmlFor="admin-password">Mot de passe administrateur</label>
      <input id="admin-password" className="text-input" type="password" placeholder="Votre mot de passe" value={password} onChange={e=>setPassword(e.target.value)} required autoFocus={!CLOUD} autoComplete="current-password" />
      {error&&<div className="form-error" role="alert">{error}</div>}
      <button className="primary-button full-button" type="submit" disabled={busy}>{busy?'Connexion…':'Se connecter'} <ArrowRight size={16}/></button>
      <p className="form-footnote"><ShieldCheck size={14}/> L’accès administrateur est protégé par mot de passe.</p>
    </form>
  </Modal>;

  return <Modal title="Administration" subtitle={adminStoreName?`Magasin sélectionné : ${adminStoreName}`:'Choisissez un magasin dans l’onglet Magasins.'} onClose={onClose} wide>
    <div className="admin-tabs" role="tablist" aria-label="Rubriques administration">
      {[['sales','Ventes'],['goals','Objectifs'],['departments','Départements'],['sellers','Vendeurs'],['services','Services'],['stores','Magasins'],...(CLOUD?[['pins','Codes PIN']]:[]),['security','Sécurité']].map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} disabled={busy} onClick={()=>switchTab(key)} className={tab===key?'active':''}>{label}</button>)}
    </div>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
    <div className="admin-body">
      {needsStore&&!adminStore&&<div className="empty-admin">Choisissez d’abord le magasin dans l’onglet <button type="button" className="admin-inline-link" onClick={()=>switchTab('stores')}>Magasins</button>.</div>}
      {tab==='sales'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Ventes du jour</h3><p>Modifiez un total pour corriger une saisie. Les changements sont visibles immédiatement.</p></div></div>
        <div className="admin-selects admin-selects-single">
          <label><span className="form-label">Vendeur</span><select className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>setAdminSeller(e.target.value)}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        </div>
        {adminStore&&adminSeller ? countsFor===`${adminStore}:${adminSeller}` ? <div className="admin-counts">
          <div className="table-head"><span>SERVICE</span><span>VENTES AUJOURD’HUI</span></div>
          {activeServices.map(s=><div className="admin-count-row" key={s.id}><strong>{s.name}</strong><div><input type="number" min="0" max={CLOUD?100:999} aria-label={`Nombre de ventes ${s.name}`} value={counts[s.id]??0} onChange={e=>setCounts(c=>({...c,[s.id]:e.target.value}))}/><button disabled={busy} className="small-outline-button" onClick={()=>run(async()=>{const n=Number(counts[s.id]??0);if(!Number.isInteger(n)||n<0||n>(CLOUD?100:999))throw new Error(`La quantité doit être comprise entre 0 et ${CLOUD?100:999}.`);await api('/api/admin/adjust',{method:'POST',token,body:{storeId:adminStore,sellerId:Number(adminSeller),serviceId:s.id,count:n}})},'Total mis à jour.')}>Enregistrer</button></div></div>)}
        </div>:<div className="empty-admin">{countsLoading?'Chargement des ventes…':'Ventes indisponibles. Réessayez en changeant de sélection.'}</div>:<div className="empty-admin">Sélectionnez un magasin et un vendeur pour modifier les ventes.</div>}
        <div className="admin-note"><Info size={15}/> Les corrections ne déclenchent pas de notification de vente.</div>
      </>}
      {tab==='goals'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Objectifs par vendeur</h3><p>Choisissez les jours travaillés, puis les objectifs par service. Les autres périodes sont calculées automatiquement.</p></div></div>
        <div className="admin-selects admin-selects-single"><label><span className="form-label">Vendeur</span><select aria-label="Vendeur pour les objectifs" className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>setAdminSeller(e.target.value)}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label></div>
        {adminSeller ? goalsFor===`${adminStore}:${adminSeller}`&&adminGoals&&adminWorkdays ? <React.Fragment key={`${adminStore}:${adminSeller}`}>
          <WorkdaysForm workdays={adminWorkdays} revision={adminWorkdaysRevision} onSave={saveAdminWorkdays} disabled={busy}/>
          <section className="admin-goals-services" aria-labelledby="admin-goals-services-title"><div className="workdays-heading"><div><h4 id="admin-goals-services-title">Services</h4><p>Définissez une cible et sa période de référence pour chaque service.</p></div></div><GoalForm services={activeServices} goals={adminGoals} workdays={adminWorkdays} date={data.today} onSave={saveAdminGoals} disabled={busy}/></section>
        </React.Fragment> : <div className="empty-admin">{goalsLoading?'Chargement des objectifs…':'Objectifs indisponibles. Réessayez en changeant de sélection.'}</div> : <div className="empty-admin">Sélectionnez un vendeur pour gérer ses objectifs.</div>}
        <div className="admin-note"><Info size={15}/> Les objectifs se répètent et toute modification s’applique aux périodes suivantes.</div>
      </>}
      {tab==='departments'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Départements du magasin</h3><p>Renommez, ajoutez ou archivez les départements de ce magasin. Réaffectez les vendeurs actifs avant d’archiver leur département.</p></div></div>
        <form className="add-entity" onSubmit={e=>{e.preventDefault();if(!name.trim())return;run(async()=>{await api('/api/admin/departments',{method:'POST',token,body:{storeId:adminStore,name}});setName('');},'Département ajouté.');}}>
          <input className="text-input" aria-label="Nom du département" placeholder="Nom du département" value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
          <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter</button>
        </form>
        <div className="entity-list">{storeDepartments.map(item=><div className={`entity-row ${!item.active?'is-archived':''}`} key={item.id}>
          {editing===item.id?<form className="edit-entity" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/api/admin/departments/${item.id}`,{method:'PATCH',token,body:{storeId:adminStore,name:editName}});setEditing(null);},'Département renommé.');}}><input className="text-input" aria-label={`Nouveau nom de ${item.name}`} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus maxLength={60} required/><button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" onClick={()=>setEditing(null)}><X size={17}/></button></form>:<><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Archivé</span>}</div><div className="entity-actions"><button className="icon-button" aria-label={`Modifier ${item.name}`} title="Modifier" disabled={busy} onClick={()=>{setEditing(item.id);setEditName(item.name)}}><Pencil size={15}/></button><button className="icon-button" aria-label={`${item.active?'Archiver':'Restaurer'} ${item.name}`} title={item.active?'Archiver':'Restaurer'} disabled={busy} onClick={()=>{if(item.active&&!window.confirm(`Archiver « ${item.name} » ? Son historique sera conservé.`))return;run(()=>api(`/api/admin/departments/${item.id}`,{method:'PATCH',token,body:{storeId:adminStore,active:!item.active}}),item.active?'Département archivé.':'Département restauré.');}}>{item.active?<Archive size={15}/>:<RotateCcw size={15}/>}</button></div></>}
        </div>)}</div>
        <div className="admin-note"><Info size={15}/> Les ventes déjà enregistrées restent attachées à leur département d’origine.</div>
      </>}
      {(tab==='sellers'||tab==='services')&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>{tab==='sellers'?'Votre équipe':'Vos services'}</h3><p>{tab==='sellers'?'Les vendeurs sont propres à ce magasin et affichés par ordre alphabétique.':'Utilisez les flèches pour choisir l’ordre de ce magasin. Les noms et l’activation des services sont communs à tous les magasins.'} L’historique est conservé.</p></div></div>
        {!adminStore?<div className="empty-admin">Choisissez d’abord le magasin à gérer.</div>:<>
          <form className={`add-entity ${tab==='sellers'?'add-seller':''}`} onSubmit={e=>{e.preventDefault();if(!name.trim())return;run(async()=>{await api(`/api/admin/entities/${tab}`,{method:'POST',token,body:{name,...(tab==='sellers'?{storeId:adminStore,departmentId:departmentForNewSeller}:{})}});setName('');},tab==='sellers'?'Vendeur ajouté dans ce magasin.':'Service ajouté dans tous les magasins.');}}>
            <input className="text-input" aria-label={tab==='sellers'?'Nom du vendeur':'Nom du service'} placeholder={tab==='sellers'?'Prénom du vendeur':'Intitulé du service'} value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
            {tab==='sellers'&&<select className="text-input" aria-label="Département du nouveau vendeur" value={departmentForNewSeller} onChange={e=>setNewSellerDepartment(e.target.value)} disabled={busy||!activeDepartments.length} required>{activeDepartments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select>}
            <button className="primary-button" disabled={busy||(tab==='sellers'&&!departmentForNewSeller)}><Plus size={16}/> Ajouter</button>
          </form>
          {(tab==='sellers'?storeSellers:orderedServices).length===0?<div className="empty-admin">{tab==='sellers'?'Aucun vendeur dans ce magasin. Ajoutez le premier prénom ci-dessus.':'Aucun service pour le moment.'}</div>:<div className="entity-list">{(tab==='sellers'?storeSellers:orderedServices).map((item,index)=><div className={`entity-row ${tab==='sellers'?'seller-entity-row':''} ${!item.active?'is-archived':''}`} key={item.id}>
            {editing===item.id ? <form className="edit-entity" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/api/admin/entities/${tab}/${item.id}`,{method:'PATCH',token,body:{name:editName,...(tab==='sellers'?{storeId:adminStore}:{})}});setEditing(null);},'Nom modifié.')}}><input className="text-input" aria-label={`Nouveau nom de ${item.name}`} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus maxLength={60} required/><button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" title="Annuler" onClick={()=>setEditing(null)}><X size={17}/></button></form> : <><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Archivé</span>}</div>{tab==='sellers'&&<label className="entity-department"><span className="sr-only">Département de {item.name}</span><select className="text-input" aria-label={`Département de ${item.name}`} value={sellerDepartmentId(item)} disabled={busy} onChange={e=>{const departmentId=e.target.value;run(()=>api(`/api/admin/entities/sellers/${item.id}`,{method:'PATCH',token,body:{storeId:adminStore,departmentId}}),'Vendeur réaffecté. Les ventes passées restent dans leur département d’origine.');}}>{storeDepartments.filter(d=>d.active||d.id===sellerDepartmentId(item)).map(d=><option value={d.id} key={d.id}>{d.name}{d.active?'':' · archivé'}</option>)}</select></label>}<div className="entity-actions">
              {tab==='services'&&<><button className="icon-button order-button" aria-label={`Monter ${item.name}`} title="Monter" disabled={busy||index===0} onClick={()=>moveService(index,-1)}><ArrowUp size={16}/></button><button className="icon-button order-button" aria-label={`Descendre ${item.name}`} title="Descendre" disabled={busy||index===orderedServices.length-1} onClick={()=>moveService(index,1)}><ArrowDown size={16}/></button></>}
              <button className="icon-button" aria-label={`Modifier ${item.name}`} title="Modifier" disabled={busy} onClick={()=>{setEditing(item.id);setEditName(item.name)}}><Pencil size={15}/></button><button className="icon-button" aria-label={`${item.active?'Archiver':'Restaurer'} ${item.name}`} title={item.active?'Archiver':'Restaurer'} disabled={busy} onClick={()=>{if(item.active&&!window.confirm(`Archiver « ${item.name} » ? Son historique sera conservé.`))return;run(()=>api(`/api/admin/entities/${tab}/${item.id}`,{method:'PATCH',token,body:{active:!item.active,...(tab==='sellers'?{storeId:adminStore}:{})}}),item.active?'Élément archivé.':'Élément restauré.')}}>{item.active?<Archive size={15}/>:<RotateCcw size={15}/>}</button></div></>}
          </div>)}</div>}
        </>}
      </>}
      {tab==='stores'&&<>
        <div className="admin-store-scope">
          <label><span className="form-label">MAGASIN À GÉRER</span><select aria-label="Magasin à gérer" className="text-input" disabled={busy} value={adminStore} onChange={e=>changeStore(e.target.value)}><option value="">Choisir un magasin</option>{data.stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
          <p>Ce choix s’applique aux ventes, objectifs, vendeurs, services et codes PIN de l’administration.</p>
        </div>
        <div className="admin-section-heading"><div><h3>Ajouter un magasin</h3><p>Un magasin absent de la liste ? Ajoutez-le à votre espace.</p></div></div>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/api/admin/stores',{method:'POST',token,body:newStore});setNewStore({name:'',lat:'',lon:''});},'Magasin ajouté.')}}>
          <label><span className="form-label">Nom du magasin</span><input className="text-input" required maxLength={60} placeholder="Ex. Fnac Bordeaux" value={newStore.name} onChange={e=>setNewStore(v=>({...v,name:e.target.value}))}/></label>
          <div className="admin-selects"><label><span className="form-label">Latitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="44.8399" value={newStore.lat} onChange={e=>setNewStore(v=>({...v,lat:e.target.value}))}/></label><label><span className="form-label">Longitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="−0.5740" value={newStore.lon} onChange={e=>setNewStore(v=>({...v,lon:e.target.value}))}/></label></div>
          <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter le magasin</button>
        </form>
        <div className="admin-note"><Store size={15}/> Les coordonnées permettent de proposer ce magasin lors de la géolocalisation. Liste initiale issue d’OpenStreetMap, susceptible d’être incomplète.</div>
      </>}
      {CLOUD&&tab==='pins'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Accès et codes PIN</h3><p>Chaque vendeur choisit son propre PIN lors de sa première connexion. Aucun code préalable n’est nécessaire.</p></div></div>
        <div className="admin-selects admin-selects-single">
          <label><span className="form-label">Vendeur</span><select aria-label="Vendeur à réinitialiser" className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>{setAdminSeller(e.target.value);setNotice('');}}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        </div>
        <div className="activation-admin"><p>Si un vendeur oublie son PIN, réinitialisez son accès, puis prévenez-le immédiatement pour qu’il choisisse un nouveau code sur son téléphone.</p>
          <button type="button" className="primary-button" disabled={busy||!adminSeller} onClick={()=>{
            const person=activeSellers.find(s=>String(s.id)===String(adminSeller));
            if(!window.confirm(`Réinitialiser l’accès de ${person?.name||'ce vendeur'} ? Son PIN et ses sessions seront immédiatement désactivés. La première personne à choisir ce profil pourra créer un nouveau PIN.`))return;
            run(()=>api('/api/admin/pin-reset',{method:'POST',token,body:{storeId:adminStore,sellerId:Number(adminSeller)}}),'Accès réinitialisé. Prévenez le vendeur pour qu’il choisisse son nouveau PIN.');
          }}>Réinitialiser l’accès <ArrowRight size={15}/></button>
        </div>
        <div className="admin-note"><ShieldCheck size={15}/> Tant qu’aucun PIN n’a été créé après une réinitialisation, la première personne à sélectionner ce profil peut le définir. L’administrateur ne voit pas le PIN.</div>
      </>}
      {tab==='security'&&<>
        <div className="admin-section-heading"><div><h3>Mot de passe administrateur</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{if(CLOUD)await changeAdminPassword(oldPass,newPass);else await api('/api/admin/password',{method:'POST',token,body:{currentPassword:oldPass,newPassword:newPass}});setOldPass('');setNewPass('');},'Mot de passe mis à jour.')}}>
          <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" required value={oldPass} onChange={e=>setOldPass(e.target.value)}/></label>
          <label><span className="form-label">Nouveau mot de passe</span><input className="text-input" type="password" minLength={12} required value={newPass} onChange={e=>setNewPass(e.target.value)}/></label>
          <button className="primary-button" disabled={busy}>Mettre à jour <ArrowRight size={16}/></button>
        </form>
        <button className="logout-button" onClick={logout}><LogOut size={15}/> Déconnexion administrateur</button>
      </>}
    </div>
  </Modal>;
}
export { Modal };

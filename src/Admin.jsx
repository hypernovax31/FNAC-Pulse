import React, { useEffect, useRef, useState } from 'react';
import { X, LockKeyhole, ArrowRight, Plus, Check, Pencil, Archive, RotateCcw, LogOut, ShieldCheck, Store, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from './api';
import { CLOUD, adminLogin, adminLogout, changeAdminPassword, setPin } from './cloud';
import { randomPin } from './pin';
import { sellersForStore, orderServices } from './catalog';

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
  const [sellerPin,setSellerPin]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState('sales');
  const [all,setAll]=useState({sellers:[],services:[],serviceOrders:{}});
  const [adminStore,setAdminStore]=useState(session?.storeId||'');
  const [adminSeller,setAdminSeller]=useState(session?.sellerId?String(session.sellerId):'');
  const [allLoaded,setAllLoaded]=useState(false);
  const [counts,setCounts]=useState({});
  const [countsFor,setCountsFor]=useState('');
  const [countsLoading,setCountsLoading]=useState(false);
  const [name,setName]=useState('');
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
  function changeStore(value){setAdminStore(value);setAdminSeller('');setCounts({});setCountsFor('');setEditing(null);setSellerPin('');setError('');setNotice('');}
  const activeSellers=sellersForStore(all.sellers,adminStore);
  const storeSellers=sellersForStore(all.sellers,adminStore,{activeOnly:false});
  const orderedServices=orderServices(all.services,all.serviceOrders,adminStore);
  const activeServices=orderedServices.filter(s=>s.active);
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

  return <Modal title="Administration" subtitle="Configurez votre espace en toute simplicité." onClose={onClose} wide>
    <div className="admin-tabs" role="tablist" aria-label="Rubriques administration">
      {[['sales','Ventes'],['sellers','Vendeurs'],['services','Services'],['stores','Magasins'],...(CLOUD?[['pins','Codes PIN']]:[]),['security','Sécurité']].map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} disabled={busy} onClick={()=>switchTab(key)} className={tab===key?'active':''}>{label}</button>)}
    </div>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
    <div className="admin-body">
      {['sales','sellers','services','pins'].includes(tab)&&<div className="admin-store-scope">
        <label><span className="form-label">MAGASIN À GÉRER</span><select aria-label="Magasin à gérer" className="text-input" disabled={busy} value={adminStore} onChange={e=>changeStore(e.target.value)}><option value="">Choisir un magasin</option>{data.stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <p>Vendeurs et ordre des services propres au magasin sélectionné.</p>
      </div>}
      {tab==='sales'&&<>
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
      {(tab==='sellers'||tab==='services')&&<>
        <div className="admin-section-heading"><div><h3>{tab==='sellers'?'Votre équipe':'Vos services'}</h3><p>{tab==='sellers'?'Les vendeurs sont propres à ce magasin et affichés par ordre alphabétique.':'Utilisez les flèches pour choisir l’ordre de ce magasin. Les noms et l’activation des services sont communs à tous les magasins.'} L’historique est conservé.</p></div></div>
        {!adminStore?<div className="empty-admin">Choisissez d’abord le magasin à gérer.</div>:<>
          <form className="add-entity" onSubmit={e=>{e.preventDefault();if(!name.trim())return;run(async()=>{await api(`/api/admin/entities/${tab}`,{method:'POST',token,body:{name,...(tab==='sellers'?{storeId:adminStore}:{})}});setName('');},tab==='sellers'?'Vendeur ajouté dans ce magasin.':'Service ajouté dans tous les magasins.');}}>
            <input className="text-input" aria-label={tab==='sellers'?'Nom du vendeur':'Nom du service'} placeholder={tab==='sellers'?'Prénom du vendeur':'Intitulé du service'} value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
            <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter</button>
          </form>
          {(tab==='sellers'?storeSellers:orderedServices).length===0?<div className="empty-admin">{tab==='sellers'?'Aucun vendeur dans ce magasin. Ajoutez le premier prénom ci-dessus.':'Aucun service pour le moment.'}</div>:<div className="entity-list">{(tab==='sellers'?storeSellers:orderedServices).map((item,index)=><div className={`entity-row ${!item.active?'is-archived':''}`} key={item.id}>
            {editing===item.id ? <form className="edit-entity" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/api/admin/entities/${tab}/${item.id}`,{method:'PATCH',token,body:{name:editName,...(tab==='sellers'?{storeId:adminStore}:{})}});setEditing(null);},'Nom modifié.')}}><input className="text-input" aria-label={`Nouveau nom de ${item.name}`} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus maxLength={60} required/><button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" title="Annuler" onClick={()=>setEditing(null)}><X size={17}/></button></form> : <><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Archivé</span>}</div><div className="entity-actions">
              {tab==='services'&&<><button className="icon-button order-button" aria-label={`Monter ${item.name}`} title="Monter" disabled={busy||index===0} onClick={()=>moveService(index,-1)}><ArrowUp size={16}/></button><button className="icon-button order-button" aria-label={`Descendre ${item.name}`} title="Descendre" disabled={busy||index===orderedServices.length-1} onClick={()=>moveService(index,1)}><ArrowDown size={16}/></button></>}
              <button className="icon-button" aria-label={`Modifier ${item.name}`} title="Modifier" disabled={busy} onClick={()=>{setEditing(item.id);setEditName(item.name)}}><Pencil size={15}/></button><button className="icon-button" aria-label={`${item.active?'Archiver':'Restaurer'} ${item.name}`} title={item.active?'Archiver':'Restaurer'} disabled={busy} onClick={()=>{if(item.active&&!window.confirm(`Archiver « ${item.name} » ? Son historique sera conservé.`))return;run(()=>api(`/api/admin/entities/${tab}/${item.id}`,{method:'PATCH',token,body:{active:!item.active,...(tab==='sellers'?{storeId:adminStore}:{})}}),item.active?'Élément archivé.':'Élément restauré.')}}>{item.active?<Archive size={15}/>:<RotateCcw size={15}/>}</button></div></>}
          </div>)}</div>}
        </>}
      </>}
      {tab==='stores'&&<>
        <div className="admin-section-heading"><div><h3>Ajouter un magasin</h3><p>Un magasin absent de la liste ? Ajoutez-le à votre espace.</p></div></div>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/api/admin/stores',{method:'POST',token,body:newStore});setNewStore({name:'',lat:'',lon:''});},'Magasin ajouté.')}}>
          <label><span className="form-label">Nom du magasin</span><input className="text-input" required maxLength={60} placeholder="Ex. Fnac Bordeaux" value={newStore.name} onChange={e=>setNewStore(v=>({...v,name:e.target.value}))}/></label>
          <div className="admin-selects"><label><span className="form-label">Latitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="44.8399" value={newStore.lat} onChange={e=>setNewStore(v=>({...v,lat:e.target.value}))}/></label><label><span className="form-label">Longitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="−0.5740" value={newStore.lon} onChange={e=>setNewStore(v=>({...v,lon:e.target.value}))}/></label></div>
          <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter le magasin</button>
        </form>
        <div className="admin-note"><Store size={15}/> Les coordonnées permettent de proposer ce magasin lors de la géolocalisation. Liste initiale issue d’OpenStreetMap, susceptible d’être incomplète.</div>
      </>}
      {CLOUD&&tab==='pins'&&<>
        <div className="admin-section-heading"><div><h3>Codes PIN individuels</h3><p>Définissez un code différent pour chaque vendeur et chaque magasin. Aucun code par défaut n’est créé.</p></div></div>
        <div className="admin-selects admin-selects-single">
          <label><span className="form-label">Vendeur</span><select className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>setAdminSeller(e.target.value)}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        </div>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(()=>setPin(api,token,adminStore,adminSeller,sellerPin),'Code défini. Transmettez-le au vendeur par un canal privé.');}}>
          <label><span className="form-label">Nouveau code à 8 chiffres</span><input className="text-input" value={sellerPin} onChange={e=>setSellerPin(e.target.value.replace(/\D/g,''))} inputMode="numeric" autoComplete="off" pattern="[0-9]{8}" maxLength={8} required/></label>
          <div className="pin-actions"><button type="button" className="outline-button" onClick={()=>setSellerPin(randomPin())}>Générer un code</button><button className="primary-button" disabled={busy||!adminStore||!adminSeller||sellerPin.length!==8}>Enregistrer le code</button></div>
        </form>
        <div className="admin-note"><ShieldCheck size={15}/> Un changement de PIN retire l’accès aux anciennes sessions. Le code affiché ne doit pas être partagé dans un canal public.</div>
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

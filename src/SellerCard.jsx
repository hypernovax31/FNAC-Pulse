import React from 'react';
import {Archive,Check,Pencil,RotateCcw,X} from 'lucide-react';
import {sellerDepartmentId} from './departments';
import {SellerWorkdays} from './SellerWorkdays';

export function SellerCard({seller,departments,storeId,token,busy,editing,editName,onEditName,onEdit,onCancelEdit,onRename,onArchive,workdaysOpen,onToggleWorkdays,onBusy,onChanged}) {
  const department=departments.find(d=>d.id===sellerDepartmentId(seller));
  return <article className={`seller-card ${!seller.active?'is-archived':''}`}>
    <div className="seller-card-top">
      {editing?<form className="edit-entity" onSubmit={event=>{event.preventDefault();onRename();}}>
        <input className="text-input" aria-label={`Nouveau nom de ${seller.name}`} value={editName} onChange={event=>onEditName(event.target.value)} autoFocus maxLength={60} required/>
        <button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" title="Annuler" onClick={onCancelEdit}><X size={17}/></button>
      </form>:<><div className="seller-card-name"><span className="seller-card-avatar" aria-hidden="true">{(seller.name||'?').trim().slice(0,1).toUpperCase()}</span><div><strong>{seller.name}</strong>{!seller.active&&<span className="archived-label">{seller.deletingJob?'Suppression en cours':'Archivé'}</span>}</div></div>
        <div className="entity-actions"><button type="button" className="icon-button" aria-label={`Modifier ${seller.name}`} title="Modifier" disabled={busy||!!seller.deletingJob} onClick={onEdit}><Pencil size={15}/></button>
          <button type="button" className="icon-button" aria-label={`${seller.active?'Archiver':'Restaurer'} ${seller.name}`} title={seller.active?'Archiver':'Restaurer'} disabled={busy||!!seller.deletingJob} onClick={onArchive}>{seller.active?<Archive size={15}/>:<RotateCcw size={15}/>}</button>
        </div></>}
    </div>
    <div className="seller-card-department"><span>DÉPARTEMENT</span><div className="seller-department-value" aria-label={`Département de ${seller.name}`}><strong>{department?.name||'Département indisponible'}</strong>{department&&!department.active&&<span> · archivé</span>}<small>Affectation définitive</small></div></div>
    <SellerWorkdays seller={seller} storeId={storeId} token={token} open={workdaysOpen} onToggle={onToggleWorkdays} disabled={busy} onBusy={onBusy} onChanged={onChanged}/>
  </article>;
}

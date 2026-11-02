import React, {useRef,useState} from 'react';
import {ArrowRight, ExternalLink, Info} from 'lucide-react';
import {api} from './api';
import {FNAC_DIRECTORY_URL, parseFnacDirectory} from '../worker/fnac-source.js';

// Le HTML est analysé sur l'appareil et n'est pas envoyé au serveur : seules
// les fiches et leur nombre sont transmis après confirmation explicite.
export function DirectoryImport({token,disabled=false,onBusy,onImported}) {
  const [source,setSource]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  function analyze(html) {
    setError('');setNotice('');setSource(null);
    try {setSource(parseFnacDirectory(html));}
    catch(e) {setError(e?.code==='incomplete'?'La copie est incomplète : sélectionnez toute la page Fnac et conservez les liens.':'Impossible de lire la page Fnac. Copiez toute la page avec ses liens ou choisissez un fichier HTML.');}
  }
  async function fileChange(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>8_000_000){setSource(null);setError('Fichier trop volumineux (8 Mo maximum).');return;}
    try {analyze(await file.text());}catch {setSource(null);setError('Lecture du fichier impossible.');}
  }
  async function apply() {
    if(!source||disabled||inFlight.current)return;
    if(!window.confirm(`Importer ${source.entries.length} fiches depuis cette copie ? La date et l’origine de la copie ne peuvent pas être vérifiées automatiquement. Les magasins absents, les profils et les historiques restent conservés.`))return;
    inFlight.current=true;setBusy(true);onBusy?.(true);setError('');setNotice('');
    try {
      const result=await api('/api/admin/stores/import',{method:'POST',token,body:source});
      setSource(null);
      setNotice(`Copie importée : ${result.imported} fiches.${result.reviewCount?` ${result.reviewCount} correspondance(s) nécessitent une vérification.`:''} L’accès automatique à Fnac reste indépendant.`);
      try {await onImported?.();}catch { /* La prochaine ouverture rechargera l’état. */ }
    } catch(e) {setError(e?.status&&e.status<500?e.message:'Résultat non confirmé. Rechargez l’état de l’annuaire avant de réessayer.');}
    finally {inFlight.current=false;setBusy(false);onBusy?.(false);}
  }
  return <details className="directory-import">
    <summary>Importer manuellement une copie Fnac</summary>
    <p>Si l’accès automatique est refusé, ouvrez l’annuaire officiel, sélectionnez toute la page, copiez-la puis collez-la ci-dessous avec ses liens. Vous pouvez aussi choisir la page enregistrée en fichier HTML.</p>
    <a href={FNAC_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">Ouvrir l’annuaire Fnac <ExternalLink size={13}/></a>
    <label><span className="form-label">Copie de la page complète</span><textarea className="text-input directory-paste" aria-label="Coller la page complète de l’annuaire Fnac" placeholder="Coller ici la page Fnac copiée avec ses liens" value="" onChange={()=>{}} onPaste={e=>{
      e.preventDefault();const html=e.clipboardData?.getData('text/html');
      if(!html){setSource(null);setError('La copie ne contient pas les liens des fiches. Copiez la page complète ou utilisez un fichier HTML.');return;}
      analyze(html);
    }} disabled={busy||disabled}/></label>
    <label className="directory-file"><span className="form-label">Ou choisir un fichier HTML</span><input type="file" accept=".html,.htm,text/html" onChange={fileChange} disabled={busy||disabled}/></label>
    {source&&<div className="directory-preview" role="status"><strong>{source.entries.length} fiches détectées · {source.declared} magasins annoncés</strong><p>{source.entries.slice(0,3).map(item=>item.name).join(' · ')}{source.entries.length>3?'…':''}</p></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status">{notice}</div>}
    <p className="admin-account-help"><Info size={14}/><span>La fraîcheur et l’origine de cette copie ne sont pas certifiées automatiquement. Les magasins absents, les profils et les données historiques ne sont ni supprimés ni fusionnés.</span></p>
    <button type="button" className="primary-button" disabled={!source||busy||disabled} onClick={apply}>{busy?'Import…':'Importer la copie'} <ArrowRight size={15}/></button>
  </details>;
}

import React from 'react';
import {Check} from 'lucide-react';
import {AutoSaveStatus,useAutomaticSave} from './AutoSave';

const cleanName=value=>value.trim().replace(/\s+/g,' ').slice(0,60);

// Renommer ne crée jamais d'entité. La valeur de départ est transmise comme
// précondition au serveur pour ne pas écraser le changement d'un collègue.
export function AutoNameEditor({name,onSave,onFinish,disabled=false}) {
  const editor=useAutomaticSave({remoteValue:name,remoteVersion:name,disabled,delay:1500,
    equals:(a,b)=>cleanName(a)===cleanName(b),
    validate:value=>cleanName(value)?'':'Saisissez un nom avant de continuer.',
    onSave:async(value,expectedName)=>{
      const next=cleanName(value);
      await onSave(next,expectedName);
      // Ne pas retirer un espace en cours de saisie lorsque le réseau répond.
      return {value:next,version:next,replaceDraft:false};
    },
  });
  async function finish(){if(await editor.flush())onFinish(editor.lastPhase()==='saved');}
  return <form className="edit-entity autosave-name" onSubmit={event=>{event.preventDefault();void finish();}}>
    <input className="text-input" aria-label={`Nouveau nom de ${name}`} value={editor.draft} onChange={event=>editor.change(event.target.value)} autoFocus maxLength={60} disabled={disabled} required/>
    <button className="icon-button" type="submit" aria-label="Terminer la modification du nom" title="Terminer" disabled={disabled}><Check size={17}/></button>
    <AutoSaveStatus editor={editor} saved="Nom enregistré automatiquement."/>
  </form>;
}

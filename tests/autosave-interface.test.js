import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React,{useState} from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const built=await build({stdin:{contents:`export {GoalForm,WorkdaysForm} from './src/Goals.jsx';export {AutoSaveProvider,useAutoSaveRegistry} from './src/AutoSave.jsx';export {AutoNameEditor} from './src/AutoNameEditor.jsx';`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',external:['react','lucide-react'],write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,require);
const {GoalForm,WorkdaysForm,AutoSaveProvider,useAutoSaveRegistry,AutoNameEditor}=module.exports;
const tick=()=>new Promise(r=>setImmediate(r)),wait=ms=>new Promise(r=>setTimeout(r,ms));
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const button=(tree,label)=>tree.root.findAllByType('button').find(b=>text(b).includes(label));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const services=[{id:1,name:'DMax'},{id:2,name:'FVD'}];
const initial={s1:{day:null,week:null,month:30,revision:'goal-rev-001'},s2:{day:null,week:null,month:10,revision:'goal-rev-002'}};
const response=(id,amount,revision)=>({goals:{...initial,[`s${id}`]:{day:null,week:null,month:amount,revision}},workdays:[1,2,3,4,5]});
function Gate({onLeave}) {const registry=useAutoSaveRegistry();return React.createElement('button',{onClick:async()=>{if(await registry.flush())onLeave();}},'Changer d’onglet');}
function Harness({save,onLeave=()=>{},start=initial,admin=false}) {
  const [goals,setGoals]=useState(start);
  return React.createElement(AutoSaveProvider,null,React.createElement(Gate,{onLeave}),React.createElement(GoalForm,{
    services,goals,admin,workdays:[1,2,3,4,5],date:'2026-10-26',initialServiceId:1,
    onSave:async body=>{const result=await save(body,setGoals);setGoals(result.goals);return result;},
  }));
}
const field=tree=>tree.root.findByProps({'aria-label':'Cible de référence'});
const service=tree=>tree.root.findByProps({'aria-label':'Service pour les objectifs'});
const enter=(tree,value)=>field(tree).props.onChange({target:{value}});

function stubWindow() {
  const old=Object.getOwnPropertyDescriptor(globalThis,'window'),listeners=new Map();let accept=true;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type)=>listeners.delete(type),confirm:()=>accept}});
  return {listeners,setAccept(value){accept=value;},restore(){if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;}};
}

test('Cible : sauvegarde automatique différée, zéro valide et champ vide jamais assimilé à une suppression',async()=>{
  const env=stubWindow(),calls=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{save:async body=>{calls.push(body);return response(1,body.values.month,`goal-rev-00${calls.length+2}`);}}));});
    assert(!tree.root.findAllByType('button').some(b=>/^Enregistrer/.test(text(b))));
    await act(async()=>{enter(tree,'4');enter(tree,'42');await wait(1250);});
    assert.equal(calls.length,1);assert.deepEqual(calls[0].values,{day:null,week:null,month:42});
    assert.match(text(tree.toJSON()),/enregistrés automatiquement/);
    await act(async()=>{enter(tree,'0');await wait(1250);});assert.equal(calls.length,2);assert.equal(calls[1].values.month,0);assert.equal(calls[1].revision,'goal-rev-003');
    await act(async()=>{enter(tree,'');await wait(1250);});assert.equal(calls.length,2);assert.match(text(tree.toJSON()),/Indiquez une cible/);
    assert.equal(field(tree).props.value,'','la saisie invalide reste visible');
    await act(async()=>button(tree,'Annuler la saisie non enregistrée').props.onClick());assert.equal(field(tree).props.value,'0');
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Changement de service : attendre la réponse et conserver le bon vendeur/service',async()=>{
  const env=stubWindow(),request=defer(),calls=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{save:body=>{calls.push(body);return request.promise;}}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{service(tree).props.onChange({target:{value:'2'}});await tick();});
    assert.equal(service(tree).props.value,'1');assert.equal(calls.length,1);assert.equal(calls[0].serviceId,1);assert.equal(calls[0].revision,'goal-rev-001');
    await act(async()=>{request.resolve(response(1,45,'goal-rev-003'));await tick();});
    assert.equal(service(tree).props.value,'2');assert.equal(field(tree).props.value,'10');
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Échec réseau : rester dans l’onglet, préserver la saisie et permettre un réessai explicite',async()=>{
  const env=stubWindow(),calls=[];let leave=0,tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{onLeave:()=>leave++,save:async body=>{calls.push(body);if(calls.length===1)throw Error('Connexion interrompue.');return response(1,45,'goal-rev-003');}}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});
    assert.equal(leave,0);assert.equal(field(tree).props.value,'45');assert.match(text(tree.toJSON()),/Connexion interrompue/);assert.equal(calls.length,1);
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(calls.length,1,'aucun réessai silencieux après une réponse incertaine');assert.equal(leave,0);
    await act(async()=>{button(tree,'Réessayer').props.onClick();await tick();});assert.equal(calls.length,2);assert.equal(calls[1].revision,'goal-rev-001');assert.match(text(tree.toJSON()),/enregistrés automatiquement/);
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(leave,1);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Conflit : conserver la saisie jusqu’au rechargement explicitement accepté',async()=>{
  const env=stubWindow();let tree,calls=0,leaves=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{onLeave:()=>leaves++,save:async(body,setGoals)=>{
      calls++;setGoals(response(1,77,'goal-rev-remote').goals);throw Object.assign(Error('Conflit'),{status:409});
    }}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});
    assert.equal(leaves,0);assert.equal(calls,1);assert.equal(field(tree).props.value,'45');assert.match(text(tree.toJSON()),/modifié ailleurs/);
    env.setAccept(false);await act(async()=>button(tree,'Recharger les valeurs').props.onClick());assert.equal(field(tree).props.value,'45');
    env.setAccept(true);await act(async()=>button(tree,'Recharger les valeurs').props.onClick());assert.equal(field(tree).props.value,'77');
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(leaves,1);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Deux saisies pendant une réponse lente sont sérialisées avec la nouvelle révision',async()=>{
  const env=stubWindow(),request=defer(),calls=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{save:body=>{calls.push(body);return calls.length===1?request.promise:Promise.resolve(response(1,46,'goal-rev-004'));}}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(calls.length,1);assert.equal(field(tree).props.disabled,false,'la saisie et le clavier restent utilisables pendant le réseau');
    // La nouvelle saisie attend la réponse et reprend sa révision.
    await act(async()=>enter(tree,'46'));assert.equal(calls.length,1);
    await act(async()=>{request.resolve(response(1,45,'goal-rev-003'));await tick();await tick();});
    assert.equal(calls.length,2);assert.equal(calls[1].revision,'goal-rev-003');assert.equal(calls[1].values.month,46);assert.equal(field(tree).props.value,'46');
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Fermeture du navigateur : avertir uniquement tant qu’une donnée est non confirmée',async()=>{
  const env=stubWindow(),request=defer();let tree;
  const fire=()=>{let prevented=false;const event={preventDefault(){prevented=true;},returnValue:undefined};env.listeners.get('beforeunload')(event);return {prevented,returnValue:event.returnValue};};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{save:()=>request.promise}));});
    assert.equal(fire().prevented,false);
    await act(async()=>enter(tree,'45'));assert.equal(fire().prevented,true);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});assert.equal(fire().prevented,true);
    await act(async()=>{request.resolve(response(1,45,'goal-rev-003'));await tick();});assert.equal(fire().prevented,false);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Planning : sauvegarde automatique groupée et un dernier jour toujours conservé',async()=>{
  const env=stubWindow(),calls=[];let tree;
  function Planning(){const [state,setState]=useState({workdays:[1],revision:'days-rev-001'});return React.createElement(AutoSaveProvider,null,React.createElement(WorkdaysForm,{workdays:state.workdays,revision:state.revision,onSave:async body=>{
    calls.push(body);const result={workdays:body.workdays,workdaysRevision:'days-rev-002'};setState({workdays:result.workdays,revision:result.workdaysRevision});return result;
  }}));}
  const day=name=>tree.root.findAllByType('label').find(x=>text(x).includes(name)).findByType('input');
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Planning));});
    await act(async()=>day('Lundi').props.onChange());assert(day('Lundi').props.checked);assert.match(text(tree.toJSON()),/Cochez d’abord un autre jour/);assert.equal(calls.length,0);
    await act(async()=>{day('Samedi').props.onChange();day('Dimanche').props.onChange();await wait(1250);});
    assert.equal(calls.length,1);assert.deepEqual(calls[0].workdays,[1,6,0]);assert.equal(calls[0].revision,'days-rev-001');assert.match(text(tree.toJSON()),/enregistrés automatiquement/);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Renommage : délai automatique, précondition de nom et validation',async()=>{
  const env=stubWindow(),calls=[];let tree;
  function Name(){const [name,setName]=useState('DMax');return React.createElement(AutoSaveProvider,null,React.createElement(AutoNameEditor,{name,onFinish(){},onSave:async(value,expected)=>{calls.push({value,expected});setName(value);}}));}
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Name));});
    const input=()=>tree.root.findByType('input');
    await act(async()=>{input().props.onChange({target:{value:'Service complet '}});await wait(1650);});
    assert.deepEqual(calls,[{value:'Service complet',expected:'DMax'}]);assert.match(text(tree.toJSON()),/Nom enregistré automatiquement/);
    assert.equal(input().props.value,'Service complet ','l’espace en cours de saisie ne disparaît pas');
    await act(async()=>{input().props.onChange({target:{value:' '}});await wait(1650);});assert.equal(calls.length,1);assert.match(text(tree.toJSON()),/Saisissez un nom/);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Réponse perdue après retour à l’ancienne valeur : aucune sortie ni confirmation silencieuse',async()=>{
  const env=stubWindow(),request=defer(),calls=[];let tree,leaves=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{onLeave:()=>leaves++,save:body=>{calls.push(body);return calls.length===1?request.promise:Promise.resolve(response(1,30,'goal-rev-003'));}}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    await act(async()=>enter(tree,'30'));
    await act(async()=>{request.reject(new TypeError('Failed to fetch'));await tick();});
    assert.match(text(tree.toJSON()),/a peut-être été enregistrée/);assert.equal(field(tree).props.value,'30');
    let prevented=false;env.listeners.get('beforeunload')({preventDefault(){prevented=true;}});assert(prevented);
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(leaves,0);assert.equal(calls.length,1);
    await act(async()=>{button(tree,'Réessayer').props.onClick();await tick();});assert.equal(calls.length,2);assert.equal(calls[1].values.month,30);
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(leaves,1);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Passage en arrière-plan : la sauvegarde est lancée sans attendre le délai',async()=>{
  const env=stubWindow(),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),listeners=new Map(),calls=[];let tree;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'hidden',addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)}});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{save:async body=>{calls.push(body);return response(1,46,'goal-rev-003');}}));});
    await act(async()=>enter(tree,'46'));assert.equal(calls.length,0);
    await act(async()=>{listeners.get('visibilitychange')();await tick();});assert.equal(calls.length,1);assert.equal(calls[0].values.month,46);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;}
});

test('Réponse perdue après écriture distante : conflit et saisie ultérieure conservée',async()=>{
  const env=stubWindow(),request=defer();let tree,leaves=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{onLeave:()=>leaves++,save:async(body,setGoals)=>{
      try {return await request.promise;}catch(e){setGoals(response(1,45,'goal-rev-remote').goals);throw e;}
    }}));});
    await act(async()=>enter(tree,'45'));
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    await act(async()=>enter(tree,'46'));
    await act(async()=>{request.reject(new TypeError('réponse perdue'));await tick();});
    assert.equal(field(tree).props.value,'46');assert.match(text(tree.toJSON()),/modifié ailleurs/);
    await act(async()=>{button(tree,'Changer d’onglet').props.onClick();await tick();});assert.equal(leaves,0);
    env.setAccept(false);await act(async()=>button(tree,'Recharger les valeurs').props.onClick());assert.equal(field(tree).props.value,'46');
    env.setAccept(true);await act(async()=>button(tree,'Recharger les valeurs').props.onClick());assert.equal(field(tree).props.value,'45');
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

test('Suppression explicite : aucune valeur nulle sans confirmation',async()=>{
  const env=stubWindow(),calls=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness,{admin:true,save:async body=>{calls.push(body);return {goals:{...initial,s1:{day:null,week:null,month:null,revision:'goal-rev-deleted'}},workdays:[1,2,3,4,5]};}}));});
    env.setAccept(false);await act(async()=>{button(tree,'Supprimer l’objectif de ce service').props.onClick();await tick();});assert.equal(calls.length,0);
    env.setAccept(true);await act(async()=>{button(tree,'Supprimer l’objectif de ce service').props.onClick();await tick();});
    assert.equal(calls.length,1);assert.deepEqual(calls[0].values,{day:null,week:null,month:null});assert.equal(calls[0].revision,'goal-rev-001');assert.match(text(tree.toJSON()),/Objectif supprimé\./);
  } finally {if(tree)await act(async()=>tree.unmount());env.restore();}
});

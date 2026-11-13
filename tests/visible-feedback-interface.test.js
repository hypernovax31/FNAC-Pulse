import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const output=await build({stdin:{contents:`
  export {VisibleFeedback,VisibleFeedbackProvider,useFeedbackState,useRetryFeedback} from './src/VisibleFeedback.jsx';
  export {useTrackedJobFeedback} from './src/TrackedJobFeedback.js';
  export {AppToastProvider,ModalToastOutlet} from './src/AppToasts.jsx';
`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent'});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const {VisibleFeedback,VisibleFeedbackProvider,useFeedbackState,useRetryFeedback,useTrackedJobFeedback,AppToastProvider,ModalToastOutlet}=module.exports;
const h=React.createElement;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const aside=tree=>tree.root.findAllByType('aside')[0];
const close=tree=>tree.root.findByProps({'aria-label':'Fermer ce message'});

test('Le rappel visible conserve le message initial, se ferme et se réaffiche après une erreur identique',async()=>{
  let setMessage,ran=0,tree;
  function Example() {
    const [message,set,revision]=useFeedbackState('');setMessage=set;
    return h(React.Fragment,null,
      h(VisibleFeedback,{message,tone:'error',revision,actionLabel:'Réessayer',onAction:()=>ran++}),
      message&&h('p',{role:'alert'},message));
  }
  try {
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,null,h(Example)));});
    await act(async()=>setMessage('Connexion impossible.'));
    assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
    assert.match(text(tree.toJSON()),/Connexion impossible/);
    assert.equal(aside(tree).props['aria-live'],'off');
    assert.match(text(aside(tree)),/Connexion impossible/);
    await act(async()=>close(tree).props.onClick());
    assert.equal(tree.root.findAllByType('aside').length,0);
    assert.match(text(tree.root.findByProps({role:'alert'})),/Connexion impossible/);
    await act(async()=>setMessage('Connexion impossible.'));
    assert.match(text(aside(tree)),/Connexion impossible/);
    await act(async()=>aside(tree).findAllByType('button').find(b=>text(b)==='Réessayer').props.onClick());
    assert.equal(ran,1);assert.equal(tree.root.findAllByType('aside').length,0);
    assert.match(text(tree.root.findByProps({role:'alert'})),/Connexion impossible/);
    await act(async()=>{setMessage('');setMessage('Une nouvelle erreur.');});
    assert.match(text(aside(tree)),/Une nouvelle erreur/);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Plusieurs retours : le dernier est visible et fermer son rappel laisse les autres accessibles',async()=>{
  let setA,setB,tree;
  function Example(){
    const [a,sa,ra]=useFeedbackState(''),[b,sb,rb]=useFeedbackState('');setA=sa;setB=sb;
    return h(React.Fragment,null,h(VisibleFeedback,{message:a,revision:ra}),h(VisibleFeedback,{message:b,tone:'error',revision:rb}),
      a&&h('p',{role:'status'},a),b&&h('p',{role:'alert'},b));
  }
  try {
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,null,h(Example)));});
    await act(async()=>setA('Premier retour'));
    await act(async()=>setB('Deuxième retour'));
    assert.match(text(aside(tree)),/Deuxième retour/);
    await act(async()=>close(tree).props.onClick());
    assert.match(text(aside(tree)),/Premier retour/);
    await act(async()=>close(tree).props.onClick());
    assert.equal(tree.root.findAllByType('aside').length,0);
    assert.equal(tree.root.findAllByProps({role:'status'}).length,1);assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Suivi des traitements : pas de confirmation historique, reprise dans le même onglet et fin réelle une seule fois',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),values=new Map();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  let job,tree;
  function Example(){
    job=useTrackedJobFeedback('test','magasin-test','',item=>({tone:item.status==='needs-review'?'error':'success',message:`Traitement ${item.status}`}));
    return h(VisibleFeedback,{message:job.notice?.message,tone:job.notice?.tone,revision:job.revision});
  }
  const mount=()=>h(VisibleFeedbackProvider,null,h(Example));
  try {
    await act(async()=>{tree=TestRenderer.create(mount());});
    await act(async()=>job.observe({jobId:'historique',status:'done'}));
    assert.equal(tree.root.findAllByType('aside').length,0);
    await act(async()=>{job.begin('local');job.observe({jobId:'autre',status:'running'});});
    assert.equal(tree.root.findAllByType('aside').length,0);
    assert.equal(values.get('fnac-pulse-feedback-job:test:magasin-test'),'local');
    await act(async()=>job.observe({jobId:'local',status:'running',count:1}));
    assert.match(text(aside(tree)),/Traitement running/);
    await act(async()=>close(tree).props.onClick());
    await act(async()=>job.observe({jobId:'local',status:'running',count:2}));
    assert.equal(tree.root.findAllByType('aside').length,0,'un sondage ne réaffiche pas le même état');
    await act(async()=>tree.unmount());
    await act(async()=>{tree=TestRenderer.create(mount());});
    await act(async()=>job.observe({jobId:'local',status:'done'}));
    assert.match(text(aside(tree)),/Traitement done/);assert.equal(values.size,0);
    await act(async()=>close(tree).props.onClick());
    await act(async()=>job.observe({jobId:'local',status:'done'}));
    assert.equal(tree.root.findAllByType('aside').length,0);
    await act(async()=>{job.begin('autre-local');job.observe({jobId:'autre-local',status:'needs-review'});});
    assert.match(text(aside(tree)),/needs-review/);assert.match(aside(tree).props.className,/is-error/);assert.equal(values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete globalThis.sessionStorage;}
});

test('Le toast et son action restent dans le dialogue actif puis reviennent sur la page',async()=>{
  let toggle,ran=0,tree;
  function Example(){
    const [open,setOpen]=React.useState(false);toggle=setOpen;
    const items=h('button',{type:'button',onClick:()=>ran++},'Annuler');
    return h(AppToastProvider,{items},open?h('div',{role:'dialog'},h(ModalToastOutlet)):h('main',null,'Page'));
  }
  try {
    await act(async()=>{tree=TestRenderer.create(h(Example));});
    assert.equal(tree.root.findAllByProps({className:'toast-stack'}).length,1);
    await act(async()=>toggle(true));
    assert.equal(tree.root.findAllByProps({className:'toast-stack'}).length,0);
    const dialog=tree.root.findByProps({role:'dialog'}),stack=dialog.findByProps({className:'toast-stack toast-stack-dialog'});
    await act(async()=>stack.findByType('button').props.onClick());assert.equal(ran,1);
    await act(async()=>toggle(false));
    assert.equal(tree.root.findAllByProps({className:'toast-stack'}).length,1);
    assert.equal(tree.root.findAllByProps({className:'toast-stack toast-stack-dialog'}).length,0);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Une actualisation volontaire signale son résultat, sans annoncer les chargements automatiques',async()=>{
  let calls=0,tree;
  const onRetry=async()=>++calls===1?{ok:false,message:'Réseau indisponible.'}:{ok:true};
  function Example(){const result=useRetryFeedback(onRetry,'Objectifs actualisés.');return h(React.Fragment,null,
    h(VisibleFeedback,{message:result.feedback?.message,tone:result.feedback?.tone,revision:result.revision,actionLabel:result.feedback?.tone==='error'?'Réessayer':'',onAction:result.retry}),
    h('button',{type:'button',onClick:result.retry},'Actualiser'));
  }
  try {
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,null,h(Example)));});
    assert.equal(tree.root.findAllByType('aside').length,0);assert.equal(calls,0);
    await act(async()=>{await tree.root.findByType('button').props.onClick();});
    assert.match(text(aside(tree)),/Réseau indisponible/);assert.match(aside(tree).props.className,/is-error/);
    await act(async()=>{await aside(tree).findAllByType('button').find(b=>text(b)==='Réessayer').props.onClick();});
    assert.equal(calls,2);assert.match(text(aside(tree)),/Objectifs actualisés/);
  } finally {if(tree)await act(async()=>tree.unmount());}
});


test('Les messages contextuels se ferment automatiquement au bout de cinq secondes',async()=>{
  let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,null,h(VisibleFeedback,{message:'Service enregistré.'})));});
    assert.equal(tree.root.findAllByType('aside').length,1);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5100));});
    assert.equal(tree.root.findAllByType('aside').length,0);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStartupSound,soundEnabled,saveSound,needsStartupTouch,SOUND_KEY,STARTUP_SOUND_KEY} from '../src/startup-sound.js';

function environment({blocked=false}={}) {
  const values=new Map(),instances=[],played=[],loaded=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let reject=blocked,inGesture=false;
  class AudioMock {
    constructor(src){this.src=src;this.paused=true;this.ended=false;this.currentTime=0;this.listeners=new Map();instances.push(this);}
    play(){played.push({src:this.src,inGesture});if(reject){this.paused=true;return Promise.reject(Object.assign(new Error('lecture bloquée'),{name:'NotAllowedError'}));}this.paused=false;this.ended=false;return Promise.resolve();}
    pause(){this.paused=true;this.emit('pause');}
    load(){loaded.push({src:this.src,inGesture});}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    emit(type){if(type==='ended'){this.paused=true;this.ended=true;}for(const fn of [...(this.listeners.get(type)||[])])fn();}
  }
  const press=fn=>{inGesture=true;try{return fn();}finally{inGesture=false;}};
  return {storage,AudioMock,instances,played,loaded,press,allow:()=>{reject=false;}};
}
const player=e=>createStartupSound({base:'./',AudioClass:e.AudioMock,storage:e.storage});
const options={standalone:true,visible:true};

test('Premier lancement : écran requis en PWA, jamais dans un onglet, aucun autoplay',async()=>{
  const e=environment(),p=player(e);
  assert.equal(soundEnabled(e.storage),true);
  assert.equal(needsStartupTouch({standalone:false,storage:e.storage}),false);
  assert.equal(needsStartupTouch({standalone:true,storage:e.storage}),true);
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),null);assert.equal(e.instances.length,0);assert.deepEqual(e.played,[]);
  assert.equal(await p.playFromGesture({standalone:false}),'ignored');
  assert.equal(await p.playFromGesture({standalone:true,visible:false}),'ignored');
  assert.equal(e.instances.length,0);p.dispose();
});

test('L’appui lance audio.play synchroniquement, une seule fois, puis ouvre la PWA',async()=>{
  const e=environment(),p=player(e);
  const result=e.press(()=>p.playFromGesture(options));
  // La lecture a déjà été appelée, avant même l'attente de la promesse.
  assert.deepEqual(e.played,[{src:'./FNAC%20-%20SIGNATURE.mp3',inGesture:true}]);
  assert.equal(await result,'played');assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');
  assert.equal(needsStartupTouch({standalone:true,storage:e.storage}),false);
  assert.equal(await e.press(()=>p.playFromGesture(options)),'done');p.dispose();
  const reopened=player(e);assert.equal(await e.press(()=>reopened.playFromGesture(options)),'done');
  assert.equal(e.played.length,1);reopened.dispose();
});

test('Une installation déjà à jour voit une fois le nouveau parcours tactile sans effacer l’ancien état',async()=>{
  const e=environment();e.storage.setItem('fnac-pulse-first-startup-sound-v1','done');
  assert.equal(needsStartupTouch({standalone:true,storage:e.storage}),true);
  const p=player(e);assert.equal(await e.press(()=>p.playFromGesture(options)),'played');
  assert.equal(e.storage.getItem('fnac-pulse-first-startup-sound-v1'),'done');
  assert.equal(needsStartupTouch({standalone:true,storage:e.storage}),false);p.dispose();
});

test('Échec audio : réessai par un nouveau geste ou accès sans son après le premier appui',async()=>{
  const e=environment({blocked:true}),p=player(e);
  assert.equal(await e.press(()=>p.playFromGesture(options)),'unavailable');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'pending');assert.equal(e.played.length,1);
  e.allow();assert.equal(await e.press(()=>p.playFromGesture(options)),'played');
  assert(e.played.every(x=>x.inGesture));assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');p.dispose();
  const x=environment({blocked:true}),q=player(x);
  assert.equal(await x.press(()=>q.playFromGesture(options)),'unavailable');q.dismiss();
  assert.equal(x.storage.getItem(STARTUP_SOUND_KEY),'done');assert.equal(await x.press(()=>q.playFromGesture(options)),'done');q.dispose();
});

test('Préférence déjà coupée conservée ; le geste ouvre sans jouer ni charger le MP3',async()=>{
  const e=environment();saveSound(false,e.storage);assert.equal(e.storage.getItem(SOUND_KEY),'off');
  const p=player(e);assert.equal(needsStartupTouch({standalone:true,storage:e.storage}),true);
  assert.equal(e.instances.length,0);assert.equal(await e.press(()=>p.playFromGesture(options)),'muted');
  assert.equal(e.instances.length,0);assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');p.dispose();
  const x=environment();saveSound(false,x.storage);const q=player(x);
  saveSound(true,x.storage);q.setEnabled(true);
  assert.equal(await x.press(()=>q.playFromGesture(options)),'played');assert.equal(x.played[0].inGesture,true);q.dispose();
});

test('Lecture en attente annulée : pas de confirmation tardive ni de verrouillage',async()=>{
  const e=environment();let resolve;
  e.AudioMock.prototype.play=function(){return new Promise(r=>{resolve=r;});};
  const p=player(e),pending=e.press(()=>p.playFromGesture(options));assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'pending');
  p.stop();resolve();assert.equal(await pending,'ignored');assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'pending');
  p.dismiss();assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');p.dispose();
});

test('Stockage et lecteur indisponibles : aucun crash, accès possible après le geste',async()=>{
  const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(needsStartupTouch({standalone:true,storage}),true);
  const p=createStartupSound({AudioClass:null,storage});
  assert.equal(await p.playFromGesture(options),'unavailable');p.dismiss();
  assert.equal(await p.playFromGesture(options),'done');p.dispose();
});

test('Alertes au premier plan : le même MP3, préparé depuis un geste et rejoué pour chaque vente',async()=>{
  const e=environment(),p=player(e);
  assert.equal(e.press(()=>p.prepareFromGesture()),true);assert.equal(e.press(()=>p.prepareFromGesture()),false);
  assert.equal(e.instances.length,1);assert.deepEqual(e.loaded,[{src:'./FNAC%20-%20SIGNATURE.mp3',inGesture:true}]);assert.equal(e.played.length,0);
  assert.equal(await p.playNotification({visible:false,notificationsEnabled:true}),'ignored');
  assert.equal(await p.playNotification({visible:true,notificationsEnabled:false}),'ignored');
  assert.equal(await p.playNotification({visible:true,notificationsEnabled:true,stillAllowed:()=>false}),'ignored');
  assert.equal(e.played.length,0);
  e.instances[0].currentTime=1.5;
  assert.equal(await p.playNotification({visible:true,notificationsEnabled:true}),'played');assert.equal(e.instances[0].currentTime,0);
  const second=p.playNotification({visible:true,notificationsEnabled:true});assert.equal(e.played.length,1);
  e.instances[0].emit('ended');assert.equal(await second,'played');
  assert.equal(e.instances.length,1);assert.equal(e.played.length,2);assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),null);
  p.dispose();assert.equal(await p.playNotification({visible:true,notificationsEnabled:true}),'ignored');
});

test('Alertes : préférence muette, refus de lecture et lecteur indisponible ne font pas échouer l’interface',async()=>{
  const e=environment();saveSound(false,e.storage);const p=player(e);
  assert.equal(e.press(()=>p.prepareFromGesture()),false);assert.equal(await p.playNotification({visible:true,notificationsEnabled:true}),'ignored');assert.equal(e.instances.length,0);
  p.setEnabled(true);assert.equal(e.press(()=>p.prepareFromGesture()),true);
  assert.equal(await p.playNotification({visible:true,notificationsEnabled:true}),'played');p.setEnabled(false);
  assert.equal(await p.playNotification({visible:true,notificationsEnabled:true}),'ignored');assert.equal(e.played.length,1);p.dispose();
  const blocked=environment({blocked:true}),q=player(blocked);
  assert.equal(await q.playNotification({visible:true,notificationsEnabled:true}),'unavailable');assert.equal(blocked.storage.getItem(STARTUP_SOUND_KEY),null);q.dispose();
  const unavailable=createStartupSound({AudioClass:null,storage:blocked.storage});
  assert.equal(await unavailable.playNotification({visible:true,notificationsEnabled:true}),'unavailable');unavailable.dispose();
});

test('Une vente pendant la bienvenue attend la fin sans couper le son ; annulation si les conditions changent',async()=>{
  const e=environment(),p=player(e);
  assert.equal(await e.press(()=>p.playFromGesture(options)),'played');assert.equal(e.instances.length,1);
  let allowed=true;const pending=p.playNotification({visible:true,notificationsEnabled:true,stillAllowed:()=>allowed});
  assert.equal(e.played.length,1);e.instances[0].emit('ended');
  assert.equal(await pending,'played');assert.equal(e.played.length,2);assert.equal(e.instances.length,1);p.dispose();

  const hidden=environment(),q=player(hidden);await hidden.press(()=>q.playFromGesture(options));
  const delayed=q.playNotification({visible:true,notificationsEnabled:true,stillAllowed:()=>allowed});
  allowed=false;hidden.instances[0].emit('ended');assert.equal(await delayed,'ignored');assert.equal(hidden.played.length,1);q.dispose();

  const muted=environment(),r=player(muted);await muted.press(()=>r.playFromGesture(options));
  const canceled=r.playNotification({visible:true,notificationsEnabled:true});r.setEnabled(false);
  assert.equal(await canceled,'ignored');muted.instances[0].emit('ended');assert.equal(muted.played.length,1);r.dispose();
});

test('Plusieurs ventes rapprochées : une lecture par alerte, sans couper la précédente',async()=>{
  const e=environment(),p=player(e),opts={visible:true,notificationsEnabled:true};
  assert.equal(await p.playNotification(opts),'played');
  const second=p.playNotification(opts),third=p.playNotification(opts);
  assert.equal(e.played.length,1);
  e.instances[0].emit('ended');assert.equal(await second,'played');assert.equal(e.played.length,2);
  e.instances[0].emit('ended');assert.equal(await third,'played');assert.equal(e.played.length,3);assert.equal(e.instances.length,1);p.dispose();
});

test('Alertes en attente : vérification de la visibilité et de l’abonnement avant la lecture',async()=>{
  const e=environment(),p=player(e),opts={visible:true,notificationsEnabled:true};let allowed=true;
  assert.equal(await p.playNotification(opts),'played');
  const pending=p.playNotification({...opts,stillAllowed:()=>allowed});allowed=false;
  e.instances[0].emit('ended');assert.equal(await pending,'ignored');assert.equal(e.played.length,1);p.dispose();
});

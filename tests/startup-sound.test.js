import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStartupSound,soundEnabled,saveSound,needsStartupTouch,SOUND_KEY,STARTUP_SOUND_KEY} from '../src/startup-sound.js';

function environment({blocked=false}={}) {
  const values=new Map(),instances=[],played=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let reject=blocked,inGesture=false;
  class AudioMock {
    constructor(src){this.src=src;this.paused=0;this.currentTime=0;instances.push(this);}
    play(){played.push({src:this.src,inGesture});return reject?Promise.reject(Object.assign(new Error('lecture bloquée'),{name:'NotAllowedError'})):Promise.resolve();}
    pause(){this.paused++;}
  }
  const press=fn=>{inGesture=true;try{return fn();}finally{inGesture=false;}};
  return {storage,AudioMock,instances,played,press,allow:()=>{reject=false;}};
}
const player=e=>createStartupSound({base:'/FNAC-Pulse/',AudioClass:e.AudioMock,storage:e.storage});
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
  assert.deepEqual(e.played,[{src:'/FNAC-Pulse/FNAC%20-%20SIGNATURE.mp3',inGesture:true}]);
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

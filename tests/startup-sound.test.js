import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStartupSound,soundEnabled,saveSound,SOUND_KEY,STARTUP_SOUND_KEY} from '../src/startup-sound.js';

function environment({blocked=false}={}) {
  const values=new Map(),instances=[],played=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let rejectAutoplay=blocked;
  class AudioMock {
    constructor(src){this.src=src;this.paused=0;this.currentTime=0;instances.push(this);}
    play(){played.push(this.src);return rejectAutoplay?Promise.reject(Object.assign(new Error('autoplay bloqué'),{name:'NotAllowedError'})):Promise.resolve();}
    pause(){this.paused++;}
  }
  return {storage,AudioMock,instances,played,allow:()=>{rejectAutoplay=false;}};
}
const player=e=>createStartupSound({base:'/FNAC-Pulse/',AudioClass:e.AudioMock,storage:e.storage});

test('Signature : uniquement à la première ouverture autonome, jamais dans un onglet',async()=>{
  const e=environment(),p=player(e);
  assert.equal(soundEnabled(e.storage),true);
  assert.equal(await p.start({standalone:false}), 'ignored');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),null);assert.deepEqual(e.played,[]);
  assert.equal(await p.start({standalone:true,visible:false}), 'ignored');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),null);
  assert.equal(await p.start({standalone:true}), 'played');
  assert.deepEqual(e.played,['/FNAC-Pulse/FNAC%20-%20SIGNATURE.mp3']);
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');
  assert.equal(await p.start({standalone:true}),'ignored');
  p.dispose();
  const reopened=player(e);assert.equal(await reopened.start({standalone:true}),'ignored');
  assert.equal(e.played.length,1);reopened.dispose();
});

test('Autoplay bloqué : un seul appui explicite permet le son, sans rejeu',async()=>{
  const e=environment({blocked:true}),p=player(e);
  assert.equal(await p.start({standalone:true}),'gesture');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'pending');assert.equal(e.played.length,1);
  assert.equal(await p.start({standalone:true}),'ignored');assert.equal(e.played.length,1);
  e.allow();assert.equal(await p.playFromGesture(),'played');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');assert.equal(e.played.length,2);
  assert.equal(await p.playFromGesture(),'ignored');p.dispose();
  const again=player(e);assert.equal(await again.start({standalone:true}),'ignored');assert.equal(e.played.length,2);again.dispose();
});

test('Une signature bloquée attend un choix explicite à la réouverture, sans nouvelle lecture automatique',async()=>{
  const e=environment({blocked:true}),first=player(e);
  assert.equal(await first.start({standalone:true}),'gesture');first.dispose();
  const second=player(e);assert.equal(await second.start({standalone:true}),'gesture');assert.equal(e.played.length,1);
  second.dismiss();assert.equal(await second.playFromGesture(),'ignored');second.dispose();
  const third=player(e);assert.equal(await third.start({standalone:true}),'ignored');assert.equal(e.played.length,1);third.dispose();
});

test('Préférence déjà coupée conservée : aucun chargement ni son, même après réactivation',async()=>{
  const e=environment();saveSound(false,e.storage);assert.equal(e.storage.getItem(SOUND_KEY),'off');
  const p=player(e);assert.equal(await p.start({standalone:true}),'muted');assert.equal(e.instances.length,0);
  saveSound(true,e.storage);p.setEnabled(true);assert.equal(await p.start({standalone:true}),'ignored');p.dispose();
  const reopened=player(e);assert.equal(await reopened.start({standalone:true}),'ignored');assert.equal(e.instances.length,0);reopened.dispose();
});

test('Le bouton coupe une invitation en attente et le stockage bloqué ne fait pas échouer l’application',async()=>{
  const e=environment({blocked:true}),p=player(e);
  assert.equal(await p.start({standalone:true}),'gesture');p.setEnabled(false);p.stop();
  assert.equal(await p.playFromGesture(),'ignored');assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');p.dispose();
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  const q=createStartupSound({AudioClass:e.AudioMock,storage:blocked});q.setEnabled(false);
  assert.equal(await q.start({standalone:true}),'muted');assert.equal(await q.start({standalone:true}),'ignored');q.dispose();
});

test('Une erreur de décodage ne propose pas un geste trompeur',async()=>{
  const e=environment();e.AudioMock.prototype.play=function(){return Promise.reject(Object.assign(new Error('format'),{name:'NotSupportedError'}));};
  const p=player(e);assert.equal(await p.start({standalone:true}),'unavailable');
  assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'done');assert.equal(await p.playFromGesture(),'ignored');p.dispose();
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSaleSound,saleSoundEnabled,saveSaleSound,SALE_SOUND_KEY} from '../src/sale-sound.js';

function environment({blocked=false}={}) {
  const listeners=new Map(),values=new Map(),instances=[],played=[];
  const target={visibilityState:'visible',addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},dispatch(name){listeners.get(name)?.();}};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  class AudioMock {
    constructor(src){this.src=src;this.muted=false;this.paused=0;this.currentTime=0;instances.push(this);}
    play(){played.push({muted:this.muted,src:this.src});return blocked?Promise.reject(new Error('autoplay bloqué')):Promise.resolve();}
    pause(){this.paused++;}
  }
  return {target,storage,AudioMock,instances,listeners,played};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Signature des ventes : aucun son au lancement ou au premier geste',async()=>{
  const e=environment(),player=createSaleSound({base:'/FNAC-Pulse/',target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  assert.equal(saleSoundEnabled(e.storage),true);assert.equal(e.instances.length,0);assert.equal(e.played.length,0);
  e.target.dispatch('pointerdown');await settle();
  assert.deepEqual(e.played,[{muted:true,src:'/FNAC-Pulse/FNAC%20-%20SIGNATURE.mp3'}]);
  assert.equal(e.instances[0].paused,1);assert.equal(e.listeners.size,0);
  e.target.dispatch('keydown');assert.equal(e.played.length,1);
  player.dispose();
});

test('Signature : une vente audible, préférence locale et application visible seulement',async()=>{
  const e=environment(),player=createSaleSound({target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  e.target.dispatch('pointerdown');await settle();
  assert.equal(player.play(),true);await settle();assert.equal(e.played.filter(x=>!x.muted).length,1);
  saveSaleSound(false,e.storage);assert.equal(e.storage.getItem(SALE_SOUND_KEY),'off');
  player.setEnabled(false);player.stop();assert.equal(player.play(),false);assert.equal(e.played.filter(x=>!x.muted).length,1);
  saveSaleSound(true,e.storage);player.setEnabled(true);e.target.visibilityState='hidden';assert.equal(player.play(),false);
  e.target.visibilityState='visible';assert.equal(player.play(),true);assert.equal(e.played.filter(x=>!x.muted).length,2);
  player.dispose();assert.equal(player.play(),false);
});

test('Lecture bloquée : aucune vente en attente ne rejoue au prochain geste',async()=>{
  const e=environment({blocked:true}),player=createSaleSound({target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  player.play();await settle();assert.equal(e.played.filter(x=>!x.muted).length,1);
  e.target.dispatch('pointerdown');await settle();
  assert.equal(e.played.filter(x=>!x.muted).length,1);assert.equal(e.played.at(-1).muted,true);
  player.dispose();assert.equal(e.listeners.size,0);
});

test('Le bouton coupe le son même si le stockage local est indisponible',()=>{
  const e=environment(),storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  const player=createSaleSound({target:e.target,AudioClass:e.AudioMock,storage});
  saveSaleSound(false,storage);player.setEnabled(false);
  e.target.dispatch('pointerdown');assert.equal(player.play(),false);assert.equal(e.instances.length,0);
  player.setEnabled(true);assert.equal(player.play(),true);player.dispose();
});

test('Préférence désactivée : le premier geste ne charge même pas le MP3',()=>{
  const e=environment();saveSaleSound(false,e.storage);
  const player=createSaleSound({target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  e.target.dispatch('pointerdown');assert.equal(e.instances.length,0);assert.equal(player.play(),false);player.dispose();
});

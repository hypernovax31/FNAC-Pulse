import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playStartupSignature,startupSoundEnabled,saveStartupSound,STARTUP_SOUND_KEY} from '../src/startup-sound.js';

function environment(autoplayBlocked=false) {
  const listeners=new Map(), values=new Map(), instances=[];
  const target={
    addEventListener(name,fn){listeners.set(name,fn);},
    removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
    dispatch(name){listeners.get(name)?.();},
  };
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  class AudioMock {
    constructor(src){this.src=src;this.calls=0;instances.push(this);}
    play(){this.calls++;return autoplayBlocked&&this.calls===1?Promise.reject(new Error('autoplay blocked')):Promise.resolve();}
  }
  return {target,storage,AudioMock,instances,listeners};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Signature : une lecture au démarrage et chemin GitHub Pages',async()=>{
  const e=environment();
  playStartupSignature({base:'/FNAC-Pulse/',target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  await settle();
  assert.equal(e.instances[0].src,'/FNAC-Pulse/FNAC%20-%20SIGNATURE.mp3');
  assert.equal(e.instances[0].calls,1);assert.equal(e.listeners.size,0);
  e.target.dispatch('pointerdown');assert.equal(e.instances[0].calls,1);
});

test('Signature : premier geste si la lecture automatique est bloquée',async()=>{
  const e=environment(true);
  playStartupSignature({target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  await settle();assert.equal(e.instances[0].calls,1);assert.equal(e.listeners.size,2);
  e.target.dispatch('pointerdown');await settle();
  assert.equal(e.instances[0].calls,2);assert.equal(e.listeners.size,0);
  e.target.dispatch('keydown');assert.equal(e.instances[0].calls,2);
});

test('Signature : réglage local et absence de lecture quand désactivée',async()=>{
  const e=environment();assert.equal(startupSoundEnabled(e.storage),true);
  saveStartupSound(false,e.storage);assert.equal(e.storage.getItem(STARTUP_SOUND_KEY),'off');
  playStartupSignature({target:e.target,AudioClass:e.AudioMock,storage:e.storage});
  assert.equal(e.instances.length,0);assert.equal(e.listeners.size,0);
  saveStartupSound(true,e.storage);assert.equal(startupSoundEnabled(e.storage),true);
});

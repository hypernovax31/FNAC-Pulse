// Conserver la préférence historique : une personne qui avait coupé le son ne
// doit pas le réentendre sans l'avoir réactivé elle-même.
export const SOUND_KEY='fnac-pulse-sale-sound-v1';
// Mémorise le parcours tactile déjà terminé ; ne pas le réinitialiser lors
// d'une mise à jour de l'interface.
export const STARTUP_SOUND_KEY='fnac-pulse-touch-welcome-v1';
export function soundEnabled(storage) {
  try {return (storage??globalThis.localStorage)?.getItem(SOUND_KEY)!=='off';} catch {return true;}
}
export function saveSound(enabled,storage) {
  try {(storage??globalThis.localStorage)?.setItem(SOUND_KEY,enabled?'on':'off');} catch {}
}
export function needsStartupTouch({standalone=false,storage}={}) {
  if(!standalone)return false;
  try {return (storage??globalThis.localStorage)?.getItem(STARTUP_SOUND_KEY)!=='done';} catch {return true;}
}

export function createStartupSound({base='/',AudioClass=globalThis.Audio,storage}={}) {
  let audio=null,disposed=false,waiting=false,finished=false,prepared=false,version=0,enabled=soundEnabled(storage),active=null;
  const queue=[];
  function writeState(value) {try{(storage??globalThis.localStorage)?.setItem(STARTUP_SOUND_KEY,value);}catch{}}
  function finish() {finished=true;writeState('done');}
  function getAudio() {
    if(audio||!AudioClass)return audio;
    try {audio=new AudioClass(`${base}FNAC%20-%20SIGNATURE.mp3`);audio.preload='auto';} catch {audio=null;}
    return audio;
  }
  function settle(item,result) {if(item&&!item.settled){item.settled=true;item.resolve(result);}}
  function unhold(block) {
    clearTimeout(block.timer);
    if(block.trackable){block.player.removeEventListener('ended',block.done);block.player.removeEventListener('pause',block.done);block.player.removeEventListener('error',block.failed);}
  }
  function release(block,result) {
    if(active!==block)return;
    active=null;unhold(block);if(result)settle(block.item,result);drain();
  }
  function hold(player,item=null) {
    const trackable=typeof player.addEventListener==='function'&&typeof player.removeEventListener==='function';
    const block={player,item,trackable,timer:null,done:null,failed:null};
    block.done=event=>{if(event?.type==='pause'&&player.paused===false)return;release(block,'unavailable');};block.failed=()=>release(block,'unavailable');active=block;
    if(trackable){player.addEventListener('ended',block.done);player.addEventListener('pause',block.done);player.addEventListener('error',block.failed);}
    // Un lecteur bloqué ou interrompu ne doit pas retenir les alertes suivantes.
    block.timer=setTimeout(()=>{if(active===block){active=null;unhold(block);settle(block.item,'unavailable');try{player.pause();}catch{}drain();}},30000);
    return block;
  }
  function stop() {
    version++;waiting=false;
    if(active){const block=active;active=null;unhold(block);settle(block.item,'ignored');}
    while(queue.length)settle(queue.shift(),'ignored');
    if(audio){try{audio.pause();audio.currentTime=0;}catch{}}
  }
  function drain() {
    if(disposed||!enabled||waiting||active||!queue.length)return;
    const item=queue.shift();
    if(!item.allowed()){settle(item,'ignored');drain();return;}
    const player=getAudio();if(!player){settle(item,'unavailable');drain();return;}
    const current=++version,block=hold(player,item);
    try {
      try {player.currentTime=0;} catch {}
      Promise.resolve(player.play()).then(()=>{
        if(disposed||current!==version){settle(item,'ignored');return;}
        prepared=true;settle(item,'played');
        if(player.paused===true||player.ended===true||!block.trackable)release(block);
      },()=>{if(current!==version)settle(item,'ignored');else {settle(item,'unavailable');release(block);}});
    } catch {settle(item,'unavailable');release(block);}
  }
  function playNotification({visible=false,notificationsEnabled=false,stillAllowed}={}) {
    const allowed=()=>{
      if(disposed||!enabled||!visible||!notificationsEnabled)return false;
      try{return typeof stillAllowed!=='function'||!!stillAllowed();}catch{return false;}
    };
    if(!allowed())return Promise.resolve('ignored');
    // Le même élément est réutilisé pour les alertes successives. Une vente
    // arrivant pendant la bienvenue ou une autre alerte attend la fin du MP3.
    // Les conditions sont revérifiées avant chaque lecture différée.
    return new Promise(resolve=>{queue.push({resolve,allowed,settled:false});drain();});
  }
  return {
    // Cette méthode doit être appelée directement par le gestionnaire du bouton,
    // sans await ni temporisation avant play(), pour respecter le geste iOS.
    playFromGesture({standalone=false,visible=true}={}) {
      if(disposed||!standalone||!visible)return Promise.resolve('ignored');
      if(finished||!needsStartupTouch({standalone:true,storage}))return Promise.resolve('done');
      if(!enabled){finish();return Promise.resolve('muted');}
      if(waiting)return Promise.resolve('busy');
      writeState('pending');
      const player=getAudio();if(!player)return Promise.resolve('unavailable');
      const current=++version;waiting=true;const block=hold(player);
      try {
        return Promise.resolve(player.play()).then(()=>{
          if(disposed||current!==version)return 'ignored';
          waiting=false;prepared=true;finish();
          if(player.paused===true||player.ended===true||!block.trackable)release(block);else drain();
          return 'played';
        },()=>{
          if(disposed||current!==version)return 'ignored';
          waiting=false;release(block);return 'unavailable';
        });
      } catch {
        if(current===version){waiting=false;release(block);}
        return Promise.resolve('unavailable');
      }
    },
    // Charger le même lecteur depuis un geste, sans jouer le son. Sur iOS,
    // réutiliser cet élément peut permettre les alertes ultérieures en premier
    // plan ; le navigateur et le mode silencieux restent décisionnaires.
    prepareFromGesture() {
      if(disposed||!enabled||prepared||waiting||active)return false;
      const player=getAudio();if(!player||typeof player.load!=='function')return false;
      try {player.load();prepared=true;return true;} catch {return false;}
    },
    // Une alerte d'équipe ne change jamais l'état du premier lancement.
    // L'appelant vérifie l'abonnement et la visibilité de l'application.
    playNotification,
    // Utilisable seulement après un échec : l'accès à la PWA ne doit pas rester
    // bloqué si le navigateur, le réseau ou le lecteur audio sont indisponibles.
    dismiss() {stop();finish();},
    setEnabled(value) {enabled=!!value;if(!enabled)stop();},
    stop,
    dispose() {disposed=true;stop();},
  };
}

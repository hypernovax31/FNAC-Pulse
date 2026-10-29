// Signature des ventes : le réglage reste propre à cet appareil. Le silence au
// démarrage est volontaire ; aucun événement ancien n'est mis en attente.
export const SALE_SOUND_KEY='fnac-pulse-sale-sound-v1';
export function saleSoundEnabled(storage) {
  try {return (storage??globalThis.localStorage)?.getItem(SALE_SOUND_KEY)!=='off';} catch {return true;}
}
export function saveSaleSound(enabled,storage) {
  try {(storage??globalThis.localStorage)?.setItem(SALE_SOUND_KEY,enabled?'on':'off');} catch {}
}

export function createSaleSound({base='/',target=globalThis.document,AudioClass=globalThis.Audio,storage}={}) {
  let audio=null,disposed=false,primed=false,priming=false,version=0,enabled=saleSoundEnabled(storage);
  function clearListeners() {
    target?.removeEventListener('pointerdown',unlock,true);
    target?.removeEventListener('keydown',unlock,true);
  }
  function getAudio() {
    if(audio||!AudioClass)return audio;
    try {audio=new AudioClass(`${base}FNAC%20-%20SIGNATURE.mp3`);audio.preload='auto';} catch {audio=null;}
    return audio;
  }
  // Une lecture muette, uniquement sur geste, autorise si possible les ventes
  // ultérieures sur iOS. Elle ne rejoue pas une vente passée ou bloquée.
  function unlock() {
    if(disposed||primed||priming||!enabled)return;
    const player=getAudio();if(!player)return;
    const startedAt=version;priming=true;player.muted=true;
    try {
      Promise.resolve(player.play()).then(()=>{
        priming=false;if(disposed)return;
        primed=true;clearListeners();
        if(version===startedAt){player.pause();try{player.currentTime=0;}catch{}}
        player.muted=false;
      }).catch(()=>{priming=false;if(!disposed)player.muted=false;});
    } catch {priming=false;player.muted=false;}
  }
  target?.addEventListener('pointerdown',unlock,true);
  target?.addEventListener('keydown',unlock,true);
  return {
    unlock,
    setEnabled(value) {enabled=!!value;},
    play() {
      if(disposed||!enabled||(target?.visibilityState&&target.visibilityState!=='visible'))return false;
      const player=getAudio();if(!player)return false;
      version++;player.muted=false;
      try {player.currentTime=0;}catch{}
      try {Promise.resolve(player.play()).catch(()=>{});}catch{}
      return true;
    },
    stop() {version++;if(audio){audio.pause();try{audio.currentTime=0;}catch{}audio.muted=false;}},
    dispose() {disposed=true;clearListeners();if(audio)audio.pause();},
  };
}

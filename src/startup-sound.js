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
  let audio=null,disposed=false,waiting=false,finished=false,version=0,enabled=soundEnabled(storage);
  function writeState(value) {try{(storage??globalThis.localStorage)?.setItem(STARTUP_SOUND_KEY,value);}catch{}}
  function finish() {finished=true;writeState('done');}
  function getAudio() {
    if(audio||!AudioClass)return audio;
    try {audio=new AudioClass(`${base}FNAC%20-%20SIGNATURE.mp3`);audio.preload='auto';} catch {audio=null;}
    return audio;
  }
  function stop() {
    version++;waiting=false;
    if(audio){try{audio.pause();audio.currentTime=0;}catch{}}
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
      const current=++version;waiting=true;
      try {
        return Promise.resolve(player.play()).then(()=>{
          if(disposed||current!==version)return 'ignored';
          waiting=false;finish();return 'played';
        },()=>{
          if(disposed||current!==version)return 'ignored';
          waiting=false;return 'unavailable';
        });
      } catch {
        if(current===version)waiting=false;
        return Promise.resolve('unavailable');
      }
    },
    // Utilisable seulement après un échec : l'accès à la PWA ne doit pas rester
    // bloqué si le navigateur, le réseau ou le lecteur audio sont indisponibles.
    dismiss() {stop();finish();},
    setEnabled(value) {enabled=!!value;if(!enabled)stop();},
    stop,
    dispose() {disposed=true;stop();},
  };
}

// Garder la clé historique : une personne qui avait coupé le son ne doit pas
// le réentendre après la mise à jour.
export const SOUND_KEY='fnac-pulse-sale-sound-v1';
export const STARTUP_SOUND_KEY='fnac-pulse-first-startup-sound-v1';
export function soundEnabled(storage) {
  try {return (storage??globalThis.localStorage)?.getItem(SOUND_KEY)!=='off';} catch {return true;}
}
export function saveSound(enabled,storage) {
  try {(storage??globalThis.localStorage)?.setItem(SOUND_KEY,enabled?'on':'off');} catch {}
}

export function createStartupSound({base='/',AudioClass=globalThis.Audio,storage}={}) {
  let audio=null,disposed=false,started=false,awaitingGesture=false,enabled=soundEnabled(storage);
  function readState() {try{return (storage??globalThis.localStorage)?.getItem(STARTUP_SOUND_KEY)||'';}catch{return '';}}
  function writeState(value) {try{(storage??globalThis.localStorage)?.setItem(STARTUP_SOUND_KEY,value);}catch{}}
  function getAudio() {
    if(audio||!AudioClass)return audio;
    try {audio=new AudioClass(`${base}FNAC%20-%20SIGNATURE.mp3`);audio.preload='auto';} catch {audio=null;}
    return audio;
  }
  function tryPlay() {
    const player=getAudio();
    if(!player){writeState('done');return Promise.resolve('unavailable');}
    try {
      // L'appel reste synchrone lorsqu'il provient du bouton : c'est nécessaire
      // pour les navigateurs qui exigent un véritable geste de l'utilisateur.
      return Promise.resolve(player.play()).then(()=>{
        if(!disposed&&enabled){awaitingGesture=false;writeState('done');return 'played';}
        return 'ignored';
      },error=>{
        if(!disposed&&enabled&&error?.name==='NotAllowedError'){awaitingGesture=true;return 'gesture';}
        if(!disposed&&enabled)writeState('done');
        return 'unavailable';
      });
    } catch(error) {
      if(!disposed&&enabled&&error?.name==='NotAllowedError'){awaitingGesture=true;return Promise.resolve('gesture');}
      if(!disposed&&enabled)writeState('done');
      return Promise.resolve('unavailable');
    }
  }
  return {
    // Ne rien marquer ni lire dans un onglet ou lorsque l'application est cachée.
    start({standalone=false,visible=true}={}) {
      if(disposed||started||!standalone||!visible)return Promise.resolve('ignored');
      started=true;
      const state=readState();
      if(state==='done')return Promise.resolve('ignored');
      if(!enabled){writeState('done');return Promise.resolve('muted');}
      // Une lecture refusée précédemment ne reprend jamais toute seule : seul un
      // appui explicite peut alors déclencher la signature, une fois.
      if(state==='pending'){awaitingGesture=true;return Promise.resolve('gesture');}
      writeState('pending');
      return tryPlay();
    },
    playFromGesture() {
      if(disposed||!enabled||!awaitingGesture)return Promise.resolve('ignored');
      awaitingGesture=false;
      return tryPlay();
    },
    dismiss() {awaitingGesture=false;writeState('done');},
    setEnabled(value) {
      enabled=!!value;
      if(!enabled&&started){awaitingGesture=false;writeState('done');}
    },
    stop() {if(audio){audio.pause();try{audio.currentTime=0;}catch{}}},
    dispose() {disposed=true;awaitingGesture=false;if(audio)audio.pause();},
  };
}

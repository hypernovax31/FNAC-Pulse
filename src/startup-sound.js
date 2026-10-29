// Signature locale : une seule lecture au chargement, jamais pour les ventes.
// Si l'autoplay est bloqué, une interaction humaine peut débloquer le même son.
export const STARTUP_SOUND_KEY='fnac-pulse-startup-sound-v1';
export function startupSoundEnabled(storage) {
  try {return (storage??globalThis.localStorage)?.getItem(STARTUP_SOUND_KEY)!=='off';} catch {return true;}
}
export function saveStartupSound(enabled,storage) {
  try {(storage??globalThis.localStorage)?.setItem(STARTUP_SOUND_KEY,enabled?'on':'off');} catch {}
}
export function playStartupSignature({base='/',target=globalThis.document,AudioClass=globalThis.Audio,storage}={}) {
  if(!target||!AudioClass||!startupSoundEnabled(storage))return ()=>{};
  let audio;try {audio=new AudioClass(`${base}FNAC%20-%20SIGNATURE.mp3`);} catch {return ()=>{};}
  audio.preload='auto';
  let played=false,disposed=false;
  function cleanup() {
    target.removeEventListener('pointerdown',attempt,true);
    target.removeEventListener('keydown',attempt,true);
  }
  function attempt() {
    if(disposed||played)return;
    if(!startupSoundEnabled(storage)){cleanup();disposed=true;return;}
    try {
      Promise.resolve(audio.play()).then(()=>{played=true;cleanup();}).catch(()=>{});
    } catch {}
  }
  target.addEventListener('pointerdown',attempt,true);
  target.addEventListener('keydown',attempt,true);
  attempt();
  return ()=>{disposed=true;cleanup();};
}

import React from 'react';
import { ArrowRight, Volume2, VolumeX } from 'lucide-react';

// Cet écran remplace le tableau de bord jusqu'au geste de bienvenue. Le bouton
// est aussi utilisable au clavier et par les technologies d'assistance.
export function StartupGate({base='/',enabled=true,ready=true,status='ready',onStart,onSound,onContinue}) {
  const busy=!ready||status==='starting',failed=status==='unavailable';
  return <main className="startup-screen" aria-labelledby="startup-title">
    <section className="startup-card">
      <img className="startup-logo" src={`${base}icons/icon-192-v3.png`} width="76" height="76" alt=""/>
      <div className="startup-kicker">ESPACE ÉQUIPE</div>
      <h1 id="startup-title">Bienvenue sur<br/><span>Fnac Pulse<span className="startup-dot">.</span></span></h1>
      <p className="startup-description">{enabled?'Touchez pour ouvrir votre espace et lancer la signature Fnac.':'Touchez pour ouvrir votre espace. La signature sonore est désactivée sur cet appareil.'}</p>
      {failed&&<p className="startup-error" role="alert">La signature n’a pas pu être lue. Vérifiez le volume et le mode silencieux, puis réessayez ou continuez sans son.</p>}
      <button type="button" className="startup-start" onClick={onStart} disabled={busy} aria-busy={busy}>
        {!ready?'Préparation…':busy?'Ouverture…':failed?'Réessayer':'Toucher pour commencer'} <ArrowRight size={18}/>
      </button>
      {failed&&<button type="button" className="startup-continue" onClick={onContinue}>Continuer sans son</button>}
      <button type="button" className="startup-sound-toggle" onClick={onSound} disabled={busy} aria-pressed={enabled} aria-label={enabled?'Couper la signature au lancement':'Activer la signature au lancement'}>
        {enabled?<Volume2 size={17}/>:<VolumeX size={17}/>}<span>{enabled?'Signature activée':'Signature désactivée'}</span>
      </button>
    </section>
    <p className="startup-footnote">Chaque service compte.</p>
  </main>;
}

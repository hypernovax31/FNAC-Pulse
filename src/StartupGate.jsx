import React from 'react';
import { ArrowRight, Volume2, VolumeX } from 'lucide-react';

// Cet écran remplace le tableau de bord jusqu'au geste de bienvenue. Le bouton
// est aussi utilisable au clavier et par les technologies d'assistance.
export function StartupGate({base='/',enabled=true,ready=true,status='ready',onStart,onSound,onContinue}) {
  const busy=!ready||status==='starting',failed=status==='unavailable';
  return <main className="startup-screen" aria-labelledby="startup-title">
    <header className="startup-topbar">
      <div className="startup-brand" aria-label="Fnac Pulse"><img src={`${base}fnac.svg`} width="34" height="35" alt=""/><strong>pulse<span>.</span></strong></div>
      <span className="startup-top-context">ESPACE ÉQUIPE</span>
    </header>
    <div className="startup-body">
      <section className="startup-card">
        <img className="startup-logo" src={`${base}icons/icon-192-v3.png`} width="92" height="92" alt=""/>
        <div className="startup-kicker">L’APPLICATION DES SERVICES</div>
        <h1 id="startup-title">Bienvenue sur<br/><span>Fnac Pulse<span className="startup-dot">.</span></span></h1>
        <p className="startup-description">Appuyez sur le bouton pour accéder à l’application des services.</p>
        {failed&&<p className="startup-error" role="alert">Le son n’a pas pu être lu. Vérifiez le volume et le mode silencieux, puis réessayez ou continuez sans son.</p>}
        <button type="button" className="startup-start" onClick={onStart} disabled={busy} aria-busy={busy}>
          {!ready?'Préparation…':busy?'Ouverture…':failed?'Réessayer':'Accéder aux services'} <ArrowRight size={18} aria-hidden="true"/>
        </button>
        {failed&&<button type="button" className="startup-continue" onClick={onContinue}>Continuer sans son</button>}
        <button type="button" className="startup-sound-toggle" onClick={onSound} disabled={busy} aria-pressed={enabled} aria-label={enabled?'Désactiver le son Fnac':'Activer le son Fnac'}>
          {enabled?<Volume2 size={17} aria-hidden="true"/>:<VolumeX size={17} aria-hidden="true"/>}<span>{enabled?'SON activée':'SON désactivé'}</span>
        </button>
      </section>
    </div>
    <footer className="startup-footnote">Chaque service compte.</footer>
  </main>;
}

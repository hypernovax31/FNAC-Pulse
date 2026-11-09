import React from 'react';
import { ArrowRight, Check, Settings2, UserRound } from 'lucide-react';

// Le profil et l'administration restent accessibles avant l'accueil. Le geste
// d'accès reste distinct pour permettre la lecture sonore sur la PWA installée.
export function StartupGate({base='/',ready=true,status='ready',authReady=false,hasSession=false,profileName='',profileContext='',profileContent,onChangeProfile,onAdmin,adminAvailable=false,adminPending=false,adminError=false,onRetry,onStart,onContinue}) {
  const busy=!ready||status==='starting',failed=status==='unavailable';
  return <main className="startup-screen" aria-labelledby="startup-title">
    <header className="startup-topbar">
      <div className="startup-brand" aria-label="Fnac Pulse"><img src={`${base}fnac.svg`} width="34" height="35" alt=""/><strong>pulse<span>.</span></strong></div>
      <div className="startup-top-actions">
        <button type="button" className="startup-admin" onClick={onAdmin} disabled={busy||!adminAvailable} aria-label="Ouvrir l’administration" title={adminAvailable?'Ouvrir l’administration':'Les magasins sont en cours de chargement'}><Settings2 size={17} aria-hidden="true"/> Administration</button>
      </div>
    </header>
    {adminPending&&!adminAvailable&&!adminError&&<p className="startup-admin-status" role="status">Ouverture de l’administration après le chargement des magasins…</p>}
    {adminError&&!adminAvailable&&<p className="startup-admin-status" role="alert">Administration indisponible. Vérifiez votre connexion. <button type="button" onClick={onRetry}>Réessayer</button></p>}
    <div className="startup-body">
      <section className="startup-card">
        <div className="startup-intro">
          <img className="startup-logo" src={`${base}icons/icon-192-v3.png`} width="92" height="92" alt=""/>
          <h1 id="startup-title">Bienvenue sur<br/><span>Fnac Pulse<span className="startup-dot">.</span></span></h1>
          <div className="startup-kicker">L’APPLICATION DES SERVICES</div>
        </div>
        <div className="startup-workspace">
          <section className="startup-launch-profile" aria-label="Sélection du profil vendeur">
            <div className="startup-launch-heading"><span className="startup-launch-icon"><UserRound size={19} aria-hidden="true"/></span><div><h2>Profil vendeur</h2><p>{hasSession?'Votre session reste ouverte sur cet appareil.':'Choisissez ou créez votre profil pour commencer.'}</p></div></div>
            {!authReady?<p className="startup-profile-status" role="status">Vérification de votre session…</p>:hasSession?<div className="startup-active-profile" role="status"><span className="startup-active-check"><Check size={16} aria-hidden="true"/></span><div><strong>{profileName||'Profil connecté'}</strong><small>{profileContext||'Votre profil est connecté.'}</small></div><button type="button" onClick={onChangeProfile} disabled={!adminAvailable}>Gérer</button></div>:profileContent}
          </section>
          {failed&&<p className="startup-error" role="alert">Le son n’a pas pu être lu. Vérifiez le volume et le mode silencieux, puis réessayez ou continuez sans son.</p>}
          <button type="button" className="startup-start" onClick={onStart} disabled={busy} aria-busy={busy}>
            {!ready?'Préparation…':busy?'Ouverture…':failed?'Réessayer':hasSession?'Accéder aux services':'Plus tard · Accéder aux services'} <ArrowRight size={18} aria-hidden="true"/>
          </button>
          {!hasSession&&!failed&&<p className="startup-skip-hint">Le choix du profil reste possible plus tard.</p>}
          {failed&&<button type="button" className="startup-continue" onClick={onContinue}>Continuer sans son</button>}
        </div>
      </section>
    </div>
    <footer className="startup-footnote"><span>ESPACE ÉQUIPE</span><p>Chaque service compte.</p></footer>
  </main>;
}

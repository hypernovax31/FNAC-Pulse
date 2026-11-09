import React, {useState} from 'react';
import {VisibleFeedback} from './VisibleFeedback';
import { BellRing, MapPin, Check, ArrowRight, Info, UserRound } from 'lucide-react';
import { Modal } from './Admin';

// Chaque dialogue système suit un appui direct. L'enregistrement réseau du
// push ne doit pas empêcher de demander la géolocalisation.
export function StartupPermissionsDialog({platform,permission,pushAvailable,notificationReady,notificationsEnabled,notificationBusy,notificationError,hasSession,authReady,profileName,profileContent,locationStatus,locationFeedback,onNotification,onLocation,onClose}) {
  const [notificationAttempt,setNotificationAttempt]=useState(0);
  const unavailable=permission==='unsupported'||!pushAvailable,blocked=permission==='denied';
  let notificationText;
  if(blocked)notificationText='Bloquées : autorisez-les dans les réglages de l’appareil ou du navigateur.';
  else if(unavailable)notificationText='Indisponibles ici. Sur iPhone et iPad, utilisez l’app installée et iOS/iPadOS 16.4 ou plus.';
  else if(notificationError==='permission')notificationText='Autorisation non accordée. Vous pouvez réessayer.';
  else if(notificationError)notificationText='Activation non confirmée. Vérifiez la connexion et réessayez.';
  else if(notificationReady)notificationText=notificationsEnabled===true?'Activées sur cet appareil.':hasSession?'Autorisation accordée · vérification de l’abonnement.':'Autorisation accordée · activation après le choix de votre profil.';
  else if(permission==='granted')notificationText='Autorisation accordée ; activez les notifications pour Fnac Pulse.';
  else notificationText='Recevez les ventes des autres vendeurs de votre département.';
  const locationText={
    checking:'Vérification de l’autorisation…',
    locating:'Recherche de votre position…',
    granted:'Autorisée sur cet appareil.',
    prompt:'Propose le magasin référencé le plus proche.',
    denied:'L’appareil ou le navigateur a refusé l’accès à la position.',
    unavailable:'Position indisponible pour le moment. Vous pouvez réessayer.',
    unsupported:'La géolocalisation n’est pas disponible sur cet appareil.',
  }[locationStatus]||'Propose le magasin référencé le plus proche.';
  const locationBusy=locationStatus==='checking'||locationStatus==='locating';
  const resultText=locationFeedback?({
    checking:'recherche en cours…',granted:'position obtenue.',denied:'accès refusé. Vérifiez les autorisations, puis réessayez.',
    unavailable:'position indisponible.',timeout:'la recherche a expiré. Vous pouvez réessayer.',unsupported:'fonction indisponible sur cet appareil.',
  })[locationFeedback.result]:'';
  const showIosHelp=platform?.os==='ios'&&locationStatus!=='granted'&&!locationBusy&&locationStatus!=='unsupported';
  return <Modal title="Bien démarrer" subtitle="Préparez Fnac Pulse sur cet appareil." onClose={onClose}>
    <VisibleFeedback message={notificationAttempt&&!notificationBusy&&(notificationError||blocked||notificationReady||permission==='granted')?`Notifications : ${notificationText}`:''} tone={notificationError||blocked?'error':'success'} revision={notificationAttempt}/>
    <VisibleFeedback message={resultText&&locationFeedback?.result!=='checking'?`Géolocalisation : ${resultText}`:''} tone={locationFeedback?.result==='granted'?'success':'error'} revision={locationFeedback?.attempt||0} actionLabel={!locationBusy&&locationStatus!=='granted'&&locationStatus!=='unsupported'?'Vérifier':''} onAction={onLocation}/>
    <p className="startup-permissions-intro">Choisissez les autorisations à activer. Votre appareil peut vous demander de confirmer chaque choix.</p>
    <div className="startup-permissions-list">
      <section className="startup-permission-card" aria-label="Notifications d’équipe">
        <span className="startup-permission-icon"><BellRing size={19}/></span>
        <div className="startup-permission-copy"><strong>Notifications d’équipe</strong><p role="status">{notificationText}</p></div>
        {notificationReady&&!notificationError?<span className="startup-permission-done"><Check size={15}/> {notificationsEnabled===true?'Activées':'Autorisées'}</span>:!unavailable&&!blocked?<button type="button" className="startup-permission-action" aria-label={notificationError?'Réessayer les notifications':'Activer les notifications'} aria-busy={notificationBusy} onClick={()=>{setNotificationAttempt(value=>value+1);onNotification();}} disabled={notificationBusy||locationStatus==='locating'}>{notificationBusy?'Activation…':notificationError?'Réessayer':'Activer'}<ArrowRight size={14}/></button>:null}
      </section>
      <section className="startup-permission-card" aria-label="Géolocalisation">
        <span className="startup-permission-icon location"><MapPin size={19}/></span>
        <div className="startup-permission-copy"><strong>Géolocalisation</strong><p role="status">{locationText}</p></div>
        {locationStatus==='granted'?<span className="startup-permission-done"><Check size={15}/> Autorisée</span>:locationStatus!=='unsupported'?<button type="button" className="startup-permission-action" aria-label={locationStatus==='denied'||locationStatus==='unavailable'?'Vérifier la géolocalisation':'Activer la géolocalisation'} aria-busy={locationBusy} onClick={onLocation} disabled={locationBusy}>{locationBusy?'Un instant…':locationStatus==='denied'||locationStatus==='unavailable'?'Vérifier':'Activer'}<ArrowRight size={14}/></button>:null}
        <p className="startup-location-result" role="status" aria-live="polite">{resultText?`Vérification ${locationFeedback.attempt} : ${resultText}`:''}</p>
        {showIosHelp&&<details className="startup-location-help">
          <summary>Comment autoriser sur iPhone ?</summary>
          <ol>
            <li>Dans Réglages → Confidentialité et sécurité → Service de localisation, activez le service. Dans la liste, vérifiez « Sites Safari » et « Fnac Pulse » s’il apparaît : l’accès ne doit pas être sur « Jamais ».</li>
            <li>Dans Réglages → Apps → Safari → Position, choisissez « Demander » plutôt que « Refuser ».</li>
            <li>Dans Safari, ouvrez Fnac Pulse. Dans le menu de la page, choisissez Réglages du site web → Position → « Demander » ou « Autoriser ».</li>
            <li>Revenez dans Fnac Pulse et touchez Vérifier. Si le refus persiste, fermez puis rouvrez l’application et réessayez.</li>
          </ol>
          <p>Les autorisations du site Safari et de l’application installée peuvent être distinctes. Un refus mémorisé peut empêcher l’affichage d’une nouvelle demande.</p>
        </details>}
      </section>
    </div>
    <section className="startup-profile" aria-label="Votre profil pour les notifications">
      <div className="startup-profile-heading"><span className="startup-profile-icon"><UserRound size={19}/></span><div><strong>Votre profil</strong><p>{hasSession?'Votre profil est déjà connecté sur cet appareil.':'Choisissez ou créez votre profil pour recevoir les ventes de votre équipe.'}</p></div></div>
      {!authReady?<p className="startup-profile-status" role="status">Vérification de votre session…</p>:hasSession?<p className="startup-profile-connected"><Check size={15}/> {profileName||'Profil connecté'}</p>:profileContent}
    </section>
    <p className="startup-permissions-privacy"><Info size={14}/><span>Votre position reste sur cet appareil et sert uniquement à proposer un magasin. Vous pouvez aussi le choisir vous-même.</span></p>
    {!hasSession&&<p className="startup-profile-later">Vous pourrez choisir votre profil plus tard depuis l’accueil.</p>}
    <button type="button" className="primary-button full-button" onClick={onClose}>{hasSession?'Continuer':'Plus tard'} <ArrowRight size={16}/></button>
  </Modal>;
}

import React from 'react';
import { BellRing, MapPin, Check, ArrowRight, Info } from 'lucide-react';
import { Modal } from './Admin';

// Les deux demandes sont séparées : sur iOS notamment, chaque dialogue système
// doit suivre un appui direct, et deux demandes simultanées peuvent se masquer.
export function StartupPermissionsDialog({permission,pushAvailable,notificationReady,notificationsEnabled,notificationBusy,notificationError,hasSession,locationStatus,onNotification,onLocation,onClose}) {
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
    denied:'Bloquée : autorisez la localisation dans les réglages de l’appareil ou du navigateur.',
    unavailable:'Position indisponible pour le moment. Vous pouvez réessayer.',
    unsupported:'La géolocalisation n’est pas disponible sur cet appareil.',
  }[locationStatus]||'Propose le magasin référencé le plus proche.';
  const locationBusy=locationStatus==='checking'||locationStatus==='locating';
  return <Modal title="Bien démarrer" subtitle="Préparez Fnac Pulse sur cet appareil." onClose={onClose}>
    <p className="startup-permissions-intro">Activez les autorisations dès maintenant. Votre appareil vous demandera de confirmer chaque choix.</p>
    <div className="startup-permissions-list">
      <section className="startup-permission-card" aria-label="Notifications d’équipe">
        <span className="startup-permission-icon"><BellRing size={19}/></span>
        <div className="startup-permission-copy"><strong>Notifications d’équipe</strong><p role="status">{notificationText}</p></div>
        {notificationReady&&!notificationError?<span className="startup-permission-done"><Check size={15}/> {notificationsEnabled===true?'Activées':'Autorisées'}</span>:!unavailable&&!blocked?<button type="button" className="startup-permission-action" aria-label={notificationError?'Réessayer les notifications':'Activer les notifications'} aria-busy={notificationBusy} onClick={onNotification} disabled={notificationBusy||locationStatus==='locating'}>{notificationBusy?'Activation…':notificationError?'Réessayer':'Activer'}<ArrowRight size={14}/></button>:null}
      </section>
      <section className="startup-permission-card" aria-label="Géolocalisation">
        <span className="startup-permission-icon location"><MapPin size={19}/></span>
        <div className="startup-permission-copy"><strong>Géolocalisation</strong><p role="status">{locationText}</p></div>
        {locationStatus==='granted'?<span className="startup-permission-done"><Check size={15}/> Autorisée</span>:locationStatus!=='unsupported'?<button type="button" className="startup-permission-action" aria-label={locationStatus==='denied'||locationStatus==='unavailable'?'Vérifier la géolocalisation':'Activer la géolocalisation'} aria-busy={locationBusy} onClick={onLocation} disabled={locationBusy||notificationBusy}>{locationBusy?'Un instant…':locationStatus==='denied'||locationStatus==='unavailable'?'Vérifier':'Activer'}<ArrowRight size={14}/></button>:null}
      </section>
    </div>
    <p className="startup-permissions-privacy"><Info size={14}/><span>Votre position reste sur cet appareil et sert uniquement à proposer un magasin. Vous pouvez aussi le choisir vous-même.</span></p>
    <button type="button" className="primary-button full-button" onClick={onClose}>Continuer <ArrowRight size={16}/></button>
  </Modal>;
}

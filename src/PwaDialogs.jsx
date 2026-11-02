import React from 'react';
import { Bell, BellOff, BellRing, Check, Download, Info } from 'lucide-react';
import { Modal } from './Admin';

export function InstallDialog({platform,base,promptAvailable,installError,onInstall,onClose}) {
  const ios=platform.os==='ios',android=platform.os==='android';
  return <Modal title="Installer Fnac Pulse" subtitle="Votre espace d’équipe à portée de main." onClose={onClose}>
    <div className="install-app-preview"><img src={`${base}icons/icon-192-v3.png`} width="54" height="54" alt=""/><div><strong>Fnac Pulse</strong><p>Retrouvez rapidement votre équipe et vos services.</p></div></div>
    {platform.inApp&&<div className="notification-device-note"><Info size={15}/><span>Ouvrez d’abord ce lien dans {ios?'Safari':'Chrome'} : le navigateur intégré à cette application peut empêcher l’installation.</span></div>}
    {ios?<div className="install-steps">
      <div><span>1</span><p>Dans <strong>Safari</strong>, touchez <strong>Partager</strong> (le carré avec une flèche vers le haut).</p></div>
      <div><span>2</span><p>Choisissez <strong>Sur l’écran d’accueil</strong>.</p></div>
      <div><span>3</span><p>Si proposé, gardez <strong>Ouvrir comme app</strong> activé, puis touchez <strong>Ajouter</strong>.</p></div>
    </div>:android?<div className="install-steps">
      <div><span>1</span><p>Dans <strong>Chrome</strong>, ouvrez le menu <strong>⋮</strong>.</p></div>
      <div><span>2</span><p>Choisissez <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>, puis confirmez.</p></div>
    </div>:<div className="install-steps">
      <div><span>1</span><p>Dans un navigateur compatible, ouvrez le menu ou l’icône d’installation dans la barre d’adresse.</p></div>
      <div><span>2</span><p>Choisissez <strong>Installer Fnac Pulse</strong>, si cette option est proposée.</p></div>
    </div>}
    <p className="modal-hint"><Info size={14}/><span>{ios?'Ouvrez ensuite l’application depuis son icône : c’est nécessaire pour les notifications sur iPhone et iPad (iOS/iPadOS 16.4 ou plus).':'Après l’installation, ouvrez Fnac Pulse depuis son icône et choisissez votre profil pour activer les notifications.'}</span></p>
    {installError&&<div className="install-error" role="alert">{installError}</div>}
    {promptAvailable&&!platform.inApp&&!ios?<><button type="button" className="primary-button full-button" onClick={onInstall}>Installer l’application <Download size={16}/></button><button type="button" className="notification-later" onClick={onClose}>Plus tard</button></>:<button type="button" className="primary-button full-button" onClick={onClose}>J’ai compris <Check size={16}/></button>}
  </Modal>;
}

export function NotificationsDialog({permission,enabled,checkError,unconfirmed,pushAvailable,platform,installed,hasSession,pendingProfile=false,pendingError=false,busy,onClose,onEnable,onDisable,onRetry,onInstall,onSelectProfile}) {
  const needInstall=platform.os==='ios'&&!installed;
  const checking=enabled===null&&!checkError;
  let note,button,label,disabled=false;
  if(checkError) {
    note='La vérification n’a pas abouti. Vérifiez la connexion et réessayez.';button=onRetry;label='Réessayer la vérification';
  } else if(needInstall) {
    note='Sur iPhone et iPad, installez l’application sur l’écran d’accueil et ouvrez-la depuis son icône avant d’activer les notifications.';button=onInstall;label='Voir comment installer';
  } else if(permission==='denied') {
    note='Les notifications sont bloquées. Autorisez-les dans les réglages de cet appareil ou de votre navigateur, puis revenez ici.';label='Notifications bloquées';disabled=true;
  } else if(permission==='unsupported'||!pushAvailable) {
    note='Les notifications Web ne sont pas disponibles dans ce contexte. Vérifiez votre navigateur, HTTPS et, sur iPhone ou iPad, iOS/iPadOS 16.4 ou plus.';label='Notifications indisponibles';disabled=true;
  } else if(!hasSession) {
    note=pendingProfile?(pendingError?'Préparation indisponible. Choisissez votre profil pour réessayer.':'Profil à choisir pour terminer l’activation.'):'Choisissez votre profil pour activer les notifications.';
    button=onSelectProfile;label='Choisir mon profil';
  } else if(checking) {
    note='Nous vérifions l’activation sur cet appareil.';label='Vérification…';disabled=true;
  } else if(enabled===true) {
    note='Les notifications sont activées sur cet appareil. Leur réception dépend aussi des réglages système et du réseau.';button=onDisable;label='Désactiver sur cet appareil';
  } else {
    note=unconfirmed?'L’autorisation est accordée, mais l’abonnement Fnac Pulse n’est pas confirmé. Appuyez pour l’activer sur cet appareil.':permission==='granted'?'L’autorisation est accordée. Activez les notifications sur cet appareil.':'Un appui est nécessaire pour demander l’autorisation au navigateur.';button=onEnable;label='Activer les notifications';
  }
  // Le réseau ne doit pas empêcher d'ouvrir le choix du profil ou l'aide à l'installation.
  const actionBusy=busy&&button!==onSelectProfile&&button!==onInstall;
  const headline=checkError?'Vérification indisponible':needInstall?'Installation requise':permission==='denied'?'Notifications bloquées':
    permission==='unsupported'||!pushAvailable?'Notifications indisponibles':!hasSession?(pendingProfile?(pendingError?'Activation à finaliser':'Autorisation accordée'):'Profil à choisir'):
    checking?'Vérification des notifications':enabled===true?'Notifications activées':'À activer sur cet appareil';
  return <Modal title="Notifications d’équipe" onClose={onClose}>
    <div className="notification-modal-hero"><div className="notification-hero-icon"><BellRing size={25}/></div><div><strong>{headline}</strong></div></div>
    <div className="notification-details"><div><Check size={16}/> Pas d’alerte pour vos propres ventes</div><div><Check size={16}/> Activation individuelle sur chaque appareil</div><div><Check size={16}/> Son Fnac en premier plan, selon l’appareil</div></div>
    <div className="notification-device-note"><Info size={15}/><span>{note}</span></div>
    <button type="button" className={enabled===true?'outline-button full-button':'primary-button full-button'} disabled={actionBusy||disabled} onClick={button}>{actionBusy?'Un instant…':label} {enabled===true?<BellOff size={16}/>:<Bell size={16}/>}</button>
    {enabled!==true&&<button type="button" className="notification-later" onClick={onClose}>Plus tard</button>}
  </Modal>;
}

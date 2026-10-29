// Le mode d’affichage ne renseigne que le contexte courant : un onglet ne
// peut pas savoir avec certitude si une autre copie a été installée ailleurs.
export function isStandalone(win=typeof window==='undefined'?null:window) {
  if(!win)return false;
  if(win.navigator?.standalone===true)return true;
  try {
    return ['standalone','fullscreen','minimal-ui','window-controls-overlay']
      .some(mode=>win.matchMedia?.(`(display-mode: ${mode})`)?.matches);
  } catch {return false;}
}

export function installPlatform(nav=typeof navigator==='undefined'?null:navigator) {
  const ua=String(nav?.userAgent||''),platform=String(nav?.platform||'');
  const ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh|MacIntel/i.test(`${ua} ${platform}`)&&Number(nav?.maxTouchPoints)>1);
  const android=/Android/i.test(ua);
  const inApp=/FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|;\s*wv\)/i.test(ua);
  return {os:ios?'ios':android?'android':'desktop',inApp};
}

export function notificationBanner({permission,enabled,hasSession,platform,installed,error,unconfirmed=false,pushAvailable=true}) {
  if(error)return {message:'Impossible de vérifier les notifications. Vérifiez votre connexion puis réessayez.',action:'retry',label:'Réessayer'};
  if(enabled!==false)return null;
  if(platform.os==='ios'&&!installed)return {message:'Sur iPhone et iPad, installez et ouvrez d’abord l’application sur l’écran d’accueil.',action:'install',label:'Installer'};
  if(permission==='denied')return {message:'Notifications bloquées : autorisez-les dans les réglages de votre appareil ou navigateur.',action:'details',label:'En savoir plus'};
  if(permission==='unsupported'||!pushAvailable)return {message:'Les notifications Web ne sont pas disponibles dans ce navigateur ou sur cet appareil.',action:'details',label:'En savoir plus'};
  if(!hasSession)return {message:'Choisissez votre profil pour vérifier et activer les notifications de votre équipe.',action:'details',label:'Activer'};
  if(unconfirmed)return {message:'Autorisation accordée, mais abonnement Fnac Pulse non confirmé sur cet appareil.',action:'details',label:'Confirmer'};
  return {message:'Activez les notifications sur cet appareil pour suivre les ventes de votre équipe.',action:'details',label:'Activer'};
}

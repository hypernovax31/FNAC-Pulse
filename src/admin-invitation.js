// Les secrets de l’invitation restent sur l’appareil de l’administrateur :
// Firebase reçoit le mot de passe, le Worker reçoit uniquement le jeton du
// nouveau compte, et la messagerie reçoit le message lorsque l’utilisateur
// choisit explicitement de l’ouvrir puis de l’envoyer.
export function invitationAddress(value) {
  const address=String(value||'').trim().toLowerCase();
  // Refuser séparateurs et caractères de contrôle pour ne jamais créer de
  // destinataires supplémentaires dans le lien mailto.
  if(address.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address))
    throw new Error('Indiquez une adresse e-mail valide.');
  return address;
}

export function createInvitationPassword(random=globalThis.crypto) {
  if(!random?.getRandomValues)throw new Error('Générateur sécurisé indisponible sur cet appareil.');
  const bytes=random.getRandomValues(new Uint8Array(18));
  let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
  // 144 bits aléatoires ; le suffixe satisfait les politiques courantes de
  // majuscules, minuscules, chiffres et caractères spéciaux.
  return `${btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}aA1!`;
}

export function invitationMessage({email,password,appUrl}) {
  const address=invitationAddress(email);
  if(typeof password!=='string'||password.length<12||/[\r\n]/.test(password))throw new Error('Mot de passe provisoire invalide.');
  let url;try{url=new URL(appUrl);}catch{throw new Error('Adresse de l’application indisponible.');}
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))
    throw new Error('Adresse de l’application non sécurisée.');
  url.search='';url.hash='';
  const subject='Bienvenue sur Fnac Pulse';
  const body=[
    'Bonjour,',
    '',
    'Bienvenue sur Fnac Pulse, l’application des services qui aide les vendeurs à suivre leurs objectifs personnels.',
    '',
    `Adresse administrateur : ${address}`,
    `Mot de passe provisoire : ${password}`,
    '',
    `Connectez-vous sur ${url.href} et choisissez votre mot de passe personnel dès votre première connexion.`,
    '',
    'À bientôt !',
  ].join('\r\n');
  return {address,subject,body,href:`mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`};
}

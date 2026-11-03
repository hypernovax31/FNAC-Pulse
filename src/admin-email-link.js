// Un lien Firebase est un secret à usage unique. Ne jamais le journaliser,
// l'envoyer au Worker ni accepter un site ou une action arbitraire.
function extractFirebaseActionCode(input,config,mode,message) {
  const invalid=()=>{throw new Error(message);};
  if(typeof input!=='string'||input.length>8192)return invalid();
  let url;try {url=new URL(input.trim());}catch{return invalid();}
  const hosts=[config?.authDomain,config?.projectId?`${config.projectId}.web.app`:null].filter(Boolean);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname)||url.pathname!=='/__/auth/action')return invalid();
  const one=name=>url.searchParams.getAll(name).length===1?url.searchParams.get(name):null;
  const code=one('oobCode');
  if(one('mode')!==mode||one('apiKey')!==config?.apiKey||!code||!/^[^\s\u0000-\u001f\u007f]{6,2048}$/.test(code))return invalid();
  if(url.searchParams.has('tenantId'))return invalid();
  return code;
}
export function extractAdminEmailChangeCode(input,config) {
  return extractFirebaseActionCode(input,config,'verifyAndChangeEmail','Copiez l’adresse complète du lien de changement d’e-mail reçu de Fnac Pulse.');
}
export function extractAdminPasswordResetCode(input,config) {
  return extractFirebaseActionCode(input,config,'resetPassword','Copiez l’adresse complète du lien de choix du mot de passe reçu de Fnac Pulse.');
}
export function extractAdminVerificationCode(input,config) {
  return extractFirebaseActionCode(input,config,'verifyEmail','Copiez l’adresse complète du lien de confirmation reçu de Fnac Pulse.');
}

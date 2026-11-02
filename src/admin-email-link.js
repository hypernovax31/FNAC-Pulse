// Un lien Firebase est un secret à usage unique. Ne jamais le journaliser,
// l'envoyer au Worker ni accepter un site ou une action arbitraire.
export function extractAdminEmailChangeCode(input,config) {
  const invalid=()=>{throw new Error('Copiez l’adresse complète du lien de changement d’e-mail reçu de Fnac Pulse.');};
  if(typeof input!=='string'||input.length>8192)return invalid();
  let url;try {url=new URL(input.trim());}catch{return invalid();}
  const hosts=[config?.authDomain,config?.projectId?`${config.projectId}.web.app`:null].filter(Boolean);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname)||url.pathname!=='/__/auth/action')return invalid();
  const one=name=>url.searchParams.getAll(name).length===1?url.searchParams.get(name):null;
  const code=one('oobCode');
  if(one('mode')!=='verifyAndChangeEmail'||one('apiKey')!==config?.apiKey||!code||!/^[^\s\u0000-\u001f\u007f]{6,2048}$/.test(code))return invalid();
  if(url.searchParams.has('tenantId'))return invalid();
  return code;
}

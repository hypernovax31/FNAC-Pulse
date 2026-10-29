// Un même message pour les notifications système et les annonces dans l'application.
// Le catalogue stocke un nom d'affichage unique : son premier mot est utilisé comme prénom.
export function saleMessage(serviceName,sellerName) {
  const rawService=typeof serviceName==='string'?serviceName.trim().replace(/\s+/g,' '):'';
  const rawSeller=typeof sellerName==='string'?sellerName.trim().replace(/\s+/g,' '):'';
  const service=rawService&&rawService.toLocaleLowerCase('fr')!=='un service'?rawService:'service';
  const firstName=rawSeller&&rawSeller.toLocaleLowerCase('fr')!=='un vendeur'?rawSeller.split(' ')[0]:'un vendeur';
  return `1 ${service} fait par ${firstName} 👍`;
}

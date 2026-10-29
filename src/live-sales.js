// Une vente reçue avec retard après reconnexion n'est pas un événement en direct.
export function isFreshSale(sale,day,clientId,now=Date.now()) {
  const created=Date.parse(sale?.createdAt||'');
  return sale?.source==='sale'&&!sale.deletedAt&&sale.clientId!==clientId&&sale.businessDate===day&&
    Number.isFinite(created)&&created>=now-30000&&created<=now+5000;
}

export function createSaleSnapshotFilter({day,clientId,now=Date.now}) {
  let serverBaseline=false;
  return snap=>{
    if(snap.metadata.fromCache)return [];
    if(!serverBaseline){serverBaseline=true;return [];}
    return snap.docChanges().filter(change=>change.type==='added')
      .map(change=>change.doc.data()).filter(sale=>isFreshSale(sale,day,clientId,now()));
  };
}

// Les ventes peuvent arriver avant le premier instantané du catalogue Firestore.
// On attend les noms avant d'afficher le toast, puis on utilise toujours le catalogue courant.
export function createSaleAnnouncer(onSale) {
  let catalog=null;
  const waiting=[];
  function send(sale) {
    const seller=catalog.sellers.find(x=>Number(x.id)===Number(sale.sellerId));
    const service=catalog.services.find(x=>Number(x.id)===Number(sale.serviceId));
    onSale({...sale,sellerName:seller?.name||'Un vendeur',serviceName:service?.name||'un service'});
  }
  return {
    setCatalog(next) {catalog=next;while(waiting.length)send(waiting.shift());},
    add(sale) {if(catalog)send(sale);else waiting.push(sale);},
  };
}

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

// Une génération ne change que lors d’une réinitialisation explicite du magasin.
// Les ventes historiques sans champ restent valides jusqu’au premier reset.
export const SALES_RESET_CONFIRMATION='SUPPRIMER';
export function salesGeneration(marker) {
  return typeof marker?.generation==='string'?marker.generation:'';
}
export function saleInGeneration(sale,generation) {
  return !generation||sale?.generation===generation;
}

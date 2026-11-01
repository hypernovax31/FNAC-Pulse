// Une vente n'est annoncée qu'aux collègues actifs de son magasin et de son
// département. Tous les abonnements du vendeur auteur sont exclus.
export function localPushTargets(db,storeId,departmentId,sellerId) {
  return db.prepare(`SELECT subscriptions.endpoint,subscriptions.subscription_json FROM subscriptions
    JOIN sellers ON sellers.id=subscriptions.seller_id AND sellers.store_id=subscriptions.store_id
    WHERE subscriptions.store_id=? AND sellers.active=1 AND sellers.department_id=? AND sellers.id<>?`)
    .all(storeId,departmentId,sellerId);
}

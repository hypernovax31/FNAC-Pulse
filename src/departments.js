import {sellerStoreId,comparePeople} from './catalog.js';

// Les identifiants sont stables : les anciens vendeurs et anciennes ventes
// appartiennent implicitement à Produits Techniques dans leur magasin d'origine.
export const TECH_DEPARTMENT_ID='tech';
export const DEFAULT_DEPARTMENTS=Object.freeze([
  Object.freeze({id:TECH_DEPARTMENT_ID,name:'Produits Techniques',active:true}),
  Object.freeze({id:'editorial',name:'Produits Éditoriaux',active:true}),
  Object.freeze({id:'cash',name:'Caisse/Adhésion',active:true}),
  Object.freeze({id:'logistics',name:'SAV/Logistique',active:true}),
]);
export function departmentsForStore(catalog,storeId,{activeOnly=true}={}) {
  if(!storeId)return [];
  const saved=catalog?.departmentsByStore?.[storeId];
  const items=Array.isArray(saved)?saved:DEFAULT_DEPARTMENTS;
  return items.filter(item=>item&&typeof item.id==='string'&&(!activeOnly||item.active!==false&&item.active!==0));
}
export function sellerDepartmentId(seller) {return seller?.departmentId||seller?.department_id||TECH_DEPARTMENT_ID;}
// Une ancienne vente garde le département historique initial, même si le vendeur
// change ensuite d'équipe. Les nouvelles ventes mémorisent leur département.
export function saleDepartmentId(sale) {return sale?.departmentId||sale?.department_id||TECH_DEPARTMENT_ID;}
export function sellersForDepartment(sellers,storeId,departmentId,{activeOnly=true}={}) {
  if(!storeId||!departmentId)return [];
  return (sellers||[]).filter(s=>sellerStoreId(s)===storeId&&sellerDepartmentId(s)===departmentId&&(!activeOnly||s.active!==false&&s.active!==0)).sort(comparePeople);
}

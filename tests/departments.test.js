import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_DEPARTMENTS,TECH_DEPARTMENT_ID,departmentsForStore,sellerDepartmentId,saleDepartmentId,sellersForDepartment} from '../src/departments.js';
import {LEGACY_STORE_ID} from '../src/catalog.js';
import {goalTargets} from '../src/goals.js';
import {distributeWeighted,summaryGoals} from '../src/summary-goals.js';
const services=[{id:1,name:'DMax'},{id:2,name:'FVD'}],departments=DEFAULT_DEPARTMENTS;
const sellers=[
 {id:1,name:'Zoé',storeId:LEGACY_STORE_ID,active:true,goals:{s1:{month:10}},workdays:[1,3,5]},
 {id:2,name:'Alice',storeId:LEGACY_STORE_ID,active:true,departmentId:'tech',goals:{s1:{week:4}},workdays:[2,4]},
 {id:3,name:'Élodie',storeId:LEGACY_STORE_ID,active:true,departmentId:'editorial',goals:{s1:{day:3}},workdays:[0]},
 {id:4,name:'Morgan',storeId:LEGACY_STORE_ID,active:true,departmentId:'tech',goals:{},workdays:[0]},
 {id:5,name:'Inactif',storeId:LEGACY_STORE_ID,active:false,departmentId:'tech',goals:{s1:{month:999}},workdays:[1]},
];
function dates(year,month){return Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);}
function plus(iso,n){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}

test('Départements : valeurs initiales par magasin, filtrage et historique',()=>{
 assert.deepEqual(departmentsForStore({},LEGACY_STORE_ID).map(x=>x.name),['Produits Techniques','Produits Éditoriaux','Caisse/Adhésion','SAV/Logistique']);
 assert.equal(sellerDepartmentId({name:'Vendeur historique'}),TECH_DEPARTMENT_ID);
 assert.equal(saleDepartmentId({sellerId:1}),TECH_DEPARTMENT_ID);
 assert.equal(saleDepartmentId({departmentId:'editorial'}),'editorial');
 assert.deepEqual(sellersForDepartment(sellers,LEGACY_STORE_ID,'tech').map(x=>x.name),['Alice','Morgan','Zoé']);
 const customized={departmentsByStore:{[LEGACY_STORE_ID]:[{id:'tech',name:'Technique',active:true},{id:'old',name:'Ancien',active:false}]}};
 assert.deepEqual(departmentsForStore(customized,LEGACY_STORE_ID).map(x=>x.name),['Technique']);
 assert.equal(departmentsForStore(customized,'another-store').length,4);
 assert.equal(departmentsForStore(customized,LEGACY_STORE_ID,{activeOnly:false}).length,2);
});

test('Répartition pondérée : exactitude, zéros et contrôle des entrées',()=>{
 assert.deepEqual(distributeWeighted(7,[1,0,2,1]),[2,0,3,2]);
 assert.deepEqual(distributeWeighted(1,[1,1,1,1,1]),[0,0,1,0,0]);
 assert.deepEqual(distributeWeighted(0,[0,0]),[0,0]);
 assert.throws(()=>distributeWeighted(-1,[1]));assert.throws(()=>distributeWeighted(1,[1,-1]));
 for(let n=1;n<=31;n++)for(const total of [0,1,7,31,9999]) {
  const weights=Array.from({length:n},(_,i)=>i%4);
  const parts=distributeWeighted(total,weights);assert.equal(parts.reduce((a,b)=>a+b,0),weights.some(Boolean)?total:0);
  assert(parts.every((x,i)=>Number.isInteger(x)&&x>=0&&(weights[i]||x===0)));
 }
});

test('Récapitulatif : somme mensuelle, répartition selon présences et semaine entre deux mois',()=>{
 const date='2026-11-01',result=summaryGoals(sellers,services,departments,date),store=result.store.byService.s1;
 const expected=10+goalTargets({week:4},date,[2,4]).month+goalTargets({day:3},date,[0]).month;
 assert.equal(store.month,expected);assert.equal(store.configured,3);assert.equal(store.sellers,4);
 assert.equal(result.store.byService.s2.month,null);
 assert.equal(result.departments.editorial.byService.s1.month,15);
 const month=dates(2026,11),daily=month.map(d=>summaryGoals(sellers,services,departments,d).store.byService.s1.day);
 assert.equal(daily.reduce((a,b)=>a+b,0),expected);
 for(let i=0;i<month.length;i++)if(new Date(`${month[i]}T12:00:00Z`).getUTCDay()===6)assert.equal(daily[i],0);
 const monday='2026-10-26',week=Array.from({length:7},(_,i)=>plus(monday,i));
 const sum=week.reduce((n,d)=>n+summaryGoals(sellers,services,departments,d).store.byService.s1.day,0);
 assert(week.every(d=>summaryGoals(sellers,services,departments,d).store.byService.s1.week===sum));
 // Aucune cible individuelle, aucun nom ou planning n'est retourné.
 const serialized=JSON.stringify(result);assert(!serialized.includes('Zoé'));assert(!serialized.includes('workdays'));assert(!serialized.includes('goals'));
});

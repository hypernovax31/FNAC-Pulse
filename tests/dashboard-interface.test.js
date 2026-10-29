import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/App.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({BASE_URL:'/',VITE_BACKEND:'local'})}});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {Header,DateChip,ActivityCard,Summary,MobileNav,default:App}=module.exports;
const render=(component,props={})=>renderToStaticMarkup(React.createElement(component,props));

test('En-tête : son séparé, cloche barrée et aucun point vert de direct',()=>{
  const off=render(Header,{connected:'live',notificationsEnabled:false,soundEnabled:false});
  assert.match(off,/aria-label="Activer le son des ventes"/);assert.match(off,/lucide-volume-x/);
  assert.match(off,/aria-label="Notifications non activées"/);assert.match(off,/lucide-bell-off/);
  assert.doesNotMatch(off,/live-dot/);assert.match(off,/aria-label="Apparence"/);
  const on=render(Header,{connected:'live',notificationsEnabled:true,soundEnabled:true});
  assert.match(on,/aria-label="Couper le son des ventes"/);assert.match(on,/aria-label="Notifications activées"/);
});

test('Navigation et date : Objectifs et semaine ISO visibles',()=>{
  const nav=render(MobileNav,{active:'objectifs',onNavigate:()=>{},onSession:()=>{}});
  assert.match(nav,/>Objectifs</);assert.doesNotMatch(nav,/>Accueil</);
  const date=render(DateChip,{today:'2026-10-29'});
  assert.match(date,/>S44</);assert.match(date,/>Jeu</);assert.match(date,/>29 Oct</);assert.match(date,/aria-label="jeudi 29 octobre, semaine 44"/);
});

test('Activité récente : quatre lignes et menu fermé pour toute la journée',()=>{
  const activity=Array.from({length:9},(_,i)=>({id:i,sellerId:i+1,sellerName:`Vendeur ${i}`,serviceName:'DMax',createdAt:'2026-10-29T12:00:00.000Z'}));
  const html=render(ActivityCard,{activity,hasSession:true});
  assert.equal((html.match(/class="activity-row"/g)||[]).length,4);
  assert.match(html,/Toute l’activité du jour \(9\)/);assert.match(html,/<details class="activity-more"/);
  assert.doesNotMatch(html,/activity-more-list/);
});

test('Récapitulatif : périmètre avant les périodes',()=>{
  const html=render(Summary,{hasSession:true,storeId:'magasin',departments:[{id:'tech',name:'Technique',active:true}]});
  assert.match(html,/Toutes les ventes du magasin et par département\./);
  assert(html.indexOf('PÉRIMÈTRE DU RÉCAP’')<html.indexOf('Période du récapitulatif'));
});

test('Tableau de bord : invitation en haut si notifications non accordées et textes demandés',()=>{
  const beforeStorage=globalThis.localStorage,beforeNotification=globalThis.Notification;
  const session={storeId:'magasin',sellerId:1};
  const data={stores:[{id:'magasin',name:'Magasin fictif'}],sellers:[{id:1,name:'Morgan',storeId:'magasin',departmentId:'tech'}],services:[],today:'2026-10-29',stats:null};
  const values={'fnac-pulse-session-v1':JSON.stringify(session),'fnac-pulse-last-view-v1':JSON.stringify({session,data})};
  globalThis.localStorage={getItem:key=>values[key]??null,setItem(){},removeItem(){}};
  try {
    globalThis.Notification={permission:'default'};
    const html=render(App);
    assert(html.indexOf('Restez informés')<html.indexOf('VOTRE TABLEAU DE BORD'));
    assert.match(html,/VENTE QUOTIDIENNE/);assert.match(html,/Une vente de services \? Un clic et c’est enregistré\./);
    assert.match(html,/La vente, c’est notre rayon\. Les services aussi\. 😉/);
    globalThis.Notification={permission:'granted'};
    assert.doesNotMatch(render(App),/Restez informés/); // autorisation en cours de vérification
  } finally {
    if(beforeStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=beforeStorage;
    if(beforeNotification===undefined)delete globalThis.Notification;else globalThis.Notification=beforeNotification;
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/App.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({BASE_URL:'/',VITE_BACKEND:'local'})}});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {Header,Sidebar,DateChip,ActivityCard,Summary,MobileNav,TodayOverview,TodayDetails,ServiceCard,Toast,default:App}=module.exports;
const render=(component,props={})=>renderToStaticMarkup(React.createElement(component,props));

test('Navigation : l’ordre des boutons suit l’ordre des blocs de la page principale',()=>{
  // Blocs de la page, dans l'ordre d'affichage : Aujourd'hui, Ajouter un
  // service, Mes objectifs, Le récap' des services, puis Top de l'équipe.
  const attendu=['Aujourd’hui','Services','Objectifs','Bilan','Classement'];
  const extraire=(html,nav)=>[...(html.match(new RegExp(`<nav class="${nav}"[^]*?</nav>`))?.[0].matchAll(/<span>([^<]+)<\/span>/g)||[])].map(m=>m[1]).filter(x=>attendu.includes(x));
  assert.deepEqual(extraire(render(MobileNav,{active:'today'}),'mobile-nav'),attendu);
  assert.deepEqual(extraire(render(Sidebar,{activeNav:'today'}),'side-nav'),attendu);
});

test('En-tête : son séparé, cloche barrée et aucun point vert de direct',()=>{
  const off=render(Header,{connected:'live',notificationsEnabled:false,soundEnabled:false});
  assert.match(off,/aria-label="Activer le son Fnac"/);assert.match(off,/lucide-volume-x/);
  assert.match(off,/aria-label="Notifications non activées"/);assert.match(off,/lucide-bell-off/);
  assert.doesNotMatch(off,/live-dot/);assert.match(off,/aria-label="Apparence"/);
  const on=render(Header,{connected:'live',notificationsEnabled:true,soundEnabled:true});
  assert.match(on,/aria-label="Désactiver le son Fnac"/);assert.match(on,/aria-label="Notifications activées"/);
  const pending=render(Header,{notificationsEnabled:false,notificationPendingProfile:true});
  assert.match(pending,/Notifications autorisées, activation après le choix du profil/);assert.doesNotMatch(pending,/lucide-bell-off/);
  const error=render(Header,{notificationsEnabled:false,notificationPendingProfile:true,notificationPendingError:true});
  assert.match(error,/Activation des notifications à finaliser/);assert.match(error,/lucide-bell-off/);
});

test('En-tête : le carré du profil et son nom ouvrent le même profil sans double appel',async()=>{
  const calls=[],{act}=TestRenderer;let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Header,{session:{sellerId:1},seller:{id:1,name:'Morgan'},store:{name:'Fnac Test'},showInstall:true,onSession:()=>calls.push('profil')}));});
    const profile=tree.root.findByProps({'aria-label':'Mon profil, Morgan'}),group=tree.root.findByProps({className:'profile-control'});
    assert.equal(profile.type,'button');assert.equal(profile.props.title,'Mon profil, Morgan');
    assert.equal(group.findByProps({className:'profile-text'}).findByType('strong').children.join(''),'Morgan');
    const buttons=tree.root.findAllByType('button');
    for(const name of ['theme-trigger','sound-trigger','top-bell','install-trigger','profile-trigger','mobile-settings'])assert.equal(buttons.filter(button=>button.props.className?.split(' ').includes(name)).length,1);
    await act(async()=>{profile.props.onClick();group.props.onClick({target:{closest:()=>profile}});});
    assert.deepEqual(calls,['profil'],'le clic sur le carré ne déclenche qu’une action');
    await act(async()=>group.props.onClick({target:{closest:()=>null}}));
    assert.deepEqual(calls,['profil','profil'],'le nom reste cliquable sur les grands écrans');
  }finally{if(tree)await act(async()=>tree.unmount());}
});

test('Premier lancement PWA sans session : le choix du profil précède le tableau de bord',()=>{
  const oldWindow=globalThis.window,oldStorage=globalThis.localStorage;
  globalThis.window={navigator:{standalone:true},isSecureContext:false};
  globalThis.localStorage={getItem(){return null;},setItem(){},removeItem(){}};
  try {
    const html=render(App);
    assert.doesNotMatch(html,/Appuyez sur le bouton pour accéder à l’application des services|startup-sound-toggle/);assert.match(html,/Bienvenue sur/);
    assert.match(html,/class="startup-start" disabled=""/);
    assert.doesNotMatch(html,/class="app-shell"/);assert.doesNotMatch(html,/Continuer sans son/);
  } finally {
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
    if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;
  }
});

test('Services : la grande zone ajoute, le retrait est distinct et les états restent accessibles',async()=>{
  const service={id:1,name:'DMax avec un nom très long'},calls=[],{act}=TestRenderer;let tree;
  const props={service,index:0,count:2,session:{sellerId:1},pending:false,onAdd:value=>calls.push(['add',value]),onRemove:value=>calls.push(['remove',value])};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(ServiceCard,props));});
    const add=tree.root.findByProps({'aria-label':`Ajouter une vente ${service.name}`});
    const remove=tree.root.findByProps({'aria-label':`Retirer une vente ${service.name}`});
    assert.equal(add.type,'button');assert.equal(remove.type,'button');assert.deepEqual(add.findAllByType('button'),[add]); // aucun bouton imbriqué
    assert.equal(add.props['aria-describedby'],'service-count-1');assert.equal(add.props['aria-busy'],false);
    assert.equal(tree.root.findByProps({id:'service-count-1'}).children.join(''),'2 aujourd’hui');
    await act(async()=>remove.props.onClick());assert.deepEqual(calls,[['remove',service]]);
    await act(async()=>add.props.onClick());assert.deepEqual(calls,[['remove',service],['add',service]]);
    await act(async()=>tree.update(React.createElement(ServiceCard,{...props,pending:true})));
    assert(tree.root.findAllByType('button').every(button=>button.props.disabled));
    assert.equal(tree.root.findByProps({'aria-label':`Ajouter une vente ${service.name}`}).props['aria-busy'],true);
    assert.match(render(ServiceCard,{...props,pending:true}),/Envoi…/);
    assert.match(render(ServiceCard,props),/Ajouter une vente/);assert.match(render(ServiceCard,props),/service-add-indicator/);
    await act(async()=>tree.update(React.createElement(ServiceCard,{...props,session:null,count:0})));
    assert.equal(tree.root.findAllByType('button').length,2);assert.equal(tree.root.findByProps({'aria-label':`Retirer une vente ${service.name}`}).props.disabled,true);
    assert.match(render(ServiceCard,{...props,session:null,count:0}),/Profil à choisir/);
    await act(async()=>tree.update(React.createElement(ServiceCard,{...props,count:0})));
    assert.equal(tree.root.findByProps({'aria-label':`Retirer une vente ${service.name}`}).props.disabled,true);
    assert.equal(tree.root.findByProps({'aria-label':`Ajouter une vente ${service.name}`}).props.disabled,false);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Navigation mobile et PC : les cinq intitulés et leur ordre sont identiques',()=>{
  const nav=render(MobileNav,{active:'today',onNavigate:()=>{}}),sidebar=render(Sidebar,{activeNav:'today',onNavigate:()=>{}});
  const labels=['Aujourd’hui','Services','Objectifs','Bilan','Classement'];
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(match=>match[1]),labels);
  const principal=sidebar.match(/<nav class="side-nav" aria-label="Navigation principale">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...principal.matchAll(/<span>([^<]+)<\/span>/g)].map(match=>match[1]),labels);
  assert.match(principal,/aria-current="location"/);
  assert.match(nav,/aria-current="location"/);assert.doesNotMatch(nav,/>Profil<|>Accueil</);
  assert.equal((nav.match(/<button /g)||[]).length,5);
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

test('Récapitulatif : les trois périodes gardent leur sélection et leurs chiffres selon le périmètre',async()=>{
  const recap=(day,week,month)=>Object.fromEntries(Object.entries({day,week,month}).map(([key,total])=>[key,{total,byService:[],start:'2026-10-26',end:'2026-10-26'}]));
  const stats={summary:{store:recap(2,7,21),departments:{tech:recap(1,4,9)}}}, {act}=TestRenderer;let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Summary,{stats,hasSession:true,storeId:'magasin',departments:[{id:'tech',name:'Technique',active:true}]}));});
    const tabs=()=>tree.root.findAllByProps({role:'tab'}),total=()=>Number(tree.root.findByProps({className:'summary-total'}).findByType('strong').children[0]);
    assert.deepEqual(tabs().map(tab=>tab.children.join('')),['Aujourd’hui','Cette semaine','Ce mois']);
    assert.equal(total(),2);
    for(const [index,value] of [[1,7],[2,21],[0,2]]) {
      await act(async()=>tabs()[index].props.onClick());
      assert.equal(total(),value);assert.deepEqual(tabs().map(tab=>tab.props['aria-selected']),[0,1,2].map(i=>i===index));
    }
    await act(async()=>tree.root.findByProps({'aria-label':'Périmètre du récapitulatif'}).props.onChange({target:{value:'tech'}}));
    assert.equal(total(),1);
    await act(async()=>tabs()[2].props.onClick());assert.equal(total(),9);
    await act(async()=>tree.root.findByProps({'aria-label':'Périmètre du récapitulatif'}).props.onChange({target:{value:'store'}}));
    assert.equal(total(),21,'la période sélectionnée reste active lors du changement de périmètre');
  }finally{if(tree)await act(async()=>tree.unmount());}
});

test('Aujourd’hui : total personnel en premier, ventes de l’équipe en second',()=>{
  const period={total:7,byService:[],bySeller:[],mineByService:[],start:'2026-10-29',end:'2026-10-29'};
  const stats={day:period,week:period,month:period,mine:[],mineTotal:3,leaderboard:[],activity:[]};
  const html=render(TodayOverview,{stats,hasSession:true}),match=html.match(/<section class="today-overview"[^>]*>(.*?)<\/section>/);
  assert(match);assert.match(html,/<section class="today-overview" id="today"/);assert.match(html,/kicker-line[^>]*><\/span> AUJOURD’HUI/);assert.doesNotMatch(html,/Votre journée en chiffres|EN UN COUP D’ŒIL/);
  const cards=match[1].split(/class="stat-card stat-card-[^"]+"/).slice(1);assert.equal(cards.length,2);
  assert.match(cards[0],/Ma journée/);assert.match(cards[0],/stat-value">3/);
  assert.match(cards[1],/Ventes de l’équipe/);assert.match(cards[1],/stat-value">7/);assert.match(cards[1],/Dans votre département/);
});

test('Navigation mobile : les cinq boutons pointent vers leurs sections',async()=>{
  const selected=[],{act}=TestRenderer;let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(MobileNav,{active:'today',onNavigate:id=>selected.push(id)}));});
    const buttons=tree.root.findAllByType('button');assert.equal(buttons.length,5);
    for(const button of buttons)await act(async()=>button.props.onClick());
    assert.deepEqual(selected,['today','services','objectifs','summary','ranking']);
    assert.equal(buttons[0].props['aria-current'],'location');
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Aujourd’hui : les cartes ouvrent le détail correspondant et restent inactives sans données',async()=>{
  const selected=[],stats={mineTotal:2,day:{total:4}}, {act}=TestRenderer;let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(TodayOverview,{stats,hasSession:true,onShow:value=>selected.push(value)}));});
    const buttons=tree.root.findAllByType('button');assert.equal(buttons.length,2);assert(buttons.every(button=>!button.props.disabled));
    for(const button of buttons) {
      assert.match(button.props['aria-label'],/Voir le détail/);
      assert.equal(button.findAllByProps({className:'stat-detail-action'}).length,1,'le détail est aussi proposé visuellement');
      await act(async()=>button.props.onClick());
    }
    assert.deepEqual(selected,['mine','team']);
    await act(async()=>tree.update(React.createElement(TodayOverview,{stats:null,hasSession:false,onShow:value=>selected.push(value)})));
    assert(tree.root.findAllByType('button').every(button=>button.props.disabled));
    assert.equal(tree.root.findAllByProps({className:'stat-detail-action'}).length,0,'aucune invitation à appuyer si les données sont indisponibles');
  }finally{if(tree)await act(async()=>tree.unmount());}
});

test('Détail Aujourd’hui : chiffres personnels et équipe, zéro et données indisponibles',()=>{
  const stats={mineTotal:2,day:{total:3,byService:[{id:1,name:'DMax',count:3},{id:2,name:'Garantie',count:0}],mineByService:[{serviceId:1,count:1},{serviceId:2,count:1}]},summary:{store:{day:{byService:[{id:1,name:'DMax'},{id:2,name:'Garantie'}]}}}};
  const mine=render(TodayDetails,{scope:'mine',stats,services:[],date:'2026-10-29',onClose(){}});
  assert.match(mine,/Ma journée/);assert.match(mine,/DMax/);assert.match(mine,/Garantie/);assert.match(mine,/Toutes vos ventes personnelles du jour/);assert.doesNotMatch(mine,/avant un changement de département/);
  assert.match(mine,/Détail par service/);assert.doesNotMatch(mine,/\d+ types?/);
  const team=render(TodayDetails,{scope:'team',stats,services:[],date:'2026-10-29',department:{name:'Technique'},onClose(){}});
  assert.match(team,/Ventes de l’équipe/);assert.match(team,/département Technique/);assert.match(team,/DMax/);assert.doesNotMatch(team,/Garantie/);assert.doesNotMatch(team,/\d+ types?/);
  for(const scope of ['mine','team']){
    const empty=render(TodayDetails,{scope,stats:{mineTotal:0,day:{total:0,byService:[],mineByService:[]}},services:[],onClose(){}});
    assert.match(empty,/Détail par service/);assert.match(empty,/Aucune vente enregistrée/);assert.doesNotMatch(empty,/\d+ types?/);
  }
  assert.match(render(TodayDetails,{scope:'mine',stats:{mineTotal:2,day:{}},services:[],onClose(){}}),/détail des ventes est indisponible/);
});

test('Alerte de profil : variante limitée, annonce accessible, fermeture et action normale préservées',async()=>{
  const {act}=TestRenderer;let tree,closed=0,undone=0;
  const message='Choisissez d’abord votre magasin et votre profil.';
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Toast,{notice:{message,tone:'warning',variant:'profile-required'},onClose:()=>closed++}));});
    let status=tree.root.findByProps({role:'status'});
    assert.equal(status.props.className,'toast toast-warning toast-profile-required');
    assert.equal(status.props['aria-atomic'],'true');
    assert.equal(status.findByProps({className:'toast-message'}).children.join(''),message);
    await act(async()=>status.findByProps({'aria-label':'Fermer la notification'}).props.onClick());assert.equal(closed,1);
    await act(async()=>tree.update(React.createElement(Toast,{notice:{message:'Vente ajoutée.',tone:'success',actionLabel:'Annuler',action:()=>undone++},onClose:()=>closed++})));
    status=tree.root.findByProps({role:'status'});
    assert.equal(status.props.className,'toast toast-success','les autres retours ne prennent pas cette variante');
    await act(async()=>status.findByProps({className:'toast-action'}).props.onClick());
    assert.equal(closed,2);assert.equal(undone,1);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

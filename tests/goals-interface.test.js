import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { personalGoalCards } from '../src/goal-display.js';

const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/Goals.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent'});
const module={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const { GoalsPanel, GoalCards, GoalForm }=module.exports;
const props={
  seller:{id:1,name:'Morgan'},services:[{id:1,name:'DMax'},{id:2,name:'Garantie'},{id:3,name:'FVD'}],
  goals:{s1:{day:null,week:null,month:50,revision:'rev-1'},s2:{day:null,week:null,month:0,revision:'rev-2'}},
  stats:{day:{mineByService:[{serviceId:1,count:3}]},week:{mineByService:[{serviceId:1,count:15},{serviceId:2,count:1},{serviceId:3,count:2}]},month:{mineByService:[]}},
  workdays:[1,2,3,4,5],date:'2026-10-29',onEdit:()=>{},onRetry:()=>{},
};
const render=(component,p)=>renderToStaticMarkup(React.createElement(component,p));

test('Objectifs du jour : cibles à 0 ou absentes cachées, cible atteinte conservée',()=>{
  const html=render(GoalsPanel,props);
  assert.match(html,/<section class="panel goals-panel" id="objectifs"/);
  assert.match(html,/aria-label="Période des objectifs"/);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
  assert.equal((html.match(/aria-pressed="false"/g)||[]).length,2);
  assert.equal((html.match(/<article class="goal-card/g)||[]).length,1);
  assert.match(html,/aria-label="Modifier les objectifs DMax"/);
  assert.doesNotMatch(html,/Modifier les objectifs Garantie/);assert.doesNotMatch(html,/objectif FVD/);
  assert.doesNotMatch(html,/goal-period-context|Objectifs du jour|jeudi 29 octobre 2026|Vos ventes personnelles|Cibles du jour de 1 ou plus/);
  const friday=render(GoalsPanel,{...props,date:'2026-10-30'});
  assert.doesNotMatch(friday,/goal-period-context|Objectifs du jour|vendredi 30 octobre 2026|Vos ventes personnelles/);
  assert.match(html,/>Ventes</);assert.match(html,/>Cible</);assert.match(html,/Dépassé de 1/);
  const reached=render(GoalsPanel,{...props,stats:{...props.stats,day:{mineByService:[{serviceId:1,count:2}]}}});assert.match(reached,/Objectif atteint/);
  assert.match(html,/role="progressbar"[^>]+aria-label="DMax, Aujourd’hui"/);
  assert.doesNotMatch(html,/Planning et calcul|Planning par défaut/);assert.match(html,/Ajouter/);
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.goals-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('Objectifs de la semaine et du mois : seules les cibles positives, même atteintes',()=>{
  for(const period of ['week','month']) {
    const rows=personalGoalCards(props.services,props.goals,props.date,props.workdays,period);
    const html=render(GoalCards,{rows,period,stats:props.stats,onEdit:props.onEdit});
    assert.equal((html.match(/<article class="goal-card/g)||[]).length,1);
    assert.match(html,/Modifier les objectifs DMax/);
    assert.doesNotMatch(html,/Modifier les objectifs Garantie|Définir un objectif FVD|Cible à 0|Cible à définir/);
    assert.equal((html.match(/>Ventes<\/span>/g)||[]).length,1);assert.equal((html.match(/>Cible<\/span>/g)||[]).length,1);
    assert.equal((html.match(/role="progressbar"/g)||[]).length,1);
    if(period==='week')assert.match(html,/Dépassé de 4/);
  }
  const missing=personalGoalCards(props.services,{s1:{month:3}},'2026-02-30',props.workdays,'week');
  assert.deepEqual(missing,[]);
  const large=render(GoalCards,{rows:personalGoalCards(props.services,{s1:{day:9999}},props.date,props.workdays,'month'),period:'month',stats:props.stats,onEdit:props.onEdit});
  assert.match(large,/goal-figures has-long-values/); // les grands nombres restent lisibles sur mobile
  assert.match(large,/219 978/);
});

test('Objectifs : journée vide, aucun objectif, date invalide et lecture hors ligne',()=>{
  const empty=render(GoalsPanel,{...props,goals:{}});
  assert.match(empty,/Définir un objectif/);assert.match(empty,/Période des objectifs/);assert.match(empty,/Aucun objectif prévu aujourd’hui/);
  const rest=render(GoalsPanel,{...props,date:'2026-11-01'});
  assert.match(rest,/Aucun objectif prévu aujourd’hui\./);assert.match(rest,/Pensez à ajouter vos objectifs\./);assert.doesNotMatch(rest,/Les services sans objectif sont masqués|Retrouvez tous les services/);
  const invalid=render(GoalsPanel,{...props,date:'2026-02-30'});
  assert.match(invalid,/Les cibles du jour sont indisponibles/);assert.doesNotMatch(invalid,/Aucun objectif prévu aujourd’hui/);
  const unavailable=render(GoalsPanel,{...props,stats:null,offline:true});
  assert.match(unavailable,/Lecture hors ligne/);assert.match(unavailable,/Ventes indisponibles/);
  assert.match(unavailable,/aria-label="Modifier les objectifs DMax"[^>]+disabled/);
  assert.match(unavailable,/aria-label="Aujourd’hui" aria-pressed="true"/);
  const defaultSchedule=render(GoalsPanel,{...props,workdaysDefault:true});
  assert.doesNotMatch(defaultSchedule,/Planning par défaut|Planning et calcul/);
});

test('Formulaire : référence, aperçu des trois cibles, zéro et priorité mensuelle historique',()=>{
  const html=render(GoalForm,{services:props.services,goals:{s1:{day:4,week:12,month:0,revision:'rev-1'}},workdays:props.workdays,date:props.date,initialServiceId:1,onSave:()=>{}});
  assert.match(html,/aria-label="Cible de référence"[^>]+value="0"/);
  assert.match(html,/<option value="month" selected="">Par mois<\/option>/);
  assert.match(html,/Cible du jour/);assert.match(html,/Cible semaine/);assert.match(html,/Cible mois/);
  assert.match(html,/objectifs à atteindre, pas les ventes déjà réalisées/);
  assert.match(html,/Supprimer l’objectif de ce service/);
  assert.doesNotMatch(html,/Planning et calcul/);
  const admin=render(GoalForm,{services:props.services,goals:props.goals,workdays:props.workdays,date:props.date,onSave:()=>{},showPlanning:true});
  assert.match(admin,/Planning et calcul/);assert.match(admin,/Jours travaillés/);
});


const nodeText=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(nodeText).join(''):nodeText(node.children);
const {act}=TestRenderer;
const clickPeriod=async(tree,label)=>act(async()=>tree.root.findByProps({'aria-label':label}).props.onClick());

test('Mes objectifs : basculer jour, semaine et mois, puis gérer les objectifs masqués',async()=>{
  const edits=[],custom={...props,services:[...props.services,{id:4,name:'Petit objectif'}],goals:{...props.goals,s4:{month:2}},onEdit:id=>edits.push(id)};let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsPanel,custom));});
    const cards=()=>tree.root.findAllByType('article').map(nodeText).join(' | ');
    assert.match(cards(),/DMax/);assert.doesNotMatch(cards(),/Garantie|FVD|Petit objectif/);
    await clickPeriod(tree,'Cette semaine');assert.match(cards(),/DMax/);assert.doesNotMatch(cards(),/Garantie|FVD|Petit objectif/);
    assert.match(nodeText(tree.toJSON()),/Dépassé de 4/);assert.doesNotMatch(nodeText(tree.toJSON()),/Objectifs de la semaine|Du 26 octobre|Vos ventes personnelles/);
    await clickPeriod(tree,'Ce mois');assert.match(cards(),/DMax/);assert.match(cards(),/Petit objectif/);assert.doesNotMatch(cards(),/Garantie|FVD/);
    assert.doesNotMatch(nodeText(tree.toJSON()),/Objectifs du mois|octobre 2026|Vos ventes personnelles/);
    assert.doesNotMatch(nodeText(tree.toJSON()),/Tous les services sont affichés/);
    const manage=tree.root.findAllByType('button').find(x=>nodeText(x).includes('Ajouter'));assert(manage);
    await act(async()=>manage.props.onClick());assert.deepEqual(edits,[3]);
    await act(async()=>{tree.update(React.createElement(GoalsPanel,{...custom,goals:{s2:{month:0}}}));});
    assert.equal(tree.root.findAllByType('article').length,0);assert.match(nodeText(tree.toJSON()),/Aucun objectif prévu ce mois-ci/);
    await clickPeriod(tree,'Cette semaine');assert.match(nodeText(tree.toJSON()),/Aucun objectif prévu cette semaine/);
    await clickPeriod(tree,'Aujourd’hui');assert.match(nodeText(tree.toJSON()),/Aucun objectif prévu aujourd’hui/);
    await act(async()=>{tree.update(React.createElement(GoalsPanel,{...custom,date:'2026-02-30'}));});
    for(const [label,phrase] of [['Aujourd’hui','Les cibles du jour'],['Cette semaine','Les cibles de la semaine'],['Ce mois','Les cibles du mois']]) {
      await clickPeriod(tree,label);assert.match(nodeText(tree.toJSON()),new RegExp(`${phrase} sont indisponibles`));
    }
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Les sélecteurs de période restent sans bandeau de titre, dates ou description',async()=>{
  let tree;try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsPanel,{...props,date:'2026-11-02'}));});
    for(const label of ['Aujourd’hui','Cette semaine','Ce mois']) {
      await clickPeriod(tree,label);const content=nodeText(tree.toJSON());
      assert.doesNotMatch(content,/Objectifs du jour|Objectifs de la semaine|Objectifs du mois|Du 2 novembre au 8 novembre 2026|Vos ventes personnelles depuis/);
      assert(tree.root.findByProps({'aria-label':label}).props['aria-pressed']);
    }
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Formulaire vendeur : minimum visible, période bloquée et contrôle avant appel',async()=>{
  const goals={s1:{day:null,week:null,month:50,revision:'rev-minimum-001',minimum:{period:'month',amount:20},personal:{period:'month',amount:50}}};
  const html=render(GoalForm,{services:props.services,goals,workdays:props.workdays,date:props.date,initialServiceId:1,onSave:()=>{}});
  assert.match(html,/Minimum administrateur : 20 par mois/);assert.match(html,/aria-label="Période de référence"[^>]*disabled/);
  assert.match(html,/aria-label="Cible de référence"[^>]+min="20"/);assert.match(html,/Seul un administrateur peut supprimer ce minimum/);
  let tree;const saves=[];
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalForm,{services:props.services,goals,workdays:props.workdays,date:props.date,initialServiceId:1,onSave:async v=>saves.push(v)}));});
    const input=()=>tree.root.findByProps({'aria-label':'Cible de référence'}),submit=()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}});
    await act(async()=>input().props.onChange({target:{value:'19'}}));await act(async()=>submit());
    assert.match(nodeText(tree.toJSON()),/Respectez le minimum et la période/);assert.equal(saves.length,0);
    assert.doesNotMatch(nodeText(tree.toJSON()),/Réessayer|Annuler la saisie non enregistrée/);
    await act(async()=>input().props.onBlur());assert.equal(input().props.value,'20');
    await act(async()=>input().props.onChange({target:{value:'20'}}));await act(async()=>submit());
    assert.equal(saves.length,1);assert.deepEqual(saves[0].values,{day:null,week:null,month:20});
  } finally {if(tree)await act(async()=>tree.unmount());}
});

test('Formulaire admin : minimum distinct de la cible personnelle et changement de période confirmé',async()=>{
  const goals={s1:{day:null,week:null,month:50,revision:'rev-minimum-001',minimum:{period:'month',amount:20},personal:{period:'month',amount:50}}};
  const p={services:props.services,goals,workdays:props.workdays,date:props.date,initialServiceId:1,admin:true,showPlanning:true};
  const html=render(GoalForm,{...p,onSave:()=>{}});
  assert.match(html,/CIBLE MINIMALE/);assert.match(html,/OBJECTIF ACTUEL DU VENDEUR :/);assert.doesNotMatch(html,/Cible personnelle actuelle/);assert.match(html,/aria-label="Cible de référence"[^>]+value="20"/);
  assert.match(html,/samedi 6 parts, lundi et vendredi 5/);assert.match(html,/Une cible par jour travaillé reste identique/);
  const old=Object.getOwnPropertyDescriptor(globalThis,'window');let tree,confirmed=false;const saves=[];
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>confirmed}});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalForm,{...p,onSave:async v=>saves.push(v)}));});
    await act(async()=>tree.root.findByProps({'aria-label':'Période de référence'}).props.onChange({target:{value:'week'}}));
    assert.equal(tree.root.findByProps({'aria-label':'Période de référence'}).props.value,'month','refuser la confirmation conserve la période');
    assert.equal(saves.length,0);
    confirmed=true;await act(async()=>tree.root.findByProps({'aria-label':'Période de référence'}).props.onChange({target:{value:'week'}}));
    assert.match(nodeText(tree.toJSON()),/Changer de période remplace la référence/);
    const submit=()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}});
    await act(async()=>submit());assert.equal(saves.length,1);assert.deepEqual(saves[0].values,{day:null,week:20,month:null});
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;}
});

test('Admin : cible vendeur et calculs actualisés sans augmenter le minimum',async()=>{
  const base={services:props.services,workdays:props.workdays,date:props.date,initialServiceId:1,admin:true,onSave:async()=>{throw Error('Aucune écriture attendue');}};
  const entry=amount=>({day:null,week:null,month:amount,revision:`seller-revision-${amount}`,minimum:{period:'month',amount:20},personal:{period:'month',amount}});
  let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalForm,{...base,goals:{s1:entry(20)}}));});
    const current=()=>tree.root.findByProps({'aria-label':'Objectif actuel du vendeur'});
    assert.equal(tree.root.findAllByProps({'aria-label':'Objectif actuel du vendeur'}).length,0,'masqué lorsque la cible égale le minimum');
    await act(async()=>{tree.update(React.createElement(GoalForm,{...base,goals:{s1:entry(30)}}));});
    assert.match(nodeText(current()),/30 par mois/);
    const cells=current().findByProps({className:'goal-preview-grid'}).findAllByType('strong');
    assert.equal(nodeText(cells[2]),'30');
    assert.equal(tree.root.findByProps({'aria-label':'Cible de référence'}).props.value,'20');
    await act(async()=>tree.root.findByProps({'aria-label':'Cible de référence'}).props.onChange({target:{value:'25'}}));
    await act(async()=>{tree.update(React.createElement(GoalForm,{...base,goals:{s1:entry(40)}}));});
    assert.match(nodeText(current()),/40 par mois/);
    assert.equal(tree.root.findByProps({'aria-label':'Cible de référence'}).props.value,'25','une saisie admin en cours ne doit pas être écrasée');
  } finally {if(tree)await act(async()=>tree.unmount());}
});


test('Admin simplifié : objectif en lecture seule, minimum séparé, équivalences repliées',async()=>{
  let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalForm,{services:props.services,goals:{s1:{month:50,day:null,week:null,revision:'simple-revision',minimum:{period:'month',amount:20}}},workdays:props.workdays,date:props.date,admin:true,onSave:async()=>{}}));});
    assert.match(nodeText(tree.root.findByProps({'aria-label':'Objectif actuel du vendeur'})),/50 par mois/);
    assert.match(nodeText(tree.root.findByProps({className:'admin-goal-minimum-editor'})),/Minimum administrateur/);
    assert.equal(tree.root.findByProps({'aria-label':'Cible de référence'}).props.value,'20');
    assert.equal(tree.root.findByProps({className:'admin-minimum-equivalents'}).props.open,undefined);
    assert.equal(tree.root.findAllByProps({className:'goal-form-intro'}).length,0);
    assert.match(nodeText(tree.toJSON()),/Le vendeur peut l’augmenter, mais pas descendre en dessous/);
  } finally {if(tree)await act(async()=>tree.unmount());}
});


test('Admin : objectif actuel visible seulement au-dessus du minimum administrateur',async()=>{
  const base={services:props.services,workdays:props.workdays,date:props.date,initialServiceId:1,admin:true,onSave:async()=>{}};
  const entry=amount=>({month:amount,day:null,week:null,revision:`conditional-${amount}`,minimum:{period:'month',amount:20},personal:{period:'month',amount}});
  let tree;
  try {
    const update=async goals=>act(async()=>{const el=React.createElement(GoalForm,{...base,goals});if(tree)tree.update(el);else tree=TestRenderer.create(el);});
    const count=()=>tree.root.findAllByProps({'aria-label':'Objectif actuel du vendeur'}).length;
    await update({});assert.equal(count(),0,'aucun objectif');
    await update({s1:entry(20)});assert.equal(count(),0,'minimum seul');
    await update({s1:entry(50)});assert.equal(count(),1,'hausse personnelle');
    await update({s1:entry(20)});assert.equal(count(),0,'retour au minimum');
    await update({s1:{month:50,day:null,week:null,revision:'without-minimum'}});assert.equal(count(),0,'aucun minimum de comparaison');
    assert.equal(tree.root.findAllByProps({className:'admin-goal-minimum-editor'}).length,1,'le minimum reste modifiable');
  } finally {if(tree)await act(async()=>tree.unmount());}
});

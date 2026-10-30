import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
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
  assert.match(html,/Objectifs du jour/);assert.match(html,/jeudi 29 octobre 2026/);
  assert.match(html,/>Ventes</);assert.match(html,/>Cible</);assert.match(html,/Objectif atteint/);
  assert.match(html,/role="progressbar"[^>]+aria-label="DMax, Aujourd’hui"/);
  assert.match(html,/Planning et calcul/);assert.match(html,/Ajouter/);
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.goals-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('Objectifs de la semaine et du mois : tous les services, zéro distinct de non défini',()=>{
  for(const period of ['week','month']) {
    const rows=personalGoalCards(props.services,props.goals,props.date,props.workdays,period);
    const html=render(GoalCards,{rows,period,stats:props.stats,onEdit:props.onEdit});
    assert.equal((html.match(/<article class="goal-card/g)||[]).length,3);
    assert.match(html,/Modifier les objectifs DMax/);assert.match(html,/Modifier les objectifs Garantie/);
    assert.match(html,/Définir un objectif FVD/);assert.match(html,/Cible à 0/);assert.match(html,/Cible à définir/);
    assert.equal((html.match(/>Ventes<\/span>/g)||[]).length,3);assert.equal((html.match(/>Cible<\/span>/g)||[]).length,3);
    assert.equal((html.match(/role="progressbar"/g)||[]).length,1);
    if(period==='week')assert.match(html,/Dépassé de 4/);
  }
  const missing=render(GoalCards,{rows:personalGoalCards(props.services,{s1:{month:3}},'2026-02-30',props.workdays,'week'),period:'week',stats:props.stats,onEdit:props.onEdit});
  assert.match(missing,/Cible indisponible/);assert.match(missing,/Cible à définir/);
  const large=render(GoalCards,{rows:personalGoalCards(props.services,{s1:{day:9999}},props.date,props.workdays,'month'),period:'month',stats:props.stats,onEdit:props.onEdit});
  assert.match(large,/goal-figures has-long-values/); // les grands nombres restent lisibles sur mobile
  assert.match(large,/219 978/);
});

test('Objectifs : journée vide, aucun objectif, date invalide et lecture hors ligne',()=>{
  const empty=render(GoalsPanel,{...props,goals:{}});
  assert.match(empty,/Définir un objectif/);assert.match(empty,/Période des objectifs/);assert.match(empty,/Aucun objectif prévu aujourd’hui/);
  const rest=render(GoalsPanel,{...props,date:'2026-11-01'});
  assert.match(rest,/Aucun objectif prévu aujourd’hui/);assert.match(rest,/Semaine ou Mois/);
  const invalid=render(GoalsPanel,{...props,date:'2026-02-30'});
  assert.match(invalid,/Les cibles du jour sont indisponibles/);assert.doesNotMatch(invalid,/Aucun objectif prévu aujourd’hui/);
  const unavailable=render(GoalsPanel,{...props,stats:null,offline:true});
  assert.match(unavailable,/Lecture hors ligne/);assert.match(unavailable,/Ventes indisponibles/);
  assert.match(unavailable,/aria-label="Modifier les objectifs DMax"[^>]+disabled/);
  assert.match(unavailable,/aria-label="Aujourd’hui" aria-pressed="true"/);
  const defaultSchedule=render(GoalsPanel,{...props,workdaysDefault:true});
  assert.match(defaultSchedule,/Planning par défaut · à vérifier/);
});

test('Formulaire : référence, aperçu des trois cibles, zéro et priorité mensuelle historique',()=>{
  const html=render(GoalForm,{services:props.services,goals:{s1:{day:4,week:12,month:0,revision:'rev-1'}},workdays:props.workdays,date:props.date,initialServiceId:1,onSave:()=>{}});
  assert.match(html,/aria-label="Cible de référence"[^>]+value="0"/);
  assert.match(html,/<option value="month" selected="">Par mois<\/option>/);
  assert.match(html,/Cible du jour/);assert.match(html,/Cible semaine/);assert.match(html,/Cible mois/);
  assert.match(html,/objectifs à atteindre, pas les ventes déjà réalisées/);
  assert.match(html,/Supprimer l’objectif de ce service/);
});

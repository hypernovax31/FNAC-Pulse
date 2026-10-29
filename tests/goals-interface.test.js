import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/Goals.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent'});
const module={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const { GoalsPanel, GoalForm }=module.exports;
const props={
  seller:{id:1,name:'Morgan'},services:[{id:1,name:'DMax'},{id:2,name:'Garantie'},{id:3,name:'FVD'}],
  goals:{s1:{day:null,week:null,month:50,revision:'rev-1'},s2:{day:null,week:null,month:0,revision:'rev-2'}},
  stats:{day:{mineByService:[{serviceId:1,count:3}]},week:{mineByService:[]},month:{mineByService:[]}},
  workdays:[1,2,3,4,5],date:'2026-10-29',onEdit:()=>{},onRetry:()=>{},
};
const render=(component,p)=>renderToStaticMarkup(React.createElement(component,p));

test('Objectifs : une période sélectionnée, deux cartes personnelles et accès direct',()=>{
  const html=render(GoalsPanel,props);
  assert.match(html,/<section class="panel goals-panel" id="objectifs"/);
  assert.match(html,/aria-label="Période des objectifs"/);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
  assert.equal((html.match(/aria-pressed="false"/g)||[]).length,2);
  assert.equal((html.match(/class="goal-card"/g)||[]).length,2);
  assert.match(html,/aria-label="Modifier les objectifs DMax"/);
  assert.match(html,/aria-label="Modifier les objectifs Garantie"/);
  assert.doesNotMatch(html,/Modifier les objectifs FVD/); // aucun objectif configuré pour ce service
  assert.match(html,/Ventes \/ objectif/);assert.match(html,/Atteint/);assert.match(html,/Cible à 0/);
  assert.match(html,/role="progressbar"[^>]+aria-label="DMax, Aujourd’hui"/);
  assert.equal((html.match(/role="progressbar"/g)||[]).length,1); // la cible zéro n'est pas une barre de progression
  assert.match(html,/Planning et calcul/);assert.match(html,/Ajouter/);
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.goals-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('Objectifs : état vide, chiffres indisponibles et lecture hors ligne',()=>{
  const empty=render(GoalsPanel,{...props,goals:{}});
  assert.match(empty,/Définir un objectif/);assert.doesNotMatch(empty,/Période des objectifs/);
  const unavailable=render(GoalsPanel,{...props,stats:null,offline:true});
  assert.match(unavailable,/Lecture hors ligne/);assert.match(unavailable,/Ventes indisponibles/);
  assert.match(unavailable,/aria-label="Modifier les objectifs DMax"[^>]+disabled/);
  assert.match(unavailable,/aria-label="Aujourd’hui" aria-pressed="true"/); // la sélection reste utilisable hors ligne
  const defaultSchedule=render(GoalsPanel,{...props,workdaysDefault:true});
  assert.match(defaultSchedule,/Planning par défaut · à vérifier/);
});

test('Formulaire : objectif zéro éditable et référence mensuelle historique prioritaire',()=>{
  const html=render(GoalForm,{services:props.services,goals:{s1:{day:4,week:12,month:0,revision:'rev-1'}},workdays:props.workdays,date:props.date,initialServiceId:1,onSave:()=>{}});
  assert.match(html,/aria-label="Cible de référence"[^>]+value="0"/);
  assert.match(html,/<option value="month" selected="">Par mois<\/option>/);
  assert.match(html,/Supprimer l’objectif de ce service/);
});

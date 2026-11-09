import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/StartupGate.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {StartupGate}=module.exports;
const render=props=>renderToStaticMarkup(React.createElement(StartupGate,{base:'/FNAC-Pulse/',...props}));

test('Accueil tactile : profil, administration et accès, sans bouton son ni texte supprimé',()=>{
  const html=render({status:'ready'});
  assert.match(html,/<main[^>]*aria-labelledby="startup-title"/);
  assert.match(html,/FNAC-Pulse\/icons\/icon-192-v3\.png/);
  assert.match(html,/<h1 id="startup-title">Bienvenue sur<br\/><span>Fnac Pulse/);
  assert.match(html,/<div class="startup-kicker">L’APPLICATION DES SERVICES<\/div>/);
  assert(html.indexOf('id="startup-title"')<html.indexOf('class="startup-kicker"'),'la bienvenue précède la signature');
  assert.match(html,/<button type="button" class="startup-start"[^>]*>Plus tard · Accéder aux services/);
  assert.doesNotMatch(html,/Appuyez sur le bouton pour accéder à l’application des services|startup-sound-toggle|Activer le son Fnac|Désactiver le son Fnac/);
  assert.match(html,/aria-label="Sélection du profil vendeur"/);assert.match(html,/aria-label="Ouvrir l’administration"/);
  assert(html.indexOf('class="startup-body"')<html.indexOf('class="startup-start"'));
  assert.match(html,/class="startup-footnote"/);assert.match(html,/Chaque service compte\./);
  assert.doesNotMatch(html,/signature/i);assert.doesNotMatch(html,/Continuer sans son/);assert.doesNotMatch(html,/Fermer/);
});

test('Accueil tactile : porte de sortie seulement après erreur de lecture',()=>{
  const ready=render({status:'ready'});
  assert.doesNotMatch(ready,/SON activ|SON désactiv|Continuer sans son/);
  const error=render({status:'unavailable'});
  assert.match(error,/role="alert"/);assert.match(error,/Réessayer/);assert.match(error,/Continuer sans son/);
  const waiting=render({status:'starting'});
  assert.match(waiting,/Ouverture…/);assert.match(waiting,/aria-busy="true"/);assert.match(waiting,/disabled=""/);
  const preparing=render({ready:false});assert.match(preparing,/Préparation…/);assert.match(preparing,/disabled=""/);
});

test('Accueil tactile : geste d’accès et sortie après erreur',async()=>{
  const calls=[],{act}=TestRenderer;let tree;
  const props={base:'/FNAC-Pulse/',ready:true,status:'ready',onStart:()=>calls.push('accès'),onContinue:()=>calls.push('sans son')};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(StartupGate,props));});
    const header=tree.root.findByType('header'),start=tree.root.findByProps({className:'startup-start'});
    assert.equal(header.findAllByProps({className:'startup-sound-toggle'}).length,0);assert.equal(start.props.disabled,false);
    await act(async()=>start.props.onClick());assert.deepEqual(calls,['accès']);
    await act(async()=>tree.update(React.createElement(StartupGate,{...props,status:'unavailable'})));
    await act(async()=>tree.root.findByProps({className:'startup-continue'}).props.onClick());assert.deepEqual(calls,['accès','sans son']);
    await act(async()=>tree.update(React.createElement(StartupGate,{...props,status:'starting'})));
    assert.equal(tree.root.findByProps({className:'startup-start'}).props.disabled,true);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

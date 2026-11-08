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

test('Accueil tactile : un vrai bouton obligatoire, icône d’origine et accès clavier',()=>{
  const html=render({enabled:true,status:'ready'});
  assert.match(html,/<main[^>]*aria-labelledby="startup-title"/);
  assert.match(html,/FNAC-Pulse\/icons\/icon-192-v3\.png/);
  assert.match(html,/<button type="button" class="startup-start"[^>]*>Plus tard · Accéder aux services/);
  assert.match(html,/Appuyez sur le bouton pour accéder à l’application des services\./);
  assert.match(html,/aria-label="Sélection du profil vendeur"/);assert.match(html,/aria-label="Ouvrir l’administration"/);
  assert.match(html,/SON activée/);assert.match(html,/Désactiver le son Fnac/);assert.match(html,/aria-pressed="true"/);
  assert(html.indexOf('class="startup-topbar"')<html.indexOf('class="startup-sound-toggle"'));
  assert(html.indexOf('class="startup-sound-toggle"')<html.indexOf('class="startup-body"'));
  assert(html.indexOf('class="startup-body"')<html.indexOf('class="startup-start"'));
  assert.match(html,/class="startup-footnote"/);assert.match(html,/Chaque service compte\./);
  assert.doesNotMatch(html,/signature/i);
  assert.doesNotMatch(html,/Continuer sans son/);assert.doesNotMatch(html,/Fermer/);
});

test('Accueil tactile : son désactivé conservé, et porte de sortie seulement après erreur',()=>{
  const muted=render({enabled:false,status:'ready'});
  assert.match(muted,/Appuyez sur le bouton pour accéder à l’application des services\./);
  assert.match(muted,/SON désactivé/);assert.match(muted,/Activer le son Fnac/);assert.match(muted,/aria-pressed="false"/);
  assert.doesNotMatch(muted,/signature/i);assert.doesNotMatch(muted,/Continuer sans son/);
  const error=render({enabled:true,status:'unavailable'});
  assert.match(error,/role="alert"/);assert.match(error,/Réessayer/);assert.match(error,/Continuer sans son/);
  const waiting=render({enabled:true,status:'starting'});
  assert.match(waiting,/Ouverture…/);assert.match(waiting,/aria-busy="true"/);assert.match(waiting,/disabled=""/);
  const preparing=render({enabled:true,ready:false});assert.match(preparing,/Préparation…/);assert.match(preparing,/disabled=""/);
});

test('Accueil tactile : le son en haut et les actions conservent leurs gestes distincts',async()=>{
  const calls=[],{act}=TestRenderer;let tree;
  const props={base:'/FNAC-Pulse/',enabled:true,ready:true,status:'ready',onSound:()=>calls.push('son'),onStart:()=>calls.push('accès'),onContinue:()=>calls.push('sans son')};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(StartupGate,props));});
    const header=tree.root.findByType('header'),sound=header.findByProps({className:'startup-sound-toggle'}),start=tree.root.findByProps({className:'startup-start'});
    assert.equal(sound.props['aria-pressed'],true);assert.equal(start.props.disabled,false);
    await act(async()=>sound.props.onClick());assert.deepEqual(calls,['son']);
    await act(async()=>start.props.onClick());assert.deepEqual(calls,['son','accès']);
    await act(async()=>tree.update(React.createElement(StartupGate,{...props,status:'unavailable'})));
    await act(async()=>tree.root.findByProps({className:'startup-continue'}).props.onClick());assert.deepEqual(calls,['son','accès','sans son']);
    await act(async()=>tree.update(React.createElement(StartupGate,{...props,status:'starting'})));
    assert.equal(tree.root.findByProps({className:'startup-start'}).props.disabled,true);assert.equal(tree.root.findByProps({className:'startup-sound-toggle'}).props.disabled,true);
  } finally {if(tree)await act(async()=>tree.unmount());}
});

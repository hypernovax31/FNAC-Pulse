import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
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
  assert.match(html,/<button type="button" class="startup-start"[^>]*>Accéder aux services/);
  assert.match(html,/Appuyez sur le bouton pour accéder à l’application des services\./);
  assert.match(html,/SON activée/);assert.match(html,/Désactiver le son au lancement/);assert.match(html,/aria-pressed="true"/);
  assert.doesNotMatch(html,/signature/i);
  assert.doesNotMatch(html,/Continuer sans son/);assert.doesNotMatch(html,/Fermer/);
});

test('Accueil tactile : son désactivé conservé, et porte de sortie seulement après erreur',()=>{
  const muted=render({enabled:false,status:'ready'});
  assert.match(muted,/Appuyez sur le bouton pour accéder à l’application des services\./);
  assert.match(muted,/SON désactivé/);assert.match(muted,/Activer le son au lancement/);assert.match(muted,/aria-pressed="false"/);
  assert.doesNotMatch(muted,/signature/i);assert.doesNotMatch(muted,/Continuer sans son/);
  const error=render({enabled:true,status:'unavailable'});
  assert.match(error,/role="alert"/);assert.match(error,/Réessayer/);assert.match(error,/Continuer sans son/);
  const waiting=render({enabled:true,status:'starting'});
  assert.match(waiting,/Ouverture…/);assert.match(waiting,/aria-busy="true"/);assert.match(waiting,/disabled=""/);
  const preparing=render({enabled:true,ready:false});assert.match(preparing,/Préparation…/);assert.match(preparing,/disabled=""/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Tactile : deux ou trois colonnes selon le conteneur et retrait de 44 px',()=>{
  assert.match(css,/\.services-grid\s*\{[^}]*grid-template-columns:repeat\(2,/);
  assert.match(css,/@container\s*\(min-width:\s*380px\)\s*\{\s*\.services-grid\s*\{[^}]*grid-template-columns:repeat\(3,/);
  assert.match(css,/\.service-add\s*\{[^}]*min-height:113px/);
  assert.match(css,/\.minus-button\s*\{[^}]*width:44px;\s*height:44px/);
  assert.match(css,/\.service-card-name\s*\{[^}]*overflow-wrap:anywhere/);
});

test('Notifications : texte lisible, actions tactiles et messages longs défilables',()=>{
  assert.match(css,/\.toast\s*\{[^}]*min-height:78px[^}]*border-left:7px[^}]*font-size:16px/);
  assert.match(css,/@keyframes\s+toast-appear/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:reduce\)\s*\{\s*\.toast\s*\{\s*animation:none/);
  assert.match(css,/\.toast-action\s*\{[^}]*min-width:44px;\s*min-height:44px/);
  assert.match(css,/\.toast-close\s*\{[^}]*width:44px;\s*height:44px/);
  assert.match(css,/\.toast-message\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:auto/);
  assert.match(css,/\.toast-stack\s*\{[^}]*bottom:calc\(78px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});

test('Zoom : champs de 16 px sur appareils tactiles, double appui contrôlé et pincement autorisé',()=>{
  assert.match(css,/button,\s*a,\s*input,\s*select,\s*textarea,\s*summary,[^{]+\{\s*touch-action:manipulation/);
  assert.match(css,/@media\s*\(max-width:1024px\),\s*\(pointer:coarse\),\s*\(any-pointer:coarse\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size:16px\s*!important;/);
  const viewport=html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)?.[1]||'';
  assert.match(viewport,/width=device-width/);
  assert.doesNotMatch(viewport,/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i);
});

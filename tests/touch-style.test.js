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

test('Tableau de bord : objectifs à pleine largeur et périodes du récapitulatif réparties également',()=>{
  assert.match(css,/\.goals-panel\s*\{[^}]*width:100%/);
  assert.match(css,/\.period-tabs\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\);[^}]*width:100%/);
  assert.match(css,/\.period-tabs button\s*\{[^}]*min-width:0;[^}]*text-align:center;[^}]*white-space:normal/);
  assert.doesNotMatch(css,/\.period-tabs\s*\{[^}]*width:max-content/);
  assert.match(css,/\.period-tabs button,\.history-modes button\s*\{\s*min-height:44px/);
});

test('Notifications : texte lisible, actions tactiles et messages longs défilables',()=>{
  assert.match(css,/\.toast\s*\{[^}]*min-height:60px[^}]*border-left:3px[^}]*font-size:14px/);
  assert.match(css,/@keyframes\s+toast-appear/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:reduce\)\s*\{\s*\.toast\s*\{\s*animation:none/);
  assert.match(css,/\.toast-action\s*\{[^}]*min-width:44px;\s*min-height:44px/);
  assert.match(css,/\.toast-close\s*\{[^}]*width:44px;\s*height:44px/);
  assert.match(css,/\.toast-message\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:auto/);
  assert.match(css,/\.toast-stack\s*\{[^}]*position:fixed;[^}]*top:78px/);
  assert.match(css,/\.feedback-rail\s*\{[^}]*top:78px[^}]*overflow-y:auto/);
  assert.match(css,/@media\s*\(max-width:800px\)\s*\{\s*\.feedback-rail\s*\{\s*top:72px/);
});

test('Zoom : champs de 16 px sur appareils tactiles, double appui contrôlé et pincement autorisé',()=>{
  assert.match(css,/button,\s*a,\s*input,\s*select,\s*textarea,\s*summary,[^{]+\{\s*touch-action:manipulation/);
  assert.match(css,/@media\s*\(max-width:1024px\),\s*\(pointer:coarse\),\s*\(any-pointer:coarse\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size:16px\s*!important;/);
  const viewport=html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)?.[1]||'';
  assert.match(viewport,/width=device-width/);
  assert.doesNotMatch(viewport,/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i);
});

test('Correction mobile : grilles rétrécissables, champs de date et confirmations tactiles',()=>{
  assert.match(css,/\.history-filters\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/\.history-add-form\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.history-filters \.text-input,\.history-add-form \.text-input,\.history-service-filter \.text-input\s*\{[^}]*min-width:0;\s*max-width:100%/);
  assert.match(css,/\.history-filters,\.history-add-form\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.history-add-button,\.history-confirm-add-button\s*\{[^}]*min-height:44px/);
  assert.match(css,/\.history-delete,\.history-confirm-delete\s*\{[^}]*min-height:44px/);
  assert.match(css,/\[data-theme='dark'\] \.history-confirm-add\s*\{/);
});

test('Tous les retours : colonne commune sous l’en-tête, couleurs inversées et contraste',()=>{
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const calls=[...app.matchAll(/flash\('Choisissez d’abord votre magasin et votre profil\.',\{tone:'warning',variant:'profile-required'\}\)/g)];
  assert.equal(calls.length,2);
  assert.match(css,/\.toast\s*\{[^}]*background:#242b23;\s*color:#f5f8ef/);
  assert.match(css,/\.visible-feedback\s*\{[^}]*background:#242b23;\s*color:#f5f8ef/);
  assert.match(css,/\[data-theme='dark'\] \.toast\s*\{[^}]*background:#f7f8f3;\s*color:#252d23/);
  assert.match(css,/\[data-theme='dark'\] \.visible-feedback\s*\{[^}]*background:#f7f8f3;[^}]*color:#252d23/);
  assert.match(css,/\.feedback-rail \.toast-stack\s*\{[^}]*position:static[^}]*width:100%/);
  assert.match(css,/\.visible-feedback-page\s*\{[^}]*position:static;\s*width:100%/);
  assert.match(css,/\.modal:not\(\.admin-modal\):has\(> \.toast-stack-dialog,> \.visible-feedback-dialog\)/);
  assert.match(css,/\.admin-modal:has\(> \.toast-stack-dialog,> \.visible-feedback-dialog\) \.admin-tabs-shell/);
  assert.match(css,/\.admin-modal \.toast-stack-dialog \.toast\s*\{\s*min-height:52px/);
  assert.match(css,/:root:has\(\.startup-screen\) \.feedback-rail\s*\{\s*top:calc\(111px/);
  const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const l=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (l[1]+.05)/(l[0]+.05);};
  assert(ratio([245,248,239],[36,43,35])>=4.5,'texte du popup sombre sur fond clair');
  assert(ratio([37,45,35],[247,248,243])>=4.5,'texte du popup clair sur fond sombre');
  assert(ratio([245,248,239],[53,64,50])>=4.5,'actions du popup sombre');
  assert(ratio([41,49,41],[238,242,235])>=4.5,'actions du popup clair');
  assert.match(html,/\.email-action-feedback\s*\{[^}]*background:#242b23;\s*color:#f5f8ef/);
  assert.match(html,/\[data-theme='dark'\] \.email-action-feedback\s*\{[^}]*background:#f7f8f3;[^}]*color:#252d23/);
});

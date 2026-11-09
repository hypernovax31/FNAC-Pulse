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

test('Correction mobile : grilles rétrécissables, champs de date et confirmations tactiles',()=>{
  assert.match(css,/\.history-filters\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/\.history-add-form\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.history-filters \.text-input,\.history-add-form \.text-input,\.history-service-filter \.text-input\s*\{[^}]*min-width:0;\s*max-width:100%/);
  assert.match(css,/\.history-filters,\.history-add-form\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.history-add-button,\.history-confirm-add-button\s*\{[^}]*min-height:44px/);
  assert.match(css,/\.history-delete,\.history-confirm-delete\s*\{[^}]*min-height:44px/);
  assert.match(css,/\[data-theme='dark'\] \.history-confirm-add\s*\{/);
});

test('Alerte de profil : deux déclencheurs ciblés, bandeau discret sous l’en-tête et retours coexistants',()=>{
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const calls=[...app.matchAll(/flash\('Choisissez d’abord votre magasin et votre profil\.',\{tone:'warning',variant:'profile-required'\}\)/g)];
  assert.equal(calls.length,2);
  assert.equal((app.match(/variant:'profile-required'/g)||[]).length,2,'aucun autre message ne change de présentation');
  assert.match(css,/\.toast-profile-required\s*\{[^}]*min-height:58px[^}]*border-left:3px[^}]*font-size:14px/);
  assert.match(css,/\.toast-stack:not\(\.toast-stack-dialog\) \.toast-profile-required\s*\{[^}]*position:fixed;\s*top:78px/);
  assert.match(css,/@media\s*\(max-width:800px\)\s*\{\s*\.toast-stack:not\(\.toast-stack-dialog\) \.toast-profile-required\s*\{\s*top:72px/);
  assert.match(css,/:root:has\(\.toast-stack:not\(\.toast-stack-dialog\) \.toast-profile-required\) \.visible-feedback-page\s*\{\s*top:148px/);
  assert.match(css,/\[data-theme='dark'\] \.toast-profile-required\s*\{[^}]*background:rgba\(41,48,40,\.97\)[^}]*color:#eef2e9/);
  assert.match(css,/\.toast-close\s*\{\s*width:44px;\s*height:44px/);
  // Contraste avec l’arrière-plan le plus défavorable à travers la légère transparence.
  const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const l=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (l[1]+.05)/(l[0]+.05);};
  const blend=(fg,bg,alpha)=>fg.map((c,i)=>c*alpha+bg[i]*(1-alpha));
  assert(ratio([53,64,53],blend([251,252,248],[0,0,0],.96))>=4.5);
  assert(ratio([238,242,233],blend([41,48,40],[255,255,255],.97))>=4.5);
});

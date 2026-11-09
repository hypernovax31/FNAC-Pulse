import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const layer=css.slice(css.indexOf('/* Boutons : surfaces nettes'));
const rules=[...layer.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:selector.trim(),body}));
const rule=(...fragments)=>{
  const found=rules.find(item=>fragments.every(fragment=>item.selector.includes(fragment)));
  assert(found,`Règle introuvable : ${fragments.join(' / ')}`);
  return found.body;
};
function contrast(foreground,background) {
  function luminance(hex) {
    const values=hex.match(/[\da-f]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
    return values[0]*.2126+values[1]*.7152+values[2]*.0722;
  }
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

test('Boutons : hiérarchie principale, secondaire et destructive avec relief',()=>{
  const primary=rule('.primary-button','.startup-start','.history-confirm-add-button');
  assert.match(primary,/min-height:44px/);assert.match(primary,/border:1px solid var\(--button-gold-border\)/);
  assert.match(primary,/background:var\(--button-gold\)/);assert.match(primary,/box-shadow:var\(--button-gold-shadow\)/);
  const secondary=rule('.outline-button','.text-button','.notification-later');
  assert.match(secondary,/min-height:44px/);assert.match(secondary,/border:1px solid var\(--button-border\)/);
  assert.match(secondary,/background:var\(--button-face\)/);assert.match(secondary,/box-shadow:var\(--button-shadow\)/);
  const destructive=rule('.sales-reset-button','.history-delete','.goal-remove');
  assert.match(destructive,/min-height:44px/);assert.match(destructive,/border:1px solid #c98275/);
  const confirm=rule('.sales-reset-danger','.history-confirm-delete');
  assert.match(confirm,/background:#a84334/);assert.match(confirm,/color:#fff/);
  assert(contrast('302700','f1c326')>=4.5);assert(contrast('343a31','ffffff')>=4.5);
  assert(contrast('8e382b','fff5f2')>=4.5);assert(contrast('ffffff','a84334')>=4.5);
});

test('Boutons : sombre, désactivé, appui, clavier et animation réduite',()=>{
  assert.match(rule("[data-theme='dark']",'.outline-button','.notification-later'),/background:var\(--button-face\)/);
  assert.match(rule("[data-theme='dark']",'.primary-button','):not(:disabled)'),/background:var\(--button-gold\)/);
  assert.match(rule('.primary-button','.startup-start','):disabled'),/box-shadow:none/);
  assert.match(rule("[data-theme='dark']",'.primary-button','):disabled'),/background:#444438/);
  assert.match(rule('.primary-button','.seller-workdays-toggle',':active:not(:disabled)'),/transform:translateY\(1px\)/);
  assert.match(layer,/:is\(button,summary\):focus-visible\s*\{[^}]*outline:3px solid/);
  assert.match(layer,/@media\s*\(prefers-reduced-motion:reduce\)/);
  assert(contrast('f0f3e9','30362e')>=4.5,'texte secondaire lisible sur le thème sombre');
});

test('Boutons tactiles : cartes, icônes d’édition et choix de période',()=>{
  assert.match(rule('.goal-card-edit','.seller-workdays-toggle'),/min-height:44px/);
  assert.match(rule('.entity-actions .icon-button','.edit-entity .icon-button'),/width:44px;\s*height:44px/);
  assert.match(rule('.edit-entity','.edit-entity .text-input'),/min-width:0/);
  assert.match(rule('.admin-tabs button','.goal-periods button','.history-modes button'),/border:1px solid/);
  assert.match(rule('.admin-tabs button.active','.goal-periods button.is-active'),/background:#fff3c7/);
  assert.match(rule('.service-add-label'),/border:1px solid/);
  assert.match(rule('.service-add:disabled .service-add-label'),/box-shadow:none/);
  assert.match(rule('.mobile-nav button.active'),/background:#fff3cb/);
  assert.match(rule('.stat-detail-action'),/border:1px solid/);
});

test('Ventes : relief prononcé, enfoncement et désactivation en clair et en sombre',()=>{
  const relief=css.slice(css.indexOf("/* Ajout d'un service : face lumineuse"));
  assert.match(relief,/\.service-add-label\s*\{[^}]*background:linear-gradient\([^}]*0 4px 0/);
  assert.match(relief,/\.service-add:active:not\(:disabled\) \.service-add-label\s*\{[^}]*transform:translateY\(3px\)[^}]*0 1px 0/);
  assert.match(relief,/\.service-add:disabled \.service-add-label,\.service-add:disabled \.service-add-indicator\s*\{\s*box-shadow:none/);
  assert.match(relief,/\[data-theme='dark'\] \.service-add-label\s*\{[^}]*background:linear-gradient\([^}]*0 4px 0/);
  assert.match(relief,/@media\s*\(prefers-reduced-motion:reduce\)\s*\{\s*\.service-add-label,\.service-add-indicator\s*\{\s*transition:none/);
});

test('En-tête : mêmes dimensions de toutes les commandes et adaptation mobile',()=>{
  const header=css.slice(css.indexOf("/* L'en-tête utilise un carré identique"));
  assert.match(header,/--header-control-size:44px/);
  assert.match(header,/\.topbar-actions > \.icon-button,\.topbar-actions \.profile-trigger\s*\{[^}]*width:var\(--header-control-size\)[^}]*height:var\(--header-control-size\)[^}]*flex:0 0 var\(--header-control-size\)/);
  assert.match(header,/@media\s*\(max-width:690px\)\s*\{[^}]*\.profile-control/);
  assert.match(header,/@media\s*\(max-width:385px\)\s*\{\s*\.mobile-brand \.brand-word/);
});

test('Page e-mail : actions et fermeture visibles en clair comme en sombre',()=>{
  assert.match(html,/\.email-action-content button,\.email-action-content \.email-action-button\s*\{[^}]*border:1px solid #b98c08[^}]*box-shadow:/);
  assert.match(html,/\.email-action-content \.email-action-secondary\s*\{[^}]*border:1px solid #c4cabd[^}]*box-shadow:/);
  assert.match(html,/\.email-action-feedback button\s*\{[^}]*border:1px solid currentColor[^}]*box-shadow:/);
  assert.match(html,/\[data-theme='dark'\] \.email-action-content \.email-action-secondary\s*\{[^}]*background:#30362e/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {isStandalone,installPlatform,notificationBanner} from '../src/install.js';

const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:['src/PwaDialogs.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','lucide-react'],write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({BASE_URL:'/',VITE_BACKEND:'local'})}});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {InstallDialog,NotificationsDialog}=module.exports;
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));

function display(mode,standalone=false) {return {navigator:{standalone},matchMedia:q=>({matches:q===`(display-mode: ${mode})`})};}
test('Installation : détecte le contexte autonome sans prétendre connaître les autres copies',()=>{
  assert.equal(isStandalone(null),false);assert.equal(isStandalone(display('browser')),false);
  for(const mode of ['standalone','fullscreen','minimal-ui','window-controls-overlay'])assert.equal(isStandalone(display(mode)),true);
  assert.equal(isStandalone(display('browser',true)),true);
  assert.equal(isStandalone({navigator:{},matchMedia(){throw Error('indisponible')}}),false);
});

test('Installation : instructions adaptées à iPhone, iPad, Android et navigateur intégré',()=>{
  assert.deepEqual(installPlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',maxTouchPoints:5}),{os:'ios',inApp:false});
  assert.equal(installPlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5}).os,'ios');
  assert.equal(installPlatform({userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:0}).os,'desktop');
  assert.deepEqual(installPlatform({userAgent:'Mozilla/5.0 (Linux; Android 14; wv) Instagram'}),{os:'android',inApp:true});
  const props={base:'/FNAC-Pulse/',onClose(){},onInstall(){},installError:''};
  const ios=render(InstallDialog,{...props,platform:{os:'ios',inApp:false},promptAvailable:false});
  assert.match(ios,/Safari/);assert.match(ios,/Partager/);assert.match(ios,/Sur l’écran d’accueil/);assert.match(ios,/Ouvrir comme app/);
  assert.match(ios,/iOS\/iPadOS 16\.4/);assert.match(ios,/FNAC-Pulse\/icons\/icon-192-v3\.png/);
  const android=render(InstallDialog,{...props,platform:{os:'android',inApp:false},promptAvailable:true});
  assert.match(android,/>Installer l’application /);assert.match(android,/>Plus tard</);
  const fallback=render(InstallDialog,{...props,platform:{os:'android',inApp:false},promptAvailable:false});
  assert.match(fallback,/Ajouter à l’écran d’accueil/);assert.match(fallback,/>J’ai compris /);
  const inApp=render(InstallDialog,{...props,platform:{os:'android',inApp:true},promptAvailable:true});
  assert.match(inApp,/navigateur intégré/);assert.doesNotMatch(inApp,/>Installer l’application <\/button>/);
});

test('L’événement natif anticipé est conservé et effacé après installation',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const script=html.match(/<script>\s*\/\/ Conserver l’invitation native[\s\S]*?<\/script>/)?.[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
  assert(script);const handlers=new Map(),dispatched=[];
  const window={addEventListener:(type,fn)=>handlers.set(type,fn),dispatchEvent:event=>dispatched.push(event.type)};
  vm.runInNewContext(script,{window,Event:class Event {constructor(type){this.type=type;}}});
  let prevented=false;const event={preventDefault(){prevented=true;}};
  handlers.get('beforeinstallprompt')(event);
  assert(prevented);assert.equal(window.__fnacInstallPrompt,event);assert.deepEqual(dispatched,['fnac-install-ready']);
  handlers.get('appinstalled')();assert.equal(window.__fnacInstallPrompt,null);
});

test('Notification : permission, profil, navigateur et erreur de vérification restent distincts',()=>{
  const base={permission:'default',enabled:false,hasSession:true,platform:{os:'android'},installed:true,pushAvailable:true,error:''};
  assert.equal(notificationBanner({...base,enabled:true}),null);
  assert.equal(notificationBanner({...base,enabled:null}),null);
  assert.equal(notificationBanner({...base,permission:'denied'}).label,'En savoir plus');
  assert.match(notificationBanner({...base,hasSession:false}).message,/profil/);
  assert.equal(notificationBanner({...base,permission:'unsupported',platform:{os:'ios'},installed:false,pushAvailable:false}).action,'install');
  assert.equal(notificationBanner({...base,permission:'granted',platform:{os:'ios'},installed:false,pushAvailable:true}).action,'install');
  assert.equal(notificationBanner({...base,pushAvailable:false}).action,'details');
  assert.equal(notificationBanner({...base,enabled:null,error:'unavailable'}).action,'retry');
  assert.equal(notificationBanner({...base,permission:'granted',unconfirmed:true}).label,'Confirmer');
});

test('Permission accordée au lancement : pas de carte redondante en attente du profil, erreurs visibles',()=>{
  const pending={permission:'granted',enabled:false,hasSession:false,platform:{os:'android'},installed:true,pushAvailable:true,error:'',pendingProfile:true};
  assert.equal(notificationBanner(pending),null);
  assert.equal(notificationBanner({...pending,enabled:null}),null);
  const failed=notificationBanner({...pending,enabled:null,pendingError:true});
  assert.equal(failed.title,'Activation à finaliser');assert.match(failed.message,/préparation a échoué/);assert.equal(failed.action,'details');
  assert.equal(notificationBanner({...pending,error:'unavailable'}).action,'retry');
  assert.match(notificationBanner({...pending,permission:'denied'}).message,/bloquées/);
  assert.equal(notificationBanner({...pending,permission:'unsupported',pushAvailable:false}).action,'details');
  assert.equal(notificationBanner({...pending,platform:{os:'ios'},installed:false}).action,'install');
  assert.match(notificationBanner({...pending,pendingProfile:false}).message,/profil/);
  assert.match(notificationBanner({...pending,hasSession:true,unconfirmed:true}).message,/abonnement/);
});

test('Modale notifications : action utilisateur, état bloqué, profil et erreur vérifiable',()=>{
  const base={permission:'default',enabled:false,checkError:'',pushAvailable:true,platform:{os:'android'},installed:true,hasSession:true,busy:false};
  const normal=render(NotificationsDialog,base);
  assert.match(normal,/Activer les notifications/);assert.match(normal,/Un appui est nécessaire/);
  assert.match(normal,/Les ventes peuvent vous être signalées même lorsque l’application est fermée/);
  assert.match(normal,/Uniquement pour votre magasin et votre département/);
  const details=normal.match(/<div class="notification-details">(.*?)<div class="notification-device-note">/)[1];
  assert.equal((details.match(/<div>/g)||[]).length,2);
  assert.doesNotMatch(details,/Pas d’alerte pour vos propres ventes|Activation individuelle sur chaque appareil|Son Fnac en premier plan/);
  const blocked=render(NotificationsDialog,{...base,permission:'denied'});
  assert.match(blocked,/Notifications bloquées/);assert.match(blocked,/<button[^>]+disabled=""[^>]*>Notifications bloquées/);
  const missingProfile=render(NotificationsDialog,{...base,hasSession:false});assert.match(missingProfile,/Choisir mon profil/);
  const pending=render(NotificationsDialog,{...base,permission:'granted',hasSession:false,pendingProfile:true});
  assert.match(pending,/Autorisation accordée/);assert.match(pending,/Profil à choisir pour terminer l’activation/);assert.match(pending,/Choisir mon profil/);assert.doesNotMatch(pending,/Notifications activées|essaiera automatiquement d’y associer cet appareil/);
  const pendingError=render(NotificationsDialog,{...base,permission:'granted',enabled:null,hasSession:false,pendingProfile:true,pendingError:true});
  assert.match(pendingError,/Activation à finaliser/);assert.match(pendingError,/Préparation indisponible/);assert.match(pendingError,/Choisissez votre profil pour réessayer/);assert.doesNotMatch(pendingError,/Notifications activées/);
  const unavailable=render(NotificationsDialog,{...base,permission:'unsupported',pushAvailable:false,platform:{os:'ios'},installed:false});assert.match(unavailable,/Voir comment installer/);
  const checking=render(NotificationsDialog,{...base,enabled:null});assert.match(checking,/Vérification…/);
  const error=render(NotificationsDialog,{...base,enabled:null,checkError:'unavailable'});assert.match(error,/Réessayer la vérification/);
  const unconfirmed=render(NotificationsDialog,{...base,permission:'granted',unconfirmed:true});assert.match(unconfirmed,/abonnement Fnac Pulse n’est pas confirmé/);
  const active=render(NotificationsDialog,{...base,permission:'granted',enabled:true});assert.match(active,/Notifications activées/);assert.match(active,/Désactiver sur cet appareil/);
});

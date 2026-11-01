import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const output=await build({entryPoints:['src/App.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],define:{'import.meta.env':'{"BASE_URL":"/"}'},logLevel:'silent',plugins:[{name:'onboarding-mocks',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__onboardingApi(...x); export const uid=()=>"test-uid";export const dateLabel=()=>"";export const timeLabel=()=>"";export const kmBetween=()=>0;`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`export const CLOUD=true; export const adminLogin=()=>{};export const adminLogout=()=>{};export const changeAdminPassword=()=>{}; export const observeVendor=()=>{}; export const sellerLogin=()=>{};export const sellerChoosePin=()=>{};export const sellerMigratePin=()=>{};export const sellerRegister=()=>{};export const sellerLogout=()=>{};export const listenStore=()=>{};export const subscribeFcm=()=>{};export const unsubscribeFcm=()=>{};export const notificationsWanted=()=>false;`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const {SessionForm}=module.exports;
const data={stores:[{id:'store-1',name:'Fnac Test',active:true}],sellers:[{id:1,name:'Morgan',storeId:'store-1',departmentId:'tech',active:true},{id:2,name:'Élodie',storeId:'store-1',departmentId:'editorial',active:true}],services:[],departmentsByStore:{'store-1':[{id:'tech',name:'Technique',active:true},{id:'editorial',name:'Éditorial',active:true}]}};
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const field=(tree,label)=>tree.root.findByProps({'aria-label':label});
const click=(tree,label)=>tree.root.findAllByType('button').find(x=>text(x).includes(label));
function apiMock(fn){const old=Object.getOwnPropertyDescriptor(globalThis,'__onboardingApi');Object.defineProperty(globalThis,'__onboardingApi',{configurable:true,value:fn});return ()=>{if(old)Object.defineProperty(globalThis,'__onboardingApi',old);else delete globalThis.__onboardingApi;};}
async function change(tree,label,value){await act(async()=>{field(tree,label).props.onChange({target:{value}});await tick();});}
async function chooseScope(tree){await change(tree,'Votre magasin Fnac','store-1');await change(tree,'Votre département','tech');}

test('Inscription : prénom libre puis deux PIN à 4 chiffres avant création',async()=>{
  const requests=[],submissions=[],restore=apiMock(async(...args)=>{requests.push(args);return {needsPin:true};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async(...args)=>submissions.push(args)}));});
    await chooseScope(tree);await change(tree,'Votre prénom','Alice');
    assert.match(text(tree.toJSON()),/Créez votre profil/);assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);assert.equal(requests.length,0);
    await change(tree,'Votre nouveau code PIN','4829');await change(tree,'Confirmer votre code PIN','4828');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});assert.equal(submissions.length,0);assert.match(text(tree.toJSON()),/ne correspondent pas/);
    await change(tree,'Confirmer votre code PIN','4829');await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,1);assert.deepEqual(submissions[0][0],{storeId:'store-1',departmentId:'tech'});assert.equal(submissions[0][1],'4829');assert.equal(submissions[0][2].mode,'register');assert.equal(submissions[0][2].name,'Alice');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Prénom existant : migration avec ancien PIN, sans nouveau profil',async()=>{
  const requests=[],submissions=[],restore=apiMock(async(path,options)=>{requests.push({path,...options});return {needsPin:false};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async(...args)=>submissions.push(args)}));});await chooseScope(tree);await change(tree,'Votre prénom','morgan');
    assert.equal(requests.length,1);assert.equal(requests[0].body.sellerId,1);assert.match(text(tree.toJSON()),/Profil existant : Morgan/);assert.match(text(tree.toJSON()),/Passez à un PIN de 4 chiffres/);
    assert.equal(field(tree,'Ancien code PIN à 8 chiffres').props.maxLength,8);assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);
    await change(tree,'Ancien code PIN à 8 chiffres','73628519');await change(tree,'Votre nouveau code PIN','7284');await change(tree,'Confirmer votre code PIN','7284');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,1);assert.deepEqual(submissions[0][0],{storeId:'store-1',departmentId:'tech',sellerId:1});assert.equal(submissions[0][2].mode,'migrate');assert.equal(submissions[0][2].oldPin,'73628519');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Profil existant sans PIN : premier code à 4 chiffres ; mauvais département bloqué',async()=>{
  const restore=apiMock(async()=>({needsPin:true}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async()=>{}}));});await chooseScope(tree);await change(tree,'Votre prénom','Elodie');
    assert.match(text(tree.toJSON()),/autre département/);assert.equal(click(tree,'Créer mon profil'),undefined);
    await change(tree,'Votre prénom','Morgan');assert.match(text(tree.toJSON()),/Première connexion/);assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);assert.equal(click(tree,'Créer mon profil'),undefined);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Profil mémorisé : connexion à 4 chiffres sans redemander le prénom',async()=>{
  const submissions=[],restore=apiMock(async()=>({needsPin:false,pinLength:4,pinSalt:'salt-profil-1234567890'}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,initialProfile:{storeId:'store-1',sellerId:1},onSubmit:async(...x)=>submissions.push(x)}));await tick();});
    assert.equal(tree.root.findAllByProps({'aria-label':'Votre prénom'}).length,0);assert.match(text(tree.toJSON()),/VOTRE PROFIL SUR CET APPAREIL/);assert.equal(field(tree,'Code PIN personnel').props.maxLength,4);
    await change(tree,'Code PIN personnel','4829');await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions[0][2].mode,'login');assert.equal(submissions[0][2].pinSalt,'salt-profil-1234567890');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

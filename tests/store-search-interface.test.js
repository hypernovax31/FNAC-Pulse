import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/StoreSearch.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent'});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {StoreSearch}=module.exports;
const rows=[{id:'a',name:'Fnac Labège',directoryStatus:'official'},{id:'b',name:'Fnac Labège',directoryStatus:'historical'},{id:'c',name:'Fnac Toulouse',directoryStatus:'official'}];
const input=tree=>tree.root.findByProps({role:'combobox'});
const key=key=>({key,preventDefault(){},stopPropagation(){}});

test('Recherche magasin : saisie sans sélection, clavier, homonymes et effacement',async()=>{
  const prior=globalThis.document,changes=[],pending=[];globalThis.document={getElementById(){return null;}};let tree;
  function Harness(){const [value,setValue]=React.useState('');return React.createElement(StoreSearch,{stores:rows,value,onUnselectedChange:x=>pending.push(x),onChange:id=>{changes.push(id);setValue(id);}});}
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Harness));});
    assert.equal(input(tree).props.placeholder,'Rechercher un magasin');
    await act(async()=>input(tree).props.onChange({target:{value:'labege'}}));
    assert.deepEqual(changes,[]);assert.equal(pending.at(-1),true);assert.equal(tree.root.findAllByProps({role:'option'}).length,2);
    await act(async()=>input(tree).props.onKeyDown(key('ArrowDown')));await act(async()=>input(tree).props.onKeyDown(key('ArrowDown')));
    assert.match(input(tree).props['aria-activedescendant'],/option-1$/);
    await act(async()=>input(tree).props.onKeyDown(key('Enter')));
    assert.deepEqual(changes,['b']);assert.equal(pending.at(-1),false);assert.equal(input(tree).props.value,'Fnac Labège');assert.equal(input(tree).props['aria-expanded'],false);
    await act(async()=>input(tree).props.onChange({target:{value:'Toulouse'}}));assert.deepEqual(changes,['b','']);assert.equal(tree.root.findAllByProps({role:'option'}).length,1);
    await act(async()=>input(tree).props.onKeyDown(key('Escape')));assert.equal(input(tree).props['aria-expanded'],false);
    await act(async()=>input(tree).props.onFocus());await act(async()=>tree.root.findByProps({role:'option'}).props.onClick());
    assert.equal(changes.at(-1),'c');assert.equal(input(tree).props.value,'Fnac Toulouse');
    await act(async()=>tree.root.findByProps({'aria-label':'Effacer la recherche de magasin'}).props.onClick());
    assert.equal(changes.at(-1),'');assert.equal(input(tree).props.value,'');
    await act(async()=>input(tree).props.onChange({target:{value:'introuvable'}}));assert.equal(tree.root.findAllByProps({role:'option'}).length,0);
  } finally {if(tree)await act(async()=>tree.unmount());if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
});

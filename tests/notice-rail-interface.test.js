import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer,h=React.createElement;
const output=await build({stdin:{contents:`
  export {VisibleFeedback,VisibleFeedbackProvider} from './src/VisibleFeedback.jsx';
  export {AppToastProvider,ModalToastOutlet} from './src/AppToasts.jsx';
`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,external:['react','react-dom','lucide-react'],logLevel:'silent'});
const module={exports:{}};
// React Test Renderer ne monte pas de vrai DOM : cette représentation permet
// néanmoins de vérifier le destinataire et la réaffectation du portail.
const fakeRequire=name=>name==='react-dom'?{createPortal:(child,host)=>h('mock-portal',{host},child)}:require(name);
new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,fakeRequire);
const {VisibleFeedback,VisibleFeedbackProvider,AppToastProvider,ModalToastOutlet}=module.exports;

test('La page partage une colonne réelle entre les toasts et les rappels et les replace dans le dialogue actif',async()=>{
  const rail={nodeType:1,id:'colonne-fictive'};let toggle,setMessage,tree,action=0;
  function Example(){
    const [open,setOpen]=React.useState(false),[message,set]=React.useState('');toggle=setOpen;setMessage=set;
    const items=h('button',{onClick:()=>action++},'Annuler');
    return h(AppToastProvider,{items},h(React.Fragment,null,
      h(VisibleFeedback,{message,tone:'error'}),
      open?h('div',{role:'dialog'},h(ModalToastOutlet)):h('main',null,'Page')));
  }
  try {
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,{placement:'page'},h(Example)),{createNodeMock:element=>element.props.className==='feedback-toast-slot'?rail:null});});
    assert.equal(tree.root.findByType('mock-portal').props.host,rail);
    assert.equal(tree.root.findAllByProps({className:'toast-stack'}).length,1);
    await act(async()=>setMessage('Un rappel visible.'));
    const column=tree.root.findByProps({className:'feedback-rail'});
    assert.equal(column.findAllByProps({'aria-label':'Message'}).length,1);
    await act(async()=>toggle(true));
    assert.equal(tree.root.findAllByType('mock-portal').length,0);
    const dialog=tree.root.findByProps({role:'dialog'}),stack=dialog.findByProps({className:'toast-stack toast-stack-dialog'});
    await act(async()=>stack.findByType('button').props.onClick());assert.equal(action,1);
    await act(async()=>toggle(false));
    assert.equal(tree.root.findByType('mock-portal').props.host,rail);
    assert.equal(tree.root.findAllByProps({className:'toast-stack toast-stack-dialog'}).length,0);
  }finally{if(tree)await act(async()=>tree.unmount());}
});

test('Dans une fenêtre, le message est placé après son en-tête et avant le contenu défilant',async()=>{
  let show,tree;
  function Example(){const [message,set]=React.useState('');show=set;return h('main',null,h(VisibleFeedback,{message}),'Contenu');}
  try {
    const header=h(React.Fragment,null,h('header',null,'Titre'),h('nav',null,'Onglets'));
    await act(async()=>{tree=TestRenderer.create(h(VisibleFeedbackProvider,{header},h(Example)));});
    await act(async()=>show('Modification enregistrée.'));
    const order=tree.toJSON();assert.deepEqual(order.map(node=>node.type),['header','nav','aside','main']);
    assert.equal(order[2].props['aria-live'],'off');
  }finally{if(tree)await act(async()=>tree.unmount());}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceIconKey } from '../src/service-icons.js';

test('Pictogrammes : services historiques, réordonnés et renommés', () => {
  const rows = [
    [{id:1,name:'DMAX',icon:'play'},'tools'],
    [{id:'4',name:'Garantie',icon:'shield'},'hard-hat'],
    [{id:5,name:'FVD',icon:'package'},'shield-plain'],
    [{id:6,name:'FNAC +',icon:'badge'},'id-card'],
    [{id:7,name:'TRC',icon:'repeat'},'dollar'],
    [{id:5,name:'FVD renommée',icon:'package'},'shield-plain'],
    [{id:28,name:' Fnac + ',icon:'other'},'id-card'],
    [{id:29,name:'Garantie',icon:'other'},'hard-hat'],
    [{id:8,name:'Reprise',icon:'refresh'},'refresh'],
    [{id:99,name:'Service personnalisé'},'other'],
  ];
  for(const [service,expected] of rows) {
    const before=JSON.stringify(service);
    assert.equal(serviceIconKey(service),expected);
    assert.equal(JSON.stringify(service),before); // aucun changement du catalogue en base
  }
});

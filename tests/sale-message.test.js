import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saleMessage} from '../src/sale-message.js';

test('Notification de vente : service, prénom et clin d’œil',()=>{
  assert.equal(saleMessage('DMax','Morgan'),'1 DMax fait par Morgan 👍');
  assert.equal(saleMessage('Assu Téléph','Élodie Dupont'),'1 Assu Téléph fait par Élodie 👍');
  assert.equal(saleMessage('  FNAC   +  ',' Jean-Pierre  Martin '),'1 FNAC + fait par Jean-Pierre 👍');
  assert.equal(saleMessage('un service','Un vendeur'),'1 service fait par un vendeur 👍');
  assert.equal(saleMessage(null,undefined),'1 service fait par un vendeur 👍');
});

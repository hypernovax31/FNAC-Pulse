import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saleHistoryRange,saleCorrectionFingerprintInput,MAX_SALE_CORRECTION} from '../src/sale-history.js';

test('Historique : jour, semaine ISO, mois et changements d’année',()=>{
  const today='2026-11-02';
  assert.deepEqual(saleHistoryRange('day','2026-10-31',today),{start:'2026-10-31',end:'2026-10-31'});
  assert.deepEqual(saleHistoryRange('week','2026-11-01',today),{start:'2026-10-26',end:'2026-11-01'});
  assert.deepEqual(saleHistoryRange('month','2026-02-12',today),{start:'2026-02-01',end:'2026-02-28'});
  assert.deepEqual(saleHistoryRange('month','2024-02-29',today),{start:'2024-02-01',end:'2024-02-29'});
  assert.deepEqual(saleHistoryRange('week','2025-12-31',today),{start:'2025-12-29',end:'2026-01-04'});
  for(const [period,date] of [['year','2026-10-01'],['day','2026-02-30'],['day','2026-11-03'],['day','2026-1-01'],['month',null]])
    assert.equal(saleHistoryRange(period,date,today),null);
});

test('Correction : empreinte stable quel que soit l’ordre des ventes cochées',()=>{
  const selection={storeId:'store-1',sellerId:4,period:'week',anchor:'2026-10-31',saleIds:['sale-b','sale-a']};
  assert.equal(saleCorrectionFingerprintInput(selection),saleCorrectionFingerprintInput({...selection,sellerId:'4',saleIds:['sale-a','sale-b']}));
  assert.notEqual(saleCorrectionFingerprintInput(selection),saleCorrectionFingerprintInput({...selection,saleIds:['sale-a']}));
  assert.equal(MAX_SALE_CORRECTION,20);
});

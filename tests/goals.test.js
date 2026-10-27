import { test } from 'node:test';
import assert from 'node:assert/strict';
import {hasGoal, parseGoalInputs, progressFor, validGoalValues} from '../src/goals.js';
import {summarize,periodStarts} from '../src/cloud-stats.js';

test('Objectifs : quantité entière, valeur absente et dépassement',()=>{
  assert.deepEqual(parseGoalInputs({day:'3',week:'',month:'40'}),{day:3,week:null,month:40});
  for(const input of ['0','-1','1.5','10000','1e3','abc'])assert.throws(()=>parseGoalInputs({day:input,week:'',month:''}));
  assert.equal(validGoalValues({day:1,week:2,month:null}),true);
  assert.equal(validGoalValues({day:1,week:2}),false);
  assert.equal(hasGoal({day:null,week:null,month:null}),false);
  assert.equal(hasGoal({day:null,week:10,month:null}),true);
  assert.deepEqual(progressFor(12,10),{actual:12,target:10,percent:100,reached:true});
  assert.deepEqual(progressFor(2,5),{actual:2,target:5,percent:40,reached:false});
  assert.equal(progressFor(2,null),null);
});

test('Objectifs : progression individuelle par service, périodes Paris et corrections',()=>{
  const catalog={sellers:[{id:1,name:'Alice'},{id:2,name:'Morgan'}],services:[{id:1,name:'DMax',active:true},{id:5,name:'FVD',active:true}]};
  const sale=(id,date,seller,service,deletedAt=null,source='sale')=>({id,businessDate:date,sellerId:seller,serviceId:service,createdAt:`${date}T12:00:00.000Z`,deletedAt,source});
  const sales=[sale('1','2026-10-26',1,1),sale('2','2026-10-31',1,1),sale('3','2026-11-01',1,1),sale('4','2026-11-01',1,5),
    sale('5','2026-11-01',2,1),sale('6','2026-11-01',1,1,'deleted'),sale('7','2026-11-02',1,1),sale('8','2026-11-01',1,5,null,'adjustment')];
  const stats=summarize(catalog,sales,1,'2026-11-01');
  assert.deepEqual(periodStarts('2026-11-01'),{day:'2026-11-01',week:'2026-10-26',month:'2026-11-01'});
  const toMap=period=>Object.fromEntries(stats[period].mineByService.map(x=>[x.serviceId,x.count]));
  assert.deepEqual(toMap('day'),{1:1,5:2});assert.deepEqual(toMap('week'),{1:3,5:2});assert.deepEqual(toMap('month'),{1:1,5:2});
  const other=summarize(catalog,sales,2,'2026-11-01');
  assert.deepEqual(other.day.mineByService,[{serviceId:1,count:1}]);
});

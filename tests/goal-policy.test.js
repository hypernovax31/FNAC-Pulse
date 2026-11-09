import {test} from 'node:test';
import assert from 'node:assert/strict';
import {goalMinimum,updateGoalEntry} from '../src/goal-policy.js';

const month=n=>({day:null,week:null,month:n});
const week=n=>({day:null,week:n,month:null});
const empty={day:null,week:null,month:null};

test('Objectifs anciens : aucune attribution rétroactive et liberté de période conservée',()=>{
  const old={day:4,week:12,month:30,revision:'ancienne-revision'};
  assert.equal(goalMinimum(old),null);
  assert.deepEqual(updateGoalEntry(old,week(2)),week(2));
  assert.deepEqual(updateGoalEntry(old,empty),empty);
  assert.equal(old.month,30);assert.equal(old.minimum,undefined);
});

test('Minimum futur : hausse, retour jusqu’au seuil et période verrouillée',()=>{
  let entry=updateGoalEntry(null,month(20),{admin:true});
  assert.deepEqual(entry,{...month(20),minimum:{period:'month',amount:20}});
  for(const invalid of [month(19),week(200),empty,{day:9999,week:9999,month:0}])
    assert.throws(()=>updateGoalEntry(entry,invalid),/minimum et la période/);
  entry=updateGoalEntry(entry,month(50));
  assert.deepEqual(entry,{...month(50),minimum:{period:'month',amount:20},personal:{period:'month',amount:50}});
  entry=updateGoalEntry(entry,month(20));assert.equal(entry.month,20);assert.equal(entry.minimum.amount,20);
  const zero=updateGoalEntry(null,month(0),{admin:true});
  assert.equal(updateGoalEntry(zero,month(0)).month,0);
  assert.throws(()=>updateGoalEntry(zero,empty),/minimum/);
});

test('Admin : conserve une hausse personnelle si la période reste identique',()=>{
  const legacy={day:4,week:12,month:30};
  let entry=updateGoalEntry(legacy,month(20),{admin:true});
  assert.equal(entry.month,30);assert.deepEqual(entry.minimum,{period:'month',amount:20});
  entry=updateGoalEntry(entry,month(40),{admin:true});assert.equal(entry.month,40);assert.equal(entry.personal.amount,30);
  entry=updateGoalEntry(entry,month(15),{admin:true});assert.equal(entry.month,30);assert.equal(entry.minimum.amount,15);
  entry=updateGoalEntry(entry,month(60));assert.equal(entry.month,60);
  entry=updateGoalEntry(entry,month(25),{admin:true});assert.equal(entry.month,60);assert.equal(entry.minimum.amount,25);
  entry=updateGoalEntry(entry,week(8),{admin:true});
  assert.deepEqual(entry,{...week(8),minimum:{period:'week',amount:8}});
  assert.deepEqual(updateGoalEntry(entry,empty,{admin:true}),empty);
});

test('Un minimum mal formé ne peut pas être contourné côté vendeur',()=>{
  const invalid={...month(50),minimum:{period:'month',amount:'20'}};
  assert.throws(()=>updateGoalEntry(invalid,month(1)),/illisible/);
  assert.deepEqual(updateGoalEntry(invalid,month(5),{admin:true}).minimum,{period:'month',amount:5});
});

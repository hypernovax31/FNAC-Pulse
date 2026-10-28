import { test } from 'node:test';
import assert from 'node:assert/strict';
import {goalReference, goalTargets, hasGoal, parseGoalInputs, progressFor, validGoalValues} from '../src/goals.js';
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

function isoDates(year,month) {
  const count=new Date(Date.UTC(year,month,0,12)).getUTCDate();
  return Array.from({length:count},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
}
function plusDays(iso,offset) {
  const date=new Date(`${iso}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}

test('Référence : priorité au mensuel historique, puis semaine et jour',()=>{
  assert.deepEqual(goalReference({day:5,week:20,month:10}),{period:'month',amount:10});
  assert.deepEqual(goalReference({day:5,week:20,month:null}),{period:'week',amount:20});
  assert.deepEqual(goalReference({day:5,week:null,month:null}),{period:'day',amount:5});
  assert.equal(goalReference({day:null,week:null,month:null}),null);
  assert.equal(goalTargets({month:10},'2026-02-30'),null);
  assert.deepEqual(goalTargets({day:5,week:20,month:10},'2026-10-28'),goalTargets({month:10},'2026-10-28'));
});

test('Objectif mensuel : répartition entière exacte, lundi à samedi et mois récurrents',()=>{
  const goal={day:null,week:null,month:10};
  for(const [year,month,activeDays] of [[2026,10,27],[2026,11,25],[2027,2,24],[2028,2,25]]) {
    const dates=isoDates(year,month),quotas=dates.map(date=>goalTargets(goal,date).day);
    assert.equal(quotas.reduce((a,b)=>a+b,0),10,`${year}-${month}`);
    assert.equal(dates.filter(date=>new Date(`${date}T12:00:00Z`).getUTCDay()!==0).length,activeDays);
    assert(quotas.every(n=>Number.isInteger(n)&&n>=0&&n<=1));
    for(const date of dates) {
      const target=goalTargets(goal,date);
      assert.equal(target.month,10);
      if(new Date(`${date}T12:00:00Z`).getUTCDay()===0)assert.equal(target.day,0);
    }
  }
  assert.deepEqual(goalTargets(goal,'2026-10-28'),{day:0,week:2,month:10});
  assert.deepEqual(goalTargets(goal,'2026-11-01'),{day:0,week:2,month:10});
});

test('Objectif quotidien ou hebdomadaire : référence durable et périodes cohérentes',()=>{
  const daily={day:5,week:null,month:null};
  assert.deepEqual(goalTargets(daily,'2026-10-28'),{day:5,week:30,month:135});
  assert.deepEqual(goalTargets(daily,'2026-11-01'),{day:0,week:30,month:125});
  assert.equal(goalTargets(daily,'2026-11-11').day,5); // Férié inclus.
  const weekly={day:null,week:10,month:null};
  for(const monday of ['2026-10-26','2026-11-02','2027-12-27','2028-02-28']) {
    const dates=Array.from({length:7},(_,i)=>plusDays(monday,i));
    assert.equal(dates.map(date=>goalTargets(weekly,date).day).reduce((a,b)=>a+b,0),10);
    assert(dates.every(date=>goalTargets(weekly,date).week===10));
    assert.equal(goalTargets(weekly,dates[6]).day,0);
  }
  for(const [year,month] of [[2026,10],[2026,11],[2028,2]]) {
    const dates=isoDates(year,month),sum=dates.map(date=>goalTargets(weekly,date).day).reduce((a,b)=>a+b,0);
    assert.equal(goalTargets(weekly,dates[0]).month,sum);
  }
});

test('Semaine à cheval sur deux mois : somme exacte des sept objectifs quotidiens',()=>{
  for(const goal of [{month:1},{month:10},{month:9999},{week:3},{day:2}]) {
    for(const monday of ['2026-09-28','2026-10-26','2026-11-30','2027-12-27']) {
      const dates=Array.from({length:7},(_,i)=>plusDays(monday,i));
      const total=dates.map(date=>goalTargets(goal,date).day).reduce((a,b)=>a+b,0);
      for(const date of dates)assert.equal(goalTargets(goal,date).week,total,`${JSON.stringify(goal)} ${date}`);
    }
  }
});

test('Répartition mensuelle exacte sur tous les mois de douze années',()=>{
  for(let year=2024;year<=2035;year++)for(let month=1;month<=12;month++) {
    const dates=isoDates(year,month);
    for(const amount of [1,10,9999]) {
      const targets=dates.map(date=>goalTargets({month:amount},date));
      assert.equal(targets.reduce((sum,target)=>sum+target.day,0),amount,`${year}-${month}, cible ${amount}`);
      assert(targets.every(target=>target.month===amount));
    }
  }
});

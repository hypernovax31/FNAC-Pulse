import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalPeriodInfo, personalGoalCards, personalGoalMetric } from '../src/goal-display.js';

test('Vue des objectifs : une période et uniquement les ventes personnelles du service',()=>{
  const stats={day:{mineByService:[{serviceId:1,count:2},{serviceId:2,count:8}]},week:{mineByService:[{serviceId:1,count:5}]},month:{mineByService:[]}};
  const day=personalGoalMetric(1,'day',4,stats);
  assert.equal(day.count,2);assert.equal(day.target,4);assert.equal(day.state,'pending');assert.equal(day.remaining,2);assert.equal(day.progress.percent,50);
  const week=personalGoalMetric(1,'week',5,stats);
  assert.equal(week.count,5);assert.equal(week.state,'reached');assert.equal(week.remaining,null);assert.equal(week.progress.percent,100);
  const month=personalGoalMetric(1,'month',20,stats);
  assert.equal(month.count,0);assert.equal(month.remaining,20);assert.equal(month.progress.percent,0);
});

test('Vue des objectifs : zéro, ventes indisponibles, cible indisponible et dépassement',()=>{
  const stats={day:{mineByService:[{serviceId:1,count:7}]}};
  const zero=personalGoalMetric(1,'day',0,stats);
  assert.equal(zero.count,7);assert.equal(zero.state,'zero');assert.equal(zero.progress,null);
  const unavailable=personalGoalMetric(1,'week',10,stats);
  assert.equal(unavailable.count,null);assert.equal(unavailable.target,10);assert.equal(unavailable.state,'sales-unavailable');
  const absentTarget=personalGoalMetric(1,'day',null,stats);
  assert.equal(absentTarget.count,7);assert.equal(absentTarget.target,null);assert.equal(absentTarget.state,'target-unavailable');
  const beyond=personalGoalMetric(1,'day',5,stats);
  assert.equal(beyond.count,7);assert.equal(beyond.state,'reached');assert.equal(beyond.progress.percent,100);
});

test('Cartes : cible du jour au moins 1, y compris une cible déjà atteinte ; toutes les cartes aux autres périodes',()=>{
  const services=[{id:1,name:'DMax'},{id:2,name:'Garantie'},{id:3,name:'FVD'},{id:4,name:'Service 4'},{id:5,name:'Service 5'}];
  const goals={s1:{day:2},s2:{month:0},s4:{month:2},s5:{month:50}};
  const day=personalGoalCards(services,goals,'2026-10-29',[1,2,3,4,5],'day');
  assert.deepEqual(day.map(row=>row.service.id),[1,5]);
  assert(day.every(row=>row.targets.day>=1));
  // Atteindre ou dépasser la cible ne modifie pas la liste.
  const reached=personalGoalMetric(1,'day',day[0].targets.day,{day:{mineByService:[{serviceId:1,count:8}]}});
  assert.equal(reached.state,'reached');assert.equal(day[0].service.id,1);
  for(const period of ['week','month']) {
    const rows=personalGoalCards(services,goals,'2026-10-29',[1,2,3,4,5],period);
    assert.deepEqual(rows.map(row=>row.service.id),[1,2,3,4,5]);
    assert.equal(rows[1].targets[period],0);assert.equal(rows[2].configured,false);assert.equal(rows[2].targets,null);
  }
  assert.deepEqual(personalGoalCards(services,goals,'2026-11-01',[1,2,3,4,5],'day'),[]); // dimanche non travaillé
  assert.equal(personalGoalCards(services,{},'2026-10-29',[1,2,3,4,5],'week').length,services.length);
  assert.equal(personalGoalCards(services,{},'2026-10-29',[1,2,3,4,5],'day').length,0);
});

test('Périodes : dates françaises, semaine à cheval sur deux années et date invalide',()=>{
  assert.equal(goalPeriodInfo('day','2026-10-30').range,'vendredi 30 octobre 2026');
  assert.equal(goalPeriodInfo('day','2026-10-30').hint,null);
  assert.match(goalPeriodInfo('week','2026-10-30').hint,/Vos ventes personnelles depuis lundi/);
  assert.match(goalPeriodInfo('month','2026-10-30').hint,/Vos ventes personnelles depuis le 1er du mois/);
  assert.equal(goalPeriodInfo('week','2026-10-30').range,'Du 26 octobre au 1er novembre 2026');
  assert.equal(goalPeriodInfo('week','2026-12-31').range,'Du 28 décembre 2026 au 3 janvier 2027');
  assert.equal(goalPeriodInfo('month','2026-10-30').range,'octobre 2026');
  assert.match(goalPeriodInfo('day','2026-11-01').range,/1er novembre/);
  assert.equal(goalPeriodInfo('day','2026-02-30').validDate,false);
  assert.equal(goalPeriodInfo('week',null).range,'Date indisponible');
});

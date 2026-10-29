import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalGoalMetric } from '../src/goal-display.js';

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

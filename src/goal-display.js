import { progressFor } from './goals.js';

// La vue n'ajoute aucune donnée : elle choisit une période et ne compte que
// les ventes personnelles fournies par les statistiques du vendeur connecté.
export function personalGoalMetric(serviceId,period,target,stats) {
  const rows=stats?.[period]?.mineByService;
  const row=Array.isArray(rows)?rows.find(item=>Number(item.serviceId)===Number(serviceId)):undefined;
  const count=Array.isArray(rows)&&(!row||Number.isFinite(row.count))
    ? Math.max(0,Math.floor(row?.count||0)) : null;
  const validTarget=Number.isInteger(target)&&target>=0?target:null;
  const progress=count!==null&&validTarget>0?progressFor(count,validTarget):null;
  const state=validTarget===null?'target-unavailable':count===null?'sales-unavailable':validTarget===0?'zero':progress.reached?'reached':'pending';
  return {count,target:validTarget,progress,state,remaining:state==='pending'?validTarget-count:null};
}

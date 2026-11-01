import { goalTargets, hasGoal, progressFor } from './goals.js';

// La vue ne compte que les ventes personnelles du vendeur connecté.
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

// Dans chaque période, le filtre porte sur la cible calculée et non sur le
// reste à faire : une cible de 1 ou plus reste visible même une fois atteinte.
// Une cible nulle ou absente est seulement masquée, jamais effacée.
export function personalGoalCards(services,goals,date,workdays,period) {
  return services.map(service=>{
    const entry=goals?.[`s${service.id}`],configured=hasGoal(entry);
    return {service,configured,targets:configured?goalTargets(entry,date,workdays):null};
  }).filter(row=>row.targets?.[period]>=1);
}

export function validGoalDate(iso) {
  if(typeof iso!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return false;
  const result=new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(result.getTime())&&result.toISOString().slice(0,10)===iso;
}

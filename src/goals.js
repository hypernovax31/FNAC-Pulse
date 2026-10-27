// Les objectifs sont récurrents et ne remplacent jamais les ventes enregistrées.
export const GOAL_PERIODS = ['day','week','month'];
export const GOAL_LIMIT = 9999;
export const GOAL_LABELS = {day:'Aujourd’hui',week:'Cette semaine',month:'Ce mois'};

export function validGoalValues(values) {
  return !!values && typeof values==='object' && !Array.isArray(values) && GOAL_PERIODS.every(period =>
    Object.hasOwn(values,period) && (values[period]===null || (Number.isInteger(values[period]) && values[period]>=1 && values[period]<=GOAL_LIMIT))
  );
}
export function parseGoalInputs(inputs) {
  const result={};
  for(const period of GOAL_PERIODS) {
    const raw=String(inputs?.[period]??'').trim();
    if(!raw){result[period]=null;continue;}
    if(!/^\d+$/.test(raw)){throw new Error(`Saisissez un nombre entier entre 1 et ${GOAL_LIMIT}, ou laissez le champ vide.`);}
    result[period]=Number(raw);
  }
  if(!validGoalValues(result))throw new Error(`Saisissez un nombre entier entre 1 et ${GOAL_LIMIT}, ou laissez le champ vide.`);
  return result;
}
export function hasGoal(entry) {return GOAL_PERIODS.some(period=>Number.isInteger(entry?.[period])&&entry[period]>0);}
export function progressFor(count,target) {
  if(!Number.isInteger(target)||target<1)return null;
  const actual=Number.isFinite(count)&&count>0?Math.floor(count):0;
  return {actual,target,percent:Math.min(100,Math.round(actual/target*100)),reached:actual>=target};
}

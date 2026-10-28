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

// Les anciens objectifs pouvaient contenir trois valeurs indépendantes : le
// mensuel est conservé en priorité, puis l'hebdomadaire, puis le quotidien.
// Une nouvelle saisie ne stocke que sa période de référence.
export function goalReference(entry) {
  for(const period of ['month','week','day']) {
    const amount=entry?.[period];
    if(Number.isInteger(amount)&&amount>=1&&amount<=GOAL_LIMIT)return {period,amount};
  }
  return null;
}

function parseDate(iso) {
  if(typeof iso!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;
  const date=new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==iso?null:date;
}
function offsetDate(date,offset) {
  const result=new Date(date);result.setUTCDate(result.getUTCDate()+offset);return result;
}
function monthDays(date) {
  return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)).getUTCDate();
}
function workedThrough(year,month,lastDay) {
  const first=new Date(Date.UTC(year,month,1,12)).getUTCDay();
  const firstSunday=first===0?1:8-first;
  const sundays=lastDay<firstSunday?0:1+Math.floor((lastDay-firstSunday)/7);
  return lastDay-sundays;
}
// Les différences de cumuls arrondis répartissent les entiers régulièrement
// sans en créer ni en perdre, même lorsque l'objectif est inférieur aux jours.
function distributed(amount,slots,index) {
  const cumulative=n=>Math.floor((amount*n+slots/2)/slots);
  return cumulative(index)-cumulative(index-1);
}
function plannedForDate(reference,date) {
  const weekday=date.getUTCDay();
  if(weekday===0)return 0; // Dimanche : hors planning, même si une vente est saisie.
  if(reference.period==='day')return reference.amount;
  if(reference.period==='week')return distributed(reference.amount,6,weekday);
  const year=date.getUTCFullYear(),month=date.getUTCMonth(),length=monthDays(date);
  const slots=workedThrough(year,month,length),index=workedThrough(year,month,date.getUTCDate());
  return distributed(reference.amount,slots,index);
}

// Les semaines vont du lundi au dimanche ; une semaine à cheval sur deux mois
// additionne les quotas prévus dans chacun d'eux. Tous les jours fériés restent
// comptés du lundi au samedi, conformément au planning choisi.
export function goalTargets(entry,isoDate) {
  const reference=goalReference(entry),date=parseDate(isoDate);
  if(!reference||!date)return null;
  const start=offsetDate(date,-((date.getUTCDay()+6)%7));
  let week=0,month=0;
  for(let i=0;i<7;i++)week+=plannedForDate(reference,offsetDate(start,i));
  for(let day=1;day<=monthDays(date);day++) {
    const item=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),day,12));
    month+=plannedForDate(reference,item);
  }
  return {day:plannedForDate(reference,date),week,month};
}
export function progressFor(count,target) {
  if(!Number.isInteger(target)||target<1)return null;
  const actual=Number.isFinite(count)&&count>0?Math.floor(count):0;
  return {actual,target,percent:Math.min(100,Math.round(actual/target*100)),reached:actual>=target};
}

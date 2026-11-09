import {distributeWeighted,goalDayWeight} from './goal-distribution.js';

// Les objectifs sont récurrents et ne remplacent jamais les ventes enregistrées.
export const GOAL_PERIODS = ['day','week','month'];
export const GOAL_LIMIT = 9999;
export const GOAL_LABELS = {day:'Aujourd’hui',week:'Cette semaine',month:'Ce mois'};
// JavaScript : dimanche = 0, lundi = 1 … samedi = 6 ; affichage du lundi au dimanche.
export const DEFAULT_WORKDAYS = Object.freeze([1,2,3,4,5]);
export const WORKDAY_ORDER = Object.freeze([1,2,3,4,5,6,0]);
export const WORKDAY_NAMES = Object.freeze({1:'lundi',2:'mardi',3:'mercredi',4:'jeudi',5:'vendredi',6:'samedi',0:'dimanche'});
export function validWorkdays(days) {
  return Array.isArray(days)&&days.length>=1&&days.length<=7&&new Set(days).size===days.length&&days.every(day=>Number.isInteger(day)&&day>=0&&day<=6);
}
export function normalizeWorkdays(days) {
  return validWorkdays(days)?WORKDAY_ORDER.filter(day=>days.includes(day)):[...DEFAULT_WORKDAYS];
}
export function workdaysLabel(days) {
  return normalizeWorkdays(days).map(day=>WORKDAY_NAMES[day]).join(', ');
}

export function validGoalValues(values) {
  return !!values && typeof values==='object' && !Array.isArray(values) && GOAL_PERIODS.every(period =>
    Object.hasOwn(values,period) && (values[period]===null || (Number.isInteger(values[period]) && values[period]>=0 && values[period]<=GOAL_LIMIT))
  );
}
export function parseGoalInputs(inputs) {
  const result={};
  for(const period of GOAL_PERIODS) {
    const raw=String(inputs?.[period]??'').trim();
    if(!raw){result[period]=null;continue;}
    if(!/^\d+$/.test(raw)){throw new Error(`Saisissez un nombre entier entre 0 et ${GOAL_LIMIT}, ou laissez le champ vide.`);}
    result[period]=Number(raw);
  }
  if(!validGoalValues(result))throw new Error(`Saisissez un nombre entier entre 0 et ${GOAL_LIMIT}, ou laissez le champ vide.`);
  return result;
}
export function hasGoal(entry) {return GOAL_PERIODS.some(period=>Number.isInteger(entry?.[period])&&entry[period]>=0&&entry[period]<=GOAL_LIMIT);}

// Les anciens objectifs pouvaient contenir trois valeurs indépendantes : le
// mensuel est conservé en priorité, puis l'hebdomadaire, puis le quotidien.
// Une nouvelle saisie ne stocke que sa période de référence.
export function goalReference(entry) {
  for(const period of ['month','week','day']) {
    const amount=entry?.[period];
    if(Number.isInteger(amount)&&amount>=0&&amount<=GOAL_LIMIT)return {period,amount};
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
function workedThrough(year,month,lastDay,workdays) {
  const first=new Date(Date.UTC(year,month,1,12)).getUTCDay();
  return workdays.reduce((count,weekday)=>{
    const firstOccurrence=1+(weekday-first+7)%7;
    return count+(lastDay<firstOccurrence?0:1+Math.floor((lastDay-firstOccurrence)/7));
  },0);
}
// Les allocations sont déterministes et bornées en mémoire : un changement
// de planning ou de cible produit une autre clé, sans modifier les données.
const planCache=new Map();
function cachedPlan(key,create) {
  if(planCache.has(key))return planCache.get(key);
  const result=create();if(planCache.size>=1024)planCache.delete(planCache.keys().next().value);
  planCache.set(key,result);return result;
}
function weeklyPlan(reference,workdays) {
  return cachedPlan(`w:${reference.amount}:${workdays.join(',')}`,
    ()=>distributeWeighted(reference.amount,workdays.map(goalDayWeight)));
}
function monthlyPlan(reference,date,workdays) {
  const year=date.getUTCFullYear(),month=date.getUTCMonth(),length=monthDays(date);
  return cachedPlan(`m:${reference.amount}:${year}:${month}:${workdays.join(',')}`,()=>{
    const weights=Array.from({length},(_,i)=>{
      const day=new Date(Date.UTC(year,month,i+1,12)).getUTCDay();
      return workdays.includes(day)?goalDayWeight(day):0;
    });
    return distributeWeighted(reference.amount,weights);
  });
}
function plannedForDate(reference,date,workdays) {
  const weekday=date.getUTCDay(),indexInWeek=workdays.indexOf(weekday);
  if(indexInWeek<0)return 0; // Jour hors du planning choisi, dimanche compris si décoché.
  // Une cible par jour travaillé reste une quantité fixe par jour ; on pondère
  // les totaux de référence hebdomadaires et mensuels, sans en changer la somme.
  if(reference.period==='day')return reference.amount;
  if(reference.period==='week')return weeklyPlan(reference,workdays)[indexInWeek];
  return monthlyPlan(reference,date,workdays)[date.getUTCDate()-1];
}
// Calcul mensuel direct équivalent à la somme des jours.
function monthTotal(reference,date,workdays) {
  if(reference.period==='month')return reference.amount;
  const year=date.getUTCFullYear(),month=date.getUTCMonth(),length=monthDays(date);
  if(reference.period==='day')return reference.amount*workedThrough(year,month,length,workdays);
  const plan=weeklyPlan(reference,workdays);
  return workdays.reduce((sum,weekday,index)=>sum+workedThrough(year,month,length,[weekday])*plan[index],0);
}
export function monthlyGoalTotal(entry,isoDate,days=DEFAULT_WORKDAYS) {
  const reference=goalReference(entry),date=parseDate(isoDate);
  return reference&&date?monthTotal(reference,date,normalizeWorkdays(days)):null;
}

// Les semaines vont du lundi au dimanche ; une semaine à cheval sur deux mois
// additionne les quotas des deux mois. Les jours habituels sont propres au
// vendeur, dimanche compris si sélectionné ; les jours fériés restent inclus.
export function goalTargets(entry,isoDate,days=DEFAULT_WORKDAYS) {
  const reference=goalReference(entry),date=parseDate(isoDate),workdays=normalizeWorkdays(days);
  if(!reference||!date)return null;
  const start=offsetDate(date,-((date.getUTCDay()+6)%7));
  let week=0;
  for(let i=0;i<7;i++)week+=plannedForDate(reference,offsetDate(start,i),workdays);
  return {day:plannedForDate(reference,date,workdays),week,month:monthTotal(reference,date,workdays)};
}
export function progressFor(count,target) {
  if(!Number.isInteger(target)||target<1)return null;
  const actual=Number.isFinite(count)&&count>0?Math.floor(count):0;
  return {actual,target,percent:Math.min(100,Math.round(actual/target*100)),reached:actual>=target};
}

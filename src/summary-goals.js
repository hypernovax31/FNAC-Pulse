import {monthlyGoalTotal,hasGoal,normalizeWorkdays} from './goals.js';
import {sellerDepartmentId} from './departments.js';

function dateAt(iso) {
  if(typeof iso!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw new Error('Date invalide.');
  const date=new Date(`${iso}T12:00:00Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==iso)throw new Error('Date invalide.');
  return date;
}
const iso=date=>date.toISOString().slice(0,10);
function addDays(date,amount) {const d=new Date(date);d.setUTCDate(d.getUTCDate()+amount);return d;}
function datesInMonth(key) {
  const [year,month]=key.split('-').map(Number),count=new Date(Date.UTC(year,month,0,12)).getUTCDate();
  return Array.from({length:count},(_,i)=>new Date(Date.UTC(year,month-1,i+1,12)));
}
// Répartition entière, régulière et déterministe : une différence de cumuls
// arrondis garantit que tous les jours additionnés valent exactement le mensuel.
export function distributeWeighted(total,weights) {
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(weights)||weights.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Répartition invalide.');
  const weight=weights.reduce((sum,n)=>sum+n,0);
  if(!weight)return weights.map(()=>0);
  let prior=0,cumulative=0;
  return weights.map(n=>{cumulative+=n;const next=Math.floor((total*cumulative+weight/2)/weight);const part=next-prior;prior=next;return part;});
}

// Ne renvoie que des totaux par service et par périmètre, jamais les objectifs
// ou les jours individuels. Les mois sont répartis selon le nombre de vendeurs
// habituellement présents chaque jour ; les jours fériés restent inclus.
export function summaryGoals(sellers,services,departments,isoDate) {
  const today=dateAt(isoDate),start=addDays(today,-((today.getUTCDay()+6)%7));
  const week=Array.from({length:7},(_,i)=>addDays(start,i));
  const monthKeys=[...new Set([iso(today).slice(0,7),...week.map(d=>iso(d).slice(0,7))])];
  // Les dates et les cibles mensuelles sont préparées une seule fois : le
  // même vendeur contribue ensuite au magasin et à son département.
  const months=Object.fromEntries(monthKeys.map(key=>{
    const dates=datesInMonth(key);return [key,{dates,weekdays:dates.map(d=>d.getUTCDay()),middle:iso(dates[14])}];
  }));
  const prepared=(sellers||[]).filter(s=>s.active!==false&&s.active!==0).map(s=>{
    const workdays=normalizeWorkdays(s.workdays),targets={};
    for(const service of services||[]) {
      const key=`s${service.id}`,entry=s.goals?.[key];
      if(hasGoal(entry))targets[key]=Object.fromEntries(monthKeys.map(month=>[month,monthlyGoalTotal(entry,months[month].middle,workdays)]));
    }
    return {...s,workdays,targets};
  });
  const resultFor=people=>{
    const byService={},weights=Object.fromEntries(monthKeys.map(month=>[month,months[month].weekdays.map(day=>people.reduce((n,s)=>n+(s.workdays.includes(day)?1:0),0))]));
    for(const service of services||[]) {
      const key=`s${service.id}`,configured=people.filter(s=>s.targets[key]);
      if(!configured.length){byService[key]={day:null,week:null,month:null,configured:0,sellers:people.length};continue;}
      const plans={};
      for(const month of monthKeys) {
        const total=configured.reduce((sum,s)=>sum+(s.targets[key][month]??0),0);
        plans[month]={total,days:distributeWeighted(total,weights[month])};
      }
      const daily=d=>plans[iso(d).slice(0,7)].days[d.getUTCDate()-1];
      byService[key]={day:daily(today),week:week.reduce((sum,d)=>sum+daily(d),0),month:plans[iso(today).slice(0,7)].total,configured:configured.length,sellers:people.length};
    }
    return {byService};
  };
  const groups={};for(const dept of departments||[])groups[dept.id]=resultFor(prepared.filter(s=>sellerDepartmentId(s)===dept.id));
  return {date:isoDate,store:resultFor(prepared),departments:groups};
}

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

// Le filtre du jour porte sur la cible calculée, et non sur le reste à faire :
// un objectif atteint reste visible. Les semaines et les mois gardent tous les
// services actifs, même sans cible enregistrée ou avec une cible à zéro.
export function personalGoalCards(services,goals,date,workdays,period) {
  return services.map(service=>{
    const entry=goals?.[`s${service.id}`],configured=hasGoal(entry);
    return {service,configured,targets:configured?goalTargets(entry,date,workdays):null};
  }).filter(row=>period!=='day'||row.targets?.day>=1);
}

const periodCopy={
  day:{title:'Objectifs du jour',hint:'Vos ventes personnelles · Cibles du jour de 1 ou plus, même atteintes.'},
  week:{title:'Objectifs de la semaine',hint:'Vos ventes personnelles depuis lundi jusqu’à aujourd’hui. Tous les services sont affichés.'},
  month:{title:'Objectifs du mois',hint:'Vos ventes personnelles depuis le 1er du mois jusqu’à aujourd’hui. Tous les services sont affichés.'},
};
function dateFromIso(iso) {
  if(typeof iso!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;
  const result=new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(result.getTime())&&result.toISOString().slice(0,10)===iso?result:null;
}
const longDate=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const shortDate=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',timeZone:'UTC'});
const dateWithYear=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const monthYear=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'});
const firstDay=value=>value.replace(/(^|\s)1(?=\s)/,(_,space)=>`${space}1er`);

export function goalPeriodInfo(period,iso) {
  const copy=periodCopy[period]||periodCopy.day,date=dateFromIso(iso);
  if(!date)return {...copy,range:'Date indisponible',validDate:false};
  let range;
  if(period==='week') {
    const start=new Date(date);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    range=start.getUTCFullYear()===end.getUTCFullYear()
      ?`Du ${firstDay(shortDate.format(start))} au ${firstDay(dateWithYear.format(end))}`
      :`Du ${firstDay(dateWithYear.format(start))} au ${firstDay(dateWithYear.format(end))}`;
  } else range=period==='month'?monthYear.format(date):firstDay(longDate.format(date));
  return {...copy,range,validDate:true};
}

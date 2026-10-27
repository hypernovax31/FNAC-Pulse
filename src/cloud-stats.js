import { comparePeople, priorityServiceId } from './catalog.js';

export function parisToday(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function periodStarts(date) {
  const d=new Date(`${date}T12:00:00Z`),offset=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-offset);
  return {day:date,week:d.toISOString().slice(0,10),month:`${date.slice(0,7)}-01`};
}
export function earliestDate(date) {const p=periodStarts(date);return p.week<p.month?p.week:p.month;}
export function summarize(catalog,sales,sellerId,date=parisToday()) {
  const starts=periodStarts(date),byService=new Map(catalog.services.map(x=>[Number(x.id),x]));
  const bySeller=new Map(catalog.sellers.map(x=>[Number(x.id),x]));
  const dmaxId=priorityServiceId(catalog.services,'dmax'),fvdId=priorityServiceId(catalog.services,'fvd');
  const live=sales.filter(s=>!s.deletedAt&&s.businessDate<=date);
  function period(start) {
    const data=live.filter(s=>s.businessDate>=start),serviceCounts=new Map(),sellerCounts=new Map();
    for(const s of data) {
      const sid=Number(s.serviceId),uid=Number(s.sellerId);
      serviceCounts.set(sid,(serviceCounts.get(sid)||0)+1);
      const counts=sellerCounts.get(uid)||{count:0,dmax:0,fvd:0};
      counts.count++;
      if(dmaxId!==null&&sid===dmaxId)counts.dmax++;
      if(fvdId!==null&&sid===fvdId)counts.fvd++;
      sellerCounts.set(uid,counts);
    }
    const services=catalog.services.filter(s=>s.active||serviceCounts.has(Number(s.id))).map(s=>({id:s.id,name:s.name,icon:s.icon,count:serviceCounts.get(Number(s.id))||0}));
    const sellers=[...sellerCounts].map(([id,counts])=>({id,name:bySeller.get(id)?.name||'Vendeur',...counts}))
      .sort((a,b)=>b.count-a.count||b.dmax-a.dmax||b.fvd-a.fvd||comparePeople(a,b));
    return {total:data.length,byService:services,bySeller:sellers,start,end:date};
  }
  const day=period(starts.day),mineMap=new Map();
  for(const s of live)if(s.businessDate===date&&Number(s.sellerId)===Number(sellerId))mineMap.set(Number(s.serviceId),(mineMap.get(Number(s.serviceId))||0)+1);
  const mine=[...mineMap].map(([serviceId,count])=>({serviceId,count}));
  const activity=live.filter(s=>s.businessDate===date&&s.source==='sale').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,6)
    .map(s=>({id:s.id,sellerId:s.sellerId,sellerName:bySeller.get(Number(s.sellerId))?.name||'Vendeur',serviceName:byService.get(Number(s.serviceId))?.name||'Service',createdAt:s.createdAt}));
  return {day,week:period(starts.week),month:period(starts.month),mine,mineTotal:mine.reduce((n,x)=>n+x.count,0),leaderboard:day.bySeller.slice(0,3),activity};
}

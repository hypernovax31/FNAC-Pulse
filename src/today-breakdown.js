// Détail cohérent avec les deux compteurs du bloc Aujourd’hui : le vendeur
// conserve ses ventes de tous ses départements du jour, l'équipe correspond
// uniquement au département actuellement sélectionné.
export function todayBreakdown(stats,services=[],scope='mine') {
  const names=new Map();
  for(const service of [...services,...(stats?.day?.byService||[]),...(stats?.summary?.store?.day?.byService||[])])
    if(service?.id!=null)names.set(Number(service.id),service.name||`Service n° ${service.id}`);
  const source=scope==='team'?stats?.day?.byService:stats?.day?.mineByService;
  if(!Array.isArray(source))return [];
  return source.map(row=>({id:Number(scope==='team'?row.id:row.serviceId),count:Number(row.count),
    name:names.get(Number(scope==='team'?row.id:row.serviceId))||`Service n° ${scope==='team'?row.id:row.serviceId}`}))
    .filter(row=>Number.isSafeInteger(row.id)&&row.id>0&&Number.isInteger(row.count)&&row.count>0)
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'fr',{sensitivity:'base',numeric:true}));
}

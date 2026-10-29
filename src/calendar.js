const MONTHS=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

// ISO 8601 : semaine débutant le lundi ; la semaine 1 contient le 4 janvier.
export function calendarChip(date) {
  const day=new Date(`${date}T12:00:00Z`);
  if(!Number.isFinite(day.getTime()))return {week:'—',weekday:'—',month:'—',day:'—'};
  const isoDay=new Date(day);
  isoDay.setUTCDate(isoDay.getUTCDate()+4-(isoDay.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(isoDay.getUTCFullYear(),0,1,12));
  const week=Math.ceil((((isoDay-yearStart)/86400000)+1)/7);
  return {week:`S${week}`,weekday:DAYS[day.getUTCDay()],month:MONTHS[day.getUTCMonth()],day:String(day.getUTCDate())};
}

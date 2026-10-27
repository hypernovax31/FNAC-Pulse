// Ces identifiants historiques sont stables même si le magasin réordonne
// ou renomme un service. Le catalogue et les ventes ne sont pas modifiés.
const builtInIcons = {1:'tools', 4:'hard-hat', 5:'shield-plain', 6:'id-card', 7:'dollar'};
const names = {dmax:'tools', garantie:'hard-hat', fvd:'shield-plain', 'fnac+':'id-card', trc:'dollar'};

export function serviceIconKey(service) {
  const name = String(service?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9+]/g,'');
  return builtInIcons[String(service?.id)] || names[name] || service?.icon || 'other';
}

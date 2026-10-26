export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const response = await fetch(path, {
    method, signal,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization:`Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new Error(result.error || 'Une erreur est survenue. Réessayez.');
  return result;
}
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export function dateLabel(iso, options = { weekday:'long', day:'numeric', month:'long' }) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', {timeZone:'Europe/Paris', ...options}).format(new Date(`${iso}T12:00:00Z`));
}
export function timeLabel(iso) {
  return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
}
export function kmBetween(a,b,c,d) {
  const rad = n => n*Math.PI/180;
  const x=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

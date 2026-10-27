export const THEME_KEY='fnac-pulse-theme-v1';
export function readTheme() {
  try {const value=localStorage.getItem(THEME_KEY);return ['light','dark','system'].includes(value)?value:'system';}
  catch {return 'system';}
}
export function applyTheme(mode) {
  const dark=mode==='dark'||(mode==='system'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.documentElement.style.colorScheme=dark?'dark':'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#171915':'#eab900');
}

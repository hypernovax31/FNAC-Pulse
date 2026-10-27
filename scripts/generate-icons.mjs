// Recrée les icônes à partir des tracés Fnac de public/fnac.svg.
// Nécessite ImageMagick : les PNG générés sont enregistrés dans le dépôt.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const logo = readFileSync(join(root, 'public/fnac.svg'), 'utf8').match(/<g>[\s\S]*<\/g>/)?.[0];
if (!logo) throw new Error('Tracés du logo Fnac introuvables.');
// Segments pleins arrondis : compatibles aussi avec le moteur SVG d'ImageMagick.
const points = [[108,426],[187,426],[211,383],[242,466],[272,409],[294,426],[404,426]];
const lines = points.slice(1).map(([x,y], i) => {
  const [px,py] = points[i], dx = x-px, dy = y-py, length = Math.hypot(dx,dy);
  const nx = -dy/length*5, ny = dx/length*5;
  return `<path d="M${px+nx} ${py+ny} L${x+nx} ${y+ny} L${x-nx} ${y-ny} L${px-nx} ${py-ny} Z"/>`;
}).join('');
const caps = points.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('');
const artwork = `<g transform="translate(106 43) scale(0.60108)">${logo}</g>
  <g fill="#25251f">${lines}${caps}</g>`;
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#fff"/>
  ${content}
</svg>\n`;
const icons = join(root, 'public/icons');
const temp = mkdtempSync(join(tmpdir(), 'fnac-pulse-icons-'));
try {
  const source = svg(artwork);
  const master = join(temp, 'icon.svg');
  const maskable = join(temp, 'maskable.svg');
  writeFileSync(join(icons, 'icon-source.svg'), source);
  writeFileSync(master, source);
  // Le contenu reste dans la zone centrale de sécurité des icônes maskables.
  writeFileSync(maskable, svg(`<g transform="translate(71.68 71.68) scale(.72)">${artwork}</g>`));
  for (const [input, name, size] of [
    [master, 'icon-192-v2.png', 192], [master, 'icon-512-v2.png', 512],
    [master, 'apple-touch-icon-v2.png', 180], [maskable, 'icon-maskable-512-v2.png', 512],
  ]) {
    execFileSync('magick', ['-background', 'white', '-density', '144', input, '-resize', `${size}x${size}`, '-alpha', 'off', `PNG24:${join(icons, name)}`]);
  }
  // URL conservées pour le Worker en production et les anciennes notifications.
  copyFileSync(join(icons, 'icon-192-v2.png'), join(icons, 'icon-192.png'));
  copyFileSync(join(icons, 'icon-512-v2.png'), join(icons, 'icon-512.png'));
} finally { rmSync(temp, {recursive:true, force:true}); }

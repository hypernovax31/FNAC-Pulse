// Recrée les icônes à partir du visuel approuvé par l'équipe, sans le redessiner.
// Nécessite ImageMagick : les PNG générés sont enregistrés dans le dépôt.
import {execFileSync} from 'node:child_process';
import {copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'artwork/fnac-pulse-approved.png');
const icons=join(root,'public/icons');
for(const [name,size] of [
  ['icon-192-v3.png',192],['icon-512-v3.png',512],['apple-touch-icon-v3.png',180],
]) {
  execFileSync('magick',[source,'-filter','Lanczos','-resize',`${size}x${size}!`,'-strip','-alpha','off',`PNG24:${join(icons,name)}`]);
}
// Les icônes Android maskables peuvent être découpées : on ramène le visuel à
// 358 px dans la zone sûre de 512 px, en prolongeant les pixels jaunes des bords.
execFileSync('magick',[source,'-filter','Lanczos','-resize','358x358!',
  '-virtual-pixel','edge','-set','option:distort:viewport','512x512-77-77',
  '-distort','SRT','0','+repage','-strip','-alpha','off',`PNG24:${join(icons,'icon-maskable-512-v3.png')}`]);
// URLs maintenues pour les anciennes notifications et versions déjà installées.
copyFileSync(join(icons,'icon-192-v3.png'),join(icons,'icon-192.png'));
copyFileSync(join(icons,'icon-512-v3.png'),join(icons,'icon-512.png'));

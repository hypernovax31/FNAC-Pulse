import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const vite=process.platform==='win32'?'node_modules/.bin/vite.cmd':'node_modules/.bin/vite';
const result=spawnSync(vite,['build','--base=/FNAC-Pulse/'],{stdio:'inherit',env:{...process.env,VITE_BACKEND:'cloud'}});
if(result.status!==0)process.exit(result.status||1);
await build({entryPoints:['src/sw-cloud.js'],outfile:'dist/sw.js',bundle:true,format:'iife',platform:'browser',target:'es2020',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
console.log('Service worker Firebase inclus dans dist/sw.js.');

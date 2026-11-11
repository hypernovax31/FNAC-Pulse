import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const site='https://pulse.ayme.cc/';

test('Compilation Pages : ressources internes relatives et présentes à la racine', {timeout:150000},()=>{
  assert.ok(fs.statSync(path.join(root,'index.html')).isFile(),'index.html doit être à la racine du dépôt');
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pages-'));
  try {
    // Une compilation réelle, isolée du dist/ éventuel et des variables de production.
    for(const item of ['index.html','package.json','vite.config.js','scripts','src','public'])
      fs.cpSync(path.join(root,item),path.join(project,item),{recursive:true});
    fs.symlinkSync(path.join(root,'node_modules'),path.join(project,'node_modules'),process.platform==='win32'?'junction':'dir');
    const result=spawnSync(process.execPath,['scripts/build-pages.mjs'],{
      cwd:project,encoding:'utf8',timeout:140000,maxBuffer:4*1024*1024,
      env:{...process.env,VITE_WORKER_URL:'https://worker.example.test',VITE_FIREBASE_VAPID_KEY:'CLE-PUBLIQUE-FICTIVE'},
    });
    assert.equal(result.status,0,`Échec de compilation : ${result.error||result.stderr||result.stdout}`);
    const dist=path.join(project,'dist'),html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
    const exists=url=>fs.existsSync(path.join(dist,decodeURIComponent(new URL(url).pathname).replace(/^\//,'')));
    const references=[...html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
    assert.ok(references.some(ref=>/^\.\/assets\/index-.*\.js$/.test(ref)),'module principal');
    assert.ok(references.some(ref=>/^\.\/assets\/index-.*\.css$/.test(ref)),'feuille de style');
    assert.ok(references.includes('./manifest.webmanifest'),'manifest');
    assert.ok(references.includes('./icons/icon-192-v3.png'),'icône');
    for(const ref of references){
      assert.ok(ref.startsWith('./'),`ressource non relative : ${ref}`);
      assert.ok(exists(new URL(ref,site)),`ressource absente : ${ref}`);
    }
    assert.doesNotMatch(html,/\/FNAC-Pulse\//);
    assert.match(html,/script\.src\s*=\s*['"]\.\/auth-action-v1\.js\?v=6['"]/);
    assert.ok(exists(new URL('./auth-action-v1.js?v=6',site)),'module de la page d’action');

    const manifestUrl=new URL('./manifest.webmanifest',site);
    const manifest=JSON.parse(fs.readFileSync(path.join(dist,'manifest.webmanifest'),'utf8'));
    assert.equal(new URL(manifest.start_url,manifestUrl).href,site);
    assert.equal(new URL(manifest.scope,manifestUrl).href,site);
    for(const icon of manifest.icons)assert.ok(exists(new URL(icon.src,manifestUrl)),`icône absente : ${icon.src}`);
    for(const resource of ['./sw.js','./fnac.svg','./FNAC%20-%20SIGNATURE.mp3'])
      assert.ok(exists(new URL(resource,site)),`ressource absente : ${resource}`);

    for(const name of fs.readdirSync(path.join(dist,'assets'))){
      const file=path.join(dist,'assets',name),source=fs.readFileSync(file,'utf8');
      if(name.endsWith('.js')){
        assert.doesNotMatch(source,/\/FNAC-Pulse\/(?:assets|icons|manifest|sw\.js|FNAC%20)/);
        for(const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(["'])(\.[^"']+)\1/g))
          assert.ok(exists(new URL(match[2],new URL(`./assets/${name}`,site))),`import manquant : ${name} → ${match[2]}`);
      } else if(name.endsWith('.css')) {
        assert.doesNotMatch(source,/\/FNAC-Pulse\//);
        for(const match of source.matchAll(/url\(([^)]*)\)/g)){
          const ref=match[1].trim().replace(/^['"]|['"]$/g,'');
          if(!ref||/^(?:data:|https?:|#)/i.test(ref))continue;
          assert.ok(exists(new URL(ref,new URL(`./assets/${name}`,site))),`ressource CSS manquante : ${ref}`);
        }
      }
    }
    assert.deepEqual(fs.readFileSync(path.join(dist,'auth-action-v1.js')),fs.readFileSync(path.join(root,'public/auth-action-v1.js')),'le gestionnaire et ses URL externes ne sont pas réécrits');
  } finally {fs.rmSync(project,{recursive:true,force:true});}
});

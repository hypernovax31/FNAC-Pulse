import { Parser } from 'htmlparser2';

export const FNAC_DIRECTORY_URL='https://www.fnac.com/localiser-magasin-fnac/w-4';
export class DirectorySourceError extends Error {
  constructor(code) {super(code);this.code=code;}
}
const bad=code=>{throw new DirectorySourceError(code);};
const clean=text=>String(text||'').replace(/\s+/g,' ').trim();
const generic=/^(?:voir|consulter|découvrir|découvrez|plus d['’]?informations?|en savoir|détails|choisir|itinéraire|fiche du magasin|magasin|horaires)(?:\b|$)/i;

// Extrait les liens de fiches Fnac et leur texte dans la liste visible. Les
// liens génériques « Voir la fiche du magasin » de la carte sont ignorés.
// Un changement de format, un captcha ou une réponse partielle est refusé.
export function parseFnacDirectory(html) {
  if(typeof html!=='string'||html.length<1000||html.length>8_000_000)bad('invalid');
  let ignored=0,anchor=null;const visible=[],found=new Map();
  const parser=new Parser({
    onopentag(tag,attrs) {
      if(tag==='script'||tag==='style'||tag==='noscript')ignored++;
      if(!ignored&&tag==='a'&&attrs.href) {
        let url;try{url=new URL(attrs.href,FNAC_DIRECTORY_URL);}catch{return;}
        const match=url.pathname.match(/\/cl(\d{1,9})\/w-4\/?$/i);
        if(url.protocol==='https:'&&(url.hostname==='www.fnac.com'||url.hostname==='fnac.com')&&match)anchor={fnacId:`cl${match[1]}`,text:''};
      }
    },
    ontext(text) {
      if(ignored)return;
      if(visible.length<150000)visible.push(text);
      if(anchor&&anchor.text.length<300)anchor.text+=text;
    },
    onclosetag(tag) {
      if(tag==='a'&&anchor) {
        const text=clean(anchor.text);
        if(text&&!generic.test(text)) {
          const short=clean(text.replace(/^fnac\s+/i,''));
          if(short.length<2||short.length>115||/[<>\u0000-\u001f]/.test(short))bad('invalid');
          const name=`Fnac ${short}`;
          const previous=found.get(anchor.fnacId);
          if(previous&&previous!==name)bad('ambiguous');
          found.set(anchor.fnacId,name);
        }
        anchor=null;
      }
      if((tag==='script'||tag==='style'||tag==='noscript')&&ignored>0)ignored--;
    },
  },{decodeEntities:true});
  try{parser.write(html);parser.end();}catch(e){if(e instanceof DirectorySourceError)throw e;bad('invalid');}
  const text=clean(visible.join(' '));
  if(!/trouver\s+(?:un\s+)?magasin\s+fnac/i.test(text))bad('invalid');
  const countMatch=text.match(/\b(\d{1,4})\s+magasins\b/i);
  const declared=countMatch?Number(countMatch[1]):0;
  const entries=[...found].map(([fnacId,name])=>({fnacId,name}));
  // L'annuaire actuel compte deux indications régionales sans lien de fiche.
  if(declared<50||declared>500||entries.length>declared||entries.length<declared-2)bad('incomplete');
  return {declared,entries};
}

export function assertDirectoryCoverage(entries,existingStores) {
  const old=new Set((existingStores||[]).filter(s=>s.fnacId&&s.directoryStatus==='official').map(s=>s.fnacId));
  const incoming=new Set(entries.map(s=>s.fnacId));
  if(old.size>=50&&[...old].filter(id=>incoming.has(id)).length<Math.ceil(old.size*.9))bad('incomplete');
}

export async function fetchFnacDirectory(fetcher=fetch) {
  let res;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
    res=await fetcher(FNAC_DIRECTORY_URL,{signal:controller.signal,headers:{'User-Agent':'Fnac-Pulse/1.0 (mise à jour mensuelle des magasins)'}});
    if(!res.ok)bad([401,403,429].includes(res.status)?'blocked':'unavailable');
    if(res.url) {
      const u=new URL(res.url);
      if(u.protocol!=='https:'||!['www.fnac.com','fnac.com'].includes(u.hostname))bad('invalid');
    }
    const size=Number(res.headers.get('content-length')||0);
    if(size>8_000_000)bad('invalid');
    let html='';
    if(res.body) {
      const reader=res.body.getReader(),decoder=new TextDecoder();let total=0;
      while(true) {
        const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
        if(total>8_000_000){await reader.cancel();bad('invalid');}
        html+=decoder.decode(value,{stream:true});
      }
      html+=decoder.decode();
    } else html=await res.text();
    return parseFnacDirectory(html);
  } catch(e) {
    if(e instanceof DirectorySourceError)throw e;
    bad('unavailable');
  } finally {clearTimeout(timer);}
}

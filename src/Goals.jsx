import React, { useState } from 'react';
import { ArrowRight, Check, Pencil, Plus, Target, RotateCw } from 'lucide-react';
import { GOAL_LABELS, GOAL_LIMIT, GOAL_PERIODS, WORKDAY_NAMES, WORKDAY_ORDER, goalReference, goalTargets, hasGoal, parseGoalInputs, normalizeWorkdays, validWorkdays, workdaysLabel } from './goals.js';
import { goalPeriodInfo, personalGoalCards, personalGoalMetric } from './goal-display.js';
import { parisToday } from './cloud-stats.js';

const PERSONAL_PERIOD_LABELS = {day:'Aujourd’hui',week:'Semaine',month:'Mois'};
const PREVIEW_LABELS = {day:'Cible du jour',week:'Cible semaine',month:'Cible mois'};
const numberFormat=new Intl.NumberFormat('fr-FR');
const formatNumber = value => value===null?'—':numberFormat.format(value);
const referenceInputs = (period,amount) => Object.fromEntries(GOAL_PERIODS.map(p=>[p,p===period?amount:'']));
function formReference(entry) {
  const reference=goalReference(entry);
  return reference?{period:reference.period,amount:String(reference.amount)}:{period:'month',amount:''};
}

// Utilisé par le vendeur et par l'administration pour garder les mêmes règles.
export function GoalForm({services,goals,workdays,initialServiceId,onSave,onCancel,disabled=false,date=parisToday()}) {
  const initial=services.find(s=>String(s.id)===String(initialServiceId))?.id||services[0]?.id||'';
  const entry=goals?.[`s${initial}`],initialReference=formReference(entry);
  const [service,setService]=useState(String(initial));
  const [basis,setBasis]=useState(initialReference.period);
  const [amount,setAmount]=useState(initialReference.amount);
  const [revision,setRevision]=useState(entry?.revision||null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const current=goals?.[`s${service}`];
  const stale=!!service && (current?.revision||null)!==revision;
  const numeric=/^\d+$/.test(amount)?Number(amount):null;
  const preview=numeric!==null&&numeric>=0&&numeric<=GOAL_LIMIT?goalTargets({[basis]:numeric},date,workdays):null;
  function loadService(id) {
    const next=goals?.[`s${id}`],reference=formReference(next);
    setService(String(id));setBasis(reference.period);setAmount(reference.amount);setRevision(next?.revision||null);setError('');setNotice('');
  }
  function changeBasis(period) {
    // Changer de période ne remplace jamais silencieusement le nombre saisi.
    setBasis(period);setError('');setNotice('');
  }
  async function save(values,removed=false) {
    setBusy(true);
    try {
      const result=await onSave({serviceId:Number(service),values,revision});
      const next=result?.goals?.[`s${service}`];
      if(next){const reference=formReference(next);setRevision(next.revision);setBasis(reference.period);setAmount(reference.amount);}
      setNotice(removed?'Objectif supprimé.':'Objectifs enregistrés.');
    } catch(e){setError(e.message||'Impossible d’enregistrer les objectifs.');}
    finally{setBusy(false);}
  }
  async function submit(event) {
    event.preventDefault();setError('');setNotice('');
    if(!service||stale)return;
    let values;try{values=parseGoalInputs(referenceInputs(basis,amount));}catch(e){setError(e.message);return;}
    if(!hasGoal(values)){setError('Indiquez une cible de référence pour ce service.');return;}
    await save(values);
  }
  function remove() {
    if(!service||stale||busy||disabled)return;
    const name=services.find(s=>String(s.id)===service)?.name||'ce service';
    if(!window.confirm(`Supprimer les objectifs de ${name} pour les trois périodes ?`))return;
    setError('');setNotice('');save({day:null,week:null,month:null},true);
  }
  return <form className="goal-form" onSubmit={submit}>
    <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service pour les objectifs" value={service} onChange={e=>loadService(e.target.value)} disabled={busy||disabled||!services.length}>
      {!services.length&&<option value="">Aucun service disponible</option>}{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <p className="goal-form-intro">Choisissez une cible de référence. Les cibles du jour, de la semaine et du mois sont calculées selon les jours travaillés.</p>
    <div className="goal-base-fields">
      <label><span className="form-label">PÉRIODE DE RÉFÉRENCE</span><select className="text-input" aria-label="Période de référence" value={basis} onChange={e=>changeBasis(e.target.value)} disabled={busy||disabled||!service}>
        <option value="day">Par jour travaillé</option><option value="week">Par semaine</option><option value="month">Par mois</option>
      </select></label>
      <label><span className="form-label">CIBLE</span><input className="text-input" aria-label="Cible de référence" inputMode="numeric" type="number" min="0" max={GOAL_LIMIT} step="1" placeholder="Ex. 10" value={amount} disabled={busy||disabled||!service} onChange={e=>{setAmount(e.target.value);setNotice('');}} required/></label>
    </div>
    <div className="goal-preview" aria-live="polite"><span className="form-label">CIBLES CALCULÉES POUR LA PÉRIODE EN COURS</span><div className="goal-preview-grid">{GOAL_PERIODS.map(period=><div key={period}><span>{PREVIEW_LABELS[period]}</span><strong>{preview?formatNumber(preview[period]):'—'}</strong></div>)}</div><p className="goal-preview-hint">Ces quantités sont des objectifs à atteindre, pas les ventes déjà réalisées.</p></div>
    <details className="goal-form-details"><summary>Planning et calcul</summary><p className="goal-form-hint">Jours travaillés : {workdaysLabel(workdays)}. L’administrateur peut modifier ces jours. Les jours fériés sont inclus ; la répartition en nombres entiers peut donner 0 certains jours. Si vous changez de période de référence, vérifiez la quantité saisie avant d’enregistrer.</p></details>
    {stale&&<div className="goal-conflict" role="alert"><span>Cet objectif a été modifié ailleurs.</span><button type="button" onClick={()=>loadService(service)}><RotateCw size={13}/> Recharger les valeurs</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {notice&&<div className="goal-saved" role="status">{notice}</div>}
    {hasGoal(current)&&<button type="button" className="goal-remove" onClick={remove} disabled={busy||disabled||stale}>Supprimer l’objectif de ce service</button>}
    <div className="goal-form-actions">{onCancel&&<button type="button" className="outline-button" onClick={onCancel} disabled={busy}>Fermer</button>}<button className="primary-button" type="submit" disabled={busy||disabled||stale||!service||!amount}>{busy?'Enregistrement…':'Enregistrer'} <ArrowRight size={15}/></button></div>
  </form>;
}

// Jours habituels par vendeur, du lundi au dimanche ; formulaire réservé à l'administration.
export function WorkdaysForm({workdays,revision,onSave,disabled=false}) {
  const [selected,setSelected]=useState(()=>normalizeWorkdays(workdays));
  const [editRevision,setEditRevision]=useState(revision||null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const stale=(revision||null)!==editRevision;
  const changed=selected.join(',')!==normalizeWorkdays(workdays).join(',');
  function reload() {setSelected(normalizeWorkdays(workdays));setEditRevision(revision||null);setError('');setNotice('');}
  function toggle(day) {
    setSelected(days=>{const next=days.includes(day)?days.filter(x=>x!==day):[...days,day];return WORKDAY_ORDER.filter(x=>next.includes(x));});
    setError('');setNotice('');
  }
  async function submit(event) {
    event.preventDefault();setError('');setNotice('');
    if(stale||!validWorkdays(selected))return;
    setBusy(true);
    try {
      const result=await onSave({workdays:selected,revision:editRevision});
      setSelected(normalizeWorkdays(result.workdays));setEditRevision(result.workdaysRevision||null);setNotice('Jours travaillés enregistrés.');
    } catch(e){setError(e.message||'Impossible d’enregistrer les jours travaillés.');}
    finally{setBusy(false);}
  }
  return <form className="workdays-form" aria-labelledby="admin-workdays-title" onSubmit={submit}>
    <div className="workdays-heading"><div><h4 id="admin-workdays-title">Jours travaillés</h4><p>Choisissez les jours habituels de ce vendeur, du lundi au dimanche. Sélectionnez au moins un jour.</p></div>{!revision&&<span>Par défaut · à vérifier</span>}</div>
    <fieldset className="workdays-list" disabled={busy||disabled}><legend className="sr-only">Jours travaillés de ce vendeur</legend>
      {WORKDAY_ORDER.map(id=><label className={`workday-option ${selected.includes(id)?'is-selected':''}`} key={id}>
        <input type="checkbox" checked={selected.includes(id)} onChange={()=>toggle(id)}/><span>{WORKDAY_NAMES[id][0].toUpperCase()+WORKDAY_NAMES[id].slice(1)}</span>
      </label>)}
    </fieldset>
    <div className="workdays-actions"><span aria-live="polite">{selected.length} {selected.length>1?'jours sélectionnés':'jour sélectionné'}</span><button type="submit" className="outline-button" disabled={busy||disabled||stale||!validWorkdays(selected)||(!changed&&!!editRevision)}>{busy?'Enregistrement…':'Enregistrer les jours'}</button></div>
    <p className="goal-form-hint">Jours fériés inclus. Le planning se répète chaque semaine et ne gère pas les absences ponctuelles ; toutes les ventes restent comptées.</p>
    {stale&&<div className="goal-conflict" role="alert"><span>Ces jours ont été modifiés ailleurs.</span><button type="button" onClick={reload}><RotateCw size={13}/> Recharger les jours</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="goal-saved" role="status">{notice}</div>}
  </form>;
}

function GoalMetric({service,period,target,stats,configured}) {
  const metric=personalGoalMetric(service.id,period,target,stats);
  const exceeded=metric.state==='reached'?Math.max(0,metric.count-metric.target):0;
  const label={
    'pending':`À faire : ${formatNumber(metric.remaining)}`,
    'reached':exceeded?`Dépassé de ${formatNumber(exceeded)}`:'Objectif atteint',
    'zero':'Cible à 0',
    'sales-unavailable':'Ventes indisponibles',
    'target-unavailable':configured?'Cible indisponible':'Cible à définir',
  }[metric.state];
  const description=metric.state==='pending'?`Encore ${formatNumber(metric.remaining)} vente${metric.remaining>1?'s':''} pour atteindre l’objectif`:metric.state==='reached'&&exceeded?`Objectif dépassé de ${formatNumber(exceeded)} vente${exceeded>1?'s':''}`:label;
  const showProgress=!!metric.progress;
  const longValues=[metric.count,metric.target].some(value=>typeof value==='number'&&value>=1000);
  return <div className="goal-metric">
    <div className={`goal-figures${longValues?' has-long-values':''}`}>
      <div className="goal-figure"><span>Ventes</span><strong>{formatNumber(metric.count)}</strong></div>
      <div className="goal-figure"><span>Cible</span><strong>{formatNumber(metric.target)}</strong></div>
    </div>
    {showProgress&&<div className={`goal-track ${metric.state==='reached'?'is-reached':''}`}
      role="progressbar" aria-label={`${service.name}, ${GOAL_LABELS[period]}`}
      aria-valuemin={0} aria-valuemax={metric.target} aria-valuenow={Math.min(metric.count,metric.target)}
      aria-valuetext={`${formatNumber(metric.count)} vente${metric.count>1?'s':''} sur une cible de ${formatNumber(metric.target)}, ${description}`}>
      <span style={{width:`${metric.progress.percent}%`}}/>
    </div>}
    <div className={`goal-state ${metric.state==='reached'?'is-reached':''}`}>
      {metric.state==='reached'&&<Check size={13} aria-hidden="true"/>}<span>{label}</span>
    </div>
  </div>;
}

// Exporté pour tester indépendamment les trois périodes et les cibles absentes.
export function GoalCards({rows,period,stats,offline,onEdit}) {
  return <div className="goals-grid">{rows.map(({service,targets,configured})=>{
    const action=configured?`Modifier les objectifs ${service.name}`:`Définir un objectif ${service.name}`;
    return <article className={`goal-card${configured?'':' is-unconfigured'}`} key={service.id}>
      <button type="button" className="goal-card-edit" aria-label={action} title={action} onClick={()=>onEdit(service.id)} disabled={offline}>
        <strong>{service.name}</strong>{configured?<Pencil size={15} aria-hidden="true"/>:<Plus size={15} aria-hidden="true"/>}
      </button>
      <GoalMetric service={service} period={period} target={targets?.[period]??null} stats={stats} configured={configured}/>
    </article>;
  })}</div>;
}

export function GoalsPanel({seller,services,goals,workdays,workdaysDefault=false,stats,loading,error,offline,onEdit,onRetry,date=parisToday()}) {
  const [period,setPeriod]=useState('day');
  const configured=services.filter(service=>hasGoal(goals?.[`s${service.id}`]));
  const nextService=services.find(service=>!hasGoal(goals?.[`s${service.id}`]));
  const info=goalPeriodInfo(period,date);
  const rows=goals?personalGoalCards(services,goals,date,workdays,period):[];
  const invalidDate=!info.validDate&&configured.length>0;
  return <section className="panel goals-panel" id="objectifs" aria-labelledby="personal-goals-title">
    <div className="goals-heading"><div><div className="section-kicker"><span className="kicker-line"/> VOTRE PROGRESSION</div><h2 id="personal-goals-title">Mes objectifs</h2></div>
      {goals&&services.length>0&&<button type="button" className="goal-manage" onClick={()=>onEdit(nextService?.id||null)} disabled={offline}>
        {nextService?<Plus size={15}/>:<Pencil size={14}/>} <span>{configured.length===0?'Définir':nextService?'Ajouter':'Gérer'}</span>
      </button>}
    </div>
    {offline&&<p className="goal-offline">Lecture hors ligne · les modifications seront possibles au retour de la connexion.</p>}
    {!goals ? <div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{loading?'Chargement de vos objectifs…':'Vos objectifs sont indisponibles.'}</strong><p>{error||'Ils apparaîtront ici dès que votre espace sera prêt.'}</p>{!loading&&!offline&&<button type="button" onClick={onRetry}>Réessayer</button>}</div></div>
    :<>
      <div className="goals-toolbar">
        <div className="goal-periods" role="group" aria-label="Période des objectifs">{GOAL_PERIODS.map(value=><button type="button" key={value} aria-label={GOAL_LABELS[value]} aria-pressed={period===value} className={period===value?'is-active':''} onClick={()=>setPeriod(value)}>{PERSONAL_PERIOD_LABELS[value]}</button>)}</div>
      </div>
      <div className="goal-period-context" aria-live="polite"><div><strong>{info.title}</strong><span>{info.range}</span></div><p>{info.hint}</p></div>
      {period==='day'&&invalidDate?<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>Les cibles du jour sont indisponibles.</strong><p>Impossible de calculer les objectifs sans une date valide. Actualisez votre espace.</p>{!offline&&<button type="button" onClick={onRetry}>Réessayer</button>}</div></div>
      :rows.length?<GoalCards rows={rows} period={period} stats={stats} offline={offline} onEdit={onEdit}/>
      :<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{services.length?'Aucun objectif prévu aujourd’hui.':'Aucun service disponible.'}</strong><p>{services.length?'Les cibles à 0 et les services sans objectif ne sont pas affichés ici. Retrouvez tous les services dans Semaine ou Mois.':'Les services actifs apparaîtront ici lorsqu’ils seront disponibles.'}</p>{configured.length===0&&services.length>0&&<button type="button" onClick={()=>onEdit(nextService?.id||null)} disabled={offline}>Définir un objectif <ArrowRight size={13}/></button>}</div></div>}
      {configured.length>0&&<details className={`goal-planning ${workdaysDefault?'needs-check':''}`}><summary>{workdaysDefault?'Planning par défaut · à vérifier':'Planning et calcul'}</summary><p>Jours travaillés de {seller?.name||'votre profil'} : {workdaysLabel(workdays)}. L’administrateur peut modifier ce planning. Les semaines vont du lundi au dimanche et les jours fériés sont inclus. Une cible à 0 peut venir du planning ou de la répartition ; toutes les ventes restent comptées.</p></details>}
    </>}
    {error&&goals&&!offline&&<p className="goal-sync-warning">Dernières valeurs affichées · {error} <button type="button" onClick={onRetry}>Réessayer</button></p>}
  </section>;
}

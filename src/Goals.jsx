import React, { useEffect, useId, useRef, useState } from 'react';
import { VisibleFeedback, useRetryFeedback } from './VisibleFeedback';
import { AutoSaveStatus, useAutomaticSave } from './AutoSave';
import { ArrowRight, Check, ChevronDown, Pencil, Plus, Target } from 'lucide-react';
import { GOAL_LABELS, GOAL_LIMIT, GOAL_PERIODS, WORKDAY_NAMES, WORKDAY_ORDER, goalReference, goalTargets, hasGoal, parseGoalInputs, normalizeWorkdays, validWorkdays, workdaysLabel } from './goals.js';
import { validGoalDate, personalGoalCards, personalGoalMetric } from './goal-display.js';
import { goalMinimum } from './goal-policy.js';
import { parisToday } from './cloud-stats.js';

const PERSONAL_PERIOD_LABELS = {day:'Aujourd’hui',week:'Semaine',month:'Mois'};
const PREVIEW_LABELS = {day:'Cible du jour',week:'Cible semaine',month:'Cible mois'};
const REFERENCE_LABELS = {day:'par jour travaillé',week:'par semaine',month:'par mois'};
const numberFormat=new Intl.NumberFormat('fr-FR');
const formatNumber = value => value===null?'—':numberFormat.format(value);
const referenceInputs = (period,amount) => Object.fromEntries(GOAL_PERIODS.map(p=>[p,p===period?amount:'']));
function formReference(entry,admin=false) {
  const reference=(admin&&goalMinimum(entry))||goalReference(entry);
  return reference?{period:reference.period,amount:String(reference.amount)}:{period:'month',amount:''};
}

// Utilisé par le vendeur et par l'administration pour garder les mêmes règles.
export function GoalForm({services,goals,workdays,initialServiceId,onSave,onCancel,disabled=false,showPlanning=false,admin=false,date=parisToday()}) {
  const initial=services.find(s=>String(s.id)===String(initialServiceId))?.id||services[0]?.id||'';
  const [service,setService]=useState(String(initial));
  const goalsRef=useRef(goals);goalsRef.current=goals;
  const current=goals?.[`s${service}`],minimum=goalMinimum(current),effective=goalReference(current);
  const sellerTargets=effective?goalTargets(current,date,workdays):null;
  const editor=useAutomaticSave({
    remoteValue:formReference(current,admin),remoteVersion:current?.revision||null,disabled:disabled||!service,
    equals:(a,b)=>{
      if(a?.remove||b?.remove)return !!a?.remove===!!b?.remove;
      if(!a.amount&&!b.amount)return true;
      return a.period===b.period&&a.amount===b.amount;
    },
    validate:value=>{
      if(value.remove)return '';
      let values;try{values=parseGoalInputs(referenceInputs(value.period,value.amount));}catch(e){return e.message;}
      if(!hasGoal(values))return 'Indiquez une cible de référence. Pour supprimer un objectif, utilisez l’action de suppression.';
      if(!admin&&minimum&&(value.period!==minimum.period||Number(value.amount)<minimum.amount))return 'Respectez le minimum et la période fixés par l’administrateur.';
      return '';
    },
    onSave:async(value,revision)=>{
      const values=value.remove?{day:null,week:null,month:null}:parseGoalInputs(referenceInputs(value.period,value.amount));
      const result=await onSave({serviceId:Number(service),values,revision});
      const next=result?.goals?.[`s${service}`];
      if(!next||typeof next.revision!=='string')throw new Error('Enregistrement non confirmé. Vérifiez les dernières valeurs avant de réessayer.');
      return {value:formReference(next,admin),version:next.revision,...(value.remove?{notice:'Objectif supprimé.'}:{})};
    },
  });
  const {period:basis,amount}=editor.draft;
  const numeric=/^\d+$/.test(amount)?Number(amount):null;
  const preview=numeric!==null&&numeric>=0&&numeric<=GOAL_LIMIT?goalTargets({[basis]:numeric},date,workdays):null;
  async function loadService(id) {
    if(!await editor.flush())return;
    const next=goalsRef.current?.[`s${id}`];
    editor.reset(formReference(next,admin),next?.revision||null);setService(String(id));
  }
  function changeBasis(period) {
    // Un changement de période admin peut effacer la hausse personnelle : il
    // reste une décision explicite, avant toute sauvegarde automatique.
    if(admin&&minimum&&period!==minimum.period&&current?.personal&&
      !window.confirm('Changer la période remplacera la référence et l’ajustement personnel du vendeur. Continuer ?'))return;
    editor.change({...editor.current(),period});
  }
  async function remove() {
    if(!service||editor.stale||editor.busy||disabled||(!admin&&minimum))return;
    const name=services.find(s=>String(s.id)===service)?.name||'ce service';
    if(!window.confirm(`Supprimer les objectifs de ${name} pour les trois périodes ?`))return;
    if(!await editor.flush())return;
    editor.change({period:basis,amount:'',remove:true});
    await editor.flush();
  }
  const minimumPreview=<div className="goal-preview" aria-live="polite"><span className="form-label">{admin?'CIBLES CALCULÉES POUR CE MINIMUM':'CIBLES CALCULÉES POUR LA PÉRIODE EN COURS'}</span><div className="goal-preview-grid">{GOAL_PERIODS.map(period=><div key={period}><span>{PREVIEW_LABELS[period]}</span><strong>{preview?formatNumber(preview[period]):'—'}</strong></div>)}</div><p className="goal-preview-hint">Ces quantités sont des objectifs à atteindre, pas les ventes déjà réalisées.</p></div>;
  return <form className={`goal-form${admin?' admin-goal-form':''}`}  onSubmit={event=>{event.preventDefault();void editor.flush();}}>
    <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service pour les objectifs" value={service} onChange={e=>{const id=e.target.value;void loadService(id);}} disabled={disabled||!services.length}>
      {!services.length&&<option value="">Aucun service disponible</option>}{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    {!admin&&<p className="goal-form-intro">Choisissez une cible de référence. Les cibles du jour, de la semaine et du mois sont calculées selon les jours travaillés.</p>}
    {!admin&&minimum&&<p className="goal-minimum"><strong>Minimum administrateur : {formatNumber(minimum.amount)} {REFERENCE_LABELS[minimum.period]}.</strong> Vous pouvez augmenter votre cible ou la redescendre jusqu’à ce minimum.</p>}
    {admin&&minimum&&effective&&effective.period===minimum.period&&effective.amount>minimum.amount&&<section className="goal-preview admin-seller-target" aria-label="Objectif actuel du vendeur" aria-live="polite">
      <p className="admin-target-title"><span className="form-label">OBJECTIF ACTUEL DU VENDEUR :</span> <strong>{effective?`${formatNumber(effective.amount)} ${REFERENCE_LABELS[effective.period]}`:'Aucun objectif défini'}</strong></p>
      <div className="goal-preview-grid">{GOAL_PERIODS.map(period=><div key={period}><span>{PERSONAL_PERIOD_LABELS[period]}</span><strong>{sellerTargets?formatNumber(sellerTargets[period]):'—'}</strong></div>)}</div>
      <p className="goal-preview-hint">{minimum&&effective&&effective.amount>minimum.amount?'Le vendeur a choisi un objectif plus élevé.':'Actualisé automatiquement.'}</p>
    </section>}
    {admin&&minimum&&basis!==minimum.period&&<p className="goal-minimum">Changer de période remplace la référence et son éventuel ajustement personnel.</p>}
    <section className={admin?'admin-goal-minimum-editor':undefined}>
    {admin&&<div className="admin-goal-minimum-heading"><h4>Minimum administrateur</h4><p>Le vendeur peut l’augmenter, mais pas descendre en dessous.</p></div>}
    <div className="goal-base-fields">
      <label><span className="form-label">{admin?'PÉRIODE':'PÉRIODE DE RÉFÉRENCE'}</span><select className="text-input" aria-label="Période de référence" value={basis} onChange={e=>changeBasis(e.target.value)} disabled={disabled||!service||(!admin&&!!minimum)}>
        <option value="day">Par jour travaillé</option><option value="week">Par semaine</option><option value="month">Par mois</option>
      </select></label>
      <label><span className="form-label">{admin?'CIBLE MINIMALE':'CIBLE'}</span><input className="text-input" aria-label="Cible de référence" inputMode="numeric" type="number" min={!admin&&minimum?minimum.amount:0} max={GOAL_LIMIT} step="1" placeholder="Ex. 10" value={amount} disabled={disabled||!service} onChange={e=>{const value=e.target.value;editor.change({period:editor.current().period,amount:value});}} onBlur={()=>{if(!admin&&minimum&&(editor.current().amount===''||Number(editor.current().amount)<minimum.amount))editor.change({period:minimum.period,amount:String(minimum.amount)});}} required/></label>
    </div>
    {admin?<details className="admin-minimum-equivalents"><summary><span><strong>Objectifs par jour, semaine et mois</strong><small>Calculés à partir de l’objectif demandé</small></span><ChevronDown size={18} aria-hidden="true"/></summary>{minimumPreview}</details>:minimumPreview}
    <AutoSaveStatus showRecovery={admin||!minimum} editor={editor} saved="Objectifs enregistrés automatiquement." conflict="Cet objectif a été modifié ailleurs. Votre saisie n’a pas été enregistrée."/>
    </section>
    {showPlanning&&<details className="goal-form-details"><summary>Planning et calcul</summary><p className="goal-form-hint">Jours travaillés : {workdaysLabel(workdays)}. Modifiez ces jours dans la fiche du vendeur, onglet Vendeurs. Les cibles par semaine ou par mois sont réparties en entiers : samedi 6 parts, lundi et vendredi 5, les autres jours travaillés 4. Une cible par jour travaillé reste identique chaque jour. Les jours fériés sont inclus et certains jours peuvent recevoir 0. Changer de période remplace la référence et son éventuelle hausse personnelle.</p></details>}
    {hasGoal(current)&&<button type="button" className="goal-remove" onClick={remove} disabled={editor.busy||disabled||editor.stale||(!admin&&!!minimum)} title={!admin&&minimum?'Seul un administrateur peut supprimer ce minimum.':undefined}>Supprimer l’objectif de ce service</button>}
    {onCancel&&<div className="goal-form-actions"><button type="button" className="outline-button" onClick={onCancel}>Fermer</button></div>}
  </form>;
}

// Jours habituels par vendeur, du lundi au dimanche ; formulaire réservé à l'administration.
export function WorkdaysForm({workdays,revision,onSave,disabled=false}) {
  const titleId=useId(),[hint,setHint]=useState('');
  const editor=useAutomaticSave({
    remoteValue:normalizeWorkdays(workdays),remoteVersion:revision||null,disabled,
    equals:(a,b)=>a.join(',')===b.join(','),
    validate:days=>validWorkdays(days)?'':'Choisissez au moins un jour travaillé.',
    onSave:async(days,expected)=>{
      const result=await onSave({workdays:days,revision:expected});
      if(!validWorkdays(result?.workdays)||typeof result?.workdaysRevision!=='string')throw new Error('Enregistrement non confirmé. Vérifiez les jours avant de réessayer.');
      return {value:normalizeWorkdays(result.workdays),version:result.workdaysRevision};
    },
  });
  const selected=editor.draft;
  function toggle(day) {
    const days=editor.current();
    if(days.length===1&&days.includes(day)){setHint('Cochez d’abord un autre jour : au moins un jour est nécessaire.');return;}
    setHint('');const next=days.includes(day)?days.filter(x=>x!==day):[...days,day];
    editor.change(WORKDAY_ORDER.filter(x=>next.includes(x)));
  }
  return <form className="workdays-form" aria-labelledby={titleId} onSubmit={event=>{event.preventDefault();void editor.flush();}}>
    <div className="workdays-heading"><div><h4 id={titleId}>Jours travaillés</h4><p>Choisissez les jours habituels de ce vendeur, du lundi au dimanche. Sélectionnez au moins un jour.</p></div>{!revision&&<span>Par défaut · à vérifier</span>}</div>
    <fieldset className="workdays-list" disabled={disabled}><legend className="sr-only">Jours travaillés de ce vendeur</legend>
      {WORKDAY_ORDER.map(id=><label className={`workday-option ${selected.includes(id)?'is-selected':''}`} key={id}>
        <input type="checkbox" checked={selected.includes(id)} onChange={()=>toggle(id)}/><span>{WORKDAY_NAMES[id][0].toUpperCase()+WORKDAY_NAMES[id].slice(1)}</span>
      </label>)}
    </fieldset>
    <div className="workdays-actions"><span aria-live="polite">{selected.length} {selected.length>1?'jours sélectionnés':'jour sélectionné'}</span></div>
    {hint&&<p className="goal-form-hint" role="status">{hint}</p>}
    <AutoSaveStatus editor={editor} saved="Jours travaillés enregistrés automatiquement." conflict="Ces jours ont été modifiés ailleurs. Votre saisie n’a pas été enregistrée."/>
    <p className="goal-form-hint">Jours fériés inclus. Le planning se répète chaque semaine et ne gère pas les absences ponctuelles ; toutes les ventes restent comptées.</p>
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

export function GoalsPanel({services,goals,workdays,stats,loading,error,offline,onEdit,onRetry,feedbackScope='',date=parisToday()}) {
  const [period,setPeriod]=useState('day');
  const retried=useRetryFeedback(onRetry,'Objectifs actualisés.');
  useEffect(()=>{retried.clear();},[feedbackScope]);
  useEffect(()=>{if(!loading&&retried.feedback&&((error&&retried.feedback.tone==='success')||(!error&&retried.feedback.tone==='error')))retried.clear();},[error,loading]);
  const configured=services.filter(service=>hasGoal(goals?.[`s${service.id}`]));
  const nextService=services.find(service=>!hasGoal(goals?.[`s${service.id}`]));
  const rows=goals?personalGoalCards(services,goals,date,workdays,period):[];
  const invalidDate=!validGoalDate(date)&&configured.length>0;
  const periodName={day:'du jour',week:'de la semaine',month:'du mois'}[period];
  const emptyTitle={day:'Aucun objectif prévu aujourd’hui.',week:'Aucun objectif prévu cette semaine.',month:'Aucun objectif prévu ce mois-ci.'}[period];
  return <section className="panel goals-panel" id="objectifs" aria-labelledby="personal-goals-title">
    <VisibleFeedback message={retried.feedback?.message} tone={retried.feedback?.tone} revision={retried.revision} actionLabel={retried.feedback?.tone==='error'?'Réessayer':''} onAction={retried.retry}/>
    {retried.feedback?.tone==='success'&&<span className="sr-only" role="status">{retried.feedback.message}</span>}
    <div className="goals-heading"><div><div className="section-kicker"><span className="kicker-line"/> VOTRE PROGRESSION</div><h2 id="personal-goals-title">Mes objectifs</h2></div>
      {goals&&services.length>0&&<button type="button" className="goal-manage" onClick={()=>onEdit(nextService?.id||null)} disabled={offline}>
        {nextService?<Plus size={15}/>:<Pencil size={14}/>} <span>{configured.length===0?'Définir':nextService?'Ajouter':'Gérer'}</span>
      </button>}
    </div>
    {offline&&<p className="goal-offline">Lecture hors ligne · les modifications seront possibles au retour de la connexion.</p>}
    {!goals ? <div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{loading?'Chargement de vos objectifs…':'Vos objectifs sont indisponibles.'}</strong><p role={error?'alert':undefined}>{error||'Ils apparaîtront ici dès que votre espace sera prêt.'}</p>{!loading&&!offline&&<button type="button" onClick={retried.retry}>Réessayer</button>}</div></div>
    :<>
      <div className="goals-toolbar">
        <div className="goal-periods" role="group" aria-label="Période des objectifs">{GOAL_PERIODS.map(value=><button type="button" key={value} aria-label={GOAL_LABELS[value]} aria-pressed={period===value} className={period===value?'is-active':''} onClick={()=>setPeriod(value)}>{PERSONAL_PERIOD_LABELS[value]}</button>)}</div>
      </div>
      {invalidDate?<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>Les cibles {periodName} sont indisponibles.</strong><p>Impossible de calculer les objectifs sans une date valide. Actualisez votre espace.</p>{!offline&&<button type="button" onClick={retried.retry}>Réessayer</button>}</div></div>
      :rows.length?<GoalCards rows={rows} period={period} stats={stats} offline={offline} onEdit={onEdit}/>
      :<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{services.length?emptyTitle:'Aucun service disponible.'}</strong><p>{services.length?'Pensez à ajouter vos objectifs.':'Les services actifs apparaîtront ici lorsqu’ils seront disponibles.'}</p>{configured.length===0&&services.length>0&&<button type="button" onClick={()=>onEdit(nextService?.id||null)} disabled={offline}>Définir un objectif <ArrowRight size={13}/></button>}</div></div>}
    </>}
    {error&&goals&&!offline&&<p className="goal-sync-warning" role="alert">Dernières valeurs affichées · {error} <button type="button" onClick={retried.retry}>Réessayer</button></p>}
  </section>;
}

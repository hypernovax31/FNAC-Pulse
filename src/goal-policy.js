import {GOAL_LIMIT,GOAL_PERIODS,goalReference,validGoalValues} from './goals.js';

function validReference(value) {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&GOAL_PERIODS.includes(value.period)&&
    Number.isInteger(value.amount)&&value.amount>=0&&value.amount<=GOAL_LIMIT;
}
export function goalMinimum(entry) {
  const value=entry?.minimum;
  return validReference(value)?{period:value.period,amount:value.amount}:null;
}

// Fonction commune au Worker et au serveur de développement. Les entrées
// historiques sans « minimum » restent libres jusqu'à une action admin.
export function updateGoalEntry(previous,values,{admin=false}={}) {
  if(!validGoalValues(values))throw new Error('Objectif invalide.');
  const reference=goalReference(values),minimum=goalMinimum(previous);
  const fields=Object.fromEntries(GOAL_PERIODS.map(period=>[period,values[period]]));
  if(admin) {
    // Une suppression administrative explicite efface cible et minimum.
    if(!reference)return fields;
    const previousPersonal=validReference(previous?.personal)?previous.personal:(!minimum?goalReference(previous):null);
    // Une hausse personnelle est préservée lorsque la référence reste la même.
    // Un changement de période par l'admin définit une nouvelle référence.
    const personal=previousPersonal?.period===reference.period?{period:previousPersonal.period,amount:previousPersonal.amount}:null;
    if(personal)fields[reference.period]=Math.max(reference.amount,personal.amount);
    return {...fields,minimum:reference,...(personal?{personal}:{})};
  }
  // Ne jamais traiter un minimum corrompu comme s'il n'existait pas.
  if(previous?.minimum!=null&&!minimum)throw new Error('Minimum administrateur illisible. Contactez un administrateur.');
  if(minimum) {
    if(!reference||reference.period!==minimum.period||reference.amount<minimum.amount)
      throw new Error('Respectez le minimum et la période fixés par l’administrateur.');
    return {...fields,minimum,personal:reference};
  }
  return fields;
}

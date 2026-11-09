// Pondérations relatives des journées réellement travaillées.
export function goalDayWeight(day) {
  return day===6?6:(day===1||day===5)?5:4;
}

// Méthode des plus forts restes : les quotas restent proportionnels, entiers,
// et leur somme vaut exactement le total. À égalité, les jours de même poids
// reçoivent leurs unités régulièrement dans la période, pas seulement au début.
export function distributeWeighted(total,weights) {
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(weights)||weights.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Répartition invalide.');
  const weight=weights.reduce((sum,n)=>sum+n,0);
  if(!Number.isSafeInteger(weight))throw new Error('Répartition invalide.');
  if(!weight)return weights.map(()=>0);
  // La plupart des objectifs restent très en dessous de 2^52 : l'arithmétique
  // entière native évite BigInt dans les grands récapitulatifs. Au-delà,
  // BigInt garde les restes exacts sans arrondi flottant.
  const maxWeight=weights.reduce((max,n)=>Math.max(max,n),0),fast=total<=Math.floor((Number.MAX_SAFE_INTEGER/2)/maxWeight);
  const denominator=fast?null:BigInt(weight),groups=new Map();let assigned=0;
  const result=weights.map((n,index)=>{
    if(!n)return 0;
    let base,remainder;
    if(fast){const numerator=total*n;base=Math.floor(numerator/weight);remainder=numerator-base*weight;}
    else {const numerator=BigInt(total)*BigInt(n);base=Number(numerator/denominator);remainder=Number(numerator%denominator);}
    assigned+=base;
    const key=`${remainder}:${n}`,group=groups.get(key)||{remainder,weight:n,indexes:[]};
    group.indexes.push(index);groups.set(key,group);
    return base;
  });
  let remaining=total-assigned;
  const ordered=[...groups.values()].sort((a,b)=>b.remainder-a.remainder||b.weight-a.weight);
  for(const group of ordered) {
    const count=Math.min(remaining,group.indexes.length),slots=group.indexes.length;
    if(count)for(let i=1;i<=slots;i++) {
      const cumulative=n=>Math.floor((count*n+slots/2)/slots);
      if(cumulative(i)>cumulative(i-1))result[group.indexes[i-1]]++;
    }
    remaining-=count;if(!remaining)break;
  }
  return result;
}

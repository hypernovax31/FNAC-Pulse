import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {localPushTargets} from '../server/push-targets.js';

test('SQLite push : aucun appareil de l’auteur, collègues du même magasin et département seulement',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE sellers(id INTEGER,store_id TEXT,department_id TEXT,active INTEGER);
      CREATE TABLE subscriptions(endpoint TEXT,store_id TEXT,seller_id INTEGER,subscription_json TEXT);`);
    const seller=db.prepare('INSERT INTO sellers VALUES (?,?,?,?)');
    seller.run(1,'A','tech',1);seller.run(2,'A','tech',1);seller.run(3,'A','editorial',1);
    seller.run(4,'B','tech',1);seller.run(5,'A','tech',0);
    const sub=db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?)');
    for(const [id,store,endpoint] of [[1,'A','author-phone'],[1,'A','author-tablet'],[2,'A','peer-phone'],[2,'A','peer-tablet'],[3,'A','other-department'],[4,'B','other-store'],[5,'A','archived']])sub.run(endpoint,store,id,'{}');
    const result=localPushTargets(db,'A','tech',1).map(x=>x.endpoint).sort();
    assert.deepEqual(result,['peer-phone','peer-tablet']);
    assert.deepEqual(localPushTargets(db,'A','tech',2).map(x=>x.endpoint).sort(),['author-phone','author-tablet']);
  } finally {db.close();}
});

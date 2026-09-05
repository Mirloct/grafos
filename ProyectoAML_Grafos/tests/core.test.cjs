const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../templates/core.js');
const row=(origen,destino,suma_monto=10)=>({origen,destino,suma_monto,ctd_trx:1});
test('Lists preserve IDs, deduplicate, accept Excel and multiline separators',()=>{
  assert.deepEqual(C.parseIds('001;002\n001, P A\t003'),['001','002','P A','003']);
});
test('All incoming/outgoing history of a selected person with repeated dimensions',()=>{
  const idx=C.index([row('A','X',4),row('A','X',6),row('X','B',2),row('Q','R')]);
  const result=C.query(idx,['X'],1,'both');
  assert.equal(result.edges.length,2);
  assert.equal(result.edges.find(e=>e.origen==='A').suma_monto,10);
  assert.equal(result.edges.find(e=>e.origen==='A').ctd_trx,2);
  assert.equal(C.query(idx,['X'],1,'in').edges.length,1);
  assert.equal(C.query(idx,['X'],1,'out').edges[0].destino,'B');
});
test('A person belongs to overlapping networks without merging those networks',()=>{
  const idx=C.index([row('A','X'),row('X','B'),row('B','Y')]);
  const result=C.query(idx,['A','B'],1,'both');
  assert.deepEqual(result.memberships.get('X'),['A','B']);
  assert.equal(result.networks.length,2);
  assert.equal(result.memberships.get('Y').length,1);
});
test('Cycles terminate and depth excludes untraversed boundary edges',()=>{
  const idx=C.index([row('A','B'),row('B','A'),row('B','C'),row('C','D')]);
  assert.equal(C.query(idx,['A'],1,'out').edges.length,1);
  assert.equal(C.query(idx,['A'],2,'out').edges.length,3);
  assert.equal(C.query(idx,['A'],3,'out').edges.length,4);
});
test('View budget never truncates query data or export',()=>{
  const all=Array.from({length:1000},(_,i)=>row('A','P'+i));
  const view=C.chooseView(all,['A'],250,600);
  assert.ok(view.nodes.length<=250);
  assert.equal(all.length,1000);
  assert.equal(C.csv(all,['origen','destino','ctd_trx']).split('\r\n').length,1001);
});
test('CSV escaping, formula protection, numeric values and non-ASCII',()=>{
  const csv=C.csv([{id:'=SUM(1)',note:'José, "A"',amount:-2}],['id','note','amount']);
  assert.ok(csv.includes('"\'=SUM(1)"'));
  assert.ok(csv.includes('"José, ""A"""'));
  assert.ok(csv.includes('"-2"'));
});
test('Budget exhaustion is an explicit error, not a partial result',()=>{
  assert.throws(()=>C.walk(C.index([row('A','B')]),['A'],1,'both',{visits:0,max:0}),/amplia/);
});
test('Hundreds of selected people leave drawing space for their counterparties',()=>{
  const seeds=Array.from({length:400},(_,i)=>'S'+i);
  const edges=seeds.map((s,i)=>row(s,'P'+i));
  const view=C.chooseView(edges,seeds);
  assert.ok(view.edges.length>0);
  assert.ok(view.nodes.length<=250);
  assert.equal(C.query(C.index(edges),seeds).edges.length,400);
});

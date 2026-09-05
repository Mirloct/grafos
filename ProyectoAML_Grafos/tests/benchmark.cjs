// Reproducible synthetic query-engine benchmark. Not a browser/rendering or ingestion SLA.
const {performance}=require('node:perf_hooks'),os=require('node:os'),C=require('../templates/core.js');
const population=50000,offsets=[1,7,97,997],rows=[];
for(let i=0;i<population;i++)for(const offset of offsets)rows.push({origen:'P'+i,destino:'P'+((i+offset)%population),suma_monto:(i%1000)+1,ctd_trx:1});
const seeds=Array.from({length:1000},(_,i)=>'P'+(i*37));
let start=performance.now();const idx=C.index(rows),indexMs=performance.now()-start;
start=performance.now();const found=C.query(idx,seeds,1,'both'),queryMs=performance.now()-start;
start=performance.now();const view=C.chooseView(found.edges,seeds),viewMs=performance.now()-start;
start=performance.now();const csv=C.csv(found.edges,['origen','destino','suma_monto','ctd_trx']),csvMs=performance.now()-start;
console.log(JSON.stringify({scope:'Synthetic JS engine only; not real-data efficacy or browser rendering',node:process.version,cpu:os.cpus()[0].model,
  people:population,rows:rows.length,seeds:seeds.length,depth:1,queryEdges:found.edges.length,viewNodes:view.nodes.length,viewEdges:view.edges.length,
  exportedRows:csv.split('\r\n').length-1,indexMs:Math.round(indexMs),queryMs:Math.round(queryMs),viewMs:Math.round(viewMs),csvMs:Math.round(csvMs),
  rssMiB:Math.round(process.memoryUsage().rss/1024/1024)},null,2));

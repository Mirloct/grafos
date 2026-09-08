'use strict';
const DATA=JSON.parse(document.getElementById('payload').textContent), C=AMLCore;
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const people=new Map(DATA.persons.map(p=>[p.persona,p]));
const nf=new Intl.NumberFormat('es-PE',{maximumFractionDigits:2});
const sf=new Intl.NumberFormat('es-PE',{maximumFractionDigits:5});
const state={page:'investigar',query:'',depth:1,direction:'both',month:'',channel:'',layout:'Fuerza',
  saved:[],selectedNetwork:'all',tableIndex:0,tablePage:0,sort:null,ascending:true,
  cacheKey:null,cacheRows:null,cacheIndex:null,request:0,
  tables:[],filtered:[],edges:[],seeds:[],shared:new Set(),networks:[],membership:new Map()};
const pages=[
  ['investigar','Investigar','Investigación de relaciones','Pega las personas de interés. Consulta sus entradas y salidas históricas y explora redes superpuestas.'],
  ['redes','Mis redes','Redes de investigación','Compara agrupaciones guardadas en esta sesión y consulta las personas que comparten.'],
  ['resumen','Resumen','Panorama del histórico','Estructura y métricas del universo cargado.'],
  ['personas','Personas','Personas del histórico','Selecciona una persona para abrir sus interacciones.'],
  ['relaciones','Relaciones','Relaciones históricas','Detalle por origen, destino y dimensiones disponibles.'],
  ['comunidades','Comunidades','Comunidades estructurales','Partición Louvain del histórico; las redes de investigación se gestionan por separado.'],
  ['patrones','Patrones de interacción','Patrones de interacción','Explora concentración, dispersión, equilibrio de montos, intermediación y circularidad.'],
  ['ayuda','Guía del visor','Guía rápida del visor','Qué hace cada elemento y cómo usarlo sin alterar el alcance de la investigación.']
];
if(DATA.monthly.length) pages.push(['mensual','Mensual','Actividad mensual','Totales mensuales y relaciones del periodo seleccionado.']);
if(DATA.channels.length) pages.push(['canales','Canales','Actividad por canal','Totales y relaciones del canal seleccionado.']);
const edgeColumns=['origen','destino','suma_monto','ctd_trx','monto_promedio'];
const relationColumns=[...edgeColumns,...(DATA.monthly.length?['codmes']:[]),...(DATA.channels.length?['canal']:[])];
const personColumns=['persona','comunidad','monto_recibido','monto_enviado','contrapartes_entrada','contrapartes_salida','contrapartes_unicas','balance_neto','equilibrio_flujo','reciprocidad','hhi_entrada','hhi_salida','pagerank','betweenness','score'];
const names={suma_monto:'Monto total',ctd_trx:'Transacciones',monto_promedio:'Promedio por trx',persona:'Persona',origen:'Origen',destino:'Destino',comunidad:'Comunidad',monto_recibido:'Monto recibido',monto_enviado:'Monto enviado',codmes:'Mes',canal:'Canal',contrapartes_entrada:'Orígenes distintos',contrapartes_salida:'Destinos distintos',contrapartes_unicas:'Contrapartes únicas',balance_neto:'Entradas − salidas',equilibrio_flujo:'Equilibrio de flujo',reciprocidad:'Reciprocidad',hhi_entrada:'HHI de entrada',hhi_salida:'HHI de salida',pagerank:'PageRank',betweenness:'Intermediación',score:'Índice histórico',n_redes:'N.º de redes'};
function metricName(k){return names[k]||k.replace(/_/g,' ');}
function theme(){const css=getComputedStyle(document.documentElement),get=n=>css.getPropertyValue('--'+n).trim();
  return {panel:get('panel'),ink:get('ink'),muted:get('muted'),grid:get('grid'),edge:get('edge'),seed:get('seed'),incoming:get('in'),outgoing:get('out'),shared:get('shared'),tooltip:get('tooltip'),tooltipText:get('tooltip-text'),
    colors:document.documentElement.dataset.theme==='dark'?['#8bb4ff','#68d8cc','#c0a1fa','#f4cb75','#89d7aa','#eea3d3']:['#245fc0','#168375','#7553b9','#9b701e','#377c50','#a04686']};
}
function saveDownload(text,filename,type='text/csv;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function say(message){$('message').textContent=message;}
function options(values,label){return '<option value="">'+label+'</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');}
function currentRows(){return DATA.relations.filter(r=>(!state.month||String(r.codmes)===state.month)&&(!state.channel||String(r.canal)===state.channel));}
function queryIndex(){
  const key=JSON.stringify([state.month,state.channel]);
  if(state.cacheKey!==key){
    state.cacheRows=currentRows();state.cacheIndex=C.index(state.cacheRows);state.cacheKey=key;
  }
  return {rows:state.cacheRows,idx:state.cacheIndex};
}
function setTables(tables){
  state.tables=tables;state.tableIndex=0;state.tablePage=0;state.sort=null;$('tableSearch').value='';
  $('tableTabs').innerHTML=tables.map((t,i)=>'<button data-table="'+i+'" class="'+(i===0?'active':'')+'">'+esc(t.label)+'</button>').join('');
  $('tableTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.tableIndex=Number(b.dataset.table);state.tablePage=0;state.sort=null;$('tableSearch').value='';
    $('tableTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderTable();
  });renderTable();
}
function renderTable(){
  const t=state.tables[state.tableIndex]||{rows:[],columns:[],label:'Detalle'},q=$('tableSearch').value.trim().toLowerCase();
  let rows=q?t.rows.filter(r=>t.columns.some(k=>String(r[k]??'').toLowerCase().includes(q))):t.rows;
  if(state.sort) rows=[...rows].sort((a,b)=>{
    const av=a[state.sort],bv=b[state.sort],cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true});
    return state.ascending?cmp:-cmp;
  });
  state.filtered=rows;state.tablePage=Math.min(state.tablePage,Math.max(0,Math.ceil(rows.length/60)-1));
  const offset=state.tablePage*60,visible=rows.slice(offset,offset+60);
  $('tableTitle').textContent=t.label;
  $('tableContainer').innerHTML=visible.length?'<table><thead><tr>'+t.columns.map(k=>'<th><button data-sort="'+esc(k)+'">'+esc(metricName(k))+(state.sort===k?(state.ascending?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr></thead><tbody>'+visible.map(r=>'<tr>'+t.columns.map(k=>{
    const value=r[k],isNumber=typeof value==='number',isPerson=['persona','origen','destino'].includes(k)&&people.has(String(value));
    const text=isNumber?(['score','pagerank','betweenness','densidad','equilibrio_flujo','reciprocidad','hhi_entrada','hhi_salida'].includes(k)?sf.format(value):nf.format(value)):String(value??'—');
    return '<td class="'+(isNumber?'num':['redes','motivo'].includes(k)?'long':'')+'">'+(isPerson?'<button data-person="'+esc(value)+'">'+esc(text)+'</button>':esc(text))+'</td>';
  }).join('')+'</tr>').join('')+'</tbody></table>':'<div class="empty">No hay filas para esta selección.</div>';
  $('tableCount').textContent=rows.length?(offset+1)+'–'+(offset+visible.length)+' de '+nf.format(rows.length):'0 filas';
  $('exportTable').textContent='Exportar '+nf.format(rows.length)+' filas';
  $('previousPage').disabled=!state.tablePage;$('nextPage').disabled=offset+60>=rows.length;
  $('tableContainer').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{state.ascending=state.sort===b.dataset.sort?!state.ascending:true;state.sort=b.dataset.sort;renderTable();});
  $('tableContainer').querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>openPerson(b.dataset.person));
}
function stats(items){$('stats').innerHTML=items.map(([label,value])=>'<div class="stat"><span>'+esc(label)+'</span><strong>'+esc(typeof value==='number'?nf.format(value):value)+'</strong></div>').join('');}
function stage(edges,seeds=[],shared=new Set(),title='Relaciones del análisis'){
  state.edges=edges;state.seeds=seeds;state.shared=shared;$('graphTitle').textContent=title;
  $('layoutSelect').hidden=false;$('graphLegend').hidden=false;draw();
}
function positions(nodes,edges){
  const map=new Map(nodes.map((id,i)=>[id,{x:Math.cos(i/nodes.length*2*Math.PI),y:Math.sin(i/nodes.length*2*Math.PI)}]));
  if(state.layout==='Fuerza'){
    // Bounded local relaxation: at most 250 nodes, 600 edges, 55 iterations.
    for(let k=0;k<55;k++){
      const delta=new Map(nodes.map(n=>[n,{x:0,y:0}]));
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
        const a=map.get(nodes[i]),b=map.get(nodes[j]),dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+.015,f=.012/d2;
        delta.get(nodes[i]).x+=dx*f;delta.get(nodes[i]).y+=dy*f;delta.get(nodes[j]).x-=dx*f;delta.get(nodes[j]).y-=dy*f;
      }
      for(const e of edges){const a=map.get(e.origen),b=map.get(e.destino),dx=b.x-a.x,dy=b.y-a.y;
        delta.get(e.origen).x+=dx*.08;delta.get(e.origen).y+=dy*.08;delta.get(e.destino).x-=dx*.08;delta.get(e.destino).y-=dy*.08;}
      for(const n of nodes){const p=map.get(n),d=delta.get(n);p.x+=Math.max(-.09,Math.min(.09,d.x-p.x*.008));p.y+=Math.max(-.09,Math.min(.09,d.y-p.y*.008));}
    }
  }else if(state.layout==='Comunidades'){
    const grouped=new Map();nodes.forEach(n=>{const key=people.get(n)?.comunidad??-1;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(n);});
    [...grouped.values()].forEach((list,c)=>{const ang=c/grouped.size*2*Math.PI,cx=grouped.size>1?Math.cos(ang)*2.2:0,cy=grouped.size>1?Math.sin(ang)*2.2:0;
      list.forEach((n,i)=>map.set(n,{x:cx+Math.cos(i/list.length*2*Math.PI)*.75,y:cy+Math.sin(i/list.length*2*Math.PI)*.75}));});
  }else if(state.layout==='Flujo'){
  const idx=C.index(edges),seeds=state.seeds.filter(n=>map.has(n));
    const roots=seeds.length?seeds:nodes.filter(n=>!idx.incoming.has(n));if(!roots.length)roots.push(nodes[0]);
    const level=new Map(roots.map(n=>[n,0]));
    for(const [direction,sign] of [['out',1],['in',-1]]){
      let front=roots;
      for(let step=1;step<=8&&front.length;step++){const next=[];
        for(const n of front){for(const i of (direction==='out'?idx.outgoing:idx.incoming).get(n)||[]){
          const e=idx.edges[i],other=direction==='out'?e.destino:e.origen;if(!level.has(other)){level.set(other,step*sign);next.push(other);}
        }}front=next;
      }
    }
    const grouped=new Map();nodes.forEach(n=>{const l=level.get(n)??9;if(!grouped.has(l))grouped.set(l,[]);grouped.get(l).push(n);});
    for(const [l,list] of grouped)list.forEach((n,i)=>map.set(n,{x:l*2,y:(i-(list.length-1)/2)*.65}));
  }else if(state.layout==='Radial'){
    const ordered=[...nodes].sort((a,b)=>(people.get(b)?.score||0)-(people.get(a)?.score||0));
    ordered.forEach((n,i)=>{const ring=i<1?0:i<9?1:2,angle=i/Math.max(ordered.length,9)*2*Math.PI;map.set(n,{x:Math.cos(angle)*ring,y:Math.sin(angle)*ring});});
  }
  return map;
}
async function draw(){
  if(state.page==='ayuda')return;
  if(['mensual','canales'].includes(state.page)){drawDimension();return;}
  const t=theme(),view=C.chooseView(state.edges,state.seeds),ids=view.nodes,edges=view.edges;
  if(!ids.length){Plotly.purge('graph');$('graph').innerHTML='<div class="empty">Sin relaciones para esta selección.</div>';$('graphScope').textContent='';return;}
  const pos=positions(ids,edges),seeds=new Set(state.seeds),traces=[],groups=new Map(),pairSet=new Set(edges.map(e=>JSON.stringify([e.origen,e.destino])));
  const xs=ids.map(n=>pos.get(n).x),ys=ids.map(n=>pos.get(n).y),range=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1),arrowX=[],arrowY=[],arrowAngle=[],arrowColor=[],hover=[];
  const maxAmount=Math.max(...edges.map(e=>e.suma_monto),1);
  for(const e of edges){
    const a=pos.get(e.origen),b=pos.get(e.destino),kind=seeds.has(e.origen)?'outgoing':seeds.has(e.destino)?'incoming':'edge';
    const bucket=Math.floor(2*Math.log1p(e.suma_monto)/Math.log1p(maxAmount)),key=kind+bucket;
    if(!groups.has(key))groups.set(key,{x:[],y:[],color:t[kind],width:1+bucket*.65});const g=groups.get(key);
    const points=[];
    if(e.origen===e.destino){for(let j=0;j<=16;j++){const theta=j/16*2*Math.PI;points.push({x:a.x+Math.sin(theta)*range*.035,y:a.y+(1-Math.cos(theta))*range*.035});}}
    else {const bend=pairSet.has(JSON.stringify([e.destino,e.origen]))?.16:0,dx=b.x-a.x,dy=b.y-a.y;
      for(let j=0;j<=12;j++){const u=j/12;points.push({x:a.x+u*dx-dy*bend*4*u*(1-u),y:a.y+u*dy+dx*bend*4*u*(1-u)});}}
    for(const p of points){g.x.push(p.x);g.y.push(p.y);}g.x.push(null);g.y.push(null);
    const i=Math.floor(points.length*.72),p=points[i],previous=points[i-1];
    arrowX.push(p.x);arrowY.push(p.y);arrowAngle.push(90-Math.atan2(p.y-previous.y,p.x-previous.x)*180/Math.PI);arrowColor.push(t[kind]);
    hover.push(esc(e.origen)+' → '+esc(e.destino)+'<br>Monto: '+nf.format(e.suma_monto)+'<br>Trx: '+nf.format(e.ctd_trx));
  }
  for(const g of groups.values())traces.push({type:'scatter',mode:'lines',x:g.x,y:g.y,line:{color:g.color,width:g.width},opacity:.65,hoverinfo:'skip',showlegend:false});
  traces.push({type:'scatter',mode:'markers',x:arrowX,y:arrowY,marker:{symbol:'triangle-up',angle:arrowAngle,size:9,color:arrowColor},text:hover,hovertemplate:'%{text}<extra></extra>',showlegend:false});
  const labelledSeeds=new Set(ids.filter(n=>seeds.has(n)).slice(0,12));
  const labels=ids.map(n=>ids.length<=25||labelledSeeds.has(n)?esc(n.length>24?n.slice(0,23)+'…':n):'');
  traces.push({type:'scatter',mode:'markers+text',ids,x:xs,y:ys,text:labels,textposition:'top center',textfont:{color:t.ink,size:12},cliponaxis:false,
    marker:{size:ids.map(n=>seeds.has(n)?25:14+8*(people.get(n)?.score||0)),
      color:ids.map(n=>seeds.has(n)?t.seed:state.shared.has(n)?t.shared:t.colors[(people.get(n)?.comunidad||0)%t.colors.length]),
      line:{color:t.panel,width:2}},customdata:ids.map(n=>{const p=people.get(n)||{};
        return esc(n)+'<br>Recibido histórico: '+nf.format(p.monto_recibido||0)+'<br>Enviado histórico: '+nf.format(p.monto_enviado||0)+(state.shared.has(n)?'<br>Miembro de varias redes':'');}),
    hovertemplate:'%{customdata}<extra></extra>',showlegend:false});
  const graph=$('graph');if(!graph.classList.contains('js-plotly-plot'))graph.innerHTML='';
  await Plotly.react(graph,traces,{paper_bgcolor:t.panel,plot_bgcolor:t.panel,font:{color:t.ink},hoverlabel:{bgcolor:t.tooltip,font:{color:t.tooltipText}},
    margin:{l:32,r:32,t:38,b:28},xaxis:{visible:false},yaxis:{visible:false,scaleanchor:'x',scaleratio:1},dragmode:'pan',showlegend:false},
    {responsive:true,displaylogo:false,scrollZoom:true});
  graph.removeAllListeners('plotly_click');
  graph.on('plotly_click',e=>{const id=e.points?.[0]?.id;if(id)openPerson(id);});
  $('graphScope').textContent='Dibujo: '+ids.length+' personas · '+edges.length+' relaciones agregadas. Consulta: '+state.edges.length+
    ' relaciones; tablas completas y exportables. '+(edges.length<state.edges.length?'Vista limitada a 250 nodos / 600 relaciones por monto. ':'')+'Clic en un nodo para investigarlo.';
}
function detailRelations(edges,rows){const keys=new Set(edges.map(e=>JSON.stringify([e.origen,e.destino])));return rows.filter(r=>keys.has(JSON.stringify([r.origen,r.destino])));}
function membershipRows(mapping){return [...mapping].map(([persona,redes])=>({persona,n_redes:redes.length,redes:redes.join(' · ')})).sort((a,b)=>b.n_redes-a.n_redes);}
async function investigate(){
  const request=++state.request;
  state.query=$('query').value;state.depth=Number($('depth').value);state.direction=$('direction').value;
  state.month=$('month')?.value||'';state.channel=$('channel')?.value||'';
  const requested=C.parseIds(state.query),seeds=requested.filter(n=>people.has(n)),unknown=requested.filter(n=>!people.has(n));
  if(requested.length&&!seeds.length){say('No se encontraron los identificadores. La vista anterior se conserva. Ausentes: '+unknown.join(', '));return;}
  $('runQuery').disabled=true;say('Preparando consulta…');
  await new Promise(resolve=>setTimeout(resolve,0));
  if(request!==state.request||state.page!=='investigar')return;
  try{
    const {rows,idx}=queryIndex();
    const found=seeds.length?C.query(idx,seeds,state.depth,state.direction):{edges:idx.edges,networks:[],memberships:new Map()};
    state.networks=found.networks;state.membership=found.memberships;
    const members=membershipRows(found.memberships),shared=new Set(members.filter(r=>r.n_redes>1).map(r=>r.persona));
    state.last={seeds:[...seeds],depth:state.depth,direction:state.direction,month:state.month,channel:state.channel,
      nodes:new Set(found.memberships.keys()),edges:found.edges};
    setTables([{label:'Interacciones',rows:detailRelations(found.edges,rows),columns:relationColumns},
      {label:'Pertenencias',rows:members,columns:['persona','n_redes','redes']},
      {label:'Redes por persona',rows:found.networks,columns:['red','personas','relaciones']}]);
    stage(found.edges,seeds,shared,seeds.length?'Entorno de '+seeds.length+' personas':'Histórico completo');
    stats([['Consultadas',seeds.length],['Redes ego',found.networks.length],['Personas compartidas',shared.size],
      ['Relaciones consultadas',found.edges.length]]);
    say((unknown.length?'No encontrados ('+unknown.length+'): '+unknown.join(', ')+'. ':'')+
      'Historia incluida: '+(state.month||'todos los meses')+' · '+(state.channel||'todos los canales')+
      '. Cada persona consultada define una red; la tabla Pertenencias muestra sus solapamientos.');
  }catch(error){say(error.message);}
  finally{if($('runQuery')&&request===state.request)$('runQuery').disabled=false;}
}
function queryControls(){
  $('controls').innerHTML='<div class="query-field"><label for="query">Personas de interés</label><textarea id="query" placeholder="Un ID por línea, o separados por comas, punto y coma o tabulaciones">'+esc(state.query)+'</textarea><div class="query-actions"><label>Importar IDs (.txt)<input id="idsFile" class="file-input" type="file" accept=".txt,text/plain"></label><button id="allHistory">Histórico completo</button></div></div>'+
    '<div class="query-options"><div class="field"><label for="depth">Alcance</label><select id="depth"><option value="1">Directo · 1 salto</option><option value="2">2 saltos</option><option value="3">3 saltos</option></select></div>'+
    '<div class="field"><label for="direction">Interacciones</label><select id="direction"><option value="both">Entradas y salidas</option><option value="in">Entradas</option><option value="out">Salidas</option></select></div>'+
    (DATA.monthly.length?'<div class="field"><label for="month">Mes</label><select id="month">'+options(DATA.monthly.map(r=>r.periodo),'Todo el histórico')+'</select></div>':'')+
    (DATA.channels.length?'<div class="field"><label for="channel">Canal</label><select id="channel">'+options(DATA.channels.map(r=>r.canal),'Todos los canales')+'</select></div>':'')+
    '<button class="primary" id="runQuery">Analizar relaciones</button><div class="field"><label for="networkName">Nombre de la agrupación</label><input id="networkName" placeholder="Red de interés 1"></div><button id="saveNetwork">Guardar red de esta consulta</button><small>Las agrupaciones se conservan durante esta sesión y pueden exportarse desde Mis redes.</small></div>';
  $('depth').value=state.depth;$('direction').value=state.direction;if($('month'))$('month').value=state.month;if($('channel'))$('channel').value=state.channel;
  $('runQuery').onclick=investigate;
  $('idsFile').onchange=async e=>{const file=e.target.files[0];if(file){$('query').value=await file.text();say(C.parseIds($('query').value).length+' identificadores únicos preparados. Pulsa Analizar relaciones.');}};
  $('allHistory').onclick=()=>{$('query').value='';if($('month'))$('month').value='';if($('channel'))$('channel').value='';investigate();};
  $('saveNetwork').onclick=()=>{
    if(!state.last?.seeds.length){say('Analiza al menos una persona antes de guardar su red.');return;}
    const label=$('networkName').value.trim()||'Red '+(state.saved.length+1);
    const id='R'+(state.saved.length+1);
    state.saved.push({...state.last,id,label,nodes:new Set(state.last.nodes)});
    say('Guardada '+id+' · '+label+'. Mis redes permite comparar personas compartidas.');
  };
}
function renderSaved(){
  const mapping=new Map(),edges=new Map(),definitions=[];
  const selected=state.selectedNetwork==='all'?state.saved:state.saved.filter(n=>n.id===state.selectedNetwork);
  for(const net of selected){
    for(const n of net.nodes){if(!mapping.has(n))mapping.set(n,[]);mapping.get(n).push(net.id+' · '+net.label);}
    for(const e of net.edges)edges.set(JSON.stringify([e.origen,e.destino]),e);
    definitions.push({red:net.id,nombre:net.label,semillas:net.seeds.join(', '),personas:net.nodes.size,
      relaciones:net.edges.length,saltos:net.depth,direccion:net.direction,mes:net.month||'Todo',canal:net.channel||'Todos'});
  }
  // Across differently filtered saved networks, use historical edge totals once per pair.
  const historical=C.aggregate(DATA.relations),keys=new Set(edges.keys()),rows=historical.filter(e=>keys.has(JSON.stringify([e.origen,e.destino])));
  const members=membershipRows(mapping),shared=new Set(members.filter(r=>r.n_redes>1).map(r=>r.persona));
  setTables([{label:'Pertenencias',rows:members,columns:['persona','n_redes','redes']},
    {label:'Definiciones',rows:definitions,columns:['red','nombre','semillas','personas','relaciones','saltos','direccion','mes','canal']},
    {label:'Relaciones históricas',rows,columns:edgeColumns}]);
  stage(rows,[...new Set(selected.flatMap(n=>n.seeds))],shared,'Redes guardadas y miembros compartidos');
  stats([['Redes seleccionadas',selected.length],['Personas',mapping.size],['Miembros compartidos',shared.size]]);
  say(state.saved.length?'Las pertenencias conservan el alcance guardado. El grafo comparado muestra cada par una vez con su monto histórico completo.':'Guarda agrupaciones desde Investigar para compararlas aquí.');
}
function patternView(){
  const type=$('pattern').value,records=DATA.patterns.filter(p=>p.patron===type),selected=$('patternPerson').value;
  const matches=selected?records.filter(p=>p.persona===selected):records;
  const seeds=matches.map(p=>p.persona),seedSet=new Set(seeds),idx=C.index(DATA.edges);
  let edges=[];
  try{
    const found=C.walk(idx,seeds,1,'both');
    edges=[...found.traversed].map(i=>idx.edges[i]);
  }catch(error){
    setTables([{label:'Personas del patrón',rows:matches,columns:['persona','patron','motivo','score']}]);
    stage([],[],new Set(),'Selecciona una persona');
    say('El contexto conjunto es demasiado amplio. Elige una persona en el selector para continuar.');return;
  }
  if(type==='Concentración de entradas')edges=edges.filter(e=>seedSet.has(e.destino));
  if(type==='Dispersión de salidas')edges=edges.filter(e=>seedSet.has(e.origen));
  if(type==='Circularidad'){
    const componentOf=new Map();
    (DATA.strong_components||[]).forEach((members,i)=>{
      if(members.some(n=>seedSet.has(n)))members.forEach(n=>componentOf.set(n,i));
    });
    edges=idx.edges.filter(e=>componentOf.has(e.origen)&&componentOf.get(e.origen)===componentOf.get(e.destino));
  }
  stage(edges,seeds,new Set(),'Entorno del patrón · '+type);
  setTables([{label:'Personas del patrón',rows:matches,columns:['persona','patron','motivo','score']},
    {label:'Relaciones de contexto',rows:detailRelations(edges,DATA.relations),columns:relationColumns}]);
  stats([['Personas',matches.length],['Relaciones de contexto',edges.length]]);
}
function updatePatternPeople(){const records=DATA.patterns.filter(p=>p.patron===$('pattern').value);$('patternPerson').innerHTML=options(records.map(p=>p.persona),'Todas las personas del patrón');patternView();}
function communityView(){
  const value=$('community').value,ids=new Set(DATA.persons.filter(p=>value===''||String(p.comunidad)===value).map(p=>p.persona));
  const edges=DATA.edges.filter(e=>ids.has(e.origen)&&ids.has(e.destino));
  stage(edges,[],new Set(),'Comunidad '+(value||'· todas'));
  setTables([{label:'Comunidades',rows:DATA.communities,columns:['comunidad','personas','relaciones','monto_interno','densidad']},
    {label:'Personas de la selección',rows:DATA.persons.filter(p=>ids.has(p.persona)),columns:personColumns},
    {label:'Relaciones internas',rows:edges,columns:edgeColumns}]);
}
function drawDimension(){
  const monthly=state.page==='mensual',all=monthly?DATA.monthly:DATA.channels,key=monthly?'periodo':'canal';
  const chosen=$('dimension')?.value||'',rows=chosen?all.filter(r=>String(r[key])===chosen):all;
  const t=theme(),traces=[{type:'scatter',mode:'lines+markers',name:'Monto',x:rows.map(r=>r[key]),y:rows.map(r=>r.monto),line:{color:t.outgoing},xaxis:'x',yaxis:'y'},
    {type:'scatter',mode:'lines+markers',name:'Transacciones',x:rows.map(r=>r[key]),y:rows.map(r=>r.transacciones),line:{color:t.incoming},xaxis:'x2',yaxis:'y2'}];
  Plotly.react('graph',traces,{paper_bgcolor:t.panel,plot_bgcolor:t.panel,font:{color:t.ink},
    hoverlabel:{bgcolor:t.tooltip,font:{color:t.tooltipText}},margin:{l:70,r:30,t:55,b:50},
    legend:{orientation:'h',x:0,y:1.14},xaxis:{domain:[0,1],anchor:'y',type:'category',gridcolor:t.grid},
    yaxis:{domain:[.58,1],title:{text:'Monto'},gridcolor:t.grid},
    xaxis2:{domain:[0,1],anchor:'y2',type:'category',title:{text:monthly?'Mes':'Canal'},gridcolor:t.grid},
    yaxis2:{domain:[0,.36],title:{text:'Trx'},gridcolor:t.grid}},
    {responsive:true,displaylogo:false});
  $('graphTitle').textContent=monthly?'Evolución mensual':'Actividad por canal';$('layoutSelect').hidden=true;$('graphLegend').hidden=true;
  $('graphScope').textContent='Cada serie tiene su propio eje vertical. Los registros sin dimensión no se incluyen en estas series.';
}
function dimensionView(){
  const monthly=state.page==='mensual',rows=monthly?DATA.monthly:DATA.channels,key=monthly?'periodo':'canal',filterKey=monthly?'codmes':'canal',value=$('dimension').value;
  setTables([{label:'Totales',rows:rows.filter(r=>!value||String(r[key])===value),columns:[key,'monto','transacciones']},
    {label:'Interacciones',rows:DATA.relations.filter(r=>r[filterKey]!=null&&(!value||String(r[filterKey])===value)),columns:relationColumns}]);
  drawDimension();
}
function openPerson(id){state.query=id;state.depth=1;state.direction='both';state.month='';state.channel='';showPage('investigar');}
function renderHelp(){
  $('helpPanel').innerHTML='<div class="help-intro"><strong>Ruta corta</strong><span>Busca personas en Investigar → revisa el grafo y el detalle → guarda redes útiles → compáralas en Mis redes.</span></div><div class="help-grid">'+
    '<article><h2>Investigar</h2><p><b>Personas de interés:</b> pega IDs o importa un TXT. Vacío muestra todo el histórico cargado.</p><p><b>Alcance:</b> 1–3 saltos desde cada ID. <b>Interacciones:</b> entradas, salidas o ambas.</p><p><b>Mes/canal:</b> aparecen solo si la fuente contiene esa dimensión. Analizar actualiza grafo y tablas.</p></article>'+
    '<article><h2>Grafo</h2><p><b>Nodo:</b> pasa el cursor para ver datos; haz clic para abrir su vecindad directa.</p><p><b>Flecha:</b> va de origen a destino. Color y grosor ayudan a leer dirección y monto; no prueban ilicitud.</p><p><b>Distribución:</b> cambia la geometría, no los datos. Usa zoom, arrastre y restablecer vista en la barra del gráfico.</p></article>'+
    '<article><h2>Detalle y exportación</h2><p>Cambia de subtabla con sus pestañas. Escribe en Buscar para filtrar y pulsa un encabezado para ordenar.</p><p>Exportar incluye todas las filas filtradas, no solo la página visible ni la muestra dibujada.</p><p>Un ID azul abre su investigación.</p></article>'+
    '<article><h2>Mis redes</h2><p>Guarda la consulta actual con un nombre. Pertenencias muestra personas compartidas por varias redes.</p><p>Las redes viven solo en esta sesión: exporta las definiciones JSON antes de cerrar o recargar.</p></article>'+
    '<article><h2>Resumen, Personas y Relaciones</h2><p><b>Resumen:</b> universo cargado. <b>Personas:</b> métricas históricas y acceso por ID. <b>Relaciones:</b> detalle agregado por par y dimensiones disponibles.</p><p>Las métricas no se recalculan al filtrar en el navegador.</p></article>'+
    '<article><h2>Comunidades y patrones</h2><p><b>Comunidades:</b> partición estructural Louvain; no equivale a una red criminal.</p><p><b>Patrones:</b> reglas de priorización para revisar contexto. Ninguna coincidencia, métrica o índice es una conclusión AML.</p></article>'+
    '<article><h2>Mensual y Canales</h2><p>Solo existen cuando hay valores utilizables. El selector restringe gráfico y detalle.</p><p>Filas sin mes/canal siguen en el histórico total, pero no se inventa una categoría para ellas.</p></article>'+
    '<article><h2>Lectura segura</h2><p>El dibujo puede limitarse a 250 nodos y 600 relaciones; el pie indica el alcance. Las tablas conservan la consulta completa.</p><p>Corrobora señales con KYC, eventos fechados y contexto del cliente antes de escalar un caso.</p></article></div>';
}
function showPage(id){
  state.request++;
  state.page=id;state.tableIndex=0;say('');$('controls').innerHTML='';$('stats').innerHTML='';
  $('navigation').querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.page===id?'page':'false'));
  const page=pages.find(p=>p[0]===id);$('pageTitle').textContent=page[2];$('pageDescription').textContent=page[3];
  const help=id==='ayuda';$('helpPanel').hidden=!help;$('workspace').hidden=help;$('historicalLabel').hidden=help;
  if(help){renderHelp();return;}
  if(id==='investigar'){queryControls();investigate();}
  if(id==='redes'){
    $('controls').innerHTML='<div class="field"><label for="savedSelect">Agrupaciones guardadas</label><select id="savedSelect"><option value="all">Comparar todas</option>'+state.saved.map(n=>'<option value="'+n.id+'">'+esc(n.id+' · '+n.label)+'</option>').join('')+'</select></div><button id="exportNetworks">Exportar definiciones JSON</button>';
    $('savedSelect').value=state.selectedNetwork;$('savedSelect').onchange=e=>{state.selectedNetwork=e.target.value;renderSaved();};
    $('exportNetworks').onclick=()=>saveDownload(JSON.stringify(state.saved.map(({id,label,seeds,depth,direction,month,channel})=>({id,label,seeds,depth,direction,month,channel})),null,2),'definiciones_redes.json','application/json');
    renderSaved();
  }
  if(id==='resumen'){
    stats([['Personas',DATA.summary.people],['Relaciones',DATA.summary.relations],['Monto',DATA.summary.amount],['Transacciones',DATA.summary.transactions]]);
    stage(DATA.edges,[],new Set(),'Estructura del histórico');
    setTables([{label:'Personas',rows:DATA.persons,columns:personColumns},{label:'Relaciones',rows:DATA.relations,columns:relationColumns}]);
  }
  if(id==='personas'){stage(DATA.edges,[],new Set(),'Personas del histórico');setTables([{label:'Personas',rows:DATA.persons,columns:personColumns}]);}
  if(id==='relaciones'){stage(DATA.edges,[],new Set(),'Relaciones del histórico');setTables([{label:'Interacciones',rows:DATA.relations,columns:relationColumns}]);}
  if(id==='comunidades'){
    $('controls').innerHTML='<div class="field"><label for="community">Comunidad</label><select id="community">'+options(DATA.communities.map(c=>c.comunidad),'Todas')+'</select></div>';
    $('community').onchange=communityView;communityView();
  }
  if(id==='patrones'){
    $('controls').innerHTML='<div class="field"><label for="pattern">Patrón</label><select id="pattern">'+[...new Set(DATA.patterns.map(p=>p.patron))].map(p=>'<option>'+esc(p)+'</option>').join('')+'</select></div><div class="field"><label for="patternPerson">Persona</label><select id="patternPerson"></select></div>';
    $('pattern').onchange=updatePatternPeople;$('patternPerson').onchange=patternView;updatePatternPeople();
  }
  if(['mensual','canales'].includes(id)){
    const rows=id==='mensual'?DATA.monthly:DATA.channels,key=id==='mensual'?'periodo':'canal';
    $('controls').innerHTML='<div class="field"><label for="dimension">'+(id==='mensual'?'Mes':'Canal')+'</label><select id="dimension">'+options(rows.map(r=>r[key]),'Todos')+'</select></div>';
    $('dimension').onchange=dimensionView;dimensionView();
  }
}
function init(){
  try{document.documentElement.dataset.theme=localStorage.getItem('ni-theme')||'light';}catch(_){}
  function themeLabel(){const dark=document.documentElement.dataset.theme==='dark';$('themeToggle').textContent=dark?'Modo claro':'Modo oscuro';$('themeToggle').setAttribute('aria-pressed',String(dark));}
  themeLabel();$('themeToggle').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('ni-theme',document.documentElement.dataset.theme);}catch(_){}themeLabel();draw();};
  $('navigation').innerHTML=pages.map(p=>'<button data-page="'+p[0]+'">'+esc(p[1])+'</button>').join('');
  $('navigation').querySelectorAll('button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $('layoutSelect').onchange=e=>{state.layout=e.target.value;draw();};
  $('tableSearch').oninput=()=>{state.tablePage=0;renderTable();};
  $('previousPage').onclick=()=>{state.tablePage--;renderTable();};$('nextPage').onclick=()=>{state.tablePage++;renderTable();};
  $('exportTable').onclick=()=>{const t=state.tables[state.tableIndex];if(t)saveDownload(C.csv(state.filtered,t.columns),state.page+'_'+Date.now()+'.csv');};
  $('datasetLabel').textContent=DATA.summary.people+' personas · '+DATA.summary.relations+' relaciones históricas';
  window.addEventListener('resize',()=>{if($('graph').classList.contains('js-plotly-plot'))Plotly.Plots.resize('graph');});
  showPage('investigar');
}
init();

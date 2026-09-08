// DOM-level integration checks, not a browser screenshot/Plotly rendering certification.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom'),C=require('../templates/core.js');
const base=__dirname+'/../templates/';
function fixture(extra={}){
  const rows=[{origen:'A',destino:'X',suma_monto:10,ctd_trx:1},{origen:'X',destino:'B',suma_monto:8,ctd_trx:2},{origen:'Q',destino:'R',suma_monto:5,ctd_trx:1}];
  return {schema:{codmes:null,canal:null},summary:{people:5,relations:3,amount:23,transactions:4,communities:2},
    persons:['A','X','B','Q','R'].map((persona,i)=>({persona,comunidad:i<3?0:1,score:.5,monto_recibido:10,monto_enviado:8})),
    edges:C.aggregate(rows),relations:rows,monthly:[],channels:[],communities:[{comunidad:0,personas:3},{comunidad:1,personas:2}],
    patterns:[{persona:'X',patron:'Entradas y salidas equilibradas',motivo:'Totales similares',score:.5}],strong_components:[],...extra};
}
async function app(data=fixture()){
  const shell=fs.readFileSync(base+'visor.html','utf8').replace('__PAYLOAD__',JSON.stringify(data)).replace('__PLOTLY__','').replace('__CORE__','').replace('__APP__','');
  const {document,window}=parseHTML(shell);
  // linkedom has no select setter. Provide the standard selection semantics used by the application.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,
    get(){const option=[...this.querySelectorAll('option')].find(o=>o.hasAttribute('selected'))||this.querySelector('option');return option?option.getAttribute('value')??option.textContent:'';},
    set(value){for(const o of this.querySelectorAll('option')){if((o.getAttribute('value')??o.textContent)===String(value))o.setAttribute('selected','');else o.removeAttribute('selected');}}});
  const plots=[],downloads=[];
  const Plotly={react:async(target,traces,layout)=>{const el=typeof target==='string'?document.getElementById(target):target;el.classList.add('js-plotly-plot');el.removeAllListeners=()=>{};el.on=()=>{};plots.push({traces,layout});},purge:()=>{},Plots:{resize:()=>{}}};
  const ctx=vm.createContext({document,window,AMLCore:C,Plotly,console,setTimeout,clearTimeout,Blob,
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},
    localStorage:{getItem(){return null;},setItem(){}},
    getComputedStyle(){return {getPropertyValue(name){const dark=document.documentElement.dataset.theme==='dark';
      return name==='--panel'?(dark?'#132035':'#ffffff'):name==='--ink'?(dark?'#e1eaf8':'#182940'):'#8899aa';}};}});
  vm.runInContext(fs.readFileSync(base+'app.js','utf8'),ctx);
  await new Promise(r=>setTimeout(r,15));
  return {ctx,document,plots,downloads,eval:code=>vm.runInContext(code,ctx)};
}
test('Optional navigation is absent independently; methodology omitted',async()=>{
  for(const [monthly,channels] of [[[],[]],[[{periodo:'202501',monto:1,transacciones:1}],[]],[[],[{canal:'APP',monto:1,transacciones:1}]]]){
    const a=await app(fixture({monthly,channels}));
    assert.equal(!!a.document.querySelector('[data-page="mensual"]'),!!monthly.length);
    assert.equal(!!a.document.querySelector('[data-page="canales"]'),!!channels.length);
    assert.equal(a.document.querySelector('[data-page="metodologia"]'),null);
    assert.ok(a.document.querySelector('[data-page="ayuda"]'));
    assert.ok(a.document.getElementById('navigation').textContent.includes('Patrones de interacción'));
  }
});
test('Viewer guide explains controls and hides the analytical workspace',async()=>{
  const a=await app();a.eval("showPage('ayuda')");
  assert.equal(a.document.getElementById('workspace').hidden,true);
  assert.equal(a.document.getElementById('helpPanel').hidden,false);
  assert.ok(a.document.getElementById('helpPanel').textContent.includes('Exportar incluye todas las filas'));
  assert.ok(a.document.getElementById('helpPanel').textContent.includes('Ninguna coincidencia'));
  a.document.getElementById('themeToggle').onclick();
  assert.equal(a.document.documentElement.dataset.theme,'dark');
});
test('Multi-ID query, unknown IDs, saved overlapping networks and neutral pattern view',async()=>{
  const a=await app(),q=a.document.getElementById('query');
  q.value='A;B\nNOT_FOUND';await a.eval('investigate()');
  assert.ok(a.document.getElementById('message').textContent.includes('NOT_FOUND'));
  assert.equal(a.eval("state.membership.get('X').length"),2);
  assert.equal(a.eval('state.edges.length'),2);
  a.document.getElementById('networkName').value='Grupo AB';a.document.getElementById('saveNetwork').onclick();
  q.value='B';await a.eval('investigate()');a.document.getElementById('saveNetwork').onclick();
  a.eval("showPage('redes')");
  assert.equal(a.eval('state.saved.length'),2);
  assert.equal(a.eval("state.shared.has('X')"),true);
  assert.equal(a.eval('state.edges.length'),2);
  a.eval("showPage('patrones')");
  assert.equal(a.eval('state.edges.length'),2);
});
test('Theme changes the page and the active chart backgrounds/text',async()=>{
  const a=await app();a.document.getElementById('themeToggle').onclick();
  assert.equal(a.document.documentElement.dataset.theme,'dark');
  assert.equal(a.plots.at(-1).layout.paper_bgcolor,'#132035');
  assert.equal(a.plots.at(-1).layout.font.color,'#e1eaf8');
  a.document.getElementById('themeToggle').onclick();
  assert.equal(a.plots.at(-1).layout.paper_bgcolor,'#ffffff');
});
test('All five graph geometries produce finite coordinates for the same relationships',async()=>{
  const a=await app();
  for(const layout of ['Fuerza','Comunidades','Flujo','Radial','Circular']){
    a.eval('state.layout='+JSON.stringify(layout));await a.eval('draw()');
    const nodes=a.plots.at(-1).traces.at(-1);
    assert.equal(nodes.ids.length,5);
    assert.ok(nodes.x.every(Number.isFinite));assert.ok(nodes.y.every(Number.isFinite));
  }
});
test('Circularity graph excludes one-way bridges between distinct cyclic components',async()=>{
  const rows=[['A','B'],['B','A'],['X','Q'],['Q','X'],['B','X']].map(([origen,destino])=>({origen,destino,suma_monto:10,ctd_trx:1}));
  const a=await app(fixture({relations:rows,edges:C.aggregate(rows),strong_components:[['A','B'],['X','Q']],
    patterns:['A','B','X','Q'].map(persona=>({persona,patron:'Circularidad',score:.5}))}));
  a.eval("showPage('patrones')");
  assert.equal(a.eval('state.edges.length'),4);
  assert.equal(a.eval("state.edges.some(e=>e.origen==='B'&&e.destino==='X')"),false);
});
test('Navigation cancels an obsolete pending investigation safely',async()=>{
  const a=await app();
  await a.eval("(async()=>{const pending=investigate();showPage('resumen');await pending;})()");
  assert.equal(a.eval('state.page'),'resumen');
  assert.equal(a.document.getElementById('pageTitle').textContent,'Panorama del histórico');
});
test('Table pagination, search and export include all matches rather than visible page',async()=>{
  const a=await app();
  a.eval("setTables([{label:'Test',rows:Array.from({length:145},(_,i)=>({persona:'T'+i,amount:i})),columns:['persona','amount']}])");
  assert.equal(a.document.querySelectorAll('tbody tr').length,60);
  assert.equal(a.eval('state.filtered.length'),145);
  a.document.getElementById('nextPage').onclick();
  assert.ok(a.document.getElementById('tableCount').textContent.includes('61'));
  const search=a.document.getElementById('tableSearch');search.value='T1';search.oninput();
  assert.equal(a.eval('state.filtered.length'),56);
  // Replace the download surface, preserving the real CSV function and selected rows.
  a.eval("globalThis.exported=null;saveDownload=(text)=>{globalThis.exported=text;}");
  a.document.getElementById('exportTable').onclick();
  assert.equal(a.eval("exported.split('\\r\\n').length"),57);
});

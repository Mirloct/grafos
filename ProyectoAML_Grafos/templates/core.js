/* Pure query engine shared by the viewer and Node tests. No DOM or network I/O. */
(function(root) {
  'use strict';
  function parseIds(text) {
    return [...new Set(String(text).split(/[,;\r\n\t]+/).map(x => x.trim()).filter(Boolean))];
  }
  function aggregate(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = JSON.stringify([String(row.origen), String(row.destino)]);
      if (!map.has(key)) map.set(key, {origen:String(row.origen), destino:String(row.destino), suma_monto:0, ctd_trx:0});
      const edge = map.get(key);
      edge.suma_monto += Number(row.suma_monto);
      edge.ctd_trx += Number(row.ctd_trx);
    }
    return [...map.values()].map(e => ({...e, monto_promedio:e.ctd_trx ? e.suma_monto/e.ctd_trx : null}));
  }
  function index(rows) {
    const incoming = new Map(), outgoing = new Map(), nodes = new Set();
    const edges = aggregate(rows);
    edges.forEach((e, i) => {
      nodes.add(e.origen); nodes.add(e.destino);
      if (!outgoing.has(e.origen)) outgoing.set(e.origen, []);
      if (!incoming.has(e.destino)) incoming.set(e.destino, []);
      outgoing.get(e.origen).push(i); incoming.get(e.destino).push(i);
    });
    return {edges, incoming, outgoing, nodes};
  }
  function walk(idx, seeds, depth=1, direction='both', budget={visits:0, max:2000000}) {
    const nodes = new Set(seeds), traversed = new Set();
    let frontier = new Set(seeds);
    for(let step=0; step<depth && frontier.size; step++) {
      const next = new Set();
      for(const node of frontier) {
        const lists = [];
        if(direction !== 'out') lists.push(idx.incoming.get(node)||[]);
        if(direction !== 'in') lists.push(idx.outgoing.get(node)||[]);
        for(const list of lists) for(const id of list) {
          if(++budget.visits > budget.max) throw new Error('Consulta demasiado amplia: reduce personas o profundidad; ninguna tabla parcial ha sido aplicada.');
          traversed.add(id);
          const e=idx.edges[id], other=e.origen===node?e.destino:e.origen;
          if(!nodes.has(other)) {nodes.add(other); next.add(other);}
        }
      }
      frontier=next;
    }
    return {nodes, traversed};
  }
  function query(idx, seeds, depth=1, direction='both') {
    const budget={visits:0,max:2000000};
    const memberships = new Map(), traversed = new Set(), networks=[];
    for(const seed of seeds) {
      const found=walk(idx,[seed],depth,direction,budget);
      networks.push({red:seed, personas:found.nodes.size, relaciones:found.traversed.size});
      for(const node of found.nodes) {
        if(!memberships.has(node)) memberships.set(node,[]);
        memberships.get(node).push(seed);
      }
      for(const id of found.traversed) traversed.add(id);
    }
    return {networks, memberships, edges:[...traversed].map(i=>idx.edges[i])};
  }
  function csv(rows, columns) {
    const cell = value => {
      let text = String(value ?? '');
      // Spreadsheet formula injection protection for text; numeric negatives stay numeric.
      if(typeof value === 'string' && /^\s*[=+@-]/.test(text)) text="'"+text;
      return '"'+text.replace(/"/g,'""')+'"';
    };
    return '\ufeff'+[columns.map(cell).join(','), ...rows.map(r=>columns.map(k=>cell(r[k])).join(','))].join('\r\n');
  }
  function chooseView(edges, seeds, maxNodes=250, maxEdges=600) {
    const ranked=[...edges].sort((a,b)=>b.suma_monto-a.suma_monto);
    // Leave room for counterparties even when hundreds of queried IDs are supplied.
    const nodes=new Set(seeds.slice(0,Math.floor(maxNodes/2))), drawn=[];
    for(const e of ranked) {
      const extra=Number(!nodes.has(e.origen))+Number(!nodes.has(e.destino)&&e.destino!==e.origen);
      if(nodes.size+extra>maxNodes) continue;
      nodes.add(e.origen);nodes.add(e.destino);drawn.push(e);
      if(drawn.length>=maxEdges) break;
    }
    return {nodes:[...nodes],edges:drawn};
  }
  const api={parseIds,aggregate,index,walk,query,csv,chooseView};
  root.AMLCore=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);

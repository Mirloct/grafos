from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from collections import deque
from dataclasses import replace
import re

import networkx as nx
import numpy as np
import pandas as pd


ALIASES = {
    "origen": ["origen", "origin", "source", "src"],
    "destino": ["destino", "destination", "target", "dst"],
    "suma_monto": ["suma_monto", "suma_de_monto", "sum_monto", "monto_total", "amount_sum", "total_amount"],
    "ctd_trx": ["ctd_trx", "cantidad_trx", "n_trx", "num_trx", "transaction_count"],
    "codmes": ["codmes", "mes", "periodo", "month", "period"],
    "canal": ["canal", "channel", "medio", "payment_channel"],
}


@dataclass(frozen=True)
class Schema:
    origen: str
    destino: str
    suma_monto: str
    ctd_trx: str
    codmes: str | None = None
    canal: str | None = None

    @property
    def has_time(self) -> bool:
        return self.codmes is not None

    @property
    def has_channel(self) -> bool:
        return self.canal is not None


def resolve_schema(df: pd.DataFrame) -> Schema:
    """Resuelve nombres obligatorios y opcionales sin asumir codmes/canal."""
    lookup = {re.sub(r'\s+', '_', str(c).strip().lower()): str(c) for c in df.columns}
    if len(lookup) != len(df.columns):
        raise ValueError('Encabezados duplicados tras normalización.')

    def pick(name: str, required: bool) -> str | None:
        for alias in ALIASES[name]:
            if alias.lower() in lookup:
                return lookup[alias.lower()]
        if required:
            raise ValueError(f"Falta la columna obligatoria: {name}")
        return None

    return Schema(
        origen=pick("origen", True), destino=pick("destino", True),
        suma_monto=pick("suma_monto", True), ctd_trx=pick("ctd_trx", True),
        codmes=pick("codmes", False), canal=pick("canal", False),
    )


def load_data(path: str | Path) -> tuple[pd.DataFrame, Schema]:
    """Carga CSV/Excel, normaliza tipos y conserva atributos adicionales."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    df = pd.read_csv(path, dtype='string') if path.suffix.lower() == '.csv' else pd.read_excel(path, dtype='string')
    schema = resolve_schema(df)
    for col in (schema.suma_monto, schema.ctd_trx):
        df[col] = pd.to_numeric(df[col], errors='coerce')
        if df[col].isna().any() or not np.isfinite(df[col].astype(float)).all() or (df[col] < 0).any():
            raise ValueError(f'{col}: valores vacíos, negativos o no numéricos; corregir antes de generar.')
    if (df[schema.ctd_trx] <= 0).any() or (df[schema.ctd_trx] % 1 != 0).any():
        raise ValueError('ctd_trx debe ser entero positivo.')
    for col in (schema.origen, schema.destino):
        df[col] = df[col].astype("string").str.strip()
    if any(df[c].isna().any() or (df[c] == '').any() for c in (schema.origen, schema.destino)):
        raise ValueError('Origen/destino vacío: no se crearán personas ficticias.')
    for key in ('codmes', 'canal'):
        col = getattr(schema, key)
        if col:
            df[col] = df[col].str.strip().replace('', pd.NA)
            if df[col].isna().all():
                schema = replace(schema, **{key: None})
    if schema.codmes:
        months = df[schema.codmes].dropna()
        if not months.str.fullmatch(r'\d{4}(0[1-9]|1[0-2])').all():
            raise ValueError('codmes debe usar YYYYMM, por ejemplo 202501.')
    return df.reset_index(drop=True), schema


def aggregate_relations(df: pd.DataFrame, schema: Schema) -> pd.DataFrame:
    """Agrega por relación y por las dimensiones opcionales presentes."""
    group = [schema.origen, schema.destino]
    if schema.codmes:
        group.append(schema.codmes)
    if schema.canal:
        group.append(schema.canal)
    out = df.groupby(group, dropna=False, as_index=False)[[schema.suma_monto, schema.ctd_trx]].sum()
    rename = {schema.origen: "origen", schema.destino: "destino", schema.suma_monto: "suma_monto", schema.ctd_trx: "ctd_trx"}
    if schema.codmes:
        rename[schema.codmes] = "codmes"
    if schema.canal:
        rename[schema.canal] = "canal"
    out = out.rename(columns=rename)
    out["monto_promedio"] = out["suma_monto"] / out["ctd_trx"].replace(0, np.nan)
    return out


def build_graph(relations: pd.DataFrame) -> nx.DiGraph:
    """Construye el grafo histórico, sumando periodos y canales por par."""
    agg = relations.groupby(["origen", "destino"], as_index=False)[["suma_monto", "ctd_trx"]].sum()
    graph = nx.DiGraph()
    for row in agg.itertuples(index=False):
        graph.add_edge(str(row.origen), str(row.destino), suma_monto=float(row.suma_monto),
                       ctd_trx=float(row.ctd_trx), monto_promedio=float(row.suma_monto / row.ctd_trx) if row.ctd_trx else 0.0)
    return graph


def detect_communities(graph: nx.DiGraph) -> tuple[dict[str, int], list[set[str]]]:
    if graph.number_of_nodes() == 0:
        return {}, []
    projection = nx.Graph()
    projection.add_nodes_from(graph)
    for u, v, d in graph.edges(data=True):
        if u != v:
            weight = d['suma_monto']
            projection.add_edge(u, v, suma_monto=weight + projection.get_edge_data(u, v, {}).get('suma_monto', 0))
    if projection.number_of_edges() == 0:
        groups = [{n} for n in graph]
    else:
        weight = 'suma_monto' if projection.size(weight='suma_monto') > 0 else None
        groups = list(nx.community.louvain_communities(projection, seed=7, weight=weight))
    return {str(node): cid for cid, members in enumerate(groups) for node in members}, groups


def person_metrics(graph: nx.DiGraph, community: dict[str, int]) -> pd.DataFrame:
    """Calcula métricas investigativas a nivel de persona."""
    nodes = list(graph.nodes())
    if not nodes:
        return pd.DataFrame()
    amount_in, amount_out = dict(graph.in_degree(weight="suma_monto")), dict(graph.out_degree(weight="suma_monto"))
    tx_in, tx_out = dict(graph.in_degree(weight="ctd_trx")), dict(graph.out_degree(weight="ctd_trx"))
    pagerank = nx.pagerank(graph, weight="suma_monto", max_iter=1000)
    between = nx.betweenness_centrality(graph, k=min(64, len(nodes)), weight=None, seed=7)
    rows: list[dict[str, Any]] = []
    for node in nodes:
        received, sent = float(amount_in[node]), float(amount_out[node])
        rows.append({"persona": str(node), "comunidad": int(community.get(str(node), -1)),
                     "monto_recibido": received, "monto_enviado": sent, "balance_neto": received - sent,
                     "trx_recibidas": float(tx_in[node]), "trx_enviadas": float(tx_out[node]),
                     "contrapartes_entrada": int(graph.in_degree(node)), "contrapartes_salida": int(graph.out_degree(node)),
                     "ratio_salida_entrada": sent / received if received else 0.0,
                     "pagerank": float(pagerank.get(node, 0.0)), "betweenness": float(between.get(node, 0.0))})
    return pd.DataFrame(rows)


def risk_score(metrics: pd.DataFrame) -> pd.DataFrame:
    """Score explicable basado en percentiles internos, no en culpabilidad."""
    if metrics.empty:
        return metrics
    out = metrics.copy()
    weights = {"monto_recibido": .16, "monto_enviado": .16, "contrapartes_entrada": .18,
               "contrapartes_salida": .18, "betweenness": .22, "pagerank": .10}
    for col in weights:
        out[f"p_{col}"] = out[col].rank(pct=True, method="average").fillna(0.0).where(out[col] > 0, 0.0)
    out["score"] = sum(out[f"p_{col}"] * weight for col, weight in weights.items())
    out["prioridad"] = pd.cut(out["score"], [-.01, .55, .80, 1.01], labels=["Baja", "Media", "Alta"]).astype("string")
    return out.sort_values(["score", "monto_recibido"], ascending=False)


def detect_aml_patterns(graph: nx.DiGraph, metrics: pd.DataFrame) -> pd.DataFrame:
    """Genera motivos AML trazables y aptos para visualizar como subgrafos."""
    columns = ["persona", "patron", "motivo", "score", "prioridad"]
    if metrics.empty:
        return pd.DataFrame(columns=columns)
    q = {col: float(metrics[col].quantile(.80)) for col in ["monto_recibido", "monto_enviado", "contrapartes_entrada", "contrapartes_salida", "betweenness"]}
    cyclic = set().union(*[part for part in nx.strongly_connected_components(graph) if len(part) > 1])
    rows = []
    for row in metrics.itertuples(index=False):
        candidates = []
        if row.contrapartes_entrada >= q["contrapartes_entrada"] and row.monto_recibido >= q["monto_recibido"]:
            if row.contrapartes_entrada >= 2:
                candidates.append(('Concentración de entradas', 'Recibe de múltiples contrapartes y concentra monto'))
        if row.contrapartes_salida >= q["contrapartes_salida"] and row.monto_enviado >= q["monto_enviado"]:
            if row.contrapartes_salida >= 2:
                candidates.append(('Dispersión de salidas', 'Distribuye fondos hacia múltiples contrapartes'))
        if row.monto_recibido > 0 and .70 <= row.ratio_salida_entrada <= 1.30 and row.contrapartes_entrada > 0 and row.contrapartes_salida > 0:
            candidates.append(('Entradas y salidas equilibradas', 'Totales históricos de entrada y salida similares'))
        if row.betweenness >= q["betweenness"] and row.betweenness > 0:
            candidates.append(('Intermediación topológica', 'Posición en caminos mínimos del grafo histórico'))
        if row.persona in cyclic:
            candidates.append(("Circularidad", "Participa en un ciclo dirigido"))
        rows.extend({"persona": row.persona, "patron": pattern, "motivo": reason,
                     "score": float(row.score), "prioridad": row.prioridad} for pattern, reason in candidates)
    return pd.DataFrame(rows, columns=columns).sort_values("score", ascending=False)


def community_metrics(graph: nx.DiGraph, groups: list[set[str]]) -> pd.DataFrame:
    rows = []
    for cid, members in enumerate(groups):
        sub = graph.subgraph(members)
        rows.append({"comunidad": cid, "personas": len(members), "relaciones": sub.number_of_edges(),
                     "monto_interno": sum(d.get("suma_monto", 0.0) for _, _, d in sub.edges(data=True)),
                     "densidad": nx.density(sub)})
    return pd.DataFrame(rows)


def _normalise_positions(pos: dict[Any, Any]) -> dict[str, list[float]]:
    if not pos:
        return {}
    arr = np.asarray(list(pos.values()), dtype=float)
    centre, scale = arr.mean(axis=0), max(np.abs(arr - arr.mean(axis=0)).max(), 1e-9)
    return {str(node): [round(float((xy[0] - centre[0]) / scale), 5), round(float((xy[1] - centre[1]) / scale), 5)] for node, xy in pos.items()}


def graph_layouts(graph: nx.DiGraph, community: dict[str, int]) -> dict[str, dict[str, list[float]]]:
    """Cinco vistas reproducibles para comparar la legibilidad del grafo."""
    names = ["Fuerza", "Comunidades", "Flujo", "Radial", "Circular"]
    if graph.number_of_nodes() == 0:
        return {name: {} for name in names}
    if graph.number_of_nodes() > 500:
        # Posiciones baratas para todo el universo. El navegador calcula fuerza solo para la vista acotada.
        pos = _normalise_positions(nx.circular_layout(graph))
        return {name: pos for name in names}
    und = graph.to_undirected()
    force = nx.spring_layout(und, seed=11, weight="suma_monto", iterations=120)
    ids = sorted(set(community.values()))
    centres = nx.circular_layout(ids, scale=.75) if ids else {}
    community_pos = {}
    for cid in ids:
        members = [n for n in graph if community.get(str(n)) == cid]
        local = nx.spring_layout(und.subgraph(members), seed=cid + 17, scale=.23)
        for node, xy in local.items():
            community_pos[str(node)] = np.asarray(xy) + np.asarray(centres[cid])
    sources = [n for n in graph if graph.in_degree(n) == 0] or [min(graph, key=lambda n: graph.in_degree(n) - graph.out_degree(n))]
    depth, queue = {str(n): 0 for n in sources}, deque(sources)
    while queue:
        node = queue.popleft()
        for nxt in graph.successors(node):
            proposed = min(depth[str(node)] + 1, 8)
            if str(nxt) not in depth or proposed < depth[str(nxt)]:
                depth[str(nxt)] = proposed
                queue.append(nxt)
    for node in graph:
        depth.setdefault(str(node), 4)
    layers: dict[int, list[str]] = {}
    for node, level in depth.items():
        layers.setdefault(level, []).append(node)
    flow = {node: np.array([level, i - (len(members) - 1) / 2]) for level, members in layers.items() for i, node in enumerate(sorted(members))}
    degree_sorted = sorted(graph, key=lambda n: graph.degree(n), reverse=True)
    cut1, cut2 = max(1, len(degree_sorted) // 8), max(2, len(degree_sorted) // 3)
    shells = [part for part in [degree_sorted[:cut1], degree_sorted[cut1:cut2], degree_sorted[cut2:]] if part]
    return {"Fuerza": _normalise_positions(force), "Comunidades": _normalise_positions(community_pos),
            "Flujo": _normalise_positions(flow), "Radial": _normalise_positions(nx.shell_layout(und, shells)),
            "Circular": _normalise_positions(nx.circular_layout(und))}

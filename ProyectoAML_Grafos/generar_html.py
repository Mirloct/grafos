from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from datetime import datetime, timezone
from time import perf_counter

import pandas as pd
import networkx as nx
from plotly.offline import get_plotlyjs
from tqdm.auto import tqdm
from src.aml_graph import (aggregate_relations, build_graph, community_metrics, detect_aml_patterns,
                          detect_communities, load_data, person_metrics, risk_score)


def serialise(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records", force_ascii=False, double_precision=10))


class HealthCheckpoints:
    def __init__(self, enabled: bool = True):
        self.enabled, self.started = enabled, perf_counter()

    def report(self, stage: str, **values) -> None:
        if not self.enabled:
            return
        details = ' · '.join(f'{key}={value:,}' if isinstance(value, int) else f'{key}={value}'
                             for key, value in values.items())
        tqdm.write(f'[salud +{perf_counter() - self.started:,.1f}s] {stage}' + (f' · {details}' if details else ''))


def file_digest(path: str | Path, show_progress: bool) -> str:
    digest = hashlib.sha256()
    source_path = Path(path)
    with source_path.open('rb') as source, tqdm(total=source_path.stat().st_size, desc='Hash SHA-256',
                                                unit='B', unit_scale=True, disable=not show_progress) as bar:
        while block := source.read(8 * 1024 * 1024):
            digest.update(block)
            bar.update(len(block))
    return digest.hexdigest()


def build_payload(path: str | Path, nodes: set[str] | None = None, chunksize: int = 250_000,
                  show_progress: bool = False, compute_hash: bool = True) -> dict:
    health = HealthCheckpoints(show_progress)
    health.report('inicio', archivo=Path(path).name, nodos_filtro=len(nodes or set()))
    data, schema = load_data(path, nodes=nodes, chunksize=chunksize, show_progress=show_progress)
    health.report('carga y validación completas', filas=len(data))
    relations = aggregate_relations(data, schema)
    health.report('agregación completa', relaciones_segmentadas=len(relations))
    graph = build_graph(relations)
    health.report('grafo construido', nodos=len(graph), aristas=graph.number_of_edges())
    mapping, groups = detect_communities(graph)
    health.report('comunidades calculadas', comunidades=len(groups))
    persons = risk_score(person_metrics(graph, mapping))
    health.report('métricas calculadas', personas=len(persons))
    edges = pd.DataFrame([{"origen": u, "destino": v, **d} for u, v, d in graph.edges(data=True)])
    def dimension(column, label):
        if column is None:
            return []
        table = data.dropna(subset=[column]).groupby(column)[[schema.suma_monto, schema.ctd_trx]].sum().reset_index()
        return serialise(table.rename(columns={column: label, schema.suma_monto: "monto", schema.ctd_trx: "transacciones"}))
    digest = file_digest(path, show_progress) if compute_hash else None
    health.report('integridad calculada' if compute_hash else 'hash omitido')
    canonical = {schema.origen, schema.destino, schema.suma_monto, schema.ctd_trx, schema.codmes, schema.canal}
    payload = {
        "schema": {"codmes": schema.codmes, "canal": schema.canal},
        "summary": {"people": len(graph), "relations": graph.number_of_edges(),
                    "amount": float(data[schema.suma_monto].sum()),
                    "transactions": int(data[schema.ctd_trx].sum()),
                    "communities": len(groups)},
        "persons": serialise(persons), "edges": serialise(edges),
        "communities": serialise(community_metrics(graph, groups)),
        "patterns": serialise(detect_aml_patterns(graph, persons)),
        "relations": serialise(relations),
        "monthly": dimension(schema.codmes, "periodo"), "channels": dimension(schema.canal, "canal"),
        "strong_components": [sorted(s) for s in nx.strongly_connected_components(graph) if len(s) > 1],
        "meta": {"sha256": digest, "generated": datetime.now(timezone.utc).isoformat(),
                 "input_rows": len(data), "betweenness_samples": min(64, len(graph)),
                 "node_filter_count": len(nodes or set()), "chunksize": chunksize,
                 "additional_columns": [c for c in data if c not in canonical],
                 "versions": {p: importlib.metadata.version(p) for p in
                              ("pandas", "numpy", "networkx", "scipy", "plotly", "openpyxl")}}
    }
    health.report('payload listo')
    return payload


def generate(path: str | Path, output: str | Path, nodes: set[str] | None = None,
             chunksize: int = 250_000, show_progress: bool = False, compute_hash: bool = True) -> Path:
    root = Path(__file__).parent
    output = Path(output)
    payload = build_payload(path, nodes=nodes, chunksize=chunksize, show_progress=show_progress,
                            compute_hash=compute_hash)
    # Data is embedded as inert JSON; literal closing tags cannot escape the script container.
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c")
    template = (root / "templates/visor.html").read_text(encoding="utf-8")
    core = (root / "templates/core.js").read_text(encoding="utf-8")
    app = (root / "templates/app.js").read_text(encoding="utf-8")
    style = (root / "templates/style.css").read_text(encoding="utf-8")
    replacements = {"STYLE": style, "PLOTLY": get_plotlyjs(), "PAYLOAD": encoded, "CORE": core, "APP": app}
    # Single pass: identifiers that resemble template markers remain literal data.
    html = re.sub(r"__(STYLE|PLOTLY|PAYLOAD|CORE|APP)__", lambda match: replacements[match[1]], template)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    documentation = (root / "templates/documentacion.html").read_text(encoding="utf-8")
    import html as html_module
    documentation = documentation.replace("__VERSIONS__", html_module.escape(
        json.dumps(payload["meta"], ensure_ascii=False, indent=2)))
    (output.parent / "documentacion_proyecto.html").write_text(documentation, encoding="utf-8")
    if show_progress:
        tqdm.write(f'[salud] archivos escritos · visor={output.resolve()} · documentación={(output.parent / "documentacion_proyecto.html").resolve()}')
    return output.resolve()


def parse_nodes(values: str | None, file: str | None) -> set[str]:
    nodes = {item.strip() for item in re.split(r'[,;\t\r\n]+', values or '') if item.strip()}
    if file:
        nodes.update(item.strip() for item in re.split(r'[,;\t\r\n]+', Path(file).read_text(encoding='utf-8')) if item.strip())
    return nodes


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera visor y documentación HTML independientes")
    parser.add_argument("--input", required=True, help="CSV o XLSX agregado por origen/destino/mes/canal")
    parser.add_argument("--output", default="outputs/visor_aml_grafos.html")
    parser.add_argument("--nodes", help="IDs a conservar, separados por coma, punto y coma o saltos")
    parser.add_argument("--nodes-file", help="TXT con IDs a conservar")
    parser.add_argument("--chunksize", type=int, default=250_000, help="Filas por bloque de lectura CSV")
    parser.add_argument("--no-progress", action="store_true", help="Oculta barras, ETA y checkpoints")
    parser.add_argument("--skip-hash", action="store_true", help="Evita una segunda lectura completa para SHA-256")
    args = parser.parse_args()
    if args.chunksize < 1:
        parser.error('--chunksize debe ser mayor que cero')
    nodes = parse_nodes(args.nodes, args.nodes_file)
    print(f"Generado: {generate(args.input, args.output, nodes=nodes, chunksize=args.chunksize, show_progress=not args.no_progress, compute_hash=not args.skip_hash)}")


if __name__ == "__main__":
    main()

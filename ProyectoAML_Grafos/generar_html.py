from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone
from time import perf_counter


def _version_tuple(value: str) -> tuple[int, ...]:
    """Comparación suficiente para las restricciones numéricas >= de requirements.txt."""
    return tuple(int(part) for part in re.findall(r'\d+', value.split('+', 1)[0])[:4])


def ensure_dependencies() -> None:
    """Instala dependencias ausentes o anteriores al mínimo antes de importarlas."""
    requirements = Path(__file__).with_name('requirements.txt')
    missing: list[str] = []
    for raw in requirements.read_text(encoding='utf-8').splitlines():
        line = raw.split('#', 1)[0].strip()
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)>=(\d+(?:\.\d+)*)', line)
        if not match:
            continue
        package, minimum = match.groups()
        try:
            installed = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(f'{package}>={minimum}')
            continue
        if _version_tuple(installed) < _version_tuple(minimum):
            missing.append(f'{package}>={minimum}')
    if not missing:
        print('[dependencias] OK · requisitos mínimos disponibles')
        return
    print('[dependencias] Instalando automáticamente: ' + ', '.join(missing), flush=True)
    subprocess.run(
        [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(requirements)],
        check=True,
    )
    unresolved: list[str] = []
    for item in missing:
        package, minimum = item.split('>=', 1)
        try:
            installed = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            unresolved.append(item)
            continue
        if _version_tuple(installed) < _version_tuple(minimum):
            unresolved.append(item)
    if unresolved:
        raise RuntimeError('La instalación terminó sin satisfacer: ' + ', '.join(unresolved))


ensure_dependencies()

import pandas as pd
import networkx as nx
from plotly.offline import get_plotlyjs
from tqdm.auto import tqdm
from src.aml_graph import (aggregate_relations, build_graph, community_metrics, detect_aml_patterns,
                          detect_communities, load_data, person_metrics, risk_score)


def serialise(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records", force_ascii=False, double_precision=10))


class HealthCheckpoints:
    def __init__(self, enabled: bool = True, log_file: str | Path | None = None):
        self.enabled, self.started = enabled, perf_counter()
        self.log_file = Path(log_file) if log_file else None
        if self.log_file:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            self.log_file.write_text(
                f'{datetime.now(timezone.utc).isoformat()} · inicio de ejecución\n', encoding='utf-8'
            )

    def report(self, stage: str, **values) -> None:
        details = ' · '.join(f'{key}={value:,}' if isinstance(value, int) else f'{key}={value}'
                             for key, value in values.items())
        message = f'[salud +{perf_counter() - self.started:,.1f}s] {stage}' + (f' · {details}' if details else '')
        if self.enabled:
            tqdm.write(message)
        if self.log_file:
            with self.log_file.open('a', encoding='utf-8') as target:
                target.write(f'{datetime.now(timezone.utc).isoformat()} · {message}\n')


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
                  show_progress: bool = False, compute_hash: bool = True,
                  extract_depth: int = 1, max_retained_rows: int | None = 2_000_000,
                  log_file: str | Path | None = None) -> dict:
    health = HealthCheckpoints(show_progress, log_file)
    health.report('inicio', archivo=Path(path).name, nodos_filtro=len(nodes or set()))
    progress_format = '{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}]'
    with tqdm(total=8, desc='Pipeline', unit='etapa', disable=not show_progress,
              bar_format=progress_format) as pipeline:
        data, schema = load_data(
            path, nodes=nodes, chunksize=chunksize, show_progress=show_progress,
            extract_depth=extract_depth, max_retained_rows=max_retained_rows,
        )
        pipeline.update(); health.report('carga y validación completas', filas=len(data))
        relations = aggregate_relations(data, schema)
        pipeline.update(); health.report('agregación completa', relaciones_segmentadas=len(relations))
        graph = build_graph(relations)
        pipeline.update(); health.report('grafo construido', nodos=len(graph), aristas=graph.number_of_edges())
        mapping, groups = detect_communities(graph)
        pipeline.update(); health.report('comunidades calculadas', comunidades=len(groups))
        persons = risk_score(person_metrics(graph, mapping))
        pipeline.update(); health.report('métricas calculadas', personas=len(persons))
        edges = pd.DataFrame([{"origen": u, "destino": v, **d} for u, v, d in graph.edges(data=True)])
        patterns = detect_aml_patterns(graph, persons)
        pipeline.update(); health.report('patrones calculados', coincidencias=len(patterns))

        def dimension(column, label):
            if column is None:
                return []
            table = data.dropna(subset=[column]).groupby(column)[[schema.suma_monto, schema.ctd_trx]].sum().reset_index()
            return serialise(table.rename(columns={column: label, schema.suma_monto: "monto", schema.ctd_trx: "transacciones"}))

        digest = file_digest(path, show_progress) if compute_hash else None
        pipeline.update(); health.report('integridad calculada' if compute_hash else 'hash omitido')
        canonical = {schema.origen, schema.destino, schema.suma_monto, schema.ctd_trx, schema.codmes, schema.canal}
        payload = {
            "schema": {"codmes": schema.codmes, "canal": schema.canal},
            "summary": {"people": len(graph), "relations": graph.number_of_edges(),
                        "amount": float(data[schema.suma_monto].sum()),
                        "transactions": int(data[schema.ctd_trx].sum()),
                        "communities": len(groups)},
            "persons": serialise(persons), "edges": serialise(edges),
            "communities": serialise(community_metrics(graph, groups)),
            "patterns": serialise(patterns),
            "relations": serialise(relations),
            "monthly": dimension(schema.codmes, "periodo"), "channels": dimension(schema.canal, "canal"),
            "strong_components": [sorted(s) for s in nx.strongly_connected_components(graph) if len(s) > 1],
            "meta": {"sha256": digest, "generated": datetime.now(timezone.utc).isoformat(),
                     "input_rows": len(data), "betweenness_samples": min(64, len(graph)),
                     "node_filter_count": len(nodes or set()), "chunksize": chunksize,
                     "extract_depth": extract_depth, "max_retained_rows": max_retained_rows,
                     "additional_columns": [c for c in data if c not in canonical],
                     "versions": {p: importlib.metadata.version(p) for p in
                                  ("pandas", "numpy", "networkx", "scipy", "plotly", "openpyxl", "tqdm")}}
        }
        pipeline.update(); health.report('payload listo')
    return payload


def generate(path: str | Path, output: str | Path, nodes: set[str] | None = None,
             chunksize: int = 250_000, show_progress: bool = False, compute_hash: bool = True,
             extract_depth: int = 1, max_retained_rows: int | None = 2_000_000,
             log_file: str | Path | None = None) -> Path:
    root = Path(__file__).parent
    output = Path(output)
    log_file = Path(log_file) if log_file else output.with_suffix('.log')
    try:
        payload = build_payload(path, nodes=nodes, chunksize=chunksize, show_progress=show_progress,
                                compute_hash=compute_hash, extract_depth=extract_depth,
                                max_retained_rows=max_retained_rows, log_file=log_file)
    except Exception as error:
        with log_file.open('a', encoding='utf-8') as target:
            target.write(f'{datetime.now(timezone.utc).isoformat()} · ERROR · {type(error).__name__}: {error}\n')
        raise
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
        tqdm.write(f'[salud] archivos escritos · visor={output.resolve()} · documentación={(output.parent / "documentacion_proyecto.html").resolve()} · log={log_file.resolve()}')
    with log_file.open('a', encoding='utf-8') as target:
        target.write(f'{datetime.now(timezone.utc).isoformat()} · archivos escritos · visor={output.resolve()} · documentación={(output.parent / "documentacion_proyecto.html").resolve()}\n')
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
    parser.add_argument("--extract-depth", type=int, choices=(1, 2, 3), default=1,
                        help="Capas que se preextraen alrededor de --nodes (CSV)")
    parser.add_argument("--max-retained-rows", type=int, default=2_000_000,
                        help="Límite de filas tras filtrar; use 0 para desactivarlo deliberadamente")
    parser.add_argument("--log-file", help="Ruta del log; por defecto usa el nombre del visor con extensión .log")
    parser.add_argument("--no-progress", action="store_true", help="Oculta barras, ETA y checkpoints")
    parser.add_argument("--skip-hash", action="store_true", help="Evita una segunda lectura completa para SHA-256")
    args = parser.parse_args()
    if args.chunksize < 1:
        parser.error('--chunksize debe ser mayor que cero')
    if args.max_retained_rows < 0:
        parser.error('--max-retained-rows no puede ser negativo')
    nodes = parse_nodes(args.nodes, args.nodes_file)
    if args.extract_depth > 1 and not nodes:
        parser.error('--extract-depth > 1 requiere --nodes o --nodes-file')
    print(f"Generado: {generate(args.input, args.output, nodes=nodes, chunksize=args.chunksize, show_progress=not args.no_progress, compute_hash=not args.skip_hash, extract_depth=args.extract_depth, max_retained_rows=args.max_retained_rows or None, log_file=args.log_file)}")


if __name__ == "__main__":
    main()

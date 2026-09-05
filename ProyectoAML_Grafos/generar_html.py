from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from datetime import datetime, timezone

import pandas as pd
import networkx as nx
from plotly.offline import get_plotlyjs
from src.aml_graph import (aggregate_relations, build_graph, community_metrics, detect_aml_patterns,
                          detect_communities, load_data, person_metrics, risk_score)


def serialise(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records", force_ascii=False, double_precision=10))


def build_payload(path: str | Path) -> dict:
    data, schema = load_data(path)
    relations = aggregate_relations(data, schema)
    graph = build_graph(relations)
    mapping, groups = detect_communities(graph)
    persons = risk_score(person_metrics(graph, mapping))
    edges = pd.DataFrame([{"origen": u, "destino": v, **d} for u, v, d in graph.edges(data=True)])
    def dimension(column, label):
        if column is None:
            return []
        table = data.dropna(subset=[column]).groupby(column)[[schema.suma_monto, schema.ctd_trx]].sum().reset_index()
        return serialise(table.rename(columns={column: label, schema.suma_monto: "monto", schema.ctd_trx: "transacciones"}))
    with Path(path).open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    canonical = {schema.origen, schema.destino, schema.suma_monto, schema.ctd_trx, schema.codmes, schema.canal}
    return {
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
                 "additional_columns": [c for c in data if c not in canonical],
                 "versions": {p: importlib.metadata.version(p) for p in
                              ("pandas", "numpy", "networkx", "scipy", "plotly", "openpyxl")}}
    }


def generate(path: str | Path, output: str | Path) -> Path:
    root = Path(__file__).parent
    output = Path(output)
    payload = build_payload(path)
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
    return output.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera visor y documentación HTML independientes")
    parser.add_argument("--input", required=True, help="CSV o XLSX agregado por origen/destino/mes/canal")
    parser.add_argument("--output", default="outputs/visor_aml_grafos.html")
    args = parser.parse_args()
    print(f"Generado: {generate(args.input, args.output)}")


if __name__ == "__main__":
    main()

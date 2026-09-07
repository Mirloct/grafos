# Network Intelligence — proyecto de grafos

El producto principal es un visor HTML autónomo para investigar el histórico de personas que aparecen como origen o destino. La documentación completa se genera por separado en `outputs/documentacion_proyecto.html`.

## Generar los dos HTML

Desde esta carpeta, en Python 3.12:

```shell
python -m pip install -r requirements.lock.txt
python generar_html.py --input data/base.csv --output outputs/visor_aml_grafos.html
```

La generación escribe el visor y la documentación en el mismo directorio. Plotly queda integrado: no se necesita conexión al abrirlos. La consola muestra una barra `tqdm` con porcentaje, velocidad y ETA durante la lectura, otra durante el hash, y checkpoints de salud con duración, filas, nodos y aristas.

## Archivo grande (recomendación para 5 GB)

No genere un HTML con los 5 GB completos: pandas, NetworkX, la serialización JSON y el navegador pueden requerir varias veces ese tamaño. Prepare un TXT con un ID por línea y filtre durante la lectura:

```shell
python generar_html.py --input D:\datos\movimientos.csv --nodes-file data\personas_interes.txt --chunksize 250000 --skip-hash --output outputs\visor_filtrado.html
```

El CSV se recorre por bloques y solo se conservan filas donde `origen` o `destino` coincide exactamente con un ID. Esto obtiene la vecindad directa de las semillas sin cargar en RAM las demás filas. El visor sí puede buscar y filtrar todos los nodos que quedaron en ese subgrafo; no puede recuperar después nodos descartados. Para 2–3 saltos sobre 5 GB, extraiga esos vecinos en la base de datos origen o ejecute pasadas sucesivas ampliando la lista. Use CSV, SSD local y empiece con `--chunksize 250000`; pruebe 500000–1000000 únicamente si hay RAM holgada. Quite `--skip-hash` cuando necesite trazabilidad SHA-256: implica una segunda lectura completa del archivo.

## Contrato

Campos obligatorios: `origen`, `destino`, `suma_monto`, `ctd_trx`.
Opcionales independientes: `codmes` (YYYYMM), `canal`.
Ambos, uno o ninguno son válidos. Una dimensión completamente vacía no crea pestaña ni filtro.

Los IDs se leen como texto. CSV usa coma y punto decimal; XLSX requiere IDs ya almacenados como texto. Los valores inválidos no se convierten silenciosamente a cero. La fuente debe estar agregada y sin duplicaciones causadas por concatenar extracciones de personas que interactúan entre sí.

## Investigar múltiples redes

- Pegar IDs con comas, punto y coma, tabulaciones o saltos de línea; también importar un .txt.
- Consultar entradas/salidas históricas a 1–3 saltos.
- Cada persona define una red ego; Pertenencias expone miembros compartidos.
- Guardar agrupaciones con nombre durante la sesión y compararlas en Mis redes.
- Exportar las definiciones JSON antes de recargar: las redes se guardan en memoria, no en un servidor.
- Louvain proporciona comunidades estructurales exclusivas; las redes del investigador sí se superponen.
- Exportar CSV de cualquier tabla, incluyendo todas las filas filtradas y ordenadas, no solo la página visible.
- Cambiar tema claro/oscuro para actualizar toda la página y sus gráficos.
- Explorar Patrones de interacción con lenguaje neutral y subgrafos.

El gráfico muestra hasta 250 nodos/600 relaciones; las tablas mantienen el resultado completo. Los índices de centralidad y patrones siguen referidos al histórico cargado. La comparación entre redes guardadas conserva pertenencias por filtro, pero muestra el monto histórico de cada relación una sola vez.

## Verificación

```shell
python -m unittest discover -s tests -v
node --test tests/core.test.cjs
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

Las pruebas DOM usan LinkeDOM y un receptor de trazas en lugar de un navegador. No sustituyen la inspección visual de Plotly.

## Mantenimiento

Editar `src/aml_graph.py` para la analítica; `templates/core.js` para consultas y exportación; `templates/app.js` para interacción; `templates/style.css` para estilos; `templates/documentacion.html` para documentación. Regenerar los HTML después de modificar fuentes.

No se incluye sección de metodología ni de calidad en el visor. El documento adicional contiene fundamentos, límites, reglas exactas, librerías, versiones, hash de entrada, fuentes y evolución de atributos.

La base de ejemplo es sintética. Las verificaciones sobre ella comprueban funcionamiento, no eficacia de detección en datos reales.

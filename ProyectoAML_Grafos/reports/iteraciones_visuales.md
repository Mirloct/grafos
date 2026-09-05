# Iteraciones visuales del grafo

Actualización 04/09/2026: registro de cinco alternativas geométricas implementadas. Las pruebas verifican coordenadas finitas e interacciones; no constituyen cinco inspecciones visuales en navegador. La documentación vigente es `../outputs/documentacion_proyecto.html`.

## 1. Circular

Punto de partida. Es determinista, pero produce cruces y no revela estructura. Se mantiene solo para comparación en redes pequeñas.

## 2. Fuerza dirigida

Reduce cruces al acercar nodos relacionados. Se adopta como vista por defecto para exploración general.

## 3. Comunidades

Separa grupos Louvain en centros distintos y distribuye sus miembros en círculos locales. No confunde esa partición exclusiva con las redes superpuestas del investigador.

## 4. Flujo horizontal

Ordena entradas y salidas en capas horizontales alrededor de las semillas. Es una lectura estructural dirigida, no una reconstrucción cronológica de fondos.

## 5. Radial

Ubica nodos por índice histórico en anillos. Ese índice combina atributos estructurales y montos; no equivale al grado ni a una probabilidad.

## Decisiones finales

- El gráfico ocupa el área dominante y la tabla queda a la derecha.
- Las etiquetas permanentes se limitan a nodos consultados, señalados o con score alto.
- El resto de los atributos se consulta mediante hover.
- Las flechas se orientan según la geometría de cada arista.
- Entradas, salidas y contexto se distinguen por color y grosor.
- Cada motivo AML genera su propio subgrafo con vecinos y tabla trazable.
- Las pestañas opcionales no se incorporan a la navegación cuando sus campos faltan.

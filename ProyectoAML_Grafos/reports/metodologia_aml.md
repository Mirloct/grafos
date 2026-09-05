# Metodología AML del visor

> Antecedente de una versión anterior. Desde el 04/09/2026, la metodología se mantiene únicamente en `templates/documentacion.html` y se entrega en `outputs/documentacion_proyecto.html`. Este registro no describe todos los comportamientos del visor actual y no se incorpora a él.

## Qué intenta resolver

El visor convierte transferencias agregadas entre personas en una red dirigida para localizar estructuras que merecen revisión: intermediación, concentración, comunidades, cadenas, ciclos y cambios mensuales o por canal.

## Qué no puede resolver todavía

Con `origen`, `destino`, `suma_monto`, `ctd_trx` y, opcionalmente, `codmes`/`canal`, no existe suficiente evidencia para determinar intención, beneficiario final, origen de fondos, destino económico, geografía, KYC ni financiación terrorista. Por eso el resultado es una señal priorizada y explicada.

## Criterio de construcción

1. Agregar relaciones por origen y destino.
2. Conservar monto total y número de transacciones.
3. Calcular métricas ponderadas y no ponderadas.
4. Comparar cada persona con la distribución de la propia base.
5. Combinar señales; ningún indicador aislado dispara una conclusión.
6. Mostrar evidencia y limitaciones en la ficha de investigación.

## Recomendaciones ACFE/COSO

El análisis se integra dentro de cinco capacidades: gobierno del riesgo, evaluación periódica, controles preventivos/detectivos, investigación con acción correctiva y monitoreo continuo. La analítica no reemplaza entrevistas, denuncias, controles ni revisión humana.

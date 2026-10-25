# Control de versiones del Informe 2 — Fin de Mes

La versión de trabajo está en `Nueva version de informe/`. Cada versión anterior queda congelada en
`versiones-anteriores/vX.Y (fecha)/` con su informe (.docx y .pdf), su flujo de caja y, desde la v0.4,
la Carta Gantt. Al cerrar una versión: se copia su carpeta completa a `versiones-anteriores/`, se sube
el número en los nombres de archivo de `Nueva version de informe/` y se agrega una fila a esta tabla.

| Versión | Fecha | Usuarios al lanzamiento | Conversión | VAN (flujo puro) | TIR | Recuperación (con CORFO) | Páginas | Cambios principales |
|---|---|---|---|---|---|---|---|---|
| v0.1 | 21-10-2026 | 5.500 | 5 % | $52,1 M | 92,1 % | 2,8 años (2,1) | — | Primera versión compilada con los scripts. Correcciones de la revisión del 21-10 contra la pauta. |
| v0.2 | 22-10-2026 | 5.500 | 4 % | $25,4 M | 56,4 % | 3,5 años (3,1) | 137 | Conversión bajada de 5 % a 4 % (sobre el cuartil superior freemium). Embudo de adquisición y bases de los KPI. |
| v0.3 | 23-10-2026 | 7.000 | 4 % | $53,9 M | 94,3 % | 2,8 años (2,1) | 137 | Usuarios de 5.500 a 7.000 para recuperar en ≈ 2 años con CORFO. Última versión generada con los scripts. |
| v0.4 | 24-10-2026 | 7.000 | 4 % | $54,3 M | 94,9 % | 2,8 años (2,1) | 138 | Editada en Word: citas con el administrador de fuentes y bibliografía automática. Capítulo VIII con formato de evaluación de proyectos (Q × Pu, equipos aportados en especie con depreciación acelerada, financiamiento). Carta Gantt desde la planilla. |
| v0.5 | 25-10-2026 | 7.500 | 4 % | $63,6 M | 108,6 % | 2,5 años (1,0) | 138 | Usuarios de 7.000 a 7.500. Se actualizaron el flujo de caja y el capítulo VIII (Tablas 112 a 121, embudo, impuestos con pérdida de arrastre, flujo mensual, sensibilidad con filas de 5.000 a 7.500), las conclusiones y el Anexo C. Fintoc sin cambios. |
| v0.6 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 139 | Se aplica la «Alternativa costo Fintoc»: 10 UF + IVA con hasta 500 cuentas (costo fijo), tramos de 0,015 / 0,010 / 0,007 UF por cuenta adicional (costo de venta) y 1,5 bancos por persona; se elimina la tarifa de 0,02 UF. Fuentes nuevas Costbench y xpay. Citas y bibliografía actualizadas al estilo APA 7. |
| v0.7 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 139 | Sin cambios de cifras. Lenguaje más formal en todo el informe (156 reemplazos) y signo de moneda en todos los costos: $ en la Tabla 120 y US$ en la Tabla 4. Detalle en `Cambios v0.7.txt`. |
| v0.8 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 139 | Sin cambios de cifras. Firewall (grupos de seguridad de AWS) en las Ilustraciones 27, 28 y 29, regeneradas con sus scripts; Tabla 79 y secciones 3.5 y 3.6 actualizadas. Detalle en `Cambios v0.8.txt`. |
| v0.9 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 139 | Sin cambios de cifras. Se eliminan las referencias a archivos externos (planilla Excel, hojas, ADR), porque solo se entrega el .docx; se mantienen las del primer informe. Detalle en `Cambios v0.9.txt`. |
| v0.10 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 139 | Sin cambios de cifras. Se eliminan las menciones a observaciones o revisiones del primer informe (secciones 3.1 y 3.6), porque este informe se basa en el primer informe ya corregido. Detalle en `Cambios v0.10.txt`. |
| v0.11 | 25-10-2026 | 7.500 | 4 % | $56,2 M | 96,0 % | 2,8 años (2,1) | 138 | Sin cambios de cifras. Se quitan «supuesto», «hipótesis» y «por confirmar»: la tarifa de Fintoc y los demás parámetros se presentan como datos firmes; la sección 8.2 pasa a «Parámetros del modelo». Detalle en `Cambios v0.11.txt`. |

## Detalle de la v0.6 (25-10-2026)
- **Fintoc:** mensualidad de 10 UF + IVA ($5.864.136 en 2027) que incluye hasta 500 cuentas; sobre eso, 0,015 UF por cuenta hasta 2.000, 0,010 UF hasta 5.000 y 0,007 UF sobre 5.000 (con IVA). 1,08 cuentas por pagador (60 % conecta, 1,5 bancos por persona, plan familiar de 2 personas): 404 cuentas en 2027 y 3.785 en 2031 ($33,2 M al año).
- **Indicadores:** VAN $56.171.131 (inversionista $68.171.131), TIR 96,0 % (166,5 %), recuperación simple 2,8 años (2,1 con CORFO), descontada 3,2 años (2,2). Punto de equilibrio: 553 pagadores al mes.
- **Caja del año 1:** déficit máximo $11.356.775; con el subsidio la caja no baja de $3.643.225.
- **Sensibilidad a los bancos por persona:** 1 banco → VAN $63,0 M, recuperación 2,6 años; 2 bancos → VAN $49,6 M, recuperación 3,0 años.
- **Pendiente:** la cotización por volumen de Fintoc (Anexo C).

## Detalle de la v0.5 (25-10-2026)
- **Supuesto:** 7.500 usuarios activos en el primer trimestre (0,12 % de los 6,1 millones de deudores, CMF).
- **Embudo:** ≈ 129.100 visitas (≈ 43.000 al mes, noviembre de 2026 a enero de 2027) → 10.715 cuentas (8,3 %) → 7.500 activos (70 %).
- **Año 1:** 9.363 usuarios promedio, 375 pagadores promedio, ventas $24.360.327; 270 cuentas en Fintoc (rige el mínimo de 10 UF).
- **Indicadores:** VAN $63.570.338 (inversionista $75.570.338), TIR 108,6 % (192,2 %), recuperación simple 2,5 años (0,96 con CORFO), descontada 2,9 años (1,4).
- **Caja del año 1:** déficit máximo $10.420.485; con el subsidio la caja no baja de $4.579.515.
- **Impuestos:** la pérdida de 2027 ($12.102.925) absorbe la utilidad de 2028; el saldo ($10.387.822) se descuenta en 2029, primer impuesto $4.150.193.
- **Ojo:** con el subsidio la recuperación queda en menos de un año, porque el flujo de 2027 más los $15 M de CORFO ya supera la inversión inicial. La propuesta `Alternativa costo Fintoc - Fin de Mes.docx` (24-10) combinaba los 7.500 usuarios con Fintoc con IVA y por tramos (2,8 y 2,1 años); no se aplicó.

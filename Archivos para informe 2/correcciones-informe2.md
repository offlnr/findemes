# Correcciones del Informe 2 — Fin de Mes

Lista de trabajo a partir de la revisión del 21-10-2026 contra la pauta `TIHI84_U2_ES2_EA4.xlsx`.
Leyenda: ✅ listo · ❌ pendiente.

## Meta general
Corregir los 7 puntos **sin que el informe crezca mucho**: partió con 129 páginas y terminó con 137 (+5 por los BPMN, +1 por las citas de la tabla de normas, +2 por el embudo y las bases de los KPI).
Restricción: **sin gasto real**. Toda herramienta o servicio debe ser gratuito o tener un plan
gratuito que cubra el proyecto, como mínimo hasta fines de diciembre de 2026.

---

## 1. ✅ Cerrar las decisiones abiertas (Anexo C)
- ✅ Proveedor de correo transaccional (Tabla 15, SLA-007, actor de los casos de uso)
- ✅ Tecnología del panel de administración (Tabla 79)
- ✅ Plan de Tailscale (SLA-008)
- ✅ Registro de consentimientos, Ley 21.719 (sección 3.4, modelo de datos)
- ✅ Medición del registro inicial para los KPI (Tabla 82)
- ✅ Hogar cuyo administrador elimina su cuenta; gasto común sin regla de aporte
- ✅ Validación de la planificación por fases por ambos socios (sección 7.1.3)
- ✅ Reducir el Anexo C: quedan solo CORFO y la confirmación del sueldo y de la tarifa de Fintoc

## 2. ✅ Resolver inconsistencias
- ✅ Fechas: portada 26-10-2026 (entrega); fichas de casos de uso 21-10-2026
- ✅ HU32/HU36 nombran a Plaid en el Informe 1; HU13/HU15 con distinto actor → nota en la introducción
- ✅ Tabla 15: BPMN «con Bizagi Modeler» → 13 diagramas exportados desde Bizagi e incorporados al informe
- ✅ Sección 5.1: al 21-10-2026, 61 pruebas unitarias y 122 de base de datos
- ✅ AWS CloudFormation: se mantiene como compromiso de la fase F2 (texto en futuro)

## 3. ✅ Quitar referencias internas y jerga
- ✅ «(cu-1)» y «(cu-3)» en las fichas → nombre del diagrama de casos de uso
- ✅ «migraciones 0001 a 0009», `app.users`, `app.refresh_tokens.created_at`,
      `percentile_cont(0.5)`, `app_api`, `app.clp`, `/v1` → lenguaje simple
- ✅ Las 7 frases «Tabla siguiente» / «Ilustración siguiente» → número calculado automáticamente
- ✅ Referencias a tablas del primer informe sin decirlo (Tablas 12, 13, 14 y 20 a 29) → «del primer informe»

## 4. ✅ Legibilidad de los diagramas
- ✅ BPMN: un subproceso por diagrama, exportados desde Bizagi (sección 3.1, páginas 21-31)
- ✅ Topología lógica: letra 1,5 veces más grande, sin la tercera línea de cada caja, sin jerga en las flechas; Amazon SES
- ✅ Carta Gantt ajustada: escala semanal (barras con precisión diaria) y letra de 11 a 16 px

## 5. ✅ Formato APA de las referencias
- ✅ Introducir las siglas en la primera cita (ISO, OMG, CMF, W3C, PMI, APA)
- ✅ Letras para un mismo autor y año (ISO 2022a/b, OWASP 2021a/b)
- ✅ Citar las referencias que no se citaban (se agregaron en la tabla de normas, la arquitectura hexagonal y PostgreSQL); se agregó la referencia de APA 7
- ✅ Leyes 21.755 (DO 11-07-2025) y 21.850 (DO 17-10-2026) verificadas; referencias completas y leyes citadas con su año

## 6. ✅ Justificar los supuestos de negocio
- ✅ Origen de los 5.500 usuarios: embudo de adquisición (≈ 94.700 visitas → 8,3 % se registra (Unbounce, 2024) → 70 % queda activo)
- ✅ Base de las metas de los KPI: RevenueCat (conversión), CleverX (registro inicial); retención declarada como hipótesis
- ✅ Usuarios al lanzamiento: 7.000 (23-10-2026; antes 5.500), para recuperar en ≈ 2 años con CORFO
- ✅ Conversión ajustada de 5 % a 4 %. Resultado final (7.000 usuarios): VAN $53,9 M, TIR 94,3 %, recuperación 2,8 años (2,1 con CORFO); CORFO cubre el déficit del año 1 (≈ $12,0 M)

## 7. ✅ Riesgo del cronograma
- ✅ Riesgo de F1 en la tabla de ajustes de alcance, con contingencia (F1 hasta el 06-11, F2 hasta el 20-11 con la holgura de F3; F4 y el cierre del 01-12 sin cambios)

---

## Registro de decisiones
| Fecha | Punto | Decisión |
|---|---|---|
| 21-10-2026 | Meta | Páginas: puede quedar cerca de 129; no crecer mucho. |
| 21-10-2026 | 1 | Correo transaccional: Amazon SES (cubierto por los créditos de AWS; pedir salida del sandbox). |
| 21-10-2026 | 1 | Panel de administración: Flutter web, aplicación separada que consume la API de administración. |
| 21-10-2026 | 1 | Tailscale: plan Personal gratuito, sin SLA; el servicio a usuarios no depende de él. |
| 21-10-2026 | 1 | Consentimientos: tabla propia (usuario, tipo, versión del documento, fecha de aceptación y de retiro) para términos, política de privacidad y conexión bancaria. |
| 21-10-2026 | 1 | KPI de registro inicial: dos fechas (inicio y término); quedaron en la tabla de usuarios, porque el perfil financiero no existe hasta registrar el saldo. |
| 21-10-2026 | 1 | Hogar: si el administrador elimina su cuenta, pasa al miembro más antiguo; sin miembros, el hogar se elimina. La supresión nunca se bloquea. |
| 21-10-2026 | 1 | Gasto común sin regla: partes iguales entre los miembros activos por defecto, visible y editable. |
| 21-10-2026 | 1 | Planificación por fases validada por ambos socios el 21-10-2026 (fecha a confirmar si fue otra). |
| 21-10-2026 | 1 | Migración `0010_consents_and_onboarding.sql` en la rama `docs/aws-kanban-bpmn-informe2`: tabla `consents` y dos fechas de registro inicial en `users`. 122 pruebas de BD en verde. Falta revisión de Maximiliano (PR). |
| 21-10-2026 | 1 | La regla «hogar pasa al miembro más antiguo» ya existía en la base (0004); solo se documentó. Gasto sin regla = partes iguales (documentado en CU-41 y sección 3.4). |
| 21-10-2026 | 1 | Fuentes: SLA de Amazon SES 99,9 % (aws.amazon.com/pinpoint/sla); Tailscale Personal gratis, hasta 6 usuarios, sin SLA, uso no comercial. |
| 21-10-2026 | 2 | Portada con fecha de entrega 26-10-2026; fichas de casos de uso con 21-10-2026. |
| 21-10-2026 | 2 | HU del Informe 1 (HU13, HU15, HU32, HU36): solo una nota en la introducción; se quitó del Anexo C. |
| 21-10-2026 | 2 | BPMN: se importarán y exportarán desde Bizagi Modeler (instalado localmente). |
| 21-10-2026 | 2 | BPMN rehechos para Bizagi: subprocesos contraídos con su propio diagrama, nombres cortos en eventos y mensajes, franjas sin proceso con proceso vacío. 5 procesos principales + 12 subprocesos, cada uno en su propio archivo .bpmn, en `bpmn-bizagi/prueba/`. Resuelve también la legibilidad (punto 4). |
| 21-10-2026 | 2 | CloudFormation: se mantiene; plantillas en la fase F2, sin costo. |
| 21-10-2026 | 2/4 | BPMN en el informe: 13 diagramas (5 procesos + 8 subprocesos de decisión, suscripción y hogar). Los 4 subprocesos de la conexión bancaria se describen en el texto (archivos en `bpmn-bizagi/no-exportar/`). |
| 22-10-2026 | 2/4 | BPMN integrados: la sección 3.1 pasa de 7 a 11 páginas; el informe queda en 134 páginas. |
| 22-10-2026 | 3 | Jerga y referencias internas reemplazadas; se corrigieron 7 referencias a tablas del Informe 1 que parecían de este informe. 134 páginas. |
| 22-10-2026 | 4 | Topología y Gantt legibles. «Por definir» del correo reemplazado por Amazon SES también en los diagramas C4 (contexto, contenedores, componentes, despliegue) y en la topología física. 134 páginas. |
| 22-10-2026 | 5 | APA: 56 referencias, todas citadas. Ley 21.755 confirma Pro Pyme 12,5 % hasta 2027 y 15 % en 2028 (condicionado a la cotización del empleador, Ley 21.735); Ley 21.850 baja la tasa a 23 %. 135 páginas (+1 por la tabla de normas). |
| 22-10-2026 | 6 | Usuarios al lanzamiento: se mantienen 5.500, justificados con un embudo de adquisición. Metas de KPI: con referencias de la industria. |
| 22-10-2026 | 6 | Conversión bajada de 5 % a 4 % (5 % estaba sobre el cuartil superior freemium, 4,5 %). Nuevo resultado: VAN $25,4 M, TIR 56,4 %, recuperación 3,5 años (3,1 con CORFO). El déficit del año 1 sube a $16,4 M: CORFO ($15 M) no lo cubre entero; faltan ≈ $1,4 M que aportan los socios. Planilla anterior en `versiones-anteriores/`. 137 páginas. |
| 22-10-2026 | 7 | Motor al 22-10: proyección mensual avanzada; faltan decisiones, indicadores y explicación. Riesgo de F1 con contingencia; la Gantt no cambia. 137 páginas. |
| 23-10-2026 | 6 | Usuarios al lanzamiento de 5.500 a 7.000 (sugerencia de un profesor: recuperar en ≈ 2 años). Embudo: ≈ 120.500 visitas (≈ 40.200 al mes) → 10.000 cuentas → 7.000 activos. VAN $53,9 M, TIR 94,3 %, recuperación 2,8 años (2,1 con CORFO). Déficit año 1 $12,0 M, cubierto por CORFO. Versión con 5.500 en `versiones-anteriores/`. |
| 25-10-2026 | 6 | Usuarios al lanzamiento de 7.000 a 7.500 (v0.5). Embudo: ≈ 129.100 visitas (≈ 43.000 al mes) → 10.715 cuentas → 7.500 activos. VAN $63,6 M, TIR 108,6 %, recuperación 2,5 años (1,0 con CORFO). Déficit año 1 $10,4 M, cubierto por CORFO. Fintoc sin cambios. Versión anterior en `versiones-anteriores/v0.4 (2026-10-24)/`. |
| 25-10-2026 | 6 | Se aplica la «Alternativa costo Fintoc» (v0.6): 10 UF + IVA con hasta 500 cuentas como costo fijo, tramos por cuenta adicional (0,015 / 0,010 / 0,007 UF) como costo de venta y 1,5 bancos por persona. VAN $56,2 M, TIR 96,0 %, recuperación 2,8 años (2,1 con CORFO). Déficit año 1 $11,4 M, cubierto por CORFO. Fuentes Costbench y xpay; citas y bibliografía pasan al estilo APA 7. Anexo C: cotización por volumen de Fintoc pendiente. Versión anterior en `versiones-anteriores/v0.5 (2026-10-25)/`. |

## Estado de la compilación
- La versión vigente es la v0.11 (25-10-2026, 138 páginas; sin referencias a archivos externos, a revisiones del primer informe ni a supuestos), en `Nueva version de informe/`. Las versiones v0.1 a v0.10 están en `versiones-anteriores/`; el historial está en `versiones.md`.

## Nueva versión base (24-10-2026)
Se trabaja desde `Nueva version de informe/` (docx editado en Word, flujo de caja y Carta Gantt en Excel; hoy v0.11). Cambios respecto de la versión del 22-10:
- Citas con el administrador de fuentes de Word (59 fuentes) y bibliografía automática; las notas de tablas y figuras ya no empiezan con «Nota.».
- Capítulo VIII con formato de evaluación de proyectos: ventas = Q × Pu, costo de venta y costo fijo, equipos aportados en especie ($3.364.880) con depreciación acelerada del SII (2 años), tabla de financiamiento y flujo en pesos con flujo descontado. Resultado: VAN $54,3 M, TIR 94,9 %, recuperación 2,8 años (2,1 con CORFO); dos tablas nuevas (116 y 117).
- Carta Gantt (Ilustración 35) tomada de la planilla `Carta Gantt ajustada - Fin de Mes.xlsx`.
- Los scripts de generación quedan desfasados: las correcciones siguientes se hacen sobre este .docx.

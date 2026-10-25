# Correcciones del Informe 2 — Fin de Mes

Lista de trabajo a partir de la revisión del 21-10-2026 contra la pauta `TIHI84_U2_ES2_EA4.xlsx`.
Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` listo.

## Meta general
Corregir los 7 puntos **sin que el informe crezca mucho**: hoy tiene 129 páginas y puede quedarse cerca de esa cifra, sin recortes grandes.
Restricción: **sin gasto real**. Toda herramienta o servicio debe ser gratuito o tener un plan
gratuito que cubra el proyecto, como mínimo hasta fines de diciembre de 2026.

---

## 1. [x] Cerrar las decisiones abiertas (Anexo C)
- [x] Proveedor de correo transaccional (Tabla 15, SLA-007, actor de los casos de uso)
- [x] Tecnología del panel de administración (Tabla 79)
- [x] Plan de Tailscale (SLA-008)
- [x] Registro de consentimientos, Ley 21.719 (sección 3.4, modelo de datos)
- [x] Medición del registro inicial para los KPI (Tabla 82)
- [x] Hogar cuyo administrador elimina su cuenta; gasto común sin regla de aporte
- [x] Validación de la planificación por fases por ambos socios (sección 7.1.3)
- [x] Reducir el Anexo C: quedan solo CORFO, la confirmación de sueldo y tarifa de Fintoc, y la actualización de HU del Informe 1 (punto 2)

## 2. [x] Resolver inconsistencias
- [x] Fechas: portada 26-10-2026 (entrega); fichas de casos de uso 21-10-2026
- [x] HU32/HU36 nombran a Plaid en el Informe 1; HU13/HU15 con distinto actor → nota en la introducción
- [x] Tabla 15: BPMN «con Bizagi Modeler» → 13 diagramas exportados desde Bizagi e incorporados al informe
- [x] Sección 5.1: al 21-10-2026, 61 pruebas unitarias y 122 de base de datos
- [x] AWS CloudFormation: se mantiene como compromiso de la fase F2 (texto en futuro)

## 3. [x] Quitar referencias internas y jerga
- [x] «(cu-1)» y «(cu-3)» en las fichas → nombre del diagrama de casos de uso
- [x] «migraciones 0001 a 0009», `app.users`, `app.refresh_tokens.created_at`,
      `percentile_cont(0.5)`, `app_api`, `app.clp`, `/v1` → lenguaje simple
- [x] Las 7 frases «Tabla siguiente» / «Ilustración siguiente» → número calculado automáticamente
- [x] Referencias a tablas del primer informe sin decirlo (Tablas 12, 13, 14 y 20 a 29) → «del primer informe»

## 4. [x] Legibilidad de los diagramas
- [x] BPMN: un subproceso por diagrama, exportados desde Bizagi (sección 3.1, páginas 21-31)
- [x] Topología lógica: letra 1,5 veces más grande, sin la tercera línea de cada caja, sin jerga en las flechas; Amazon SES
- [x] Carta Gantt ajustada: escala semanal (barras con precisión diaria) y letra de 11 a 16 px

## 5. [x] Formato APA de las referencias
- [x] Introducir las siglas en la primera cita (ISO, OMG, CMF, W3C, PMI, APA)
- [x] Letras para un mismo autor y año (ISO 2022a/b, OWASP 2021a/b)
- [x] Citar las referencias que no se citaban (se agregaron en la tabla de normas, la arquitectura hexagonal y PostgreSQL); se agregó la referencia de APA 7
- [x] Leyes 21.755 (DO 11-07-2025) y 21.850 (DO 17-10-2026) verificadas; referencias completas y leyes citadas con su año

## 6. [x] Justificar los supuestos de negocio
- [x] Origen de los 5.500 usuarios: embudo de adquisición (≈ 94.700 visitas → 8,3 % se registra (Unbounce, 2024) → 70 % queda activo)
- [x] Base de las metas de los KPI: RevenueCat (conversión), CleverX (registro inicial); retención declarada como hipótesis
- [x] Decidir 5.500 o 6.000 usuarios con CORFO → se mantiene 5.500 (recuperación 2,8 años; 2,1 con CORFO)

## 7. [x] Riesgo del cronograma
- [x] Riesgo de F1 en la tabla de ajustes de alcance, con contingencia (F1 hasta el 06-11, F2 hasta el 20-11 con la holgura de F3; F4 y el cierre del 01-12 sin cambios)

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

## Estado de la compilación
- `Informe 2 - Fin de Mes (nuevo).docx` y `Informe 2 - Fin de Mes.pdf` de esta carpeta están al día (22-10-2026, 137 páginas). Versiones anteriores en `versiones-anteriores/`.

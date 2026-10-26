# Implementación de los KPI y SLA · Fin de Mes

Este documento baja a la implementación los indicadores (Tablas 3, 18 y 19 del informe 1) y los niveles de
servicio (Tablas 20 a 29). Para cada uno define de dónde sale el dato, cómo se mide y en qué estado está. Las
correcciones que hay que hacer al informe se marcan con **Corrección**.

Principio que se aplica a todo el documento: las métricas se calculan **agregadas**, sin datos personales ni
montos (Ley 21.719, reglas 4 y 5 del proyecto). Ningún indicador necesita ver el presupuesto de un usuario.

## 1. Definiciones comunes

| Término | Definición operativa | Fuente |
|---|---|---|
| Usuario registrado | Cuenta con correo verificado (`users.email_verified_at` no nulo) y estado `active`. | `app.users` |
| Usuario activo del mes | Usuario registrado que inició o renovó una sesión en el mes calendario (zona horaria de Chile). | `app.refresh_tokens.created_at`: cada inicio de sesión y cada rotación crea una fila. |
| Usuario con plan pagado activo | Usuario con una fila en `app.subscriptions` cuyo período incluye el día de corte. | `app.subscriptions` |
| Registro inicial completado | Usuario con saldo inicial y al menos un ingreso registrados (HU01 y HU04). | `app.financial_profiles`, `app.incomes` |

**Pendiente de decisión (requiere migración):** hoy no se guarda cuándo empezó ni cuándo terminó el registro
inicial, y `financial_profiles` solo tiene `updated_at`. Sin ese dato, la "tasa de finalización" y el "tiempo
mediano de registro" solo se pueden aproximar. Hay dos opciones:

- **A (recomendada):** agregar a `financial_profiles` las columnas `onboarding_started_at` y
  `onboarding_completed_at`. Son dos fechas, sin datos personales ni montos.
- **B:** registrar eventos de producto en la app con una herramienta de analítica. Agrega un tercero que
  recibe datos de uso, así que habría que declararlo en la política de privacidad (HU32).

Además, la retención de `refresh_tokens` debe cubrir al menos el mes anterior. Si no, el cálculo mensual deja
una **instantánea agregada** (ver 2.3) antes de que se purguen.

## 2. KPI

### 2.1 Indicadores de producto, negocio y técnicos (Tabla 18)

| KPI | Fórmula (Tabla 19) | De dónde sale el dato | Cómo se mide | Frecuencia | Estado |
|---|---|---|---|---|---|
| Tasa de finalización del registro inicial | Registros completados / registros iniciados × 100 | Opción A: `onboarding_started_at` y `onboarding_completed_at` | Consulta agregada mensual | Mensual | Requiere migración (opción A) |
| Tiempo mediano de registro inicial | Mediana de (fin − inicio) del registro | Las mismas dos columnas | `percentile_cont(0.5)` en PostgreSQL | Mensual | Requiere migración (opción A) |
| Escenarios creados por usuario activo al mes | Escenarios creados en el mes / usuarios activos del mes | `app.scenarios.created_at` y usuarios activos | Consulta agregada | Mensual | Datos disponibles. Los escenarios eliminados en el mes no se cuentan; si se quieren contar, la instantánea mensual debe tomarse a fin de mes. |
| Tasa de conversión a plan pagado | Usuarios con plan pagado activo / usuarios activos × 100 | `app.subscriptions` y usuarios activos | Consulta agregada al cierre del mes | Mensual | Datos disponibles |
| Tasa de retención mensual | Activos del mes que también lo fueron el mes anterior / activos del mes anterior × 100 | Usuarios activos de dos meses consecutivos | Consulta agregada | Mensual | Datos disponibles mientras se conserve un mes de `refresh_tokens` o la instantánea |
| Cobertura de pruebas del motor | Líneas del núcleo cubiertas / líneas del núcleo × 100 | Reporte de cobertura de Vitest (v8) | `pnpm check` en CI; el umbral de 90 % ya **bloquea** la integración | Cada cambio (y por sprint) | **Implementado** |
| Tiempo de respuesta de la proyección (p95) | Percentil 95 del tiempo de respuesta del endpoint de proyección | (1) Prueba de rendimiento en CI que calcula 12 meses; (2) en el servidor, la duración de cada petición en los logs de Fastify | (1) Falla si p95 ≥ 300 ms; (2) p95 semanal desde los logs | Cada cambio y semanal | Por implementar con el endpoint |
| Defectos críticos abiertos al cierre del sprint | Conteo de defectos de severidad crítica sin resolver | Issues de GitHub con la etiqueta `severity:critical` | Filtro de GitHub al cierre del sprint | Por sprint | Por configurar (crear la etiqueta) |
| Cumplimiento del compromiso del sprint | Historias completadas / comprometidas × 100 | GitHub Projects: cada historia es un issue con su HU, asignado al hito del sprint | Issues cerrados / issues del hito | Por sprint | Por configurar |
| Desviación presupuestaria acumulada | (Costo real − costo planificado) / costo planificado × 100 | Facturación de AWS (Cost Explorer) y gastos registrados frente al presupuesto (Tablas 38 a 41) | Planilla de control actualizada al cierre del mes | Mensual | Por configurar |

### 2.2 Indicadores del Cuadro de Mando Integral que no están en la Tabla 18 (Tabla 3)

| Indicador | De dónde sale el dato | Cómo se mide | Estado |
|---|---|---|---|
| Tasa de crecimiento de usuarios activos mensuales | Usuarios activos de cada mes | (Activos del trimestre actual − activos del anterior) / activos del anterior × 100 | Datos disponibles |
| Proporción de valoraciones positivas en la tienda | Google Play Console (valoraciones de 4 y 5 estrellas) | Lectura manual mensual | Aplica cuando la app se publique (fuera del MVP) |
| Costo mensual de infraestructura por usuario activo | Factura de AWS (y de Fintoc y correo en producción) / usuarios activos | Planilla mensual | Por configurar |
| Cobertura del motor e historias completadas | Iguales a los de la Tabla 18 | Ver 2.1 | Ver 2.1 |
| Capacitaciones o certificaciones por integrante | Registro del equipo | Conteo anual | Manual |
| Mejoras incorporadas desde la retroalimentación | Issues de GitHub con la etiqueta `feedback` cerrados en el trimestre | Filtro de GitHub | Por configurar |

### 2.3 Cómo se calcula sin exponer datos

- **Funciones agregadas en la base.** Los indicadores de producto y de negocio se exponen con funciones
  `SECURITY DEFINER` del esquema `app` que devuelven **solo conteos y porcentajes**, nunca filas por usuario.
  El rol `app_admin` recibe permiso para ejecutarlas, pero sigue sin poder leer las tablas financieras (HU23).
  Es el mismo patrón de las funciones que ya existen (por ejemplo, `verify_audit_chain`).
- **Instantánea mensual.** Un proceso mensual guarda los resultados en una tabla de indicadores (mes,
  indicador, valor). Así la historia de los KPI no depende de conservar datos detallados, que se pueden
  purgar.
- **Dónde se ven.** En el panel de administración, como parte de HU24 (monitoreo, prioridad C). Mientras el
  panel no exista, las mismas funciones se ejecutan desde la API de administración.
- **Umbrales.** Cada valor se clasifica como óptimo, tolerable o deficiente con los umbrales de la Tabla 18.
  Un valor deficiente activa el plan de acción de la Tabla 19.

## 3. SLA de proveedores

**Corrección:** las Tablas 20 y 21 del informe 1 citan compromisos genéricos de AWS. La plataforma corre en AWS
(ADR-005) y aquí se precisan los compromisos de cada servicio elegido.

| ID | Servicio | Compromiso del proveedor | Créditos por incumplimiento | Criticidad | Fuente |
|---|---|---|---|---|---|
| SLA-001 | Amazon CloudFront (sitio y entrada a /v1) | 99,9 % mensual | Bajo 99,9 %: 10 %. Bajo 99 %: 25 %. Bajo 95 %: 100 % | Alta | [CloudFront SLA](https://aws.amazon.com/cloudfront/sla/) |
| SLA-002 | Amazon API Gateway | 99,95 % mensual por región | Bajo 99,95 %: 10 %. Bajo 99 %: 25 %. Bajo 95 %: 100 % | Alta | [API Gateway SLA](https://aws.amazon.com/api-gateway/sla/) |
| SLA-003 | Amazon EC2 (API pública, migrador y administración) | Por instancia: 99,5 %. Regional (dos o más zonas): 99,99 % | Bajo el compromiso: 10 %. Bajo 99 %: 30 %. Bajo 95 %: 100 % | Alta (API); baja (administración) | [Compute SLA](https://aws.amazon.com/compute/sla/) |
| SLA-004 | Amazon RDS for PostgreSQL | **Single-AZ (MVP): 99,5 %.** Multi-AZ: 99,95 % | Bajo el compromiso: 10 %. Bajo 99 %: 25 %. Bajo 95 %: 100 % | Alta | [RDS SLA](https://aws.amazon.com/rds/sla/) |
| SLA-005 | Transbank Webpay Plus | Sin porcentaje publicado; operación 24/7 con aviso de mantenimiento | Sin créditos; se escala por la mesa de ayuda | Media: solo impide contratar o renovar planes | Tabla 22 del informe 1 (sin cambios) |
| SLA-006 | Fintoc (agregación bancaria) | Modo de prueba: sin compromiso. Producción: se negocia en el contrato | Por definir en la cotización | Baja: el registro manual la reemplaza | Comunicación comercial, octubre de 2026 |
| SLA-007 | Proveedor de correo transaccional | Por definir al elegir el proveedor | Por definir | Media: afecta la verificación, la recuperación de acceso y las invitaciones | Pendiente |
| SLA-008 | Tailscale (acceso de administración) | Plan gratuito: sin compromiso | Sin créditos | Baja: si falla, no se puede administrar, pero el servicio a los usuarios sigue | Pendiente de confirmar el plan |
| SLA-009 | Google Play | Sin porcentaje publicado | Sin créditos | Baja | Tabla 23 del informe 1 (sin cambios) |

Los créditos de AWS son un porcentaje del cargo del servicio afectado y se piden al soporte con evidencia. Mientras
la cuenta usa los créditos del plan gratuito, el cargo efectivo es cero: el SLA sirve para dimensionar la
disponibilidad, no como compensación.

### 3.1 Disponibilidad compuesta

Un usuario necesita a la vez CloudFront, API Gateway, la instancia de la API y la base de datos:

- **Ambiente de integración (una instancia, RDS Single-AZ):** 0,999 × 0,9995 × 0,995 × 0,995 ≈ **98,85 %**,
  unas 8 horas de caída posible al mes. Aceptable para la validación, que no opera con clientes reales.
- **Producción (dos instancias en zonas distintas, RDS Multi-AZ):** 0,999 × 0,9995 × 0,9999 × 0,9995 ≈
  **99,79 %**, unos 92 minutos al mes, compatible con el OLA-001.

Fintoc, el correo y Transbank no entran en el cálculo porque su caída no impide registrar, proyectar ni simular.

## 4. OLA: compromisos de Fin de Mes con sus usuarios

| ID | Compromiso (informe 1) | Cómo se mide o se cumple | Estado y correcciones |
|---|---|---|---|
| OLA-001 | Disponibilidad mensual superior al 99 % | Chequeo externo cada minuto contra un endpoint de salud `GET /v1/health`, que verifica la API y la conexión a la base, con alerta por correo. Disponibilidad = minutos con respuesta correcta / minutos del mes. Las ventanas de mantenimiento se registran aparte. | Por implementar: falta crear `/v1/health` y configurar el chequeo (por ejemplo, una alarma de CloudWatch Synthetics o un monitor externo gratuito). |
| OLA-002 | Respuesta a consultas dentro de 24 horas hábiles | Cada solicitud de contacto (HU34) o correo de soporte genera un registro con su fecha de recepción y de respuesta. | Por implementar con HU34. |
| OLA-003 | Atención inmediata de incidentes críticos y aviso al usuario dentro de 4 horas | Alertas del chequeo de disponibilidad y de errores 5xx; registro de cada incidente con su hora de detección, aviso y resolución, y su análisis de causa raíz. | Por implementar: alertas y plantilla de registro de incidentes. |
| OLA-004 | Protección de datos y aviso de brechas a la autoridad dentro de 72 horas | Controles del ADR-003 y del ADR-004, traza de auditoría encadenada (HU25) y procedimiento escrito de respuesta a brechas. | Controles en curso (ADR-004). Procedimiento de respuesta a brechas definido en el informe 2 (sección 6.2). |
| OLA-005 | Respaldo diario con retención de 30 días, RPO de 24 horas y RTO de 4 horas | Respaldo automático diario de RDS con retención de 30 días y PITR; instantánea manual antes de cada migración. La restauración se prueba al cierre de cada fase en una instancia aparte. | Cumple los 30 días del informe 1 (RDS permite hasta 35). El PITR deja un RPO de minutos. |
| OLA-006 | Ejercicio de derechos del titular dentro de los plazos legales | HU21: exportación y borrado efectivo desde la app. Cada solicitud queda en la traza de auditoría. | Por implementar con HU21. |

## 5. Correcciones al informe

Aplicadas en el informe 2 (20-10-2026): SLA de AWS por servicio, disponibilidad compuesta, OLA-005 con 30 días,
procedimiento de respuesta a brechas y definición de "usuario activo".

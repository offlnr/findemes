# Diccionario de datos · Fin de Mes

> Generado por `docs/diagrams/data-model/generate_er.py` desde la base de datos con las migraciones 0001-0010 aplicadas (21-10-2026). No se edita a mano: se regenera cuando cambia una migración.

Esquema `app` de PostgreSQL 18. Diagramas: `docs/diagrams/data-model/datos-*.drawio.svg`. Decisiones de diseño, roles y Row-Level Security: `docs/adr/003-data-model-and-database-security.md`.

## Convenciones

- Identificadores UUID aleatorios (no secuenciales): un recurso ajeno responde 404 y los IDs no revelan volumen.
- Montos en pesos chilenos como enteros (dominio `clp`), nunca punto flotante.
- Fechas y horas en `timestamptz`; los meses del modelo financiero en el dominio `month`.
- Ningún secreto en claro: tokens con hash SHA-256; `link_token` y secretos TOTP cifrados con AES-256-GCM por la aplicación; contraseñas con argon2id.
- Dos roles de servicio: `app_api` (API pública, bajo RLS) y `app_admin` (API de administración, sin acceso a tablas financieras, HU23). Las migraciones usan un rol dueño con el que ningún servicio se conecta.
- Las altas que deben respetar una regla (crear un escenario bajo el límite del plan, crear un hogar, aceptar una invitación, rotar un refresh token, activar un plan) pasan por funciones `SECURITY DEFINER` del esquema `app`; por eso algunas tablas no dan INSERT directo a `app_api`.

## Dominios

| Dominio | Tipo base | Regla |
|---|---|---|
| `app.clp` | `bigint` | Monto en pesos chilenos, entero, dentro del rango seguro de JavaScript (±2^53 − 1). Regla 10: sin decimales. |
| `app.month` | `date` | Mes calendario, guardado como su primer día (CHECK: el valor es inicio de mes). |
| `app.label` | `text` | Nombre dado por el usuario: entre 1 y 80 caracteres sin contar espacios extremos. |

## Resumen de tablas

| Tabla | Módulo | Descripción | HU / RNF | RLS | app_api | app_admin |
|---|---|---|---|---|---|---|
| [`users`](#users) | Identidad y administración | Cuenta de usuario registrada. Base de la identidad y del control de acceso. | HU17, HU17.1-HU17.4, HU23 | Sí | DELETE, INSERT, SELECT, UPDATE (email, onboarding_completed_at, onboarding_started_at, password_hash, updated_at) | SELECT (created_at, email, email_verified_at, id, onboarding_completed_at, onboarding_started_at, status, updated_at), UPDATE (status, updated_at) |
| [`consents`](#consents) | Identidad y administración | Consentimientos otorgados por el usuario (términos, política de privacidad y conexión bancaria) con la versión del documento aceptado. Retirar un consentimiento no borra el historial; se elimina con la cuenta. | HU32, HU36, Ley 21.719 | Sí | INSERT, SELECT, UPDATE (withdrawn_at) | sin acceso |
| [`refresh_tokens`](#refresh_tokens) | Identidad y administración | Refresh tokens opacos y rotativos, guardados como hash SHA-256. Una familia agrupa los tokens de un mismo inicio de sesión; reutilizar uno consumido revoca la familia. | HU17.1-HU17.3 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`email_tokens`](#email_tokens) | Identidad y administración | Enlaces de un solo uso enviados por correo (verificación 24 h, restablecimiento 30 min), guardados como hash SHA-256. | HU17, HU17.2 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`login_throttle`](#login_throttle) | Identidad y administración | Contadores del bloqueo temporal de inicio de sesión por cuenta y por IP. Las claves son HMAC del correo normalizado o de la IP: no guarda datos personales en claro. | HU17.1 | No | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`platform_admins`](#platform_admins) | Identidad y administración | Usuarios con rol de administrador de la plataforma y su segundo factor TOTP. Solo la lee el rol de la API de administración. | HU22, RNF22 | No | sin acceso | SELECT, UPDATE (last_login_at) |
| [`financial_profiles`](#financial_profiles) | Registro financiero | Saldo inicial del usuario al comienzo de un mes (uno por usuario). | HU04 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`incomes`](#incomes) | Registro financiero | Ingresos recurrentes o esporádicos del usuario. | HU01 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`expenses`](#expenses) | Registro financiero | Gastos fijos y gastos variables estimados del usuario. | HU02 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`debts`](#debts) | Registro financiero | Deuda en cuotas del usuario. Lo pendiente está en debt_installments. | HU03 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`debt_installments`](#debt_installments) | Registro financiero | Calendario explícito de cuotas pendientes de una deuda: una fila por mes, lo que también representa cuotas desiguales. | HU03 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`bank_links`](#bank_links) | Agregación bancaria | Vínculo con un banco a través de Fintoc (modo de prueba) o del banco de demostración. Guarda el link_token cifrado con AES-256-GCM. | HU36, ADR-002 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`bank_accounts`](#bank_accounts) | Agregación bancaria | Cuentas bancarias obtenidas de un vínculo. | HU36 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`bank_movements`](#bank_movements) | Agregación bancaria | Movimientos bancarios importados. Volver a sincronizar es idempotente. | HU36 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`households`](#households) | Hogar | Hogar: espacio común compartido por sus miembros. | HU12 | Sí | DELETE, SELECT, UPDATE | sin acceso |
| [`household_members`](#household_members) | Hogar | Pertenencia de un usuario a un hogar y su rol. En el MVP, un usuario pertenece como máximo a un hogar. | HU12, HU16 | Sí | DELETE, SELECT, UPDATE (display_name) | sin acceso |
| [`household_invitations`](#household_invitations) | Hogar | Invitaciones de un solo uso a un hogar, guardadas como hash, con vigencia máxima de 7 días. | HU12, HU31 | Sí | DELETE, INSERT, SELECT | sin acceso |
| [`household_expenses`](#household_expenses) | Hogar | Gastos comunes del hogar, visibles para todos los miembros junto con quién los registró. | HU13 | Sí | DELETE, INSERT, SELECT, UPDATE (amount, from_month, interval_months, label, schedule_kind, until_month, updated_at) | sin acceso |
| [`contribution_rules`](#contribution_rules) | Hogar | Regla de aporte de cada gasto común: partes iguales, porcentajes o asignado a un miembro. | HU14, HU15 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`contribution_shares`](#contribution_shares) | Hogar | Porcentaje de cada miembro cuando la regla es por porcentajes. La suma debe ser exactamente 100 % (se verifica al confirmar la transacción). | HU14 | Sí | DELETE, INSERT, SELECT, UPDATE | sin acceso |
| [`plans`](#plans) | Suscripción y pagos | Catálogo de planes del modelo freemium y sus límites (Tabla 13 del primer informe). Datos de referencia cargados por la migración. | HU18, HU30 | No | SELECT | SELECT |
| [`subscriptions`](#subscriptions) | Suscripción y pagos | Período pagado vigente de un usuario. Sin fila, el usuario está en el plan gratuito. El estado (Tabla 14 del primer informe) se deriva de las fechas; no se almacena. | HU19, HU20 | Sí | SELECT | SELECT |
| [`payment_orders`](#payment_orders) | Suscripción y pagos | Órdenes de pago de Webpay Plus. buy_order único hace idempotente la activación. Nunca se guardan datos de tarjeta. | HU19, HU26, RNF09 | Sí | INSERT, SELECT, UPDATE (provider_token) | SELECT |
| [`scenarios`](#scenarios) | Escenarios | Escenario de simulación: nombre, referencia al estado base y decisiones. El estado base nunca se copia, así que el escenario no puede alterarlo (regla 3). | HU06, HU07, HU09, HU11 | Sí | DELETE, SELECT, UPDATE (base_kind, decisions, household_id, name, updated_at) | sin acceso |
| [`audit_log`](#audit_log) | Auditoría | Traza de auditoría de solo inserción, encadenada por hash: alterar o borrar una entrada rompe la cadena y es detectable. | RNF10, RNF22, HU25 | No | INSERT | INSERT, SELECT |

## Identidad y administración

### users

Cuenta de usuario registrada. Base de la identidad y del control de acceso. Trazabilidad: HU17, HU17.1-HU17.4, HU23.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `email` | `text` | No |  | UK | `(email = lower(btrim(email))) AND ((length(email) >= 3) AND (length(email) <= 254))` | Correo, normalizado (sin espacios y en minúsculas). Único. |
| `password_hash` | `text` | No |  |  | `password_hash ~~ '$argon2id$%'` | Hash argon2id de la contraseña (RNF07). La API de administración no puede leerlo. |
| `email_verified_at` | `timestamptz` | Sí |  |  |  | Fecha y hora de verificación del correo; NULL = no verificado. |
| `status` | `text` | No | `'active'` |  | `status IN ('active', 'suspended')` | Estado de la cuenta: 'active' o 'suspended'. Solo un administrador lo cambia (HU23). |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |
| `onboarding_started_at` | `timestamptz` | Sí |  |  |  | Inicio del registro inicial (KPI de finalización y tiempo de registro). |
| `onboarding_completed_at` | `timestamptz` | Sí |  |  |  | Término del registro inicial: saldo inicial y al menos un ingreso (HU01, HU04). |

- **Clave primaria:** `id`
- **Única:** (`email`)
- **Regla de fila:** `(onboarding_completed_at IS NULL) OR ((onboarding_started_at IS NOT NULL) AND (onboarding_completed_at >= onboarding_started_at))`
- **RLS:** activa; políticas: `users_admin` (ALL, app_admin), `users_self` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE (email, onboarding_completed_at, onboarding_started_at, password_hash, updated_at) · `app_admin`: SELECT (created_at, email, email_verified_at, id, onboarding_completed_at, onboarding_started_at, status, updated_at), UPDATE (status, updated_at)

### consents

Consentimientos otorgados por el usuario (términos, política de privacidad y conexión bancaria) con la versión del documento aceptado. Retirar un consentimiento no borra el historial; se elimina con la cuenta. Trazabilidad: HU32, HU36, Ley 21.719.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario que otorgó el consentimiento. |
| `kind` | `text` | No |  |  | `kind IN ('terms', 'privacy_policy', 'bank_connection')` | Tipo: 'terms' (términos), 'privacy_policy' (política de privacidad) o 'bank_connection' (conexión bancaria). |
| `document_version` | `text` | No |  |  | `(length(btrim(document_version)) >= 1) AND (length(btrim(document_version)) <= 20)` | Versión del documento aceptado, por ejemplo 2026-10. |
| `accepted_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de aceptación. |
| `withdrawn_at` | `timestamptz` | Sí |  |  |  | Fecha y hora de retiro; NULL = vigente. Solo un consentimiento vigente por tipo. |

- **Clave primaria:** `id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`owner_id`, `kind) WHERE (withdrawn_at IS NULL`)
- **Regla de fila:** `(withdrawn_at IS NULL) OR (withdrawn_at >= accepted_at)`
- **Índice:** `consents_owner_idx` (owner_id)
- **RLS:** activa; políticas: `consents_owner` (ALL, app_api)
- **Acceso:** `app_api`: INSERT, SELECT, UPDATE (withdrawn_at) · `app_admin`: sin acceso

### refresh_tokens

Refresh tokens opacos y rotativos, guardados como hash SHA-256. Una familia agrupa los tokens de un mismo inicio de sesión; reutilizar uno consumido revoca la familia. Trazabilidad: HU17.1-HU17.3.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `user_id` | `uuid` | No |  | FK |  | Usuario de la sesión. |
| `family_id` | `uuid` | No |  |  |  | Familia de tokens de un mismo inicio de sesión. |
| `token_hash` | `bytea` | No |  | UK | `length(token_hash) = 32` | Hash SHA-256 del token; el token en claro nunca se guarda. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `expires_at` | `timestamptz` | No |  |  |  | Fecha y hora de expiración. |
| `consumed_at` | `timestamptz` | Sí |  |  |  | Fecha y hora en que se rotó; presentarlo de nuevo revoca la familia. |
| `revoked_at` | `timestamptz` | Sí |  |  |  | Fecha y hora de revocación (cierre de sesión o reutilización detectada). |

- **Clave primaria:** `id`
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`token_hash`)
- **Regla de fila:** `expires_at > created_at`
- **Índice:** `refresh_tokens_family_idx` (family_id)
- **Índice:** `refresh_tokens_user_idx` (user_id)
- **RLS:** activa; políticas: `refresh_tokens_self` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### email_tokens

Enlaces de un solo uso enviados por correo (verificación 24 h, restablecimiento 30 min), guardados como hash SHA-256. Trazabilidad: HU17, HU17.2.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `user_id` | `uuid` | No |  | FK |  | Usuario destinatario del enlace. |
| `purpose` | `text` | No |  |  | `purpose IN ('verify_email', 'reset_password')` | Uso del enlace: 'verify_email' o 'reset_password'. |
| `token_hash` | `bytea` | No |  | UK | `length(token_hash) = 32` | Hash SHA-256 del token; el token en claro nunca se guarda. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `expires_at` | `timestamptz` | No |  |  |  | Fecha y hora de expiración. |
| `used_at` | `timestamptz` | Sí |  |  |  | Fecha y hora de uso; un enlace usado no vuelve a servir. |

- **Clave primaria:** `id`
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`token_hash`)
- **Regla de fila:** `expires_at > created_at`
- **Índice:** `email_tokens_user_idx` (user_id)
- **RLS:** activa; políticas: `email_tokens_self` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### login_throttle

Contadores del bloqueo temporal de inicio de sesión por cuenta y por IP. Las claves son HMAC del correo normalizado o de la IP: no guarda datos personales en claro. Trazabilidad: HU17.1.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `key_hash` | `bytea` | No |  | PK | `length(key_hash) = 32` | HMAC del correo normalizado o de la IP. |
| `failures` | `integer` | No | `0` |  | `failures >= 0` | Intentos fallidos consecutivos. |
| `locked_until` | `timestamptz` | Sí |  |  |  | Bloqueo temporal hasta esta fecha y hora; la espera crece con los fallos. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |

- **Clave primaria:** `key_hash`
- **RLS:** no aplica
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### platform_admins

Usuarios con rol de administrador de la plataforma y su segundo factor TOTP. Solo la lee el rol de la API de administración. Trazabilidad: HU22, RNF22.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `user_id` | `uuid` | No |  | PK,FK |  | Usuario con rol de administrador. |
| `totp_secret_ciphertext` | `bytea` | No |  |  |  | Secreto TOTP cifrado por la aplicación con AES-256-GCM. |
| `totp_nonce` | `bytea` | No |  |  | `length(totp_nonce) = 12` | Nonce de 12 bytes del cifrado AES-256-GCM. |
| `totp_key_version` | `smallint` | No |  |  | `totp_key_version > 0` | Versión de la clave de cifrado usada (permite rotarla). |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `last_login_at` | `timestamptz` | Sí |  |  |  | Último inicio de sesión en el panel. |

- **Clave primaria:** `user_id`
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE CASCADE
- **RLS:** no aplica
- **Acceso:** `app_api`: sin acceso · `app_admin`: SELECT, UPDATE (last_login_at)

## Registro financiero

### financial_profiles

Saldo inicial del usuario al comienzo de un mes (uno por usuario). Trazabilidad: HU04.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `owner_id` | `uuid` | No |  | PK,FK |  | Usuario dueño del perfil (uno por usuario). |
| `opening_balance` | `app.clp` | No |  |  |  | Saldo inicial en pesos; puede ser negativo. |
| `balance_month` | `app.month` | No |  |  |  | Mes al que corresponde el saldo inicial. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |
| `origin` | `text` | No | `'real'` |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `source_account_id` | `uuid` | Sí |  | FK |  | Cuenta bancaria de la que se tomó el saldo; NULL si es manual. |

- **Clave primaria:** `owner_id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Clave foránea:** (`source_account_id`, `owner_id`) → `bank_accounts` (id, owner_id), ON DELETE SET NULL
- **RLS:** activa; políticas: `financial_profiles_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### incomes

Ingresos recurrentes o esporádicos del usuario. Trazabilidad: HU01.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `label` | `app.label` | No |  |  |  | Nombre que el usuario da al registro. |
| `amount` | `app.clp` | No |  |  | `amount > 0` | Monto en pesos chilenos (entero). |
| `schedule_kind` | `text` | No |  |  | `schedule_kind IN ('once', 'monthly', 'every_n_months')` | Periodicidad: 'once' (un mes), 'monthly' (mensual) o 'every_n_months' (cada N meses). |
| `interval_months` | `smallint` | Sí |  |  |  | Cada cuántos meses se repite (2 a 24); solo con 'every_n_months'. |
| `from_month` | `app.month` | No |  |  |  | Primer mes en que aplica. |
| `until_month` | `app.month` | Sí |  |  |  | Último mes en que aplica; NULL = sin término. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |
| `origin` | `text` | No | `'real'` |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `source_movement_id` | `uuid` | Sí |  | FK |  | Movimiento bancario desde el que el usuario confirmó el registro; NULL si es manual o si se borró el dato bancario. |

- **Clave primaria:** `id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Clave foránea:** (`source_movement_id`, `owner_id`) → `bank_movements` (id, owner_id), ON DELETE SET NULL
- **Regla de fila:** `((schedule_kind = 'once') AND (interval_months IS NULL) AND (until_month IS NULL)) OR ((schedule_kind = 'monthly') AND (interval_months IS NULL)) OR ((schedule_kind = 'every_n_months') AND ((interval_months >= 2) AND (interval_months <= 24)))`
- **Regla de fila:** `(until_month IS NULL) OR (until_month >= from_month)`
- **Índice:** `incomes_owner_idx` (owner_id)
- **RLS:** activa; políticas: `incomes_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### expenses

Gastos fijos y gastos variables estimados del usuario. Trazabilidad: HU02.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `label` | `app.label` | No |  |  |  | Nombre que el usuario da al registro. |
| `nature` | `text` | No |  |  | `nature IN ('fixed', 'variable_estimate')` | Tipo de gasto: 'fixed' (fijo) o 'variable_estimate' (variable estimado). |
| `amount` | `app.clp` | No |  |  | `amount > 0` | Monto en pesos chilenos (entero). |
| `schedule_kind` | `text` | No |  |  | `schedule_kind IN ('once', 'monthly', 'every_n_months')` | Periodicidad: 'once' (un mes), 'monthly' (mensual) o 'every_n_months' (cada N meses). |
| `interval_months` | `smallint` | Sí |  |  |  | Cada cuántos meses se repite (2 a 24); solo con 'every_n_months'. |
| `from_month` | `app.month` | No |  |  |  | Primer mes en que aplica. |
| `until_month` | `app.month` | Sí |  |  |  | Último mes en que aplica; NULL = sin término. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |
| `origin` | `text` | No | `'real'` |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `source_movement_id` | `uuid` | Sí |  | FK |  | Movimiento bancario desde el que el usuario confirmó el registro; NULL si es manual o si se borró el dato bancario. |

- **Clave primaria:** `id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Clave foránea:** (`source_movement_id`, `owner_id`) → `bank_movements` (id, owner_id), ON DELETE SET NULL
- **Regla de fila:** `((schedule_kind = 'once') AND (interval_months IS NULL) AND (until_month IS NULL)) OR ((schedule_kind = 'monthly') AND (interval_months IS NULL)) OR ((schedule_kind = 'every_n_months') AND ((interval_months >= 2) AND (interval_months <= 24)))`
- **Regla de fila:** `(until_month IS NULL) OR (until_month >= from_month)`
- **Índice:** `expenses_owner_idx` (owner_id)
- **RLS:** activa; políticas: `expenses_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### debts

Deuda en cuotas del usuario. Lo pendiente está en debt_installments. Trazabilidad: HU03.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `label` | `app.label` | No |  |  |  | Nombre que el usuario da al registro. |
| `total_installments` | `smallint` | Sí |  |  | `(total_installments >= 1) AND (total_installments <= 600)` | Número total de cuotas informado al registrar (para mostrar "cuota 3 de 12"). |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |

- **Clave primaria:** `id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`id`, `owner_id`)
- **Índice:** `debts_owner_idx` (owner_id)
- **RLS:** activa; políticas: `debts_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### debt_installments

Calendario explícito de cuotas pendientes de una deuda: una fila por mes, lo que también representa cuotas desiguales. Trazabilidad: HU03.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `debt_id` | `uuid` | No |  | PK,FK |  | Deuda a la que pertenece la cuota. |
| `owner_id` | `uuid` | No |  | FK |  | Dueño; la clave compuesta asegura que coincide con el de la deuda. |
| `month` | `app.month` | No |  | PK |  | Mes de vencimiento de la cuota. |
| `amount` | `app.clp` | No |  |  | `amount > 0` | Monto de la cuota en pesos. |

- **Clave primaria:** `debt_id`, `month`
- **Clave foránea:** (`debt_id`, `owner_id`) → `debts` (id, owner_id), ON DELETE CASCADE
- **Índice:** `debt_installments_owner_idx` (owner_id)
- **RLS:** activa; políticas: `debt_installments_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

## Agregación bancaria

### bank_links

Vínculo con un banco a través de Fintoc (modo de prueba) o del banco de demostración. Guarda el link_token cifrado con AES-256-GCM. Trazabilidad: HU36, ADR-002.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `provider` | `text` | No |  |  | `provider IN ('fintoc', 'demo')` | Proveedor: 'fintoc' o 'demo'. |
| `provider_link_id` | `text` | No |  |  | `(length(provider_link_id) >= 1) AND (length(provider_link_id) <= 128)` | Identificador del vínculo en el proveedor. |
| `institution_name` | `text` | No |  |  | `(length(institution_name) >= 1) AND (length(institution_name) <= 120)` | Nombre del banco. |
| `token_ciphertext` | `bytea` | No |  |  |  | link_token de Fintoc cifrado por la aplicación con AES-256-GCM. |
| `token_nonce` | `bytea` | No |  |  | `length(token_nonce) = 12` | Nonce de 12 bytes del cifrado AES-256-GCM. |
| `token_key_version` | `smallint` | No |  |  | `token_key_version > 0` | Versión de la clave de cifrado usada (permite rotarla). |
| `origin` | `text` | No |  |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `status` | `text` | No | `'active'` |  | `status IN ('active', 'revoked')` | Estado del vínculo: 'active' o 'revoked'. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `last_synced_at` | `timestamptz` | Sí |  |  |  | Última sincronización exitosa. |

- **Clave primaria:** `id`
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`id`, `owner_id`)
- **Única:** (`owner_id`, `provider`, `provider_link_id`)
- **RLS:** activa; políticas: `bank_links_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### bank_accounts

Cuentas bancarias obtenidas de un vínculo. Trazabilidad: HU36.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `link_id` | `uuid` | No |  | FK |  | Vínculo bancario del que proviene la cuenta. |
| `external_id` | `text` | No |  |  | `(length(external_id) >= 1) AND (length(external_id) <= 128)` | Identificador del registro en el proveedor bancario. |
| `name` | `text` | No |  |  | `(length(name) >= 1) AND (length(name) <= 120)` | Nombre de la cuenta informado por el banco. |
| `account_type` | `text` | No |  |  | `(length(account_type) >= 1) AND (length(account_type) <= 40)` | Tipo de cuenta informado por el proveedor. |
| `available_balance` | `app.clp` | No |  |  |  | Saldo disponible en pesos. |
| `origin` | `text` | No |  |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última actualización desde el proveedor. |

- **Clave primaria:** `id`
- **Clave foránea:** (`link_id`, `owner_id`) → `bank_links` (id, owner_id), ON DELETE CASCADE
- **Única:** (`id`, `owner_id`)
- **Única:** (`link_id`, `external_id`)
- **RLS:** activa; políticas: `bank_accounts_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### bank_movements

Movimientos bancarios importados. Volver a sincronizar es idempotente. Trazabilidad: HU36.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `account_id` | `uuid` | No |  | FK |  | Cuenta a la que pertenece el movimiento. |
| `external_id` | `text` | No |  |  | `(length(external_id) >= 1) AND (length(external_id) <= 128)` | Identificador del registro en el proveedor bancario. |
| `posted_on` | `date` | No |  |  |  | Fecha contable del movimiento. |
| `amount` | `app.clp` | No |  |  | `amount <> 0` | Monto en pesos: negativo = cargo, positivo = abono. Nunca cero. |
| `description` | `text` | No |  |  | `length(description) <= 500` | Glosa del banco. Texto no confiable: siempre se escapa al mostrarlo. |
| `origin` | `text` | No |  |  | `origin IN ('real', 'provider_test', 'demo')` | Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula lo que no es real. |
| `imported_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de importación. |

- **Clave primaria:** `id`
- **Clave foránea:** (`account_id`, `owner_id`) → `bank_accounts` (id, owner_id), ON DELETE CASCADE
- **Única:** (`account_id`, `external_id`)
- **Única:** (`id`, `owner_id`)
- **Índice:** `bank_movements_owner_month_idx` (owner_id, posted_on)
- **RLS:** activa; políticas: `bank_movements_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

## Hogar

### households

Hogar: espacio común compartido por sus miembros. Trazabilidad: HU12.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `name` | `app.label` | No |  |  |  | Nombre del hogar. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |

- **Clave primaria:** `id`
- **Trigger** `households_detach_scenarios`: Al eliminar un hogar, los escenarios basados en él pasan a personales.
- **RLS:** activa; políticas: `households_admin_delete` (DELETE, app_api), `households_admin_update` (UPDATE, app_api), `households_read` (SELECT, app_api)
- **Acceso:** `app_api`: DELETE, SELECT, UPDATE · `app_admin`: sin acceso

### household_members

Pertenencia de un usuario a un hogar y su rol. En el MVP, un usuario pertenece como máximo a un hogar. Trazabilidad: HU12, HU16.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `household_id` | `uuid` | No |  | PK,FK |  | Hogar al que pertenece el registro. |
| `user_id` | `uuid` | No |  | PK,FK |  | Miembro del hogar (único: un hogar por usuario en el MVP). |
| `role` | `text` | No |  |  | `role IN ('admin', 'member')` | Rol en el hogar: 'admin' o 'member'. |
| `display_name` | `app.label` | No |  |  |  | Nombre visible para los demás miembros; el correo nunca se expone. |
| `joined_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de ingreso al hogar. |

- **Clave primaria:** `household_id`, `user_id`
- **Clave foránea:** (`household_id`) → `households` (id), ON DELETE CASCADE
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE CASCADE
- **Única:** (`user_id`)
- **Trigger** `household_members_detach_scenarios`: Al salir un miembro, sus escenarios basados en el hogar pasan a personales.
- **Trigger** `household_members_removed`: Al salir un miembro: sus reglas vuelven a partes iguales, un hogar vacío se elimina y, sin administrador, se promueve al miembro más antiguo.
- **RLS:** activa; políticas: `members_delete` (DELETE, app_api), `members_read` (SELECT, app_api), `members_update_self` (UPDATE, app_api)
- **Acceso:** `app_api`: DELETE, SELECT, UPDATE (display_name) · `app_admin`: sin acceso

### household_invitations

Invitaciones de un solo uso a un hogar, guardadas como hash, con vigencia máxima de 7 días. Trazabilidad: HU12, HU31.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `household_id` | `uuid` | No |  | FK |  | Hogar al que pertenece el registro. |
| `token_hash` | `bytea` | No |  | UK | `length(token_hash) = 32` | Hash SHA-256 del token; el token en claro nunca se guarda. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `expires_at` | `timestamptz` | No |  |  |  | Expiración; como máximo 7 días después de su creación. |
| `accepted_at` | `timestamptz` | Sí |  |  |  | Fecha y hora de aceptación; una invitación aceptada no vuelve a servir. |

- **Clave primaria:** `id`
- **Clave foránea:** (`household_id`) → `households` (id), ON DELETE CASCADE
- **Única:** (`token_hash`)
- **Regla de fila:** `(expires_at > created_at) AND (expires_at <= (created_at + '7 days'))`
- **Índice:** `household_invitations_household_idx` (household_id)
- **RLS:** activa; políticas: `invitations_admin` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT · `app_admin`: sin acceso

### household_expenses

Gastos comunes del hogar, visibles para todos los miembros junto con quién los registró. Trazabilidad: HU13.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `household_id` | `uuid` | No |  | FK |  | Hogar al que pertenece el registro. |
| `created_by` | `uuid` | Sí |  | FK |  | Miembro que registró el gasto; NULL si eliminó su cuenta (HU21). |
| `created_by_name` | `app.label` | No |  |  |  | Nombre de quien lo registró, fijado por el servidor; pasa a 'Ex miembro' si se borra su cuenta. |
| `label` | `app.label` | No |  |  |  | Nombre que el usuario da al registro. |
| `amount` | `app.clp` | No |  |  | `amount > 0` | Monto en pesos chilenos (entero). |
| `schedule_kind` | `text` | No |  |  | `schedule_kind IN ('once', 'monthly', 'every_n_months')` | Periodicidad: 'once' (un mes), 'monthly' (mensual) o 'every_n_months' (cada N meses). |
| `interval_months` | `smallint` | Sí |  |  |  | Cada cuántos meses se repite (2 a 24); solo con 'every_n_months'. |
| `from_month` | `app.month` | No |  |  |  | Primer mes en que aplica. |
| `until_month` | `app.month` | Sí |  |  |  | Último mes en que aplica; NULL = sin término. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |

- **Clave primaria:** `id`
- **Clave foránea:** (`created_by`) → `users` (id), ON DELETE SET NULL
- **Clave foránea:** (`household_id`) → `households` (id), ON DELETE CASCADE
- **Única:** (`id`, `household_id`)
- **Regla de fila:** `((schedule_kind = 'once') AND (interval_months IS NULL) AND (until_month IS NULL)) OR ((schedule_kind = 'monthly') AND (interval_months IS NULL)) OR ((schedule_kind = 'every_n_months') AND ((interval_months >= 2) AND (interval_months <= 24)))`
- **Regla de fila:** `(until_month IS NULL) OR (until_month >= from_month)`
- **Índice:** `household_expenses_household_idx` (household_id)
- **Trigger** `household_expenses_author`: Fija el autor y su nombre desde el servidor e impide reescribirlos.
- **RLS:** activa; políticas: `household_expenses_delete` (DELETE, app_api), `household_expenses_insert` (INSERT, app_api), `household_expenses_read` (SELECT, app_api), `household_expenses_update` (UPDATE, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE (amount, from_month, interval_months, label, schedule_kind, until_month, updated_at) · `app_admin`: sin acceso

### contribution_rules

Regla de aporte de cada gasto común: partes iguales, porcentajes o asignado a un miembro. Trazabilidad: HU14, HU15.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `expense_id` | `uuid` | No |  | PK,FK |  | Gasto común al que aplica la regla (una regla por gasto). |
| `household_id` | `uuid` | No |  | FK |  | Hogar del gasto; la clave compuesta impide mezclar hogares. |
| `mode` | `text` | No |  |  | `mode IN ('equal', 'percentage', 'assigned')` | Modo de reparto: 'equal', 'percentage' o 'assigned'. |
| `assigned_user_id` | `uuid` | Sí |  |  |  | Miembro que asume el gasto; solo con 'assigned'. Debe ser miembro actual (trigger). |

- **Clave primaria:** `expense_id`
- **Clave foránea:** (`expense_id`, `household_id`) → `household_expenses` (id, household_id), ON DELETE CASCADE
- **Única:** (`expense_id`, `household_id`)
- **Regla de fila:** `(mode = 'assigned') = (assigned_user_id IS NOT NULL)`
- **Trigger** `contribution_rules_members`: El miembro asignado debe pertenecer actualmente al hogar.
- **Trigger** `contribution_rules_total`: Con modo porcentaje, los porcentajes deben sumar 100 % (al confirmar).
- **Relación lógica:** `assigned_user_id` → `household_members.user_id`. Trigger: debe ser miembro actual del hogar.
- **RLS:** activa; políticas: `contribution_rules_read` (SELECT, app_api), `contribution_rules_write` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

### contribution_shares

Porcentaje de cada miembro cuando la regla es por porcentajes. La suma debe ser exactamente 100 % (se verifica al confirmar la transacción). Trazabilidad: HU14.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `expense_id` | `uuid` | No |  | PK,FK |  | Gasto común. |
| `household_id` | `uuid` | No |  | FK |  | Hogar; la clave compuesta mantiene el porcentaje en el mismo hogar que la regla. |
| `user_id` | `uuid` | No |  | PK |  | Miembro que aporta. Debe ser miembro actual del hogar (trigger). |
| `basis_points` | `integer` | No |  |  | `(basis_points >= 1) AND (basis_points <= 10000)` | Porcentaje en puntos básicos enteros (10.000 = 100 %). |

- **Clave primaria:** `expense_id`, `user_id`
- **Clave foránea:** (`expense_id`, `household_id`) → `contribution_rules` (expense_id, household_id), ON DELETE CASCADE
- **Trigger** `contribution_shares_members`: Cada miembro con porcentaje debe pertenecer actualmente al hogar.
- **Trigger** `contribution_shares_total`: Los porcentajes deben sumar 100 % (verificación diferida al confirmar).
- **Relación lógica:** `user_id` → `household_members.user_id`. Trigger: debe ser miembro actual del hogar.
- **RLS:** activa; políticas: `contribution_shares_read` (SELECT, app_api), `contribution_shares_write` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, INSERT, SELECT, UPDATE · `app_admin`: sin acceso

## Suscripción y pagos

### plans

Catálogo de planes del modelo freemium y sus límites (Tabla 13 del primer informe). Datos de referencia cargados por la migración. Trazabilidad: HU18, HU30.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `code` | `text` | No |  | PK | `code IN ('free', 'paid', 'family')` | Código del plan: 'free', 'paid' o 'family'. |
| `name` | `app.label` | No |  |  |  | Nombre visible del plan. |
| `price_clp` | `app.clp` | Sí |  |  | `(price_clp IS NULL) OR (price_clp > 0)` | Precio por período en pesos; NULL = no está a la venta (el informe aún no fija precios). |
| `period_months` | `smallint` | No | `1` |  | `(period_months >= 1) AND (period_months <= 12)` | Duración del período pagado, en meses. |
| `max_saved_scenarios` | `integer` | Sí |  |  | `(max_saved_scenarios IS NULL) OR (max_saved_scenarios >= 0)` | Máximo de escenarios guardados; NULL = ilimitado. |
| `max_compared_scenarios` | `integer` | Sí |  |  | `(max_compared_scenarios IS NULL) OR (max_compared_scenarios >= 1)` | Máximo de escenarios comparables contra la base; NULL = ilimitado. |
| `full_history` | `boolean` | No |  |  |  | Acceso al historial completo de meses. |
| `user_prepayments` | `boolean` | No |  |  |  | Permite simular prepagos definidos por el usuario. |
| `household_space` | `boolean` | No |  |  |  | Incluye el espacio común del hogar. |

- **Clave primaria:** `code`
- **RLS:** no aplica
- **Acceso:** `app_api`: SELECT · `app_admin`: SELECT

### subscriptions

Período pagado vigente de un usuario. Sin fila, el usuario está en el plan gratuito. El estado (Tabla 14 del primer informe) se deriva de las fechas; no se almacena. Trazabilidad: HU19, HU20.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `user_id` | `uuid` | No |  | PK,FK |  | Usuario suscrito (una suscripción vigente por usuario). |
| `plan_code` | `text` | No |  | FK | `plan_code <> 'free'` | Plan contratado. |
| `period_start` | `date` | No |  |  |  | Inicio del período pagado (fecha de Chile). |
| `period_end` | `date` | No |  |  |  | Fin del período pagado; luego el usuario vuelve al plan gratuito sin perder datos (HU20). |
| `cancel_at_period_end` | `boolean` | No | `false` |  |  | El usuario canceló: conserva el acceso hasta period_end y no se renueva. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |

- **Clave primaria:** `user_id`
- **Clave foránea:** (`plan_code`) → `plans` (code), ON DELETE NO ACTION
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE CASCADE
- **Regla de fila:** `period_end > period_start`
- **RLS:** activa; políticas: `subscriptions_admin_read` (SELECT, app_admin), `subscriptions_owner_read` (SELECT, app_api)
- **Acceso:** `app_api`: SELECT · `app_admin`: SELECT

### payment_orders

Órdenes de pago de Webpay Plus. buy_order único hace idempotente la activación. Nunca se guardan datos de tarjeta. Trazabilidad: HU19, HU26, RNF09.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `buy_order` | `text` | No |  | PK | `buy_order ~ '^[A-Za-z0-9_-]{1,26}$'` | Orden de compra enviada a Webpay. Única: confirmar dos veces no activa dos veces. |
| `user_id` | `uuid` | Sí |  | FK |  | Usuario que paga; NULL si eliminó su cuenta (se conserva para conciliar con Transbank). |
| `plan_code` | `text` | No |  | FK | `plan_code <> 'free'` | Plan contratado. |
| `amount` | `app.clp` | No |  |  | `amount > 0` | Monto esperado según el plan. |
| `provider_token` | `text` | Sí |  | UK | `length(provider_token) <= 128` | token_ws de Webpay. |
| `status` | `text` | No | `'created'` |  | `status IN ('created', 'authorized', 'rejected', 'aborted', 'amount_mismatch')` | Resultado: 'created', 'authorized', 'rejected', 'aborted' o 'amount_mismatch'. |
| `authorized_amount` | `app.clp` | Sí |  |  |  | Monto informado por Transbank; se compara con amount. |
| `response_code` | `text` | Sí |  |  | `length(response_code) <= 32` | Código de respuesta de Transbank. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `committed_at` | `timestamptz` | Sí |  |  |  | Fecha y hora del commit desde el servidor. |
| `activated_at` | `timestamptz` | Sí |  |  |  | Fecha y hora en que se activó el plan; solo si status = authorized. |

- **Clave primaria:** `buy_order`
- **Clave foránea:** (`plan_code`) → `plans` (code), ON DELETE NO ACTION
- **Clave foránea:** (`user_id`) → `users` (id), ON DELETE SET NULL
- **Única:** (`provider_token`)
- **Regla de fila:** `(activated_at IS NULL) OR (status = 'authorized')`
- **Índice:** `payment_orders_review_idx` (status) WHERE (status = 'amount_mismatch'::text)
- **Índice:** `payment_orders_user_idx` (user_id)
- **RLS:** activa; políticas: `payment_orders_admin_read` (SELECT, app_admin), `payment_orders_owner_create` (INSERT, app_api), `payment_orders_owner_read` (SELECT, app_api), `payment_orders_owner_token` (UPDATE, app_api)
- **Acceso:** `app_api`: INSERT, SELECT, UPDATE (provider_token) · `app_admin`: SELECT

## Escenarios

### scenarios

Escenario de simulación: nombre, referencia al estado base y decisiones. El estado base nunca se copia, así que el escenario no puede alterarlo (regla 3). Trazabilidad: HU06, HU07, HU09, HU11.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |  | Identificador único (UUID aleatorio, no secuencial). |
| `owner_id` | `uuid` | No |  | FK |  | Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS). |
| `name` | `app.label` | No |  |  |  | Nombre del escenario. |
| `base_kind` | `text` | No |  |  | `base_kind IN ('personal', 'household')` | Estado base: 'personal' o 'household'. |
| `household_id` | `uuid` | Sí |  | FK |  | Hogar cuyo estado se usa como base; solo con 'household'. Si el hogar desaparece o el usuario sale, el escenario pasa a personal (trigger). |
| `decisions` | `jsonb` | No | `'[]'` |  | `(jsonb_typeof(decisions) = 'array') AND (jsonb_array_length(decisions) <= 20) AND (octet_length(decisions) <= 65536)` | Decisiones del escenario (arreglo JSON, máx. 20 y 64 KB). El núcleo las valida al simular. |
| `created_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de creación. |
| `updated_at` | `timestamptz` | No | `now()` |  |  | Fecha y hora de la última modificación. |

- **Clave primaria:** `id`
- **Clave foránea:** (`household_id`) → `households` (id), ON DELETE NO ACTION
- **Clave foránea:** (`owner_id`) → `users` (id), ON DELETE CASCADE
- **Regla de fila:** `(base_kind = 'household') = (household_id IS NOT NULL)`
- **Índice:** `scenarios_household_idx` (household_id)
- **Índice:** `scenarios_owner_idx` (owner_id)
- **RLS:** activa; políticas: `scenarios_owner` (ALL, app_api)
- **Acceso:** `app_api`: DELETE, SELECT, UPDATE (base_kind, decisions, household_id, name, updated_at) · `app_admin`: sin acceso

## Auditoría

### audit_log

Traza de auditoría de solo inserción, encadenada por hash: alterar o borrar una entrada rompe la cadena y es detectable. Trazabilidad: RNF10, RNF22, HU25.

| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |
|---|---|---|---|---|---|---|
| `id` | `bigint` | No | `identidad` | PK |  | Identificador interno autoincremental. |
| `seq` | `bigint` | No |  | UK |  | Posición en la cadena, asignada por el trigger con bloqueo. |
| `occurred_at` | `timestamptz` | No |  |  |  | Fecha y hora del evento, fijada por el servidor. |
| `actor_type` | `text` | No |  |  | `actor_type IN ('user', 'admin', 'system')` | Quién actuó: 'user', 'admin' o 'system'. |
| `actor_id` | `uuid` | Sí |  |  |  | Identificador del actor. Sin clave foránea: sobrevive al borrado de la cuenta como seudónimo. |
| `action` | `text` | No |  |  | `action ~ '^[a-z][a-z0-9_.]{0,63}$'` | Acción realizada, p. ej. 'user.suspend'. |
| `target_type` | `text` | No |  |  | `target_type ~ '^[a-z][a-z0-9_]{0,63}$'` | Tipo de recurso afectado. |
| `target_id` | `uuid` | Sí |  |  |  | Identificador del recurso afectado. |
| `origin_ip` | `inet` | Sí |  |  |  | IP de origen vista por la API (HU25). |
| `details` | `jsonb` | No | `'{}'` |  | `(jsonb_typeof(details) = 'object') AND (octet_length(details) <= 4096)` | Detalle en JSON: solo identificadores y nombres de campos, nunca valores personales ni montos. |
| `prev_hash` | `bytea` | No |  |  | `length(prev_hash) = 32` | Hash de la entrada anterior (encadenamiento). |
| `hash` | `bytea` | No |  | UK | `length(hash) = 32` | Hash SHA-256 de esta entrada. |

- **Clave primaria:** `id`
- **Única:** (`hash`)
- **Única:** (`seq`)
- **Trigger** `audit_log_chain`: Asigna seq, occurred_at, prev_hash y hash; el llamador no puede elegirlos.
- **Trigger** `audit_log_no_update_delete`: Rechaza toda modificación o borrado: la traza es de solo inserción.
- **Relación lógica:** `actor_id` → `users.id`. Sin clave foránea a propósito: la traza sobrevive al borrado de la cuenta (HU21).
- **RLS:** no aplica
- **Acceso:** `app_api`: INSERT · `app_admin`: INSERT, SELECT

## Pendientes del modelo

- **Registro de consentimientos (Ley 21.719, HU32):** no hay tabla que guarde qué versión de los términos y de la política de privacidad aceptó cada usuario, ni el consentimiento para vincular su banco. Requiere decisión del equipo antes de crear la migración.

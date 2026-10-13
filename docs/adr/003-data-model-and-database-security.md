# ADR-003: Modelo de datos y seguridad en la base de datos

- **Estado:** aceptada
- **Fecha:** 04-10-2026
- **Autores:** Joaquín Varas (revisión pendiente: Maximiliano Lizana)

## Contexto

La plataforma guarda datos financieros personales protegidos por la Ley 21.719, con un modelo de
hogar donde la información fluye del espacio común hacia cada miembro y nunca al revés (regla 5,
RNF08). La autorización se verifica en el servidor, pero un solo error en una consulta bastaría
para exponer datos de otra persona. Por eso la base de datos debe ser una segunda barrera.

## Decisión

**PostgreSQL 18, sin extensiones.** Es la versión por defecto de DigitalOcean Managed PostgreSQL,
donde varias extensiones todavía no están disponibles. Basta con lo que trae de serie:
`gen_random_uuid()` y `sha256()`. Los identificadores son UUID v4 aleatorios: un UUID v7 dejaría
ver la fecha de creación en los identificadores públicos.

**Migraciones SQL versionadas** (`backend/migrations/NNNN_nombre.sql`), aplicadas en orden, cada
una en su propia transacción y con huella SHA-256. Si una migración ya aplicada se modifica o
desaparece, el proceso falla, para que el esquema nunca se aparte en silencio de los archivos.

**Roles separados por servicio:**

| Rol | Uso | Acceso |
|---|---|---|
| dueño (`findemes_owner` en local) | Solo migraciones | Dueño de los objetos; ningún servicio se conecta con él |
| `app_api` (login `findemes_api`) | API pública | Datos de usuario bajo RLS |
| `app_admin` (login `findemes_admin`) | API de administración | Cuentas, planes, pagos y auditoría. **Ningún permiso sobre tablas financieras** (HU23) ni sobre el hash de contraseña |

**Row-Level Security en todas las tablas con datos de usuario.** La API fija el usuario de cada
transacción con `set_config('app.user_id', <uuid>, true)`. Sin usuario, ninguna política coincide
(denegación por defecto). Las tablas individuales (registro, escenarios y datos bancarios) solo
son visibles para su dueño. Las del hogar son visibles para sus miembros y contienen solo datos
comunes: un administrador del hogar no puede leer los datos individuales de los miembros. Cada
miembro se muestra con un nombre visible elegido por él, nunca con su correo.

**Operaciones sensibles como funciones atómicas** (`SECURITY DEFINER`, con `search_path` fijo y
permisos de ejecución explícitos por rol):

- `lookup_login` y `lookup_admin_login`: el inicio de sesión ocurre antes de conocer al usuario.
- `rotate_refresh_token`: rotación con detección de reutilización. Reutilizar un token revoca
  toda su familia.
- `consume_email_token`: enlaces de un solo uso y con vencimiento.
- `create_household` y `accept_household_invitation`: nadie puede agregarse a un hogar ajeno.
- `create_scenario_if_under_limit`: es la única vía para crear escenarios. Lee el límite desde
  el plan vigente (no lo recibe de la API) y se respeta aun con solicitudes simultáneas.
- `settle_payment_order`: activación idempotente, serializada por usuario, con el monto
  verificado contra la orden y contra el precio del plan (regla 6, RNF04). Una diferencia de
  monto queda marcada como `amount_mismatch` para la conciliación (HU26). Renovar el mismo plan
  extiende el período; cambiar de plan inicia uno nuevo, así que el tiempo pagado no se mejora
  gratis. `cancel_subscription` implementa el estado "Cancelada" de la Tabla 14.

**Auditoría inalterable.** La tabla de auditoría solo admite inserciones, también para el dueño
(los triggers rechazan UPDATE, DELETE y TRUNCATE). El servidor fija la hora, y cada registro
incluye el hash del anterior; `verify_audit_chain()` detecta cualquier alteración. Cada servicio
registra solo su propio tipo de actor: la API pública no puede escribir acciones de
administrador. Los detalles rechazan claves de datos personales o financieros.

**Otras decisiones:**

- Los montos se guardan como `bigint` dentro del rango seguro de JavaScript (dominio `app.clp`) y
  los meses como su primer día (dominio `app.month`).
- La deuda se guarda como un calendario explícito de cuotas, igual que en el núcleo.
- Un escenario guarda solo su nombre, la referencia a su base y sus decisiones (regla 3); una
  prueba verifica que no tenga otras columnas.
- El estado de la Tabla 14 (activa, por vencer, vencida, cancelada) se calcula desde las fechas
  del período y no se guarda, para que no quede desactualizado.
- Al borrar una cuenta (HU21) se eliminan en cascada todos sus datos individuales. Las órdenes de
  pago y la auditoría conservan solo el identificador seudónimo; el autor de un gasto común pasa
  a mostrarse como "Ex miembro".
- Una acción sobre el espacio común nunca borra datos individuales (regla 5): si se elimina el
  hogar o un miembro sale de él, sus escenarios basados en el hogar pasan a ser personales.
- Los ingresos, gastos y saldo inicial guardan su origen (`real`, `provider_test` o `demo`) y el
  movimiento o la cuenta bancaria de donde vienen, de modo que los datos de demostración o de
  prueba no pierden su etiqueta al pasar al registro (ADR-002).
- El `link_token` de Fintoc y el secreto TOTP se guardan cifrados por la aplicación
  (AES-256-GCM); la base nunca los ve en claro.

**Reglas que se quedan en la base y por qué.** La revisión de arquitectura propuso llevar a los
módulos tres reglas del hogar que hoy aplica un trigger cuando sale un miembro: el reparto pasa a
partes iguales, se promueve un nuevo administrador y se elimina el hogar vacío. Se mantienen en
la base como red de seguridad, porque el borrado de una cuenta (HU21) siempre debe completarse y
un hogar nunca debe quedar sin administración ni con reparticiones que sumen menos de 100 %, aun
si una operación no pasa por el módulo. El módulo de hogar implementará los mismos casos de uso
de forma explícita, con pruebas que verifiquen que coinciden con este comportamiento.

**Operación en DigitalOcean.**

- Las migraciones corren como un trabajo previo al despliegue, por el puerto directo (no por el
  pool), y nunca al iniciar un servicio.
- Los servicios usan TLS con verificación (`sslmode=verify-full` y el certificado de DigitalOcean).
- El dueño en producción es un rol sin superusuario. La CI debe probar también con un dueño sin
  superusuario.
- Los roles son de todo el clúster: staging y producción usan clústeres separados.
- Un respaldo restaurado corta la cadena de auditoría en el punto de restauración. El hash más
  reciente de la cadena se exporta periódicamente fuera de la base, para detectar si el dueño la
  recalcula.
- Toda la seguridad por filas depende de `app.user_id`. Solo el adaptador de PostgreSQL lo fija,
  dentro de `withActor`, y ningún repositorio puede consultar fuera de esa transacción. Una
  inyección SQL anularía esta barrera, así que todas las consultas son parametrizadas.
- La inserción en la auditoría va al final de cada transacción, porque toma un bloqueo global
  hasta el commit.
- Retención: la IP de origen de la auditoría se conserva por un plazo que el equipo debe definir
  en la política de privacidad (HU32).

## Consecuencias

- `pnpm test:db` ejecuta 115 pruebas de integración contra PostgreSQL real, con los mismos roles y
  RLS que producción. Entre ellas: acceso cruzado individual y del hogar, privilegios de cada
  función, concurrencia del límite de escenarios y de los pagos, idempotencia de pagos e
  integridad de la auditoría. Solo aceptan una base local (`TEST_DATABASE_URL`) salvo en CI, y
  usan roles de prueba propios.
- Las pruebas y dos revisiones independientes (arquitectura y seguridad) encontraron defectos
  antes de integrarse; cada uno quedó cubierto por una prueba de regresión. Entre ellos:
  - todas las funciones eran ejecutables por cualquier rol;
  - dos pagos simultáneos daban un solo período;
  - el administrador del hogar podía borrar escenarios individuales;
  - un exmiembro podía borrar gastos comunes;
  - la API podía falsificar auditoría de administrador;
  - el límite de escenarios se podía saltar.
- Pendiente del equipo: **los precios de los planes pagado y familiar**. El informe no los
  define; mientras el precio sea NULL, el plan no se puede comprar.
- Pendiente del equipo: qué significa "historial de meses" en la Tabla 13 (mes vigente en el plan
  gratuito, histórico completo en los pagados). Hoy `plans.full_history` es solo una marca.
- Pendiente: si los miembros de un hogar con plan familiar reciben los beneficios de ese plan.
  Hoy la suscripción es por usuario.
- El modo de solo lectura del espacio común con la suscripción vencida (Tabla 14) se aplica en la
  capa de aplicación, porque depende del estado derivado de la suscripción.

# ADR-004: Modelo de amenazas — la plataforma como vector de ataque

- **Estado:** propuesta (requiere revisión de Maximiliano Lizana; los controles nuevos amplían el alcance)
- **Fecha:** 11-10-2026
- **Autores:** Joaquín Varas
- **Afecta al informe:** Ilustración 5 (acceso administrativo por Tailscale), apartado de seguridad,
  RNF21, RNF22, HU19, HU22, HU31 y HU36.

## Contexto

El profesor guía pidió analizar cómo podría usarse Fin de Mes como pasarela para atacar a la propia
plataforma, a sus clientes o a las cuentas bancarias de sus clientes, y cómo protegerse.

Este documento no repite los controles generales del `CLAUDE.md`. Recorre los escenarios en que
**un atacante usa la plataforma como medio**, no solo como objetivo, y para cada uno indica el
control y la HU o el RNF que lo respalda. Los activos que interesan a un atacante son:

| Activo | Valor para el atacante |
|---|---|
| Perfil financiero de los clientes (ingresos, deudas, gastos) | Estafas dirigidas: sabe a quién llamar, qué banco usa y cuánto debe |
| `link_token` de Fintoc y clave secreta de Fintoc | Lectura de movimientos bancarios reales (en modo live) |
| Cuentas de usuario | Datos individuales y del hogar |
| Panel de administración | Acceso transversal a todas las cuentas |
| Dominio y correo de Fin de Mes | Credibilidad para suplantar la marca |
| Checkout de Webpay | Probar tarjetas robadas |
| Código fuente y CI | Insertar código en todo lo que se despliega |

## Principio rector: limitar lo que la plataforma puede hacer

La defensa más fuerte es de diseño: si la plataforma se compromete por completo, debe haber poco que
robar y nada que mover.

1. **No mueve dinero.** La app no paga deudas ni hace transferencias; solo muestra y simula.
2. **No recibe la clave bancaria.** El usuario la ingresa en el widget de Fintoc (ADR-002).
3. **Solo lee movimientos.** Los Link se crean con el producto `movements`. La cuenta de Fintoc del
   proyecto no debe tener habilitados productos que inicien pagos, y el MCP de Fintoc no se usa
   (ADR-002).
4. **No almacena tarjetas** (RNF09). El pago ocurre en el formulario de Transbank.
5. **Guarda lo mínimo** y permite el borrado efectivo (HU21).

## Escenarios y controles

Estado: ✅ previsto en el `CLAUDE.md` o en un ADR · ⚠️ parcial o sin formalizar · ❌ no previsto.

| # | Escenario | Víctima | Controles | Respaldo | Estado |
|---|---|---|---|---|---|
| A1 | Tomar el panel de administración para ver o alterar cuentas | Todos los clientes | `admin-api` y panel solo por Tailscale (sin puerto en internet) + TOTP; el rol `app_admin` no lee tablas financieras; auditoría encadenada por hash | RNF21, RNF22, HU22, HU23, HU25, ADR-001, ADR-003 | ✅ |
| A2 | Robar la base de datos para hacer estafas dirigidas | Clientes | PostgreSQL gestionado con *trusted sources* limitadas a la salida privada de la app y a la IP privada del Droplet (el clúster conserva un hostname público que DigitalOcean no permite desactivar; está por verificar); RLS y roles por servicio; `link_token` y TOTP cifrados en la aplicación con una clave que vive fuera de la base; borrado efectivo. **Riesgo aceptado:** ingresos, gastos y deudas no se cifran en la aplicación, así que un volcado completo o una inyección SQL con el rol `app_api` los expone | RNF08, RNF10, HU21, ADR-003 | ⚠️ |
| A3 | Robar la clave secreta de Fintoc para leer los movimientos de todos | Cuentas bancarias de los clientes | Clave solo en variables de entorno del servicio (gitleaks en CI); MFA en el panel de Fintoc; solo el producto `movements` (es configuración de la cuenta de Fintoc, no del código: se verifica periódicamente); revocar el Link al desconectar o borrar la cuenta; rotar la clave ante sospecha | HU36, ADR-002 | ⚠️ Formalizar la rotación, el MFA y la verificación periódica |
| A4 | Probar tarjetas robadas en nuestro checkout (*card testing*) | Titulares de tarjetas; nuestra afiliación con Transbank | Pagar solo con cuenta de correo verificada; límite de transacciones creadas por usuario y por IP; alerta ante una tasa de rechazos anómala; montos solo los del plan | HU19, HU26 | ❌ |
| A5 | Suplantar la marca con correos falsos ("vincula tu banco aquí") | Clientes | SPF, DKIM y DMARC `p=reject` en el dominio de envío; los correos nunca piden datos ni claves; la app lo declara en su centro de ayuda | HU32 | ❌ |
| A6 | Usar nuestras invitaciones para enviar phishing desde nuestro dominio | Terceros | Los correos no incluyen texto libre escrito por usuarios (nombre del hogar, mensajes), o lo incluyen escapado y truncado; límite de invitaciones por hogar y por día; enlace de un solo uso | HU31 | ❌ |
| A7 | Usar el registro y la recuperación para bombardear un buzón ajeno | Terceros | Límite por dirección de correo y por IP en registro, recuperación e invitaciones; respuestas idénticas exista o no la cuenta | HU17, HU17.2, HU34 | ⚠️ Hoy solo hay límite por IP en el inicio de sesión |
| A8 | Redirección abierta: un enlace nuestro que lleva a un sitio falso | Clientes | Las URL de retorno (Webpay, verificación, restablecimiento, widget) son fijas en el servidor; nunca se toman de parámetros de la petición | HU17.2, HU19 | ❌ |
| A9 | Tomar cuentas con contraseñas filtradas en otros sitios | Clientes | argon2id; lista local de contraseñas filtradas; bloqueo progresivo por cuenta y límite por IP; refresh rotativo con detección de reutilización; aviso por correo al cambiar la contraseña | HU17, HU17.1, HU17.4 | ⚠️ Diseñado, no implementado; HU17.1 dice "cinco intentos" y el `CLAUDE.md` dice espera creciente (alinear). Evaluar 2FA opcional para usuarios |
| A10 | Un miembro del hogar lee datos individuales de otro o le inyecta contenido (XSS en el nombre de un gasto común) | Clientes entre sí | Autorización por recurso en el servidor; 404 ante recursos ajenos; pruebas de acceso cruzado; validación estricta; CSP en la web | RNF08, HU16 | ✅ |
| A11 | SSRF: engañar al servidor para que haga peticiones a la red interna | Plataforma | Cada adaptador usa un cliente HTTP con una lista fija de hosts permitidos (Fintoc, Transbank, correo); ninguna ruta acepta una URL de destino del usuario | Regla 7 del `CLAUDE.md` | ⚠️ Cierto por diseño; falta el cliente con lista fija |
| A12 | Pagos o movimientos falsos: webhooks falsificados o retorno de Webpay con un `token_ws` ajeno | Plataforma y clientes | El plan se activa solo tras el `commit` contra Transbank desde el servidor, ligado a la orden del usuario autenticado y con el monto verificado contra el plan. Los webhooks de Fintoc quedan **fuera de alcance**: la sincronización la inicia el backend | RNF04, HU19 | ⚠️ Falta ligar el retorno a la orden del usuario |
| A13 | Abusar del modo demostración público para agotar recursos | Plataforma | Endpoint sin estado con límite de tasa y tamaño de entrada acotado | HU27, HU28 | ✅ |
| A14 | Cadena de suministro: una dependencia o una acción de CI maliciosa inserta código | Todos | Lockfile; acciones fijadas por SHA; osv-scanner, `pnpm audit`, Dependabot y CodeQL; revisión obligatoria del otro socio | `CLAUDE.md` (CI) | ✅ |
| A15 | Un equipo de administración comprometido, ya dentro de la tailnet, se mueve hacia otros servicios | Plataforma | ACL de Tailscale: solo dispositivos `tag:admin` y solo hacia el puerto de `admin-api`; aprobación manual de dispositivos; MFA en el proveedor de identidad; Cloud Firewall del Droplet sin entradas públicas; `admin-api` escucha solo en la interfaz de Tailscale; TOTP igual se exige. Es un control **operativo**: con responsable y evidencia versionada en `docs/` | RNF21, RNF22 | ⚠️ Definir las ACL |
| A16 | Falsificar la IP de origen (`X-Forwarded-For`) para evadir los límites por IP, o que todos los límites vean la IP del balanceador | Plataforma y clientes | Configurar `trustProxy` solo para el balanceador de App Platform y documentar qué cabecera se confía. Sin esto fallan en silencio A4, A7, A9 y A13 | — | ❌ No definido en código ni en ADR |
| A17 | Enumerar cuentas por tiempo de respuesta en registro y recuperación | Clientes | Además de respuestas idénticas, enviar el correo de forma asíncrona para igualar los tiempos | HU17, HU17.2 | ❌ |
| A18 | Agotar la cuota de Fintoc forzando Link Intents o sincronizaciones | Plataforma | Límite por usuario en el módulo `aggregation` | HU36 | ❌ |
| A19 | Secuestrar una cuenta cambiando su correo | Clientes | Reautenticación y aviso al correo anterior antes de cambiar el correo | HU17.4 | ❌ |
| A20 | Fuga por logs: montos, `link_token`, TOTP o tokens de enlace en la URL registrada por Fastify | Clientes | Ampliar la redacción del logger (`amount`, `balance`, `link_token`, `totp`); los tokens de verificación y restablecimiento no viajan en la ruta ni en la query que se registra; `Referrer-Policy: no-referrer` | `CLAUDE.md` (Datos) | ⚠️ El logger actual no redacta montos, `link_token` ni TOTP |
| A21 | Administrador malicioso o coaccionado: suspende cuentas en masa o extrae correos y pagos | Clientes | Toda acción queda en la auditoría encadenada; alerta ante suspensiones masivas; `app_admin` no lee datos financieros, pero **sí** correos, planes y pagos | HU23, HU25 | ⚠️ Falta la alerta |

## Decisión

1. **Acceso administrativo por Tailscale**, no por el balanceador público con segundo factor. El
   RNF21 exige que la API de administración no tenga ruta alcanzable desde internet y que un
   escaneo del dominio público no encuentre puntos de acceso administrativos; un panel detrás del
   balanceador público lo incumpliría. Tailscale agrega una barrera de red con identidad de
   dispositivo antes del TOTP de la aplicación, que se mantiene (RNF22).
2. Se adoptan los principios de la sección anterior como restricciones de diseño: ninguna
   funcionalidad nueva puede mover dinero, recibir credenciales bancarias o almacenar tarjetas.
3. Los controles ❌ y ⚠️ se proponen como trabajo nuevo, sujeto a la aprobación de ambos socios.

## Consecuencias

- La Ilustración 5 del informe debe redibujarse: el tráfico administrativo entra por Tailscale
  hacia el Droplet, no por el balanceador público.
- En la defensa, la comisión no puede abrir el panel desde un equipo propio; se muestra desde un
  dispositivo de la tailnet.
- Si Tailscale no está disponible, no se pueden abrir conexiones nuevas al panel. El servicio a
  los usuarios no se ve afectado.
- La confianza en el plano de control de Tailscale es un riesgo aceptado; la confidencialidad no
  depende solo de él, porque el panel exige TOTP y el rol `app_admin` no lee datos financieros
  (sí lee correos, planes y pagos).
- Otros riesgos aceptados: el proveedor de correo ve los enlaces de verificación y
  restablecimiento (se mitiga con un solo uso y vida corta), y el perfil financiero no se cifra en
  la aplicación (A2).
- A la fecha, casi todos estos controles son diseño: las APIs solo exponen `/health`. Cada ruta
  nueva debe cumplirlos desde el inicio.

## Pendientes propuestos

Orden sugerido para un equipo pequeño:

1. **Base transversal**, antes de escribir más rutas: `trustProxy`, límite de tasa por IP y por
   cuenta o correo, CORS con orígenes exactos, CSP y HSTS (A16, A4, A7, A9, A13).
2. **Pagos y redirecciones** (A8, A12): pocas rutas, con dinero de por medio y fáciles de probar.
3. **Logs** (A20): barato y evita una fuga silenciosa.
4. **Correo** (A5, A6, A7, A17).
5. **Operación** de Tailscale y Fintoc (A3, A15, A21).
6. Al final: A11, A18, A19 y el 2FA opcional.

| Control | Escenario | Dónde |
|---|---|---|
| `trustProxy` para el balanceador de App Platform y límite de tasa transversal | A16 | `http`, `composition` |
| Redacción de montos, `link_token` y TOTP en el logger; tokens fuera de la URL | A20 | `composition/logger.ts`, rutas de `identity` |
| Retorno de Webpay ligado a la orden del usuario autenticado | A12 | `subscription` |
| Envío asíncrono de correos; reautenticación al cambiar el correo | A17, A19 | `identity`, `notifications` |
| Límite por usuario en Link Intents y sincronización | A18 | `aggregation` |
| Alerta ante suspensiones masivas | A21 | `admin-api` |
| Verificar que ningún servicio se conecta con el rol dueño (las tablas no usan `FORCE ROW LEVEL SECURITY`) | A2 | ADR-003, despliegue |
| Límite de transacciones por usuario e IP; pago solo con correo verificado; alerta de rechazos | A4 | `subscription`, `admin-api` (HU26) |
| SPF, DKIM y DMARC `p=reject` | A5 | Configuración de DNS y del proveedor de correo |
| Plantillas de correo sin texto libre de usuarios; límite de invitaciones | A6 | `notifications`, `household` |
| Límite por dirección de correo en registro, recuperación e invitaciones | A7 | `identity`, `household` |
| URL de retorno fijas y prueba que rechace redirecciones a otros dominios | A8 | `api/v1`, `subscription` |
| Prueba que verifique que los adaptadores solo llaman a hosts permitidos | A11 | `adapters` |
| MFA del panel de Fintoc y procedimiento de rotación de la clave secreta | A3 | Operación |
| ACL de Tailscale y Cloud Firewall del Droplet, versionados en `docs/` | A15 | Operación |
| Evaluar 2FA opcional para usuarios | A9 | Consultar si se agrega como HU |

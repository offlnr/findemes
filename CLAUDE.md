# Fin de Mes — Reglas del proyecto para agentes

Plataforma SaaS de registro y simulación financiera para personas y hogares en Chile.
Proyecto de Título (Ingeniería en Informática). Equipo: Joaquín Varas (app Flutter y UX) y
Maximiliano Lizana (backend, motor, API, pagos). Fecha de cierre fija: 01-12-2026.

La especificación es el informe `Varas_Lizana_Informe_corregido (1).docx` (43 HU en el Anexo A,
29 RNF en el Anexo B). El informe **no se versiona** (está en `.gitignore`). Cada funcionalidad
se traza a su HU o RNF. Si el informe parece incorrecto, se consulta antes de desviarse.
El calendario de sprints del informe (Tabla 36) es simulado y no se usa para planificar.

## Idioma
- Código, nombres de archivos y commits: inglés.
- Textos visibles para el usuario, explicaciones del motor y documentación: español neutro.

## Estructura del repositorio
```
/backend
  /src/core          -> motor de simulación (dominio puro)
  /src/modules       -> identity, registry, scenarios, household, subscription,
                        privacy (HU21), audit (RNF10, HU25), demo (HU27-29),
                        aggregation (HU36), notifications
                        (cada módulo: domain/ application/ ports/)
                        shared/ -> Actor, Clock, IdGenerator (comunes a los módulos)
  /src/adapters      -> postgres, webpay, fintoc, email
  /src/api/v1        -> API REST pública versionada (Fastify; genera el OpenAPI)
  /src/admin-api     -> API de administración (proceso y despliegue separados)
  /src/http          -> utilidades HTTP comunes a ambas APIs (errores uniformes, sin lógica)
  /src/composition   -> raíz de composición: conecta puertos con adaptadores
  /migrations        -> SQL versionado
  /test              -> integración y acceso cruzado
/app                 -> aplicación Flutter (web, Android, iOS)
/admin               -> panel de administración (aplicación separada)
/docs                -> openapi.yaml, adr/, diagrams/, actas
```

## Reglas no negociables
1. **Núcleo puro.** `backend/src/core` no importa nada de `modules`, `adapters`, `api`,
   base de datos, sesión, HTTP, Flutter ni bibliotecas de validación. Recibe un estado
   financiero y decisiones; devuelve proyección, indicadores y explicación. Determinista:
   misma entrada, misma salida. No usar `Date.now()`, aleatoriedad ni E/S dentro del núcleo.
   La regla se verifica en CI con `dependency-cruiser` y ESLint.
2. **Dependencias hacia el dominio.** Los módulos dependen del núcleo; nunca al revés (RNF16).
3. **El escenario no modifica el estado base.** Se deriva como copia inmutable. En la base de
   datos un escenario guarda solo sus decisiones y una referencia al estado base.
4. **El sistema no recomienda.** Ninguna explicación, pantalla ni API ordena alternativas por
   conveniencia, destaca una como preferible, emite juicios ("buena", "mala", "deberías",
   "mejora", "empeora") ni sugiere productos financieros. Las explicaciones son descriptivas:
   qué ocurre y qué lo causa.
5. **Privacidad del hogar.** La información fluye del espacio común hacia los perfiles
   individuales, nunca al revés. El control de acceso se verifica en el servidor por recurso.
   Toda ruta nueva que exponga datos individuales requiere prueba automatizada de acceso cruzado.
6. **Pagos.** Nunca almacenar datos de tarjeta. La activación del plan se confirma desde el
   backend contra Transbank y es idempotente; no depende del retorno del navegador.
7. **Integraciones solo por adaptadores.** Webpay Plus (ambiente de integración), Fintoc
   (modo de prueba) y correo transaccional. El núcleo funciona sin ninguna de ellas.
8. **Sin lógica de negocio en el cliente.** Flutter y el panel consumen la API; no recalculan.
9. **Panel de administración separado.** Ninguna ruta administrativa en la API pública.
10. **Montos en pesos chilenos como enteros** (sin decimales de punto flotante; `bigint` en
    PostgreSQL).

## Seguridad (defensa en profundidad)
- **Contraseñas:** argon2id (parámetros OWASP), mínimo 10 caracteres, verificación contra una
  lista local de contraseñas filtradas (sin llamadas externas).
- **Sesiones:** JWT de acceso de 15 min (algoritmo fijo; validar `iss`, `aud`, `exp`) más
  refresh token opaco y rotativo, guardado con hash en PostgreSQL, con detección de reutilización.
  Web: refresh en cookie `HttpOnly; Secure; SameSite=Strict` y acceso solo en memoria.
  Móvil: `flutter_secure_storage`.
- **Bloqueo de inicio de sesión (HU17.1):** bloqueo temporal con espera creciente por cuenta,
  más límite por IP. Nunca bloqueo permanente que un tercero pueda provocar.
- **Enlaces por correo:** un solo uso, guardados con hash, con expiración (verificación 24 h,
  restablecimiento 30 min).
- **Autorización:** denegación por defecto; cada repositorio exige el actor y filtra por
  propietario. IDs UUID y respuesta 404 ante recursos ajenos. Row-Level Security en PostgreSQL
  como segunda barrera.
- **Roles de base de datos por servicio.** `admin-api` no tiene lectura sobre tablas financieras
  (HU23). La traza de auditoría solo admite inserciones y está encadenada por hash (HU25).
- **Panel de administración:** segundo factor TOTP (RNF22).
- **Pagos:** `commit` de Webpay desde el servidor, restricción única sobre `buy_order`,
  verificación del monto contra el plan, manejo de flujos abortados (`TBK_TOKEN`).
- **Datos:** `link_token` de Fintoc cifrados en la aplicación (AES-256-GCM); la clave bancaria
  del usuario la recibe solo el widget de Fintoc, nunca la app ni el backend; HSTS, CSP y CORS con
  orígenes exactos; validación estricta (se rechazan campos desconocidos, montos con límites);
  los logs no registran correos, montos ni tokens; exportación y borrado efectivo (HU21).
- **CI:** gitleaks, osv-scanner / `pnpm audit`, CodeQL, Dependabot; acciones de GitHub fijadas
  por SHA; `main` protegida con revisión obligatoria del otro socio.
- Cada paso de trabajo termina con una revisión de arquitectura (núcleo puro) y una de seguridad.

## Calidad
- TDD en el núcleo: primero la prueba con resultado esperado conocido, luego el código.
- Cobertura del núcleo > 90 % de líneas (bloquea la integración si baja).
- Proyección de 12 meses < 300 ms (p95).
- Interfaces con nivel AA de WCAG 2.1.
- La documentación OpenAPI se actualiza junto con cada endpoint.

## Tecnología
Ver `docs/adr/001-technical-stack.md`.
- Backend: Node.js 24 LTS + TypeScript (strict), pnpm workspaces, Fastify, Zod (solo en `api`,
  `modules` y `composition`), Kysely + migraciones SQL, Vitest, PostgreSQL, JWT.
- Node ejecuta TypeScript directamente (type stripping): los imports relativos usan extensión
  `.ts` y solo se permite sintaxis borrable (`erasableSyntaxOnly`: sin `enum` ni `namespace`).
- Comandos: `pnpm check` (lint, tipos, capas, pruebas), `pnpm --filter @findemes/backend dev:api`,
  `openapi:generate` tras cambiar una ruta (una prueba falla si `docs/openapi.yaml` queda desfasado).
- Base de datos local: PostgreSQL en Docker Desktop (`docker compose`), misma versión que CI y
  producción.
- App: Flutter (una base de código para web, Android e iOS). Manejo de estado: Riverpod.
  Cliente de la API generado desde `docs/openapi.yaml`.
- CI: GitHub Actions. Remoto: `github.com/joaqovrs/findemes`.
- Despliegue: contenedores en DigitalOcean App Platform (servicios sin estado). `admin-api` y
  el panel corren en un Droplet dentro de la VPC de DigitalOcean, accesibles solo por Tailscale
  (RNF21).

## Catálogo de decisiones del motor (Tabla 11)
Compra en N cuotas · Alta o modificación de gasto fijo · Gasto único ·
Adelanto o prepago de deuda · Variación de ingreso.
Cada tipo implementa un contrato común y se registra en el catálogo; agregar uno nuevo
no debe modificar el motor (RNF17).

**Prepago de deuda.** La app nunca paga deudas; solo las muestra y simula. Como el efecto real
depende de la institución, el usuario elige la modalidad en cada decisión:
- `reduce_term` (por defecto): el prepago extingue cuotas completas desde la última; la cuota
  mensual se mantiene y el término se adelanta.
- `reduce_installment`: el prepago se reparte entre las cuotas restantes; el plazo se mantiene.
La explicación indica qué modalidad se asumió.

## Indicadores (Tabla 12)
Saldo mínimo proyectado · Mes de quiebre · Margen mensual disponible ·
Carga de deuda sobre ingreso · Variación respecto del escenario base.
La variación se expresa de forma neutra: diferencia de cada indicador frente a la base (+/−).
El motor es mensual: responde "en qué mes", no "en qué semana".

## Decisiones de alcance (02-10-2026)
- **Plan gratuito (Tabla 13):** máximo 2 escenarios guardados y 1 escenario comparable contra
  la base.
- **Modo demostración (HU27-28):** endpoint público sin estado `POST /v1/demo/projection`, sin
  persistencia y con límite de tasa. El cálculo sigue en el servidor.
- **Agregación bancaria (HU36): Fintoc** en lugar de Plaid, que no opera en Chile (decisión
  del 03-10-2026, ver `docs/adr/002-bank-aggregation-fintoc.md`). Modo de prueba; entrega
  cuentas corrientes y vista con montos CLP enteros (negativo = cargo). No entrega tarjetas de
  crédito, así que las deudas en cuotas (HU03) siguen siendo registro manual. El usuario
  confirma qué movimientos son recurrentes: el sistema no los clasifica por su cuenta.
- **Importación de cartolas:** fuera del MVP.

## Definición de terminado
Pruebas automatizadas en verde en CI, documentación de la API actualizada,
incremento desplegado en el ambiente de integración y revisado por el otro socio.

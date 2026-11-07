# Manual de instalación del ambiente local

Guía para dejar funcionando la implementación completa de Fin de Mes en un computador nuevo
(Windows 10/11; en macOS o Linux los comandos son los mismos salvo donde se indica). Al terminar
quedan corriendo:

| Servicio | Dirección |
|---|---|
| App Fin de Mes (Flutter web) | <http://localhost:8080> |
| Panel de administración (Flutter web) | <http://localhost:8090> |
| API pública + documentación interactiva | <http://localhost:3000> · <http://localhost:3000/docs> |
| API de administración + documentación | <http://localhost:3001> · <http://localhost:3001/docs> |
| Bandeja de correo de prueba (Mailpit) | <http://localhost:8025> |
| PostgreSQL 18 | `127.0.0.1:5432` |

Tiempo estimado: 30 a 45 minutos la primera vez (la mayor parte son descargas).

## 1. Programas necesarios

Instalar en este orden. Todos son gratuitos.

| Programa | Versión | Para qué | Cómo |
|---|---|---|---|
| Git | cualquiera reciente | Código | <https://git-scm.com/download/win> |
| fnm (Fast Node Manager) | reciente | Instala la versión exacta de Node | `winget install Schniz.fnm` |
| Node.js | **24.21.0** (archivo `.node-version`) | Backend | `fnm install 24.21.0` y `fnm use 24.21.0` |
| pnpm | **12.8.1** (`packageManager` en `package.json`) | Dependencias | `corepack enable` (viene con Node) |
| Docker Desktop | reciente, con WSL 2 | PostgreSQL 18 y Mailpit | <https://www.docker.com/products/docker-desktop/> |
| Flutter | canal estable (3.x) | App y panel | Descomprimir en `D:\tools\flutter` (o similar) y agregar `...\flutter\bin` al PATH. <https://docs.flutter.dev/get-started/install/windows/web> |
| Google Chrome | reciente | Ejecutar la app y el panel | <https://www.google.com/chrome/> |

Para que Node 24 quede activo en cada terminal, agregar a la configuración de la consola:

- **PowerShell** (`notepad $PROFILE`): `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression`
- **Git Bash** (`~/.bashrc`): `eval "$(fnm env --use-on-cd --shell bash)"`

Comprobar en una terminal nueva:

```bash
node --version      # v24.21.0
pnpm --version      # 12.8.1
docker --version
flutter --version   # canal stable
flutter doctor      # basta con que Chrome aparezca con ✓
```

> Si `node --version` muestra otra versión (por ejemplo 26), la terminal no está usando fnm:
> revisar el paso anterior o correr `fnm use 24.21.0` en esa terminal.

## 2. Obtener el código

```bash
git clone https://github.com/joaqovrs/findemes.git
cd findemes
git fetch origin
git switch feat/final-app       # rama con la implementación completa
```

Si la rama todavía no está en GitHub, pedirla al compañero (se sube con `git push -u origin feat/final-app`).

## 3. Base de datos y correo de prueba

Con Docker Desktop abierto, en la raíz del repositorio:

```bash
docker compose up -d
docker compose ps       # db y mail deben decir "healthy"
```

Esto levanta PostgreSQL 18 (datos en un volumen de Docker, persisten entre reinicios) y Mailpit.

## 4. Backend

```bash
pnpm install            # en la raíz: instala backend, landing y herramientas
cd backend
pnpm env:init           # crea backend/.env.local con secretos nuevos (no sobrescribe uno existente)
pnpm db:migrate         # crea el esquema, aplica las migraciones y los roles de cada servicio
```

`backend/.env.local` **no se versiona** y cada persona tiene el suyo. `pnpm env:init` copia
`.env.example` y genera al azar `JWT_SECRET`, `IDENTITY_HMAC_KEY`, `BANK_TOKEN_KEY`,
`ADMIN_JWT_SECRET` y `ADMIN_TOTP_KEY`. Los secretos nunca se comparten por chat ni se suben al
repositorio.

**Fintoc (opcional).** Sin llaves, la app ofrece solo el banco de demostración. Para usar Fintoc en
modo de prueba, crear una cuenta en <https://dashboard.fintoc.com>, copiar las llaves de prueba
(`sk_test_...` y `pk_test_...`) y completar en `.env.local`:

```
FINTOC_SECRET_KEY=sk_test_...
FINTOC_PUBLIC_KEY=pk_test_...
```

El backend rechaza llaves que no sean de prueba.

Levantar las dos API, cada una en su propia terminal (se reinician solas al cambiar el código):

```bash
pnpm dev:api            # API pública en http://localhost:3000
pnpm dev:admin-api      # API de administración en http://localhost:3001
```

Comprobar: <http://localhost:3000/health> responde y <http://localhost:3000/docs> muestra la API.

## 5. App y panel (Flutter)

En otras dos terminales:

```bash
cd app
flutter pub get
flutter run -d chrome --web-port 8080 --dart-define=API_BASE_URL=http://localhost:3000
```

```bash
cd admin
flutter pub get
flutter run -d chrome --web-port 8090 --dart-define=ADMIN_API_BASE_URL=http://localhost:3001
```

Los puertos 8080 y 8090 deben ser esos: son los únicos orígenes que aceptan las API (CORS).

## 6. Primeras cuentas

**Usuario de la app.** En <http://localhost:8080> → «Crear cuenta». El correo de verificación y los
códigos de 6 dígitos para entrar llegan a Mailpit (<http://localhost:8025>), sin importar la
dirección usada. Para que lleguen a una bandeja real, ver «Correos reales durante las pruebas» en
[`entornos-de-prueba.md`](entornos-de-prueba.md).

**Administrador del panel.** Con una cuenta ya verificada:

```bash
cd backend
pnpm admin:create correo@verificado.cl
```

Imprime una clave manual (y un enlace `otpauth://`). Agregarla en Google Authenticator, 1Password
o similar. En <http://localhost:8090> se entra con el correo, la contraseña de esa cuenta y el código
de 6 dígitos de la app de autenticación.

## 7. Comprobar que todo funciona

```bash
pnpm check              # en la raíz: lint, tipos, capas y pruebas unitarias (≈230 pruebas)
cd backend
pnpm test:db            # integración con PostgreSQL real y RLS (≈180 pruebas)
pnpm smoke              # Webpay (integración), Fintoc (si hay llaves) y correo
cd ../app && flutter test
cd ../admin && flutter test
```

Qué probar a mano en la app, en orden:

1. Registro: saldo inicial, un sueldo y un gasto → proyección de 12 meses.
2. Escenarios: una compra en cuotas comparada con la base.
3. Bancos: «Usar banco de demostración», o Fintoc de prueba (RUT `41614850-3`, clave `jonsnow`).
4. Plan: «Contratar» lleva al formulario de Transbank (ambiente de integración, sin cobros
   reales). Tarjetas de prueba en [`entornos-de-prueba.md`](entornos-de-prueba.md).
5. Hogar: se habilita con el plan Familiar; invitar a otra cuenta con el enlace de invitación.
6. Cuenta: exportar mis datos, consentimientos y borrar la cuenta.

## 8. Uso diario

```bash
docker compose up -d                    # si se reinició el computador
cd backend && pnpm dev:api              # terminal 1
cd backend && pnpm dev:admin-api        # terminal 2
cd app && flutter run -d chrome --web-port 8080 --dart-define=API_BASE_URL=http://localhost:3000
```

- Tras cambiar una ruta de la API: `pnpm --filter @findemes/backend openapi:generate` (una prueba
  falla si `docs/openapi.yaml` queda desfasado).
- Tras traer migraciones nuevas: `pnpm db:migrate` en `backend/`.
- En Flutter, `r` en la terminal recarga la app y `R` la reinicia.

## 9. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `node` muestra una versión distinta de 24 | fnm no está activo en esa terminal: `fnm use 24.21.0` (y revisar el perfil de la consola). |
| `pnpm` no existe | `corepack enable` (con Node 24 activo). |
| `pnpm db:migrate` no conecta | Docker Desktop cerrado o contenedor caído: `docker compose up -d` y `docker compose ps`. |
| La API dice `Invalid ... configuration in environment variables: X` | Falta o está mal la variable `X` en `backend/.env.local`. El mensaje nunca muestra el valor. |
| La app muestra error de red / CORS | La app no está en el puerto 8080 (o el panel en 8090), o la API no está corriendo. |
| No llega el correo | En local llega a Mailpit (<http://localhost:8025>), no a la bandeja real. |
| El puerto 5432 está ocupado | Hay otro PostgreSQL instalado en Windows: detener ese servicio. |
| `flutter` no existe | Falta `...\flutter\bin` en el PATH; abrir una terminal nueva después de agregarlo. |
| Quiero partir con la base vacía | `docker compose down -v` (borra los datos locales), `docker compose up -d` y `pnpm db:migrate`. |

Lo que falta para que todo funcione completo está en [`pendientes.md`](pendientes.md).

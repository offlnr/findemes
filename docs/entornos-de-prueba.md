# Entornos de prueba y ejecución local

Cada integración externa tiene un entorno de prueba que no mueve dinero ni datos reales. El núcleo
y el registro funcionan sin ninguna de ellas (regla 7).

| Integración | Entorno de prueba | Cómo se activa | Verificación rápida |
|---|---|---|---|
| **Webpay Plus** (HU19) | Ambiente de integración de Transbank (`webpay3gint.transbank.cl`) con sus credenciales públicas de prueba | Por defecto (`WEBPAY_ENVIRONMENT=integration`). Producción exige `WEBPAY_COMMERCE_CODE` y `WEBPAY_API_KEY` propios | `pnpm smoke:webpay` crea una transacción e imprime la URL para pagarla con una tarjeta de prueba |
| **Fintoc** (HU36) | Modo de prueba (`sk_test_` / `pk_test_`), bancos y movimientos ficticios rotulados `provider_test` | `FINTOC_SECRET_KEY` y `FINTOC_PUBLIC_KEY` en `backend/.env.local`. Solo se aceptan llaves de prueba | `pnpm smoke:fintoc` crea un Link Intent. En el widget: RUT `41614850-3`, clave `jonsnow` |
| **Banco de demostración** (HU36) | Perfiles curados y deterministas (`estudiante`, `familia`, `profesional-con-deudas`), rotulados `demo` | Siempre disponible | Bancos → «Usar banco de demostración» |
| **Correo** (HU17, HU17.2, HU17.4) | Mailpit en Docker: atrapa todo lo enviado por SMTP, bandeja en <http://localhost:8025> | `EMAIL_TRANSPORT=smtp` (por defecto en desarrollo se escriben archivos en `backend/.outbox`). Producción: Amazon SES por SMTP | `pnpm smoke:email` envía un mensaje y comprueba que llegó. Envío real por Gmail: ver más abajo |
| **API pública** | Swagger UI en <http://localhost:3000/docs> (fuera de producción) | `pnpm dev:api` | Probar cada ruta con «Authorize» y un token de acceso |
| **API de administración** | Swagger UI en <http://localhost:3001/docs> (fuera de producción) | `pnpm dev:admin-api` | Iniciar sesión con contraseña y código TOTP |

`pnpm smoke` corre las tres verificaciones de integraciones juntas (en `backend/`).

## Correos reales durante las pruebas (Gmail)

Mailpit atrapa todo y nada llega a una bandeja real. Para que los correos de verificación, de
restablecimiento y los códigos de acceso lleguen de verdad (por ejemplo, en la validación con
usuarios), el mismo adaptador SMTP puede enviar por una cuenta de Gmail, sin costo
(límite de unos 500 correos al día):

1. En la cuenta de Google del equipo, activar la verificación en dos pasos y crear una
   «contraseña de aplicación» en <https://myaccount.google.com/apppasswords> (16 letras).
2. En `backend/.env.local`, reemplazar las líneas `SMTP_*` y `EMAIL_FROM` por:

   ```
   EMAIL_TRANSPORT=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=cuenta.del.equipo@gmail.com
   SMTP_PASSWORD=la contraseña de aplicación, sin espacios
   EMAIL_FROM=Fin de Mes <cuenta.del.equipo@gmail.com>
   ```

   `EMAIL_FROM` debe ser la misma cuenta (Gmail reemplaza cualquier otro remitente). Con
   usuario y contraseña la conexión exige TLS.
3. Comprobar con `pnpm smoke:email tu@correo.cl` y reiniciar `pnpm dev:api`.

Para volver a Mailpit basta con restaurar `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025` y quitar
`SMTP_USER` y `SMTP_PASSWORD`. La contraseña de aplicación nunca se versiona (`.env.local` está en
`.gitignore`) y se revoca desde la misma página de Google.

## Tarjetas de prueba de Webpay (ambiente de integración)

Transbank publica las tarjetas de prueba en su documentación para desarrolladores. Las más usadas:
Visa `4051 8856 0044 6623` (aprobada), Mastercard `5186 0595 5959 0568` (rechazada), CVV `123`,
cualquier fecha futura. En la autenticación del banco simulado: RUT `11.111.111-1`, clave `123`.
Si Transbank cambia estos datos, manda su documentación.

## Levantar todo en local

Requisitos: Node 24 (`.node-version`), pnpm 12 (corepack), Docker Desktop y Flutter estable.

```bash
docker compose up -d                 # PostgreSQL 18 y Mailpit
cd backend
cp .env.example .env.local           # completar secretos: JWT_SECRET, IDENTITY_HMAC_KEY, BANK_TOKEN_KEY,
                                     # ADMIN_JWT_SECRET, ADMIN_TOTP_KEY (32 bytes base64url cada uno)
pnpm install
pnpm db:migrate                      # migraciones y roles de login
pnpm dev:api                         # http://localhost:3000  (docs en /docs)
pnpm dev:admin-api                   # http://localhost:3001  (docs en /docs)

cd ../app
flutter run -d chrome --web-port 8080 --dart-define=API_BASE_URL=http://localhost:3000

cd ../admin                          # después de `pnpm admin:create <correo>` en backend/
flutter run -d chrome --web-port 8090 --dart-define=ADMIN_API_BASE_URL=http://localhost:3001
```

Generar un secreto: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Pruebas automatizadas

| Comando | Qué cubre |
|---|---|
| `pnpm check` (raíz) | Lint, tipos, capas (núcleo puro) y pruebas unitarias y de API con cobertura |
| `pnpm test:db` (backend) | Integración con PostgreSQL real, RLS, acceso cruzado y roles de cada servicio |
| `flutter test` (app y admin) | Pantallas contra respuestas simuladas de la API |

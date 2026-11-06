# Fin de Mes · panel de administración (Flutter web)

Aplicación separada del sitio público (HU22, regla 9). Consume solo la API de administración
(`backend/src/admin-api`, puerto 3001), que en AWS corre en su propia instancia sin reglas de
entrada y se alcanza por Tailscale (RNF21).

| Sección | Historia | Qué muestra |
|---|---|---|
| Estado | HU24 | Disponibilidad y latencia de la API pública, cuentas, KPI del registro inicial y planes vigentes |
| Cuentas | HU23 | Búsqueda por correo, plan y vigencia; suspender y reactivar. Nunca datos financieros |
| Auditoría | HU25 | Traza de solo lectura con la verificación de la cadena de hash |
| Pagos | HU26 | Órdenes por estado, inconsistencias marcadas y conciliación con Transbank |

El inicio de sesión pide contraseña y el código TOTP de una app de autenticación (RNF22). El token
vive solo en memoria y dura 15 minutos.

## Uso local

```bash
# en backend/: API de administración y un administrador (cuenta ya registrada y verificada en la app)
pnpm dev:admin-api
pnpm admin:create correo@dominio.cl      # imprime el otpauth:// para la app de autenticación

# en admin/
flutter pub get
flutter run -d chrome --web-port 8090 --dart-define=ADMIN_API_BASE_URL=http://localhost:3001
flutter test
```

`ADMIN_CORS_ORIGINS` de la API debe incluir `http://localhost:8090`.

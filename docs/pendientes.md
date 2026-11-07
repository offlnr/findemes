# Pendientes para que todo funcione correctamente

Estado al 06-11-2026 de la rama `feat/final-app`. La implementación cubre el registro, la
proyección, los escenarios, el hogar, los planes con Webpay, la privacidad, los bancos (Fintoc de
prueba y banco de demostración), la API y el panel de administración. Las pruebas automatizadas
están en verde (`pnpm check`, `pnpm test:db`, `flutter test` en app y panel). Lo que sigue falta
para cerrar el sistema, ordenado por prioridad.

## Bloqueantes para integrar a `main`

| # | Pendiente | Quién | Detalle |
|---|---|---|---|
| 1 | **Subir la rama y abrir el PR** | Joaquín | `git push -u origin feat/final-app` y PR hacia `main`. `main` exige revisión del otro socio. |
| 2 | **Revisión del PR** | Maximiliano | Revisar backend, pagos y seguridad (definición de terminado). |
| 3 | **CI en GitHub Actions** | Ambos | No existe todavía. Debe correr `pnpm check`, `pnpm test:db` (con un servicio PostgreSQL 18), `flutter test` en `app/` y `admin/`, gitleaks, osv-scanner / `pnpm audit` y CodeQL, más Dependabot. Cada acción se fija por **SHA de commit** (no por etiqueta), copiando el SHA desde la página de la versión de cada acción. |

## Pruebas manuales que faltan

| # | Pendiente | Detalle |
|---|---|---|
| 4 | **Pago completo con tarjeta de prueba** | Se probó crear la transacción y conciliarla con Transbank, pero no pagarla en el formulario del navegador. Contratar un plan desde la app, pagar con la tarjeta de prueba y comprobar que vuelve a «Pago aprobado» y el plan queda activo. Verificar las tarjetas de prueba en la documentación vigente de Transbank (las de la guía se anotaron de memoria). Probar también anular en el formulario y dejar expirar la sesión. |
| 5 | **Widget de Fintoc en el navegador** | Se probó crear el Link Intent, no completar el widget. Conectar con el banco de prueba de Fintoc, sincronizar y confirmar movimientos recurrentes. |
| 6 | **Hogar con dos personas reales** | Invitar a una segunda cuenta, aceptar, registrar gastos comunes con las tres reglas de aporte y verificar que cada persona ve solo el aporte del otro. |
| 7 | **Correo a bandejas reales** | El envío por Gmail está implementado pero no probado: falta crear la contraseña de aplicación y configurarla (ver `entornos-de-prueba.md`, «Correos reales durante las pruebas»). Revisar que no caiga en spam. |
| 8 | **Accesibilidad WCAG 2.1 AA** | Revisar contraste, navegación con teclado y lector de pantalla en las pantallas nuevas (hogar, bancos, plan, cuenta y panel). |

## Funcionalidad sin implementar

| # | Pendiente | Detalle |
|---|---|---|
| 9 | **HU29: pasar lo hecho en el modo demostración a la cuenta nueva** | Hoy el modo demo no guarda nada; al crear la cuenta se parte de cero. |
| 10 | **HU33 y HU34** (prioridad C) | No iniciadas. |
| 11 | **Fintoc en Android e iOS** | El widget funciona solo en la web; en móvil la app indica que la conexión se hace desde la web. Falta integrarlo con un WebView. |
| 12 | **Cliente Flutter generado desde `docs/openapi.yaml`** | CLAUDE.md lo pide; hoy los clientes de `app/lib/data/` están escritos a mano sobre un `ApiClient` común. |
| 13 | **Renovación y aviso de vencimiento** | El estado «por vencer» (7 días) se calcula, pero no se envía correo de aviso ni hay cobro recurrente (Webpay Plus es pago único: cada período se paga de nuevo). |

## Despliegue (definición de terminado: «incremento desplegado»)

| # | Pendiente | Detalle |
|---|---|---|
| 14 | **Infraestructura en AWS** | Según `docs/adr/005-aws-deployment.md`: CloudFront + S3, API Gateway → VPC Link → EC2 con Docker, RDS PostgreSQL 18 privado, segunda EC2 para la API y el panel de administración solo por Tailscale, despliegue por Systems Manager. No hay Dockerfile ni scripts de despliegue todavía. |
| 15 | **Correo en producción** | El adaptador SMTP sirve para cualquier servidor; el de producción definido en el informe sigue siendo el mismo. Falta su configuración en el ambiente desplegado. |
| 16 | **Secretos del ambiente desplegado** | Generar secretos propios (no reutilizar los locales) y guardarlos fuera del repositorio. |
| 17 | **Webpay de producción** | Requiere código de comercio y llave propios tras la validación de Transbank; durante el proyecto se usa el ambiente de integración. |

## Detalles menores conocidos

- La terminal del equipo donde se hizo la implementación usa Node 26 por defecto: hay que activar
  fnm con Node 24 en el perfil de la consola (ver el manual de instalación).
- La carpeta antigua `.claude\worktrees\final-app` es una copia sobrante del traslado a
  `D:\Proyectos\FinDeMes\final-app`; se puede borrar al cerrar la sesión de trabajo que la usaba.

Instalación del ambiente local: [`instalacion-local.md`](instalacion-local.md).

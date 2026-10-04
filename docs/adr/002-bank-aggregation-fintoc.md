# ADR-002: Agregación bancaria con Fintoc en lugar de Plaid

- **Estado:** aceptada
- **Fecha:** 03-10-2026
- **Autores:** Joaquín Varas (revisión pendiente: Maximiliano Lizana)
- **Afecta al informe:** HU36 y Tabla 45 (integraciones) nombran a Plaid; deben actualizarse.

## Contexto

Para el equipo, la conexión de los bancos del usuario es, después del motor, la capacidad más
importante del producto. El informe proponía Plaid en modo sandbox. Plaid no opera en Chile: su
sandbox entrega bancos ficticios de Estados Unidos con montos en USD con decimales, lo que obligaba
a convertir a CLP en el adaptador y no permitía mostrar una conexión con bancos chilenos.

El Sistema de Finanzas Abiertas de la Ley 21.521 entra en vigor en julio de 2027 (NCG 514
modificada en junio de 2026), después del cierre del proyecto (01-12-2026).

## Alternativas evaluadas

| Proveedor | Chile | Acceso de prueba | Observación |
|---|---|---|---|
| Plaid | No | Autoservicio | Bancos de EE. UU., montos en USD |
| Fintoc | Sí | Autoservicio (llaves `sk_test_`) | BancoEstado, Banco de Chile, Santander, Itaú, BICE, Scotiabank y BCI para personas |
| Floid | Sí | Requiere contactar a ventas | No publica la lista de bancos |
| Belvo | No | — | México, Brasil y Colombia |

## Decisión

Usar **Fintoc** (producto Movements, titular `individual`, país `cl`) a través del puerto
`BankAggregator`, en modo de prueba durante el proyecto.

La prueba de factibilidad del 03-10-2026, en modo de prueba, verificó el flujo completo:
Link Intent desde el backend → widget de Fintoc → `exchange_token` → `link_token` → cuentas y
movimientos. Resultados:

- Montos en **CLP enteros**; negativo = cargo y positivo = abono.
- La cuenta entrega saldo disponible, contable y límite. El saldo disponible sirve como saldo
  inicial (HU04).
- Los movimientos se filtran por fecha (`since`, `until`) y por actualización (`updated_since`),
  lo que permite sincronizar de forma incremental.
- El widget funciona en la web (SDK de JavaScript) y en Android e iOS (WebView). La clave del
  banco la ingresa el usuario en el widget de Fintoc; la aplicación nunca la recibe.

## Consecuencias

- Se elimina la conversión de USD a CLP. El núcleo sigue trabajando solo en CLP.
- **Las tarjetas de crédito no se entregan.** Las deudas en cuotas (HU03) se siguen registrando a
  mano.
- Los datos de prueba son ficticios: descripciones en latín y montos al azar. Por eso la
  aplicación no clasifica sola los movimientos recurrentes. Muestra totales mensuales y el usuario
  confirma qué es recurrente, lo que además respeta la regla de no recomendar.
- El `link_token` da acceso de lectura a las cuentas del usuario: se guarda cifrado (AES-256-GCM),
  nunca se registra en logs y se revoca cuando el usuario desconecta el banco o borra su cuenta
  (HU21).
- Usar bancos reales (modo live) exige un acuerdo comercial con Fintoc, una política de privacidad
  y el consentimiento explícito exigido por la Ley 21.719. Queda fuera del alcance mientras el
  equipo no decida lo contrario.
- El MCP de Fintoc para asistentes de IA opera solo en modo live y puede mover dinero. El proyecto
  no lo usa.

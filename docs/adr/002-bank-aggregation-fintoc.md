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

## Banco de demostración (agregado el 03-10-2026)

Los datos del modo de prueba de Fintoc no se pueden personalizar: son aleatorios, con
descripciones en latín y montos de millones. No sirven para mostrar casos realistas. Por eso el
puerto `BankAggregator` tiene un segundo adaptador, `src/adapters/demo-bank`:

- Ofrece perfiles curados y deterministas (`estudiante`, `familia`, `profesional-con-deudas`) con
  12 meses de historial, ingresos y cargos recurrentes y gastos variables generados con una
  semilla fija.
- Lo elige la raíz de composición. El resto del sistema no distingue entre ambos adaptadores, lo
  que además demuestra la regla 7 y el RNF16.
- Cada cuenta y cada movimiento declaran `origin`: `real`, `provider_test` o `demo`. La app debe
  rotular los datos que no son reales, para no presentar datos inventados como información
  bancaria del usuario.


## Varios bancos por usuario (agregado el 19-10-2026)

**Decisión:** un usuario puede conectar más de un banco, por ejemplo BancoEstado y BCI al mismo
tiempo. La aplicación muestra sus cuentas juntas, pero cada una indica de qué banco viene.

Fundamento en la documentación de Fintoc (revisada el 19-10-2026):

- Un Link es *"una conexión entre un usuario final y una institución financiera"*. Tiene una sola
  `institution` y todas las cuentas que el titular tiene en ese banco. Por eso, conectar dos bancos
  significa tener **dos Links**.
- Cada banco se conecta en un flujo separado: el backend crea un Link Intent nuevo, el widget se
  abre (con `institutionId` si se quiere dejar el banco elegido, por ejemplo `cl_banco_estado` o
  `cl_banco_bci`) y el intercambio entrega un `link_token` propio. La documentación no pone un
  límite de Links por usuario.
- Para movimientos en Chile, Fintoc soporta: Banco de Chile, Santander, Itaú, BICE, Scotiabank,
  BCI (`cl_banco_bci`; `cl_banco_bci_360` es el portal de empresas), BancoEstado y Security (solo
  empresas).
- Credenciales de prueba para personas: `41614850-3`, `40427672-7` y `41579263-8`, todas con la
  contraseña `jonsnow`.

Implementación:

- El esquema ya lo permite: `app.bank_links` admite varias filas por `owner_id`. Cada fila tiene
  su propio `link_token` cifrado, su `institution_name` y su `status`. La restricción
  `UNIQUE (owner_id, provider, provider_link_id)` evita duplicados cuando se reconecta el mismo
  banco.
- Desconectar un banco revoca solo ese Link y borra solo sus cuentas y movimientos (`ON DELETE
  CASCADE` desde `bank_links`). Los demás bancos no cambian.
- La API expone la lista de conexiones del usuario y las cuentas agrupadas por conexión. Las
  pruebas de acceso cruzado (regla 5) cubren también el caso de varios Links.
- El banco de demostración (`demo-bank`) incluye al menos un perfil con dos bancos, para mostrar
  el caso en la validación con usuarios y en la defensa, aunque el modo de prueba de Fintoc esté
  limitado.

Pendiente de verificar en el modo de prueba (la documentación no lo dice):

1. Qué bancos ofrece el widget en modo de prueba. La única lista de bancos de prueba publicada es
   la de pagos (Santander, Banco de Chile, BancoEstado y Mach), y no incluye BCI.
2. Si la misma credencial de prueba sirve en dos bancos distintos, y qué cuentas devuelve cada
   uno.

Para verificarlo: con la llave `sk_test_`, crear un Link Intent con `cl_banco_estado` y otro con
`cl_banco_bci`, y conectar ambos con `41614850-3` / `jonsnow`. Si BCI no aparece en modo de prueba,
el caso de dos bancos se hace con dos bancos que sí estén disponibles, y se deja anotado en esta
sección.

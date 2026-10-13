# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Una sola base de código Flutter publica la app en web, Android (10+) e iOS (15+) con un lenguaje
visual propio e idéntico en las tres. No se adoptan Material ni Cupertino como identidad; solo se
respetan las convenciones básicas de cada sistema (gesto de volver, teclados, áreas seguras). No
hay versión de escritorio nativa. El panel de administración es una aplicación aparte, accesible
solo por la red privada (Tailscale).

## Users

Dos segmentos primarios, con el mismo peso en las decisiones de diseño:

- **Persona con cuotas.** Mayor de 18 años, con ingreso formal y compras o deudas en cuotas. Está
  por tomar una decisión concreta (una compra, una cuota nueva, un prepago) y quiere saber antes
  cómo quedan sus meses siguientes.
- **Hogar con gastos comunes.** Dos o más personas que aportan a gastos compartidos y quieren
  coordinarlos sin mostrar sus finanzas individuales a los demás integrantes.

Segmento secundario: personas con ingreso variable que necesitan proyectar sus meses.

Otros públicos reales:

- **Comisión evaluadora del Proyecto de Título** y **participantes de la validación con usuarios**.
  Recorren el prototipo y el modo demostración, normalmente con los perfiles del banco de
  demostración.
- **Operadores** del panel de administración (cuentas, auditoría, monitoreo y suscripciones). No
  pueden ver datos financieros de los usuarios.

## Product Purpose

Fin de Mes es una plataforma SaaS para personas y hogares en Chile. Registra ingresos, gastos,
deudas y cuotas, y responde una pregunta prospectiva: «si hago esto, ¿cómo queda mi mes?».
Proyecta el flujo de caja mensual, simula una decisión sobre una copia del estado base, la compara
con la base mediante indicadores objetivos y explica el resultado en lenguaje natural.

El problema que resuelve es de anticipación, no de registro: la persona tiene la información, pero
no puede ver en qué mes deja de alcanzar el dinero ni comparar dos alternativas sobre su propio
presupuesto.

Se considera exitoso si el registro inicial se completa en menos de diez minutos sin formación
financiera, si cada indicador se entiende sin conocimientos previos y si el usuario conoce el efecto
de una decisión antes de tomarla.

## Positioning

Los agregadores que operan en Chile (Fintonic, Finerio) muestran el pasado. Fin de Mes simula el
futuro de una decisión concreta sobre el presupuesto del propio usuario, con un motor determinista y
explicable: misma entrada, misma salida, y una explicación trazable hasta la cifra.

Además, ofrece un plan familiar en que la información fluye del espacio común hacia los perfiles
individuales y nunca al revés.

**El sistema no recomienda.** Muestra qué ocurre y qué lo causa, pero no ordena alternativas, no
destaca una como preferible ni emite juicios. Es una restricción de diseño permanente.

## Operating Context

- El usuario consulta la app al momento de decidir (en una tienda, frente a una oferta en cuotas o
  antes de prepagar) y también en el cierre o inicio de mes, para revisar su proyección.
- El registro captura la estructura del presupuesto: ingresos, compromisos recurrentes, cuotas con
  su plazo restante y el saldo inicial. No pretende capturar cada transacción diaria. Un registro
  bien hecho sigue siendo válido durante varios meses.
- La agregación bancaria usa Fintoc en modo de prueba y entrega cuentas corrientes y vista. Las
  tarjetas de crédito y las cuotas se registran a mano. El usuario confirma qué movimientos son
  recurrentes; el sistema no los clasifica por su cuenta.
- La Ley 21.521 (finanzas abiertas) entra en vigencia en julio de 2027. Hasta entonces no hay datos
  bancarios reales.
- El modo demostración es público, sin cuenta y sin persistencia. En la defensa y la validación se
  usa el banco de demostración (perfiles estudiante, familia y profesional con deudas).

## Capabilities and Constraints

- **Motor mensual.** Responde «en qué mes», no «en qué semana». El horizonte es configurable y la
  proyección de 12 meses debe tardar menos de 300 ms (p95).
- **Decisiones (Tabla 11).** Compra en N cuotas, alta o modificación de gasto fijo, gasto único,
  adelanto o prepago de deuda y variación de ingreso. El prepago se presenta en dos modalidades,
  `reduce_term` (por defecto) y `reduce_installment`, y la explicación indica cuál se asumió.
- **Indicadores (Tabla 12).** Saldo mínimo proyectado, mes de quiebre, margen mensual disponible,
  carga de deuda sobre ingreso y variación respecto de la base. La variación se expresa de forma
  neutra (+/−).
- **Escenarios.** Se derivan del estado base sin modificarlo.
- **Plan gratuito.** Hasta 2 escenarios guardados y 1 comparable contra la base. Planes pagados:
  individual y familiar, pagados con Webpay Plus (ambiente de integración) y renovados manualmente
  cada período.
- **Montos.** Siempre en pesos chilenos enteros. No hay multimoneda.
- **Sin lógica de negocio en el cliente.** Las interfaces solo consumen la API.
- **Excluido del producto.** Mover dinero, pagar deudas, dar asesoría, sugerir productos, plazos o
  instituciones e importar cartolas (fuera del MVP).
- **Terminología fija.** Escenario, estado base, decisión, mes de quiebre, espacio común, perfil
  individual y plan familiar.

## Brand Commitments

- El nombre **Fin de Mes** es obligatorio.
- Todo texto visible está en español neutro.
- Las explicaciones son descriptivas, nunca prescriptivas. Ningún texto usa «buena», «mala»,
  «deberías», «mejora» ni «empeora».
- Todo dato agregado declara su origen (`real`, `provider_test` o `demo`). Lo que no es `real` se
  rotula en la interfaz: los datos de prueba o demostración nunca se presentan como reales.
- **Aún sin definir:** el lema («Si hago esto, ¿cómo queda mi mes?», que hoy usa el prototipo) y el
  trato (hoy el prototipo tutea). Ninguno de los dos es obligatorio todavía.

## Evidence on Hand

- `prototype/index.html`: prototipo navegable. Incluye landing, planes, privacidad, casos con
  cifras, modo demostración, registro, proyección, escenarios y panel de administración. Se sirve
  con `node prototype/serve.mjs`.
- Perfiles deterministas del adaptador `demo-bank` (estudiante, familia y profesional con deudas).
- El informe del proyecto (fuera del repositorio; conversión en `informe/informe.md`) contiene el
  diagnóstico del problema, las 43 historias de usuario y los 29 RNF.
- **Ausencias:** no hay usuarios reales, testimonios, métricas de uso, clientes ni prensa. Todo caso
  con cifras es ilustrativo y debe rotularse así. No deben inventarse testimonios ni resultados.

## Product Principles

1. **Describir, no recomendar.** Cada resultado muestra qué ocurre y qué lo causa. Ninguna
   alternativa aparece como preferible.
2. **La cifra y su explicación son inseparables.** Ningún indicador se muestra sin una explicación
   comprensible sin conocimientos financieros.
3. **El escenario nunca toca la base.** Simular es seguro y reversible, y la interfaz lo deja claro.
4. **La privacidad del hogar es estructural.** Lo común baja a lo individual y nunca sube.
5. **Origen honesto.** Los datos de demostración o prueba siempre se identifican como tales.

## Accessibility & Inclusion

WCAG 2.1 nivel AA en web y móvil (RNF13): contraste, tamaño de texto y navegación por teclado. El
público no tiene formación financiera y la alfabetización financiera documentada es baja, por lo
que el lenguaje debe ser llano. La verificación obligatoria en navegador del MVP se hace en Chrome;
Firefox, Edge y Safari se prueban según el tiempo disponible.

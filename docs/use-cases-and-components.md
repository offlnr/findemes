# Casos de uso y componentes (UML) · Fin de Mes

Diagramas en `docs/diagrams/use-cases/` y `docs/diagrams/components/`: fuente `.puml` (PlantUML), `.svg` para el informe y `.png` de vista
previa. Notación UML 2.5. Cada caso de uso se traza a su historia de usuario (Anexo A del informe) y lleva
su prioridad MoSCoW.

## 1. Casos de uso

### 1.1 Convenciones

- **Límite del sistema:** el rectángulo "Fin de Mes" encierra lo que el sistema hace; los actores quedan
  fuera.
- **Actor principal** (izquierda): inicia el caso de uso. **Actor secundario** (derecha, «sistema externo»):
  participa a pedido del sistema.
- **«include»:** el caso base siempre ejecuta el incluido. La flecha va del base al incluido.
- **«extend»:** el caso extensor agrega un comportamiento opcional al base. La flecha va del extensor al base.
- **Generalización** (triángulo hueco): el actor hijo hereda todos los casos de uso del padre.
- **Color y estereotipo de prioridad:** «M» imprescindible (azul intenso), «S» importante (azul claro),
  «C» deseable (gris). Las historias W (fuera de alcance) no se dibujan; se nombran en una nota o leyenda.

### 1.2 Actores (cu-0)

| Actor | Tipo | Descripción |
|---|---|---|
| Visitante | Principal | Persona sin cuenta. Conoce el sitio, prueba la demostración, se registra o acepta una invitación. |
| Usuario registrado | Principal | Persona con cuenta. Registra su situación financiera, proyecta, simula y contrata planes. |
| Miembro del hogar | Principal | Usuario registrado que pertenece a un hogar. Hereda los casos del usuario registrado. |
| Administrador de hogar | Principal | Miembro que creó o administra el hogar. Hereda los casos del miembro. |
| Administrador de la plataforma | Principal | Operador interno con rol de administrador y segundo factor TOTP. Usa solo el panel separado, alcanzable por Tailscale. No hereda los casos del usuario registrado. |
| Transbank Webpay Plus | Secundario | Procesa el pago con tarjeta; el sistema crea y confirma la transacción. |
| Fintoc | Secundario | Entrega cuentas y movimientos bancarios en modo de prueba; recibe la clave bancaria en su propio widget. |
| Proveedor de correo | Secundario | Envía los correos transaccionales (verificación, recuperación, aviso de cambio de contraseña e invitaciones). |

El diagrama `cu-0-actores` muestra además los cinco subsistemas, uno por diagrama de detalle, y con qué
actores se relaciona cada uno.

### 1.3 Sitio público, demostración e identidad (cu-1 · épicas E6 y E9)

Agrupa lo que un visitante puede hacer antes de tener cuenta y la gestión de la cuenta propia.

| Caso de uso | Actor | HU | Prioridad | Descripción |
|---|---|---|---|---|
| Probar el simulador con un caso de ejemplo | Visitante | HU27 | M | Ejecuta una simulación sobre un perfil precargado, sin crear cuenta. |
| Ingresar datos mínimos y ver la proyección | Visitante | HU28 | M | El visitante ingresa su propia situación mínima; el cálculo ocurre en el servidor y no se guarda nada. |
| Revisar casos resueltos con cifras concretas | Visitante | HU33 | C | Muestra casos frecuentes con su proyección y explicación. «extend» de HU27: cada caso abre la demostración precargada con ese estado. |
| Conocer los planes y sus capacidades | Visitante | HU30 | S | Compara los planes de la Tabla 13 antes de registrarse. |
| Conocer qué datos se almacenan y cómo se tratan | Visitante | HU32 | S | Política de privacidad, finalidad y plazo de conservación (Ley 21.719). |
| Contactar al equipo | Visitante | HU34 | C | Formulario con correo y mensaje, protegido contra envíos automatizados; confirma la recepción y el plazo de respuesta. |
| Crear una cuenta | Visitante | HU17 | M | Registro con correo y contraseña (mínimo 10 caracteres, lista de contraseñas filtradas). «include» Verificar el correo. |
| Verificar el correo | Visitante, proveedor de correo | HU17 | M | Enlace de un solo uso con vigencia de 24 horas. |
| Conservar lo trabajado en la demostración | Visitante | HU29 | S | «extend» de Crear una cuenta: con confirmación explícita, el estado de la demostración pasa a la cuenta nueva. |
| Iniciar sesión | Visitante | HU17.1 | M | Bloqueo temporal con espera creciente por cuenta y límite por IP; nunca bloqueo permanente. |
| Recuperar el acceso | Visitante, proveedor de correo | HU17.2 | M | Enlace de restablecimiento de un solo uso con vigencia de 30 minutos. |
| Cerrar sesión | Usuario registrado | HU17.3 | S | Invalida la sesión en el servidor; permite cerrar también las sesiones de otros dispositivos. |
| Cambiar la contraseña | Usuario registrado, proveedor de correo | HU17.4 | S | Exige la contraseña vigente y notifica el cambio al correo registrado. |
| Ejercer derechos sobre los datos personales | Usuario registrado | HU21 | S | Exportar en formato estructurado, rectificar y eliminar la cuenta con borrado efectivo. |

Fuera de alcance: HU35 (boletín de educación financiera, prioridad W).

### 1.4 Registro financiero, proyección y escenarios (cu-2 · épicas E1 a E4)

Es el núcleo funcional del producto: registrar la situación, proyectarla y simular decisiones.

| Caso de uso | Actor | HU | Prioridad | Descripción |
|---|---|---|---|---|
| Registrar ingresos recurrentes y esporádicos | Usuario registrado | HU01 | M | Ingresos únicos, mensuales o cada N meses, en pesos enteros. |
| Registrar gastos fijos y variables | Usuario registrado | HU02 | M | Gastos fijos y gastos variables estimados. |
| Registrar deudas con sus cuotas pendientes | Usuario registrado | HU03 | M | Calendario de cuotas pendientes, incluso cuotas desiguales. |
| Registrar el saldo inicial | Usuario registrado | HU04 | M | Saldo al inicio de un mes; puede ser negativo. |
| Sincronizar movimientos bancarios | Usuario registrado, Fintoc | HU36 | S | Lectura de movimientos en modo de prueba. La clave bancaria la recibe solo el widget de Fintoc. El usuario confirma qué movimientos son ingresos o gastos; el sistema no los clasifica solo. |
| Ver la proyección del flujo de caja mensual | Usuario registrado | HU05 | M | Proyección mes a mes calculada por el motor (12 meses en menos de 300 ms, p95). |
| Ver la salud financiera | Usuario registrado | HU39 | M | Resumen con saldo mínimo proyectado, margen mensual, carga de deuda y mes de quiebre. |
| Crear un escenario | Usuario registrado | HU06 | M | Escenario derivado del estado base, que nunca lo modifica. Respeta el límite del plan. |
| Aplicar decisiones sobre un escenario | Usuario registrado | HU07 | M | Catálogo: compra en cuotas, gasto fijo, gasto único, prepago de deuda y variación de ingreso. |
| Comparar escenarios | Usuario registrado | HU09 | S | Diferencia de cada indicador frente a la base, expresada de forma neutra. «include» Ver los indicadores. |
| Ver los indicadores de un escenario | Usuario registrado | HU08 | M | Los cinco indicadores de la Tabla 12. «include» Recibir la explicación. |
| Recibir la explicación del resultado | Usuario registrado | HU10 | M | Texto determinista que describe qué ocurre y qué lo causa, sin recomendar. |
| Editar y eliminar escenarios | Usuario registrado | HU11 | S | Cambiar nombre y decisiones, o eliminar. |

Excluida por diseño: HU37 (recomendar qué decisión tomar, prioridad W). El sistema describe, no recomienda.

### 1.5 Hogar, gastos comunes y reglas de aporte (cu-3 · épica E5)

| Caso de uso | Actor | HU | Prioridad | Descripción |
|---|---|---|---|---|
| Crear un hogar | Administrador de hogar | HU12 | S | Quien lo crea queda como administrador del hogar. |
| Invitar miembros | Administrador de hogar, proveedor de correo | HU12 | S | Envía un enlace de invitación de un solo uso. |
| Registrar gastos comunes | Administrador de hogar | HU13 | S | Gastos compartidos, con quién los registró. |
| Configurar las reglas de aporte | Administrador de hogar | HU14 | S | Partes iguales, porcentajes que suman exactamente 100 % o gasto asignado a un miembro. |
| Consultar los gastos comunes | Miembro del hogar | HU13 | S | Todos los miembros ven los gastos comunes. |
| Ver mi aporte en mi proyección individual | Miembro del hogar | HU15 | S | El aporte al hogar entra a la proyección individual de cada miembro. |
| Mantener privados ingresos, deudas y escenarios | Miembro del hogar | HU16 | M | La información fluye del espacio común al perfil individual, nunca al revés; se verifica en el servidor y con RLS. |
| Aceptar una invitación y crear la cuenta | Visitante | HU31 | S | Enlace de un solo uso, vigente como máximo 7 días. «include» Crear una cuenta (cu-1). |

Nota de trazabilidad: el informe asigna HU15 al administrador de hogar. En el diagrama se asigna al miembro,
porque todo miembro aporta y el administrador lo hereda por generalización. Queda por confirmar con el equipo.

### 1.6 Planes, suscripción y pago en línea (cu-4 · épica E7)

| Caso de uso | Actor | HU | Prioridad | Descripción |
|---|---|---|---|---|
| Conocer las capacidades de cada plan | Usuario registrado | HU18 | S | Compara los planes y muestra las capacidades bloqueadas en el plan vigente. |
| Contratar un plan pagado | Usuario registrado, Transbank | HU19 | S | Redirige al formulario de Webpay Plus. «include» Confirmar la transacción. |
| Confirmar la transacción desde el servidor | Transbank | HU19 | S | Commit desde el backend, verificación del monto contra el plan y activación idempotente. No depende del retorno del navegador ni se guardan datos de tarjeta. |
| Conservar los datos al vencer la suscripción | Usuario registrado | HU20 | S | Al vencer, la cuenta baja al plan gratuito sin eliminar información y el espacio del hogar queda de solo lectura; al renovar se restablece el acceso. |

Fuera de alcance: HU38 (renovación automática con Oneclick, prioridad W).

### 1.7 Administración y monitoreo de la plataforma (cu-5 · épica E8)

El límite del sistema es el panel de administración, separado del sitio público y alcanzable solo por
Tailscale (RNF21).

| Caso de uso | Actor | HU | Prioridad | Descripción |
|---|---|---|---|---|
| Acceder al panel con segundo factor (TOTP) | Administrador de la plataforma | HU22 | S | Incluido por todos los demás casos. Un usuario sin rol de administrador recibe denegación aun con sesión válida. |
| Consultar y gestionar el estado de las cuentas | Administrador de la plataforma | HU23 | S | Suspender y reactivar cuentas. El rol de administración no puede leer datos financieros ni el hash de la contraseña. |
| Consultar la traza de auditoría | Administrador de la plataforma | HU25 | S | Traza de solo inserción, encadenada por hash. |
| Monitorear disponibilidad y desempeño | Administrador de la plataforma | HU24 | C | Disponibilidad, tiempo de respuesta, errores y estado del último respaldo, con alertas. |
| Revisar y conciliar las transacciones de suscripción | Administrador de la plataforma, Transbank | HU26 | C | Marca inconsistencias entre el registro propio y el del proveedor. |

### 1.8 Cobertura

Los diagramas cubren las 40 historias M, S y C del Anexo A. Las tres historias W (HU35, HU37 y HU38) se
mencionan como fuera de alcance.

## 2. Componentes

### 2.1 Convenciones (UML 2.5)

- **Componente** (rectángulo con el ícono de componente): unidad reemplazable con interfaces definidas.
- **Interfaz provista** (círculo o "bola" unido con línea continua): servicio que el componente ofrece.
- **Interfaz requerida** (flecha discontinua hacia la interfaz): servicio que el componente necesita.
- **Estereotipos:** «núcleo» (motor puro), «administración» (despliegue separado), «externo» (fuera de
  Fin de Mes) y «previsto» (borde discontinuo: diseñado pero aún no implementado).

### 2.2 Sistema (comp-1)

Muestra los componentes desplegables y cómo se conectan:

- **Aplicación Fin de Mes** (Flutter: web, Android e iOS) requiere la **API REST /v1**. No contiene lógica
  de negocio: no recalcula nada.
- **API pública** provee la API REST /v1 (HTTPS, JSON, JWT, documentada en OpenAPI). Requiere la interfaz
  **Simulación** del motor, la interfaz **SQL** de la base de datos con el rol `app_api` y los servicios de
  Transbank, Fintoc y correo, siempre por HTTPS saliente.
- **Motor de simulación** («núcleo») provee la interfaz Simulación (proyectar, simular, calcular indicadores
  y explicar). Corre en el mismo proceso que la API y no depende de nada externo.
- **Migrador** aplica las migraciones con el rol dueño antes de cada despliegue.
- **PostgreSQL 18** provee SQL sobre TLS, con un rol distinto por servicio y RLS.
- **Plano de administración** («administración», solo por Tailscale): el **panel** requiere la **API REST de
  administración** (con TOTP), y la **API de administración** usa SQL con el rol `app_admin`, que no lee
  tablas financieras.
- **Widget de Fintoc** («externo») corre en el dispositivo del usuario y envía la clave bancaria
  directamente a Fintoc: **nunca pasa por Fin de Mes**.

### 2.3 Interior de la API pública (comp-2)

Muestra la arquitectura hexagonal de la API pública en capas, de arriba hacia abajo:

1. **Adaptadores de entrada:** los **controladores REST** (`api/v1`, Fastify y Zod) proveen la API REST /v1 y
   dependen de los módulos y de los **errores HTTP uniformes** (`http`). La **raíz de composición**
   (`composition`) construye la aplicación conectando cada puerto con su adaptador.
2. **Módulos (casos de uso):** identidad, registro financiero, escenarios, hogar, suscripción, agregación,
   privacidad, auditoría y demostración. Registro, escenarios y demostración requieren la interfaz
   Simulación del **motor de simulación**.
3. **Puertos:** interfaces que declara cada módulo (por ejemplo, `UserAccountRepository` o `BankAggregator`).
   Los módulos dependen de ellas, no de la tecnología concreta.
4. **Adaptadores de salida:** implementan los puertos. PostgreSQL implementa la persistencia; Seguridad, el
   hash argon2id y el emisor JWT; Correo, el envío; Webpay Plus, la pasarela de pago; Fintoc y el **banco de
   demostración** implementan el mismo puerto `BankAggregator`.

Las dependencias apuntan siempre hacia adentro: los adaptadores dependen de los puertos y los módulos del
núcleo, nunca al revés (regla 2, RNF16). Por eso cambiar Fintoc por el banco de demostración, o por otro
agregador, no toca ni los casos de uso ni el motor. La regla del núcleo puro se verifica en CI con
`dependency-cruiser`.

Hoy están implementados el motor, los errores HTTP, la raíz de composición, el banco de demostración y el
migrador; el resto aparece como «previsto». Los puertos comunes (`Clock`, `IdGenerator`,
`TransactionRunner`) se omiten para no recargar el diagrama.

### 2.4 Relación con los diagramas C4

`comp-1` corresponde al nivel de contenedores del C4 (`c4-2-contenedores`) y `comp-2` al de componentes
(`c4-3-componentes-api`). Los C4 muestran tecnologías y protocolos; los UML muestran interfaces provistas y
requeridas, que es lo que pide la notación UML de componentes.

## 3. Cómo regenerarlos

Requiere Java, Graphviz y `plantuml.jar` (versión 1.2026.8, en `~/plantuml.jar`):

```bash
cd docs/diagrams
java -jar ~/plantuml.jar -charset UTF-8 -tsvg use-cases/*.puml components/*.puml
java -jar ~/plantuml.jar -charset UTF-8 -tpng use-cases/*.puml components/*.puml
```

El estilo común (colores por prioridad y estereotipos) está en `docs/diagrams/uml-style.iuml`.

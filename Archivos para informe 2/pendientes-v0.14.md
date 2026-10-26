# Pendientes para la v0.14 del Informe 2 (aplicados el 25-10-2026)

Todo lo de esta lista quedó aplicado en la v0.14; el detalle y las diferencias están en
`Nueva version de informe/Cambios v0.14.txt`. Se mantuvieron 7.900 usuarios aunque el modelo exacto da
2,07 años de recuperación descontada.

Lista acumulada antes de aplicar los cambios. Se aplica todo junto: la v0.13 se archiva en
`versiones-anteriores/`, se regeneran los diagramas desde sus fuentes y se sube al repositorio.

## 1. Ilustración 20 · Diagrama de componentes del sistema
Fuente: `docs/diagrams/components/comp-1-sistema.puml` (PlantUML).

- [x] Renombrar el paquete «Backend (App Platform)» a «Backend (servidor de la API)». App Platform
      es de DigitalOcean, proveedor descartado.
- [x] Cambiar «Proveedor de correo» por «Amazon SES», como en los demás diagramas y en la tabla
      de actores.
- [x] Agregar «AWS Systems Manager Parameter Store» como servicio externo, con flecha desde la
      API pública: «lee los secretos al iniciar». Sumar una línea en la descripción bajo la figura.

## 2. Ilustración 27 · Topología física (confirmado el 25-10-2026)
Fuente: generador de la topología en `docs/diagrams/`.

- [x] El firewall de RDS cuelga del router de la VPC, que es el mismo Internet Gateway, lo que
      sugiere un camino desde internet hasta la base de datos. Separar el router interno de la
      VPC del Internet Gateway, o anotar «sin ruta a internet» junto a las subredes privadas.

## 3. Ilustración 29 · Diagrama de despliegue en AWS (C4)
Fuente: `docs/diagrams/architecture/generate_c4.py` → `c4-4-despliegue.drawio`.

Correcciones:
- [x] Subtítulo «Nivel C4 de despliegue» → «Diagrama complementario de despliegue del modelo C4»
      (despliegue no es un nivel de C4). Revisar la misma expresión en el texto de la sección.
- [x] Agregar AWS Systems Manager como nodo (Parameter Store para los secretos y Run Command para
      el despliegue), con sus flechas desde los dos servidores y desde GitHub Actions. Hoy solo
      aparece en una nota.
- [x] Coherencia con la Ilustración 31 (contenedores, C4 nivel 2): agregar el contenedor «Sitio
      público» (Astro, estático), o explicar que el S3 sirve la aplicación web y el sitio público.

Hacerlo más fácil de entender, manteniendo la notación C4:
- [x] Recortar el espacio vacío superior y agrandar la letra para que se lea al ancho de la página.
- [x] Ordenar la lectura de izquierda a derecha, igual que la Ilustración 28: dispositivo del
      usuario → borde de AWS → VPC (subred pública → subredes privadas) → servicios externos; el
      equipo del operador abajo. Usar los mismos colores de zona que la Ilustración 28.
- [x] Numerar los recorridos principales y explicarlos en una tabla breve bajo la figura:
      (1) el usuario abre el sitio; (2) la aplicación llama a la API; (3) la API consulta la base
      de datos; (4) la API llama a Fintoc, Webpay y SES; (5) el operador entra por Tailscale;
      (6) GitHub Actions despliega por Systems Manager.
- [x] Dejar en cada caja solo nombre, tipo («[Nodo: …]» o «[Contenedor: …]») y una línea de
      descripción. Pasar al texto los detalles finos (atributos de la cookie, roles de base de
      datos, retención de respaldos).
- [x] Rotular cada firewall con su regla en una línea («sg-rds · entra 5432 solo desde sg-api y
      sg-admin»).
- [x] Mantener una sola flecha de salida desde la VPC hacia los servicios externos, a través del
      Internet Gateway, en lugar de una flecha por servicio.
- [x] Si aun así queda cargado, dividirlo en dos figuras C4: (a) tráfico de usuarios y
      (b) administración y despliegue.
- [x] Actualizar la leyenda y la descripción bajo la figura con los cambios.

## 4. Todos los diagramas C4 · Ilustraciones 29 a 32
Fuente: `docs/diagrams/architecture/generate_c4.py` (contexto, contenedores, componentes de la API
y despliegue). Aplicar a los cuatro el mismo criterio del punto 3, manteniendo la notación C4:

- [x] Letra más grande: que el texto más chico se lea al ancho de la página impresa (≈ 9 pt);
      recortar los márgenes y el espacio vacío de cada figura.
- [x] Cajas simples: nombre, tipo («[Persona]», «[Contenedor: …]», «[Componente: …]»,
      «[Nodo: …]») y una línea de descripción; los detalles finos pasan al texto bajo la figura.
- [x] Lectura de izquierda a derecha y con los mismos colores y zonas en las cuatro figuras.
- [x] Menos flechas cruzadas: agrupar las salidas hacia servicios externos y reordenar las cajas
      para evitar cruces.
- [x] Recorridos numerados donde haya varios flujos (contenedores y despliegue), explicados en
      una tabla breve bajo la figura.
- [x] Leyenda uniforme en las cuatro figuras, con solo los elementos que aparecen en cada una.
- [x] Si una figura queda cargada aun así, dividirla en dos vistas C4 en vez de achicar la letra.
- [x] Revisar que las descripciones bajo cada figura sigan coincidiendo después de simplificar.

## 5. Tabla 104 · Normas y estándares incorporados al proyecto
- [x] Eliminar la última fila, «Normas APA, 7.ª edición»: es una norma del informe, no del
      desarrollo del proyecto. Es la única cita a American Psychological Association (2020), así
      que la referencia sale sola de la bibliografía al actualizar el campo en Word (verificar).
      La tabla queda con 15 normas; revisar que ningún texto mencione la cantidad.

## 6. Flujo de caja · préstamo bancario en lugar de depender de CORFO (capítulo VIII)
Motivo: hoy el déficit del año 1 (≈ $11,4 M) solo se cubre con el subsidio Semilla Inicia, que no
está asegurado. Si no se adjudica, los socios no tienen ese dinero: el flujo del inversionista
debe financiarse con un préstamo, con intereses y amortización. El flujo puro no cambia.

Parámetros (verificados el 25-10-2026):
- Tasa **20,02 % anual**: interés corriente de la CMF para operaciones no reajustables en moneda
  nacional de 90 días o más, entre 200 y 5.000 UF (Certificado N° 10/2026, Diario Oficial del
  15-10-2026, promedio cobrado por los bancos en septiembre de 2026). Es la tasa oficial del tramo
  del préstamo (≈ 550 UF) y es conservadora: un crédito con garantía FOGAPE podría costar menos,
  pero no hay una tasa oficial publicada para citar. Fuente nueva para la bibliografía (APA 7):
  Comisión para el Mercado Financiero. (2026). Certificado N° 10/2026: Interés corriente.
  Diario Oficial de la República de Chile, 15 de octubre de 2026.
- Préstamo comercial de **$22.000.000**, desembolsado al inicio de 2027 (año 1), con aval de los
  socios o garantía FOGAPE. Monto verificado mes a mes: la caja nunca queda negativa; el punto más
  bajo es septiembre de 2028 (≈ $0,74 M). Con $21 M queda en ≈ $0,09 M (demasiado justo).
- Plazo 5 años: 2 años de gracia de capital (solo intereses en 2027 y 2028, $4.404.400 por año) y
  amortización constante en 2029, 2030 y 2031 ($7.333.333 por año).
- Los intereses son gasto: bajan la utilidad y, por lo tanto, los impuestos (efecto tributario).
- La TIR del inversionista no es confiable porque el flujo cambia de signo más de una vez (año 1
  positivo por el préstamo, año 2 negativo): informar el VAN y la recuperación descontada como
  indicadores principales y explicarlo en una línea.

**Decisiones del 25-10-2026:**
- **Usuarios activos al lanzamiento: de 7.500 a 7.900** (0,13 % de los 6,1 millones de deudores,
  CMF), para recuperar la inversión en 2 años.
- **El informe cita la recuperación descontada** (al 25 %) como cifra principal en el texto, las
  conclusiones y la presentación: es la más exigente y coherente con el VAN. La tabla de
  indicadores mantiene ambas. Con préstamo y 7.900 usuarios, la simple da 0,6 años porque el
  préstamo de 2027 cubre por sí solo el aporte de los socios y el acumulado no vuelve a quedar
  negativo; explicarlo en una línea bajo la tabla de indicadores.

Flujo proyectado con 7.900 usuarios (calculado el 25-10-2026 escalando ventas y costo de venta
por 7.900 / 7.500; recalcular con la planilla al aplicar):

| Ítem | 0 | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---|---|---|---|---|---|
| Ventas | — | 25.659.544 | 44.878.703 | 78.493.133 | 137.284.979 | 240.112.287 |
| Flujo puro | −4.110.543 | −10.679.219 | 1.883.581 | 22.450.013 | 54.081.759 | 126.595.357 |
| + Préstamo | — | 22.000.000 | — | — | — | — |
| − Intereses (20,02 %) | — | −4.404.400 | −4.404.400 | −4.404.400 | −2.936.267 | −1.468.133 |
| + Efecto tributario de los intereses | — | — | — | 3.039.036 | 675.341 | 337.671 |
| − Amortización | — | — | — | −7.333.333 | −7.333.333 | −7.333.334 |
| = Flujo del inversionista | −4.110.543 | 6.916.381 | −2.520.819 | 13.751.316 | 44.487.500 | 118.131.561 |
| Acumulado | −4.110.543 | 2.805.838 | 285.019 | 14.036.335 | 58.523.835 | 176.655.395 |

Saldo del préstamo al inicio de cada año: 22.000.000 · 22.000.000 · 22.000.000 · 14.666.667 ·
7.333.334. El efecto tributario de 2029 incluye las pérdidas arrastradas de 2027 y 2028 (impuesto
23 %). Caja mes a mes: mínimo en junio de 2028 ≈ $3,3 M (con 7.500 usuarios era ≈ $0,74 M). Se
mantiene el préstamo de $22 M para conservar ese margen.

Indicadores (7.500 → 7.900 usuarios):

| Indicador | v0.13 (7.500, con CORFO) | 7.500 con préstamo | **7.900 con préstamo** |
|---|---|---|---|
| VAN del inversionista (25 %) | $68,2 M | $56,2 M | **$63,8 M** |
| Recuperación descontada | 2,2 años | 2,43 años (2 años y 5 meses) | **2,03 años (2 años)** |
| Recuperación simple | 2,1 años | 2,26 años (2 años y 3 meses) | 0,6 años (ver nota) |
| VAN del flujo puro | $56,2 M | $56,2 M | **$63,7 M** |
| TIR del flujo puro | 96,0 % | 96,0 % | **106,9 %** |
| Recuperación del flujo puro (simple / descontada) | 2,8 / 3,2 años | 2,8 / 3,2 años | **2,6 / 3,0 años** |
| Pagadores promedio en 2027 | 375 | 375 | **395** |

Cambios en el informe:
- [x] Tabla 115 (parámetros): fila del préstamo (monto, tasa, gracia, amortización, garantía).
- [x] Tabla 120 (financiamiento): «Préstamo bancario $22.000.000»; CORFO pasa a fuente
      complementaria: si se adjudica, reemplaza parte del préstamo.
- [x] Tabla 121 (flujo de caja): el flujo puro queda igual; el bloque del inversionista pasa a
      «+ Préstamo», «− Intereses», «+ Efecto tributario de los intereses», «− Amortización»,
      «= Flujo del inversionista» y su acumulado.
- [x] Nueva tabla de amortización del préstamo (saldo, interés, amortización y cuota por año), o
      incluirla como filas de la Tabla 120. Si se agrega tabla, correr las menciones «Tabla N».
- [x] Flujo mensual del año 1: la columna «Caja con subsidio» pasa a «Caja con préstamo»
      (préstamo menos el déficit acumulado y los intereses pagados).
- [x] Indicadores: columna del inversionista con préstamo (VAN, TIR, recuperación simple y
      descontada); CORFO queda como una línea de sensibilidad.
- [x] Texto del capítulo VIII, conclusiones, Anexo C y presentación: reemplazar «2,1 años con
      CORFO» por la recuperación descontada con préstamo (2 años); explicar quién toma el préstamo
      y su garantía.
- [x] 7.900 usuarios en todo el informe: Tabla 115 (parámetros), embudo de la Tabla 116
      (≈ 136.000 visitas y ≈ 11.290 cuentas, con las mismas tasas), ventas (Tabla 117), costo de
      venta y cuentas de Fintoc (Tabla 118), capital de trabajo, impuestos, flujo de caja
      (Tabla 121), flujo mensual del año 1, indicadores, punto de equilibrio y sensibilidad (agregar
      la fila de 7.900 y revisar que la de 7.500 quede como comparación).
- [x] Recalcular todo desde la planilla `Flujo de caja - Fin de Mes` (cambiar los usuarios en la
      hoja de parámetros) y copiar las cifras exactas al informe; las de esta lista son una
      estimación escalada.
- [x] Buscar en el informe «7.500», «2,8 años», «2,1 años», «3,2 años», «$56,2», «96,0 %» y
      «$68,2» para que no quede ninguna cifra antigua.
- [x] Planilla `Flujo de caja - Fin de Mes`: hoja o filas del préstamo, con fórmulas.
- [x] Actualizar las cifras del modelo de negocio en `CLAUDE.md` (7.900 usuarios, préstamo, recuperación descontada) y en `versiones.md`.

## 7. Identidad: formulario de registro, código al iniciar sesión y retiro de consentimiento
Decisiones del 25-10-2026 (respondidas por el usuario): código por correo en dispositivo nuevo y
cada 30 días; edad mínima 18 años con declaración, sin fecha de nacimiento.

### 7.1 Formulario de «Crear una cuenta» (CU-08)
Criterio: pedir solo lo que el producto usa (principio de minimización de la Ley 21.719); los
datos financieros se registran después, dentro de la aplicación.

| Campo | Obligatorio | Para qué se usa |
|---|---|---|
| Nombre para mostrar (alias, 2 a 40 caracteres) | Sí | Saludo en la app y en los correos; es lo que ven los demás miembros del hogar (CU-47 ya habla de «nombre visible», pero hoy no se pide). No es el nombre legal completo. |
| Correo electrónico | Sí | Identificador de la cuenta, verificación y códigos de acceso. |
| Contraseña y confirmación | Sí | Mínimo 10 caracteres, comparada con la lista local de contraseñas filtradas; la confirmación evita errores de tipeo. |
| «Declaro ser mayor de 18 años» (casilla) | Sí | Los planes pagados son un contrato y los datos de menores tienen un régimen especial; se registra junto con la aceptación de los términos. |
| Aceptación de términos de uso y política de privacidad (casilla desmarcada, con enlaces y versión) | Sí | Ya está en la v0.13 (consentimiento con versión y fecha). |

No se piden (explicarlo en una línea del informe): RUT, nombre legal completo, fecha de
nacimiento, teléfono, dirección, género ni ingresos. Ninguno es necesario para el servicio: el
pago lo identifica Transbank y el banco lo identifica Fintoc en su propia ventana. Tampoco se
agrega una casilla de comunicaciones comerciales, porque el MVP solo envía correos
transaccionales (el boletín, HU35, está fuera del alcance).

Cambios:
- [x] CU-08: paso 2 con los campos de la tabla; flujos alternativos para alias inválido,
      contraseñas que no coinciden y declaración de edad sin marcar; poscondición con el alias.
- [x] Modelo de datos: columna `display_name` en `app.users` (migración nueva; la declaración de
      edad queda dentro del consentimiento de términos, sin columna propia). Actualizar el
      diccionario de datos (Anexo B) y regenerar las Ilustraciones 22, 23 y 36.
- [x] CU-16 «Rectificar mis datos personales»: incluir el alias entre los datos rectificables.
- [x] Revisar el caso de prueba de registro en el plan de pruebas.

### 7.2 Código de verificación al iniciar sesión (CU-11)
Regla: se pide un código de 6 dígitos enviado por correo cuando (a) el dispositivo o navegador no
está reconocido, (b) se restableció la contraseña o (c) pasaron 30 días desde la última
verificación en ese dispositivo.

- Código de un solo uso, válido 10 minutos, guardado con hash; máximo 5 intentos, y luego se
  pide uno nuevo. Los intentos fallidos cuentan para el bloqueo temporal de la HU17.1.
- Dispositivo reconocido: identificador aleatorio guardado en una cookie `HttpOnly; Secure;
  SameSite=Strict` (web) o en `flutter_secure_storage` (móvil), con hash en la base de datos; el
  usuario puede revocar sus dispositivos al «Cerrar todas las sesiones» (CU-13).
- El correo del código avisa desde qué tipo de dispositivo y a qué hora se pidió, para que el
  usuario detecte un acceso no autorizado.

Cambios:
- [x] CU-11: pasos del código cuando corresponde (como flujo alternativo, para no alargar el
      caso normal) y flujos para código vencido, código incorrecto y correo que no llega.
- [x] Diagrama de casos de uso de identidad (Ilustración 15): asociar «Iniciar sesión» con el
      Proveedor de correo.
- [x] Modelo de datos: tablas de dispositivos reconocidos y de códigos de acceso (migración
      nueva); diccionario y diagramas de datos.
- [x] Sección de seguridad, KPI o SLA que describan el inicio de sesión, y un caso de prueba
      nuevo (código vencido, reutilizado y fuera de intentos).
- [x] `CLAUDE.md`, sección de seguridad: agregar la regla del código por correo.

### 7.3 Retiro de consentimiento (CU-17, Tabla 35): ¿bloquear el acceso?
Recomendación: **no bloquear la aplicación completa**. Cada consentimiento cubre un uso concreto
de los datos, y al retirarlo solo se detiene ese uso:

- **Conexión bancaria:** al retirarla se desvinculan los bancos y se deja de sincronizar; el
  resto de la app sigue funcionando con registro manual. Bloquear todo sería condicionar el
  servicio a un consentimiento que no es necesario para prestarlo, lo que la Ley 21.719 no
  permite. (Es lo que ya dice la ficha.)
- **Términos de uso y política de privacidad:** no son un consentimiento que se pueda retirar
  manteniendo la cuenta, porque el servicio no se puede prestar sin ellos (la base es el
  contrato). Tampoco corresponde dejar la cuenta bloqueada con los datos guardados, porque se
  conservarían datos sin finalidad. Lo correcto es lo que ya hace la ficha: informar y ofrecer
  «Eliminar mi cuenta».

Cambios:
- [x] CU-17: aclarar en la descripción que retirar el consentimiento bancario solo desactiva la
      conexión bancaria y que no se bloquea el resto de la aplicación; en el flujo 4b, decir que
      los términos y la política se aceptan para usar el servicio y que dejar de aceptarlos
      equivale a cerrar la cuenta.
- [x] Cuando cambie la versión de los términos o de la política: pedir la nueva aceptación al
      iniciar sesión, antes de seguir usando la app. Es el único caso en que se bloquea hasta
      aceptar o eliminar la cuenta. Agregarlo como flujo alternativo de CU-11.

## 8. Otros
- [x] Primera mención de «p95» en el informe: escribir «percentil 95 (p95)»; el resto sigue
      usando p95. (Confirmado el 25-10-2026.)
- [x] Migraciones: la 0010 (consentimientos y fechas de registro inicial) está solo en la rama
      remota `docs/aws-kanban-bpmn-informe2` (commit 90cfefc), no en `main`. Integrarla antes de
      crear las migraciones del alias y del código de acceso, que serán la 0011 y la 0012.
      El informe ya dice «diez archivos de cambios»: actualizar el número cuando se agreguen.

## 9. Cierre de la versión
- [x] Corregir las menciones «Tabla N» escritas a mano si cambia la cantidad de tablas.
- [x] Actualizar índices y PDF en Word; escribir `Cambios v0.14.txt`; actualizar `versiones.md`
      y el número de versión en `CLAUDE.md`.
- [x] Commit y push en una rama nueva; abrir el PR.

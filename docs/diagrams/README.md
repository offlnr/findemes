# Diagramas de Fin de Mes

| Carpeta | Contenido | Herramienta | Descripción |
|---|---|---|---|
| `architecture/` | Arquitectura en notación C4 (contexto, contenedores, componentes, despliegue) y topología de comunicaciones | draw.io | Este archivo |
| `bpmn/` | Procesos de negocio en BPMN 2.0: decisión de gasto (as-is y to-be), suscripción, hogar y vinculación bancaria | `generate_bpmn.py` + bpmn-js | Informe 2, sección 3.1 |
| `planning/` | Carta Gantt ajustada (fases F1 a F4, Kanban con XP) | draw.io | Informe 2, capítulo VII |
| `data-model/` | Modelo de datos en notación pata de gallo | draw.io | `docs/data-dictionary.md` |
| `use-cases/` | Casos de uso UML | PlantUML | `docs/use-cases-and-components.md` |
| `components/` | Componentes UML con interfaces provistas y requeridas | PlantUML | `docs/use-cases-and-components.md` |

`uml-style.iuml` es el estilo común de los diagramas UML (colores por prioridad y estereotipos).

Formatos:

- draw.io: `.drawio` (fuente editable), `.drawio.svg` (para el informe) y `.drawio.png` (vista previa). El SVG
  y el PNG incluyen el diagrama completo, así que también se pueden abrir y editar en draw.io.
- PlantUML: `.puml` (fuente), `.svg` (para el informe) y `.png` (vista previa).

## Arquitectura (`architecture/`)

| Archivo | Nivel C4 | Reemplaza en el informe |
|---|---|---|
| `c4-1-contexto` | 1 · Contexto del sistema | Nueva ilustración |
| `c4-2-contenedores` | 2 · Contenedores | Nueva ilustración |
| `c4-3-componentes-api` | 3 · Componentes de la API pública, en capas hexagonales | Ilustración 6 |
| `c4-4-despliegue` | Despliegue en AWS (ambiente de integración, ADR-005) | Ilustración 5 |
| `topologia-comunicaciones` | Zonas de confianza, protocolos, puertos y cifrado | Nueva ilustración |

Se generan con `generate_c4.py`, que fija cada elemento y cada recorrido de flecha:

```bash
cd docs/diagrams/architecture
python -I generate_c4.py .
"<ruta a draw.io.exe>" -x -f svg -e -b 20 -o c4-4-despliegue.drawio.svg c4-4-despliegue.drawio
```

Si se edita un `.drawio` a mano en draw.io, el generador queda desfasado. En ese caso hay que actualizar
el generador o dejar de usarlo para ese diagrama.

## Modelo de datos (`data-model/`)

Se generan desde la base local, así que reflejan exactamente las migraciones.

| Archivo | Contenido |
|---|---|
| `datos-0-general` | Las 24 tablas, solo claves y relaciones |
| `datos-1-identidad` | Identidad y administración, todas las columnas |
| `datos-2-registro-y-agregacion` | Registro financiero y agregación bancaria |
| `datos-3-hogar` | Hogar y reglas de aporte |
| `datos-4-suscripcion-escenarios-auditoria` | Planes, pagos, escenarios y auditoría |
| `datos-completo` | Las 24 tablas con todas sus columnas en una sola figura |

Para regenerarlos, con la base local levantada y migrada (`docker compose up -d`, `pnpm db:migrate`), desde la
raíz del repositorio:

```bash
python -I docs/diagrams/data-model/generate_er.py .
"<ruta a draw.io.exe>" -x -f svg -e -b 20 -o docs/diagrams/data-model/datos-0-general.drawio.svg docs/diagrams/data-model/datos-0-general.drawio
```

El generador también escribe `docs/data-dictionary.md` y, si existe la carpeta `informe/`, una versión
para Word en `informe/diccionario-datos.html` (se abre en Word y se copian las tablas). Falla si una tabla
o columna nueva no tiene descripción, o si una vista une tablas que no están en columnas vecinas.

## Casos de uso (`use-cases/`)

| Archivo | Contenido |
|---|---|
| `cu-0-actores` | Actores, su generalización y los cinco subsistemas |
| `cu-1-sitio-publico-e-identidad` | Demostración, registro, sesión y derechos sobre los datos (E6, E9) |
| `cu-2-registro-proyeccion-escenarios` | Registro financiero, proyección y escenarios (E1-E4) |
| `cu-3-hogar` | Hogar, gastos comunes y reglas de aporte (E5) |
| `cu-4-planes-y-suscripcion` | Planes, pago con Webpay y vencimiento (E7) |
| `cu-5-administracion` | Panel de administración (E8) |

## Componentes UML (`components/`)

| Archivo | Contenido |
|---|---|
| `comp-1-sistema` | Componentes del sistema con sus interfaces provistas y requeridas |
| `comp-2-api-publica` | Interior de la API pública: módulos, puertos y adaptadores |

Para regenerar los UML (requiere Java, Graphviz y `plantuml.jar`):

```bash
cd docs/diagrams
java -jar ~/plantuml.jar -charset UTF-8 -tsvg use-cases/*.puml components/*.puml
java -jar ~/plantuml.jar -charset UTF-8 -tpng use-cases/*.puml components/*.puml
```

## Convenciones de los C4

- Notación C4 (Simon Brown). Cada elemento lleva nombre, tipo, tecnología y descripción, y cada
  flecha lleva intención y tecnología.
- Las flechas parten de quien inicia la conexión.
- Borde discontinuo = componente previsto (aún no implementado).
- Rojo = credencial que nunca toca Fin de Mes.
- Naranja = plano de administración, solo accesible por Tailscale (RNF21, ADR-004).
- Las decisiones que reflejan están en `docs/adr/001` a `004`.

## Procesos BPMN (`bpmn/`)

`generate_bpmn.py` escribe los cinco `.bpmn` (BPMN 2.0 con su diagrama; se importan en Bizagi Modeler con
*File > Import > BPMN* o en Camunda Modeler). Las imágenes se generan con bpmn-js y Chrome sin interfaz:

```bash
cd docs/diagrams/bpmn
python -I generate_bpmn.py .
# en una carpeta aparte: npm i bpmn-js@17.11.1 puppeteer-core@23.11.1, copiar render.js y luego:
node render.js <carpeta de salida> docs/diagrams/bpmn/*.bpmn
```

## Planificación (`planning/`)

`generate_gantt.py` escribe `gantt-fases.drawio`; se exporta con draw.io igual que los diagramas C4.

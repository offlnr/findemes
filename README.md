# Fin de Mes

Plataforma SaaS de registro y simulación financiera para personas y hogares en Chile. Reúne
ingresos, gastos, deudas y cuotas, proyecta el saldo mes a mes y muestra qué cambia con una
decisión (una compra en cuotas, un gasto nuevo, un prepago) antes de tomarla. El sistema describe
lo que ocurre y qué lo causa; no recomienda.

Proyecto de Título de Ingeniería en Informática. Equipo: Joaquín Varas (app Flutter y UX) y
Maximiliano Lizana (backend, motor, API y pagos).

## Landing (prototipo)

Primera versión de la página pública, en prueba. Es un solo archivo HTML estático en
[`prototype/landing/index.html`](prototype/landing/index.html).

![Primera pantalla de la landing](docs/images/landing/inicio.jpg)

<details>
<summary>Ver la página completa, la versión móvil y la paleta Oliva</summary>

| Página completa | Móvil |
|---|---|
| ![Landing completa](docs/images/landing/pagina-completa.jpg) | ![Landing en móvil](docs/images/landing/movil.jpg) |

![Primera pantalla con la paleta Oliva](docs/images/landing/inicio-oliva.jpg)

</details>

**Secciones:** portada, cómo funciona, simulador de una compra con su proyección a 12 meses,
qué incluye, plan Familiar (gastos comunes con perfiles privados), planes, preguntas y cierre.

**Para verla en local** (Node 24):

```bash
node prototype/serve.mjs
# abrir http://localhost:4321/landing/index.html
```

**Paletas de prueba:** el selector del borde derecho cambia entre 15 combinaciones de color, todas
con contraste WCAG AA. La paleta elegida queda en la URL, por ejemplo
`http://localhost:4321/landing/index.html?paleta=oliva`. El selector es temporal: se quita cuando
se elija la paleta definitiva.

**Pendiente antes de publicarla:**
- Precios de los planes Individual y Familiar (hoy dicen «Por definir»).
- El simulador calcula en el navegador con un perfil de ejemplo. En la versión real debe llamar a
  `POST /v1/demo/projection` (regla 8: sin lógica de negocio en el cliente).
- Los montos y el hogar de ejemplo son ficticios y están rotulados como «Datos de ejemplo».

El prototipo navegable de la aplicación completa está en [`prototype/index.html`](prototype/index.html);
los enlaces de la landing («Crear cuenta», «Entrar», «Probar sin cuenta») apuntan a él.

## Estructura del repositorio

| Carpeta | Contenido |
|---|---|
| `backend/` | Motor de simulación (núcleo puro), módulos, adaptadores y API (Node.js + TypeScript) |
| `docs/` | OpenAPI, ADR, diagramas, diccionario de datos, KPI y SLA |
| `prototype/` | Prototipo navegable de la app y landing de prueba |
| `PRODUCT.md` | Contexto de producto: usuarios, propósito, principios y restricciones |

Las reglas del proyecto y los comandos de desarrollo están en [`CLAUDE.md`](CLAUDE.md); el stack
técnico, en [`docs/adr/001-technical-stack.md`](docs/adr/001-technical-stack.md).

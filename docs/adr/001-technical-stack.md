# ADR-001: Stack técnico y organización del repositorio

- **Estado:** aceptada
- **Fecha:** 02-10-2026
- **Autores:** Joaquín Varas (revisión pendiente: Maximiliano Lizana)

## Contexto

El informe fija Node.js + TypeScript, PostgreSQL, JWT, Flutter con Riverpod y despliegue en
contenedores de DigitalOcean App Platform. No define el framework HTTP, el acceso a datos, la
herramienta de pruebas ni el CI. Hay que elegirlos considerando:

- un núcleo de simulación puro, determinista y con más de 90 % de cobertura (RNF16, RNF17);
- un contrato OpenAPI compartido entre el backend y la app Flutter;
- un equipo de dos personas con un plazo fijo, donde todos los entornos deben ser iguales;
- datos financieros personales protegidos por la Ley 21.719, con un modelo de privacidad del hogar.

## Decisión

| Tema | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 24 LTS | LTS activa a la fecha; la misma versión en local, CI y producción |
| Gestor de paquetes | pnpm workspaces | Monorepo liviano con instalación estricta de dependencias |
| Lenguaje | TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | Detecta errores de montos y valores opcionales al compilar |
| Framework HTTP | Fastify | Esquemas de validación que generan el OpenAPI; buen rendimiento |
| Validación | Zod, solo en `api` y `modules` | El núcleo no depende de bibliotecas externas |
| Acceso a datos | Kysely + migraciones SQL versionadas | Consultas tipadas y explícitas, sin ORM; facilita RLS y roles por servicio |
| Pruebas | Vitest con cobertura v8 | Umbral de cobertura por carpeta (`src/core/**` ≥ 90 % de líneas) |
| Base de datos local | PostgreSQL en Docker Desktop (`docker compose`) | La misma versión que CI y producción; base desechable para pruebas |
| Guardián de capas | `dependency-cruiser` + ESLint `no-restricted-imports` | La regla del núcleo puro se verifica en CI, no solo en revisión |
| Cliente Flutter | `openapi-generator` (dart-dio) desde `docs/openapi.yaml` | Cliente tipado y regenerable; la app no reimplementa lógica |
| CI | GitHub Actions | Repositorio en GitHub; escaneos de seguridad integrados |
| Admin | `admin-api` y panel en un Droplet de la VPC de DigitalOcean, solo por Tailscale | App Platform no permite publicar servicios accesibles solo por VPN (RNF21) |

## Consecuencias

- El núcleo (`backend/src/core`) solo usa TypeScript estándar. Cualquier import externo hace
  fallar el CI.
- Toda ruta de la API declara su esquema en Fastify, y el OpenAPI se regenera con cada endpoint.
- Kysely obliga a escribir las consultas a mano. Es más trabajo que un ORM, pero cada consulta
  queda visible y filtra explícitamente por el actor.
- Docker Desktop es requisito para desarrollar el backend (necesita WSL2 en Windows).
- El Droplet de administración suma entre US$4 y US$6 al mes al presupuesto (Tabla 40).
- Cambiar alguna de estas elecciones requiere un ADR nuevo que reemplace a este.

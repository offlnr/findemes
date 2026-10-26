# ADR-005: Despliegue en AWS con el plan gratuito

- **Estado:** aceptada (reemplaza la fila de despliegue y de administración del ADR-001)
- **Fecha:** 20-10-2026
- **Autores:** Joaquín Varas (revisión pendiente: Maximiliano Lizana)

## Contexto

El ADR-001 fijó DigitalOcean (App Platform, PostgreSQL gestionado y un Droplet de administración). El equipo
descartó esa opción por costo: el ambiente de integración y la validación con usuarios no deben tener costo
durante el proyecto (hasta el 01-12-2026). Se siguen exigiendo:

- PostgreSQL 18 gestionado con respaldo diario y recuperación a un punto en el tiempo (OLA-005: 30 días);
- un plano de administración sin ninguna ruta desde internet, alcanzable solo por Tailscale (RNF21);
- la API pública sin estado, con TLS y límite de tasa delante;
- el sitio y la API bajo el mismo dominio, para la cookie de refresh `SameSite=Strict`.

## Decisión

Amazon Web Services, región `us-east-1`, cuenta del plan gratuito (hasta US$200 en créditos durante 6 meses):

| Pieza | Servicio | Detalle |
|---|---|---|
| Entrada pública | Amazon CloudFront | Único punto de entrada, TLS gestionado, AWS Shield Standard. `/` va a S3 y `/v1/*` a API Gateway |
| Sitio estático | Amazon S3 | Bucket privado, solo legible por CloudFront (Origin Access Control) |
| Entrada a la API | Amazon API Gateway (API HTTP) | Límite de tasa; integración privada por VPC Link con AWS Cloud Map |
| API pública y migrador | EC2 `t4g.micro` en subred pública, Docker | Grupo de seguridad: entrada solo desde el VPC Link. Sale a internet por su IPv4 pública (sin NAT) |
| Administración | EC2 `t4g.nano` en subred pública | Grupo de seguridad sin reglas de entrada; la API y el panel escuchan solo en la interfaz de Tailscale |
| Base de datos | Amazon RDS for PostgreSQL 18, `db.t4g.micro`, Single-AZ, 20 GB cifrados con KMS | Subredes privadas sin ruta a internet; 5432 solo desde los grupos de las dos instancias; retención de respaldos de 30 días |
| Secretos | Systems Manager Parameter Store (SecureString, KMS) | Cada instancia los lee con su rol de IAM |
| Despliegue | GitHub Actions → rol de IAM por OIDC → Systems Manager Run Command | Sin llaves de larga duración y sin SSH abierto |
| Control de costos | AWS Budgets | Alerta ante cualquier cargo mientras dure el plan gratuito |

Se descartó el diseño convencional con ECS Fargate, Application Load Balancer y NAT Gateway: cuesta cerca de
US$82 al mes, casi todo en red, y consumiría los créditos antes del cierre.

## Consecuencias

- Costo durante el proyecto: US$0 (créditos). En operación, cerca de US$32 al mes; es el valor que usa el flujo
  de caja del informe 2.
- SLA: CloudFront 99,9 %, API Gateway 99,95 %, EC2 99,5 % por instancia (99,99 % regional), RDS 99,5 %
  Single-AZ o 99,95 % Multi-AZ. Piso compuesto del ambiente de integración ≈ 98,85 %; de producción (dos
  instancias en zonas distintas y RDS Multi-AZ) ≈ 99,79 % (ver `docs/kpi-and-sla.md`).
- La configuración es más extensa que en una plataforma gestionada. Se describe con plantillas de AWS
  CloudFormation versionadas en el repositorio.
- La conexión a RDS usa `sslmode=verify-full` con el paquete de certificados de RDS. El puerto pasa de 25060
  (DigitalOcean) a 5432.
- Fastify debe confiar en la cabecera de IP de origen que entrega API Gateway (`trustProxy` acotado) para que
  el límite por IP del inicio de sesión (HU17.1) vea la IP real del cliente.
- Si el plan gratuito vence o los créditos se agotan antes del cierre, la cuenta se cierra: hay que pasar al
  plan pagado con AWS Budgets activo antes de esa fecha.
- Diagramas: `docs/diagrams/architecture/c4-4-despliegue` y `topologia-comunicaciones`.

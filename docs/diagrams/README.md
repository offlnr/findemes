# Diagramas de arquitectura (modelo C4)

| Archivo | Nivel C4 | Reemplaza en el informe |
|---|---|---|
| `c4-1-contexto` | 1 · Contexto del sistema | Nueva ilustración |
| `c4-2-contenedores` | 2 · Contenedores | Nueva ilustración |
| `c4-3-componentes-api` | 3 · Componentes de la API pública, en capas hexagonales | Ilustración 6 |
| `c4-4-despliegue` | Despliegue en DigitalOcean (ambiente de integración) | Ilustración 5 |

Cada diagrama existe en tres formatos:

- `.drawio`: fuente editable en draw.io.
- `.drawio.svg`: versión vectorial para el informe.
- `.drawio.png`: vista previa.

El SVG y el PNG incluyen el diagrama completo, así que también se pueden abrir y editar en draw.io.

## Cómo modificarlos

Los diagramas se generan con `generate_c4.py`, que fija cada elemento y cada recorrido de flecha:

```bash
python generate_c4.py .
"<ruta a draw.io.exe>" -x -f svg -e -b 20 -o c4-4-despliegue.drawio.svg c4-4-despliegue.drawio
```

Si se edita un `.drawio` a mano en draw.io, el generador queda desfasado. En ese caso hay que actualizar
el generador o dejar de usarlo para ese diagrama.

## Convenciones

- Notación C4 (Simon Brown). Cada elemento lleva nombre, tipo, tecnología y descripción, y cada
  flecha lleva intención y tecnología.
- Las flechas parten de quien inicia la conexión.
- Borde discontinuo = componente previsto (aún no implementado).
- Rojo = credencial que nunca toca Fin de Mes.
- Naranja = plano de administración, solo accesible por Tailscale (RNF21, ADR-004).
- Las decisiones que reflejan están en `docs/adr/001` a `004`.

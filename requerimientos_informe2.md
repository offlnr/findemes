Leyenda: [x] hecho · [~] parcial · [ ] pendiente.
"Hecho" significa que el material está listo en el repositorio; todavía falta pasarlo al informe 2
y que lo revise Maximiliano.

Detalle de las tecnologias a implementar
    [~] Analisis cualitativo/cuantitativo de las tecnologias que seran implementadas
        ADR-001 (elección y motivo) y ADR-002 (Fintoc frente a Plaid) cubren lo cualitativo.
        Falta la comparación cuantitativa (alternativas, costos, rendimiento).
    [x] Herramientas, Aplicaciones, lenguajes y componentes que seran implementados
        docs/adr/001-technical-stack.md

Detalle de la arquitectura a implementar
    [~] Diagrama BPMN
        Revisada la Il. 7: hay que rehacerla (mezcla API con negocio y modela funciones que no existen).
    [x] Diagramas de casos de uso
        docs/diagrams/use-cases/ (cu-0 a cu-5) (UML, PlantUML), descritos en docs/use-cases-and-components.md
    [x] Diagrama de componentes
        UML: docs/diagrams/components/ (comp-1-sistema y comp-2-api-publica).
        C4: docs/diagrams/architecture/c4-3-componentes-api (reemplaza la Il. 6)
    [x] Modelo de datos
        docs/diagrams/data-model/ y docs/data-dictionary.md (diccionario de datos).
        Falta elegir la organización (general + módulos o completo) y el criterio de idioma.
    [~] Topologia de comunicaciones
        El diagrama de despliegue muestra protocolos, puertos y quién inicia cada conexión.
        Falta una vista o tabla dedicada (origen, destino, protocolo, puerto, cifrado).
    [x] Diagrama de infraestructura
        docs/diagrams/architecture/c4-4-despliegue (reemplaza la Il. 5)
    [x] Diagrama de arquitectura
        docs/diagrams/architecture/c4-1-contexto y c4-2-contenedores, más el modelo de amenazas (ADR-004)

Implementacion de los KPI y SLA
    [x] Descripcion de KPI
        docs/kpi-and-sla.md: fuente del dato, cómo se mide y estado de cada KPI.
        Falta decidir cómo medir el registro inicial (migración, opción A).
    [x] Descripcion de SLA
        docs/kpi-and-sla.md: SLA de DigitalOcean verificados, disponibilidad compuesta y medición de los OLA.

Plan de pruebas y aseguramiento de calidad
    [ ] Plan de pruebas
        Ya existen prácticas (TDD en el núcleo, 61 pruebas unitarias, 115 de base de datos,
        acceso cruzado, cobertura > 90 % en el núcleo) pero no el plan formal.
    [ ] Normas y estandares

Plan de implementacion
    [ ] Gestion de disponibilidad
    [ ] Gestion de continuidad
        Hay insumos: respaldo diario y PITR de 7 días de PostgreSQL gestionado.
    [ ] Plan de mantencion

Ajustes del cronograma
    [ ] Revision de carta gantt o desarrollo de fases

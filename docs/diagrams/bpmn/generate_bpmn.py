"""Generate the BPMN 2.0 models (with diagram interchange) of the household spending decision process.

The files are standard BPMN 2.0 XML: Bizagi Modeler imports them with File > Import > BPMN, keeping the layout.

usage: python -I generate_bpmn.py <out_dir>
outputs: proceso-decision-as-is.bpmn, proceso-decision-to-be.bpmn
"""
import html
import os
import sys

TASK_W, TASK_H = 120, 70
EVENT = 36
GATEWAY = 50


def e(s):
    return html.escape(s, quote=True)


class Model:
    def __init__(self, name):
        self.name = name
        self.participants = []          # (id, name, process_id or None, x, y, w, h)
        self.processes = {}             # process id -> list of xml strings
        self.shapes = []                # (element id, x, y, w, h, extra attrs)
        self.edges = []                 # (element id, points)
        self.message_flows = []
        self.bounds = {}
        self.outgoing = {}
        self.incoming = {}
        self.nodes = {}                 # id -> (process, tag, name, attrs, inner)

    def pool(self, pid, name, process, x, y, w, h):
        self.participants.append((pid, name, process, x, y, w, h))
        if process:
            self.processes.setdefault(process, [])
        self.shapes.append((pid, x, y, w, h, 'isHorizontal="true"'))

    def node(self, process, tag, nid, name, x, y, w, h, inner='', attrs=''):
        self.nodes[nid] = (process, tag, name, attrs, inner)
        self.bounds[nid] = (x, y, w, h)
        self.shapes.append((nid, x, y, w, h, 'isMarkerVisible="true"' if 'Gateway' in tag else ''))

    def task(self, process, nid, name, cx, cy, kind='task'):
        self.node(process, kind, nid, name, cx - TASK_W // 2, cy - TASK_H // 2, TASK_W, TASK_H)

    def event(self, process, tag, nid, name, cx, cy, definition=''):
        inner = '<bpmn:%s id="%s_def"/>' % (definition, nid) if definition else ''
        self.node(process, tag, nid, name, cx - EVENT // 2, cy - EVENT // 2, EVENT, EVENT, inner)

    def gateway(self, process, nid, name, cx, cy, kind='exclusiveGateway'):
        self.node(process, kind, nid, name, cx - GATEWAY // 2, cy - GATEWAY // 2, GATEWAY, GATEWAY)

    def flow(self, process, fid, src, tgt, pts, name=''):
        self.processes[process].append('<bpmn:sequenceFlow id="%s" name="%s" sourceRef="%s" targetRef="%s"/>'
                                       % (fid, e(name), src, tgt))
        self.outgoing.setdefault(src, []).append(fid)
        self.incoming.setdefault(tgt, []).append(fid)
        self.edges.append((fid, pts))

    def message(self, mid, name, src, tgt, pts):
        self.message_flows.append('<bpmn:messageFlow id="%s" name="%s" sourceRef="%s" targetRef="%s"/>'
                                  % (mid, e(name), src, tgt))
        self.edges.append((mid, pts))

    def annotation(self, process, aid, text, x, y, w, h, target, pts):
        self.processes[process].append('<bpmn:textAnnotation id="%s"><bpmn:text>%s</bpmn:text>'
                                       '</bpmn:textAnnotation>' % (aid, e(text)))
        self.processes[process].append('<bpmn:association id="%s_a" sourceRef="%s" targetRef="%s"/>'
                                       % (aid, aid, target))
        self.shapes.append((aid, x, y, w, h, ''))
        self.edges.append((aid + '_a', pts))

    def data_store(self, process, sid, name, x, y):
        self.processes[process].append('<bpmn:dataStoreReference id="%s" name="%s"/>' % (sid, e(name)))
        self.shapes.append((sid, x, y, 50, 50, ''))
        self.bounds[sid] = (x, y, 50, 50)

    def xml(self):
        out = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
               'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
               'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
               'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
               'id="defs_%s" targetNamespace="https://findemes.cl/bpmn" exporter="generate_bpmn.py">' % self.name]
        out.append('<bpmn:collaboration id="collab_%s">' % self.name)
        for pid, name, process, *_ in self.participants:
            ref = ' processRef="%s"' % process if process else ''
            out.append('<bpmn:participant id="%s" name="%s"%s/>' % (pid, e(name), ref))
        out += self.message_flows
        out.append('</bpmn:collaboration>')
        for process, items in self.processes.items():
            out.append('<bpmn:process id="%s" isExecutable="false">' % process)
            for nid, (proc, tag, name, attrs, inner) in self.nodes.items():
                if proc != process:
                    continue
                body = ''.join('<bpmn:incoming>%s</bpmn:incoming>' % f for f in self.incoming.get(nid, []))
                body += ''.join('<bpmn:outgoing>%s</bpmn:outgoing>' % f for f in self.outgoing.get(nid, []))
                out.append('<bpmn:%s id="%s" name="%s"%s>%s%s</bpmn:%s>' % (tag, nid, e(name), attrs, body, inner, tag))
            out += items
            out.append('</bpmn:process>')
        out.append('<bpmndi:BPMNDiagram id="dia_%s"><bpmndi:BPMNPlane id="plane_%s" bpmnElement="collab_%s">'
                   % (self.name, self.name, self.name))
        for sid, x, y, w, h, extra in self.shapes:
            out.append('<bpmndi:BPMNShape id="%s_di" bpmnElement="%s" %s><dc:Bounds x="%d" y="%d" width="%d" '
                       'height="%d"/></bpmndi:BPMNShape>' % (sid, sid, extra, x, y, w, h))
        for fid, pts in self.edges:
            wps = ''.join('<di:waypoint x="%d" y="%d"/>' % p for p in pts)
            out.append('<bpmndi:BPMNEdge id="%s_di" bpmnElement="%s">%s</bpmndi:BPMNEdge>' % (fid, fid, wps))
        out.append('</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>')
        return '\n'.join(out) + '\n'

    # Connection points.
    def r(self, n):
        x, y, w, h = self.bounds[n]
        return (x + w, y + h // 2)

    def l(self, n):
        x, y, w, h = self.bounds[n]
        return (x, y + h // 2)

    def t(self, n):
        x, y, w, h = self.bounds[n]
        return (x + w // 2, y)

    def b(self, n):
        x, y, w, h = self.bounds[n]
        return (x + w // 2, y + h)


def to_be():
    m = Model('to_be')
    U, F, H = 'proc_usuario', 'proc_findemes', 'proc_hogar'
    m.pool('pool_usuario', 'Usuario', U, 0, 0, 2520, 240)
    m.pool('pool_findemes', 'Fin de Mes', F, 0, 280, 2520, 400)
    m.pool('pool_hogar', 'Administrador de hogar', H, 0, 720, 2520, 170)

    # Usuario.
    y1, y2 = 110, 195
    m.event(U, 'startEvent', 'u_start', 'Surge una necesidad de gasto o crédito', 78, y1)
    m.gateway(U, 'u_merge', '', 160, y1)
    m.task(U, 'u_crear', 'Crear un escenario a partir del estado base', 270, y1, 'userTask')
    m.task(U, 'u_aplicar', 'Aplicar la decisión e ingresar sus parámetros', 450, y1, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_resultado', 'Resultados recibidos', 1350, y1,
            'messageEventDefinition')
    m.task(U, 'u_revisar', 'Revisar y comparar indicadores y explicación', 1470, y1, 'userTask')
    m.gateway(U, 'u_otra', '¿Evaluar otra alternativa?', 1600, y1)
    m.task(U, 'u_decidir', 'Tomar la decisión', 1730, y1, 'manualTask')
    m.gateway(U, 'u_ejecuta', '¿Ejecuta la decisión?', 1860, y1)
    m.task(U, 'u_actualizar', 'Actualizar el estado base con el compromiso adquirido', 1990, y1, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_proyeccion', 'Proyección actualizada recibida', 2360, y1,
            'messageEventDefinition')
    m.event(U, 'endEvent', 'u_fin', 'Decisión reflejada en la proyección', 2450, y1)
    m.event(U, 'endEvent', 'u_descarta', 'Decisión descartada; estado base sin cambios', 1990, y2)

    m.flow(U, 'fu1', 'u_start', 'u_merge', [m.r('u_start'), m.l('u_merge')])
    m.flow(U, 'fu2', 'u_merge', 'u_crear', [m.r('u_merge'), m.l('u_crear')])
    m.flow(U, 'fu3', 'u_crear', 'u_aplicar', [m.r('u_crear'), m.l('u_aplicar')])
    m.flow(U, 'fu4', 'u_aplicar', 'u_resultado', [m.r('u_aplicar'), m.l('u_resultado')])
    m.flow(U, 'fu5', 'u_resultado', 'u_revisar', [m.r('u_resultado'), m.l('u_revisar')])
    m.flow(U, 'fu6', 'u_revisar', 'u_otra', [m.r('u_revisar'), m.l('u_otra')])
    m.flow(U, 'fu7', 'u_otra', 'u_merge', [m.t('u_otra'), (1600, 40), (160, 40), m.t('u_merge')], 'Sí')
    m.flow(U, 'fu8', 'u_otra', 'u_decidir', [m.r('u_otra'), m.l('u_decidir')], 'No')
    m.flow(U, 'fu9', 'u_decidir', 'u_ejecuta', [m.r('u_decidir'), m.l('u_ejecuta')])
    m.flow(U, 'fu10', 'u_ejecuta', 'u_actualizar', [m.r('u_ejecuta'), m.l('u_actualizar')], 'Sí')
    m.flow(U, 'fu11', 'u_ejecuta', 'u_descarta', [m.b('u_ejecuta'), (1860, y2), m.l('u_descarta')], 'No')
    m.flow(U, 'fu12', 'u_actualizar', 'u_proyeccion', [m.r('u_actualizar'), m.l('u_proyeccion')])
    m.flow(U, 'fu13', 'u_proyeccion', 'u_fin', [m.r('u_proyeccion'), m.l('u_fin')])

    # Fin de Mes: simulación de la decisión.
    r1, r2, r3 = 380, 480, 610
    m.event(F, 'startEvent', 'f_inicio', 'Decisión recibida', 450, r1, 'messageEventDefinition')
    m.gateway(F, 'f_hogar', '¿Pertenece a un hogar?', 545, r1)
    m.task(F, 'f_aporte', 'Incorporar el aporte al hogar según las reglas vigentes', 670, r2, 'serviceTask')
    m.gateway(F, 'f_merge', '', 790, r1)
    m.task(F, 'f_copia', 'Aplicar la decisión sobre una copia del estado base', 910, r1, 'serviceTask')
    m.task(F, 'f_calculo', 'Calcular la proyección y los indicadores', 1060, r1, 'serviceTask')
    m.task(F, 'f_explica', 'Generar la explicación descriptiva', 1210, r1, 'serviceTask')
    m.event(F, 'endEvent', 'f_entrega', 'Resultados entregados sin ordenar ni recomendar', 1350, r1,
            'messageEventDefinition')
    m.flow(F, 'ff1', 'f_inicio', 'f_hogar', [m.r('f_inicio'), m.l('f_hogar')])
    m.flow(F, 'ff2', 'f_hogar', 'f_aporte', [m.b('f_hogar'), (545, r2), m.l('f_aporte')], 'Sí')
    m.flow(F, 'ff3', 'f_hogar', 'f_merge', [m.r('f_hogar'), m.l('f_merge')], 'No')
    m.flow(F, 'ff4', 'f_aporte', 'f_merge', [m.r('f_aporte'), (790, r2), m.b('f_merge')])
    m.flow(F, 'ff5', 'f_merge', 'f_copia', [m.r('f_merge'), m.l('f_copia')])
    m.flow(F, 'ff6', 'f_copia', 'f_calculo', [m.r('f_copia'), m.l('f_calculo')])
    m.flow(F, 'ff7', 'f_calculo', 'f_explica', [m.r('f_calculo'), m.l('f_explica')])
    m.flow(F, 'ff8', 'f_explica', 'f_entrega', [m.r('f_explica'), m.l('f_entrega')])

    # Fin de Mes: actualización del estado base.
    m.event(F, 'startEvent', 'f_cambio', 'Cambio en el estado base recibido', 1990, r1, 'messageEventDefinition')
    m.task(F, 'f_registra', 'Registrar el cambio en el estado base', 2110, r1, 'serviceTask')
    m.task(F, 'f_recalcula', 'Recalcular la proyección', 2250, r1, 'serviceTask')
    m.event(F, 'endEvent', 'f_actualizada', 'Proyección actualizada entregada', 2360, r1 + 0,
            'messageEventDefinition')
    m.flow(F, 'ff9', 'f_cambio', 'f_registra', [m.r('f_cambio'), m.l('f_registra')])
    m.flow(F, 'ff10', 'f_registra', 'f_recalcula', [m.r('f_registra'), m.l('f_recalcula')])
    m.flow(F, 'ff11', 'f_recalcula', 'f_actualizada', [m.r('f_recalcula'), m.l('f_actualizada')])

    # Fin de Mes: gasto común del hogar.
    m.event(F, 'startEvent', 'f_gasto', 'Gasto común y regla recibidos', 560, r3, 'messageEventDefinition')
    m.task(F, 'f_guarda', 'Validar y guardar el gasto y su regla de aporte', 690, r3, 'serviceTask')
    m.event(F, 'endEvent', 'f_confirma', 'Registro confirmado', 830, r3, 'messageEventDefinition')
    m.flow(F, 'ff12', 'f_gasto', 'f_guarda', [m.r('f_gasto'), m.l('f_guarda')])
    m.flow(F, 'ff13', 'f_guarda', 'f_confirma', [m.r('f_guarda'), m.l('f_confirma')])

    m.data_store(F, 'f_reglas', 'Gastos comunes y reglas de aporte vigentes', 790, 520)
    proc, tag, name, attrs, inner = m.nodes['f_guarda']
    m.nodes['f_guarda'] = (proc, tag, name, attrs, inner + '<bpmn:dataOutputAssociation id="do_guarda">'
                           '<bpmn:targetRef>f_reglas</bpmn:targetRef></bpmn:dataOutputAssociation>')
    m.edges.append(('do_guarda', [m.t('f_guarda'), (815, 575)]))
    proc, tag, name, attrs, inner = m.nodes['f_aporte']
    m.nodes['f_aporte'] = (proc, tag, name, attrs, inner + '<bpmn:dataInputAssociation id="di_aporte">'
                           '<bpmn:sourceRef>f_reglas</bpmn:sourceRef></bpmn:dataInputAssociation>')
    m.edges.append(('di_aporte', [(790, 540), m.r('f_aporte')]))

    # Administrador de hogar.
    h = 805
    m.event(H, 'startEvent', 'h_inicio', 'Hay un gasto común nuevo o modificado', 220, h)
    m.task(H, 'h_registra', 'Registrar el gasto común', 340, h, 'userTask')
    m.task(H, 'h_regla', 'Configurar la regla de aporte', 560, h, 'userTask')
    m.event(H, 'intermediateCatchEvent', 'h_confirma', 'Confirmación recibida', 830, h, 'messageEventDefinition')
    m.event(H, 'endEvent', 'h_fin', 'Gasto común vigente para todos los miembros', 930, h)
    m.flow(H, 'fh1', 'h_inicio', 'h_registra', [m.r('h_inicio'), m.l('h_registra')])
    m.flow(H, 'fh2', 'h_registra', 'h_regla', [m.r('h_registra'), m.l('h_regla')])
    m.flow(H, 'fh3', 'h_regla', 'h_confirma', [m.r('h_regla'), m.l('h_confirma')])
    m.flow(H, 'fh4', 'h_confirma', 'h_fin', [m.r('h_confirma'), m.l('h_fin')])

    # Mensajes entre participantes.
    m.message('m1', 'Decisión y parámetros', 'u_aplicar', 'f_inicio', [m.b('u_aplicar'), m.t('f_inicio')])
    m.message('m2', 'Proyección, indicadores y explicación', 'f_entrega', 'u_resultado',
              [m.t('f_entrega'), m.b('u_resultado')])
    m.message('m3', 'Nuevo compromiso', 'u_actualizar', 'f_cambio', [m.b('u_actualizar'), m.t('f_cambio')])
    m.message('m4', 'Proyección actualizada', 'f_actualizada', 'u_proyeccion',
              [m.t('f_actualizada'), m.b('u_proyeccion')])
    m.message('m5', 'Gasto común y regla', 'h_regla', 'f_gasto', [m.t('h_regla'), m.b('f_gasto')])
    m.message('m6', 'Confirmación', 'f_confirma', 'h_confirma', [m.b('f_confirma'), m.t('h_confirma')])

    m.annotation(F, 'n_pre', 'Precondición: sesión iniciada y estado base registrado (HU01-HU04).',
                 120, 300, 230, 45, 'f_inicio', [(350, 322), m.l('f_inicio')])
    m.annotation(F, 'n_hogar', 'No espera a otros miembros: usa la regla vigente del gasto común.',
                 400, 525, 210, 45, 'f_aporte', [(610, 547), (620, 510)])
    m.annotation(U, 'n_decide', 'La decisión es del usuario: el sistema calcula y muestra, no recomienda.',
                 1660, 160, 200, 50, 'u_decidir', [(1730, 160), m.b('u_decidir')])
    return m


def as_is():
    m = Model('as_is')
    P = 'proc_persona'
    m.pool('pool_persona', 'Persona', P, 0, 0, 1880, 260)
    m.pool('pool_hogar', 'Integrantes del hogar', None, 0, 300, 1880, 90)

    y1, y2 = 120, 205
    m.event(P, 'startEvent', 'p_start', 'Surge una necesidad de gasto o crédito', 78, y1)
    m.task(P, 'p_mental', 'Comparar mentalmente la cuota con el ingreso', 200, y1, 'manualTask')
    m.gateway(P, 'p_compara', '¿Compara alternativas?', 330, y1)
    m.task(P, 'p_planilla', 'Armar y editar una planilla de cálculo', 450, y2, 'manualTask')
    m.gateway(P, 'p_merge1', '', 570, y1)
    m.task(P, 'p_decide', 'Decidir con información incompleta', 690, y1, 'manualTask')
    m.gateway(P, 'p_hogar', '¿Afecta gastos del hogar?', 820, y1)
    m.task(P, 'p_coordina', 'Coordinar conversando con el hogar', 940, y2, 'manualTask')
    m.gateway(P, 'p_merge2', '', 1060, y1)
    m.task(P, 'p_ejecuta', 'Ejecutar la decisión', 1180, y1, 'manualTask')
    m.event(P, 'intermediateCatchEvent', 'p_finmes', 'Llega el fin de mes', 1310, y1, 'timerEventDefinition')
    m.task(P, 'p_detecta', 'Detectar el desajuste cuando ya ocurrió', 1440, y1, 'manualTask')
    m.event(P, 'endEvent', 'p_fin', 'Desajuste asumido sin anticipación', 1570, y1)

    m.flow(P, 'fp1', 'p_start', 'p_mental', [m.r('p_start'), m.l('p_mental')])
    m.flow(P, 'fp2', 'p_mental', 'p_compara', [m.r('p_mental'), m.l('p_compara')])
    m.flow(P, 'fp3', 'p_compara', 'p_planilla', [m.b('p_compara'), (330, y2), m.l('p_planilla')], 'Sí (rara vez)')
    m.flow(P, 'fp4', 'p_compara', 'p_merge1', [m.r('p_compara'), m.l('p_merge1')], 'No')
    m.flow(P, 'fp5', 'p_planilla', 'p_merge1', [m.r('p_planilla'), (570, y2), m.b('p_merge1')])
    m.flow(P, 'fp6', 'p_merge1', 'p_decide', [m.r('p_merge1'), m.l('p_decide')])
    m.flow(P, 'fp7', 'p_decide', 'p_hogar', [m.r('p_decide'), m.l('p_hogar')])
    m.flow(P, 'fp8', 'p_hogar', 'p_coordina', [m.b('p_hogar'), (820, y2), m.l('p_coordina')], 'Sí')
    m.flow(P, 'fp9', 'p_hogar', 'p_merge2', [m.r('p_hogar'), m.l('p_merge2')], 'No')
    m.flow(P, 'fp10', 'p_coordina', 'p_merge2', [m.r('p_coordina'), (1060, y2), m.b('p_merge2')])
    m.flow(P, 'fp11', 'p_merge2', 'p_ejecuta', [m.r('p_merge2'), m.l('p_ejecuta')])
    m.flow(P, 'fp12', 'p_ejecuta', 'p_finmes', [m.r('p_ejecuta'), m.l('p_finmes')])
    m.flow(P, 'fp13', 'p_finmes', 'p_detecta', [m.r('p_finmes'), m.l('p_detecta')])
    m.flow(P, 'fp14', 'p_detecta', 'p_fin', [m.r('p_detecta'), m.l('p_fin')])

    m.message('mp1', 'Ingresos y deudas personales', 'p_coordina', 'pool_hogar', [m.b('p_coordina'), (940, 300)])

    m.annotation(P, 'n_mental', 'No considera los compromisos vigentes ni las cuotas pendientes.',
                 140, 20, 220, 45, 'p_mental', [(220, 65), m.t('p_mental')])
    m.annotation(P, 'n_coordina', 'Para coordinar se expone información personal.',
                 1020, 210, 200, 40, 'p_coordina', [(1020, 230), m.r('p_coordina')])
    return m


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for fname, model in [('proceso-decision-as-is.bpmn', as_is()), ('proceso-decision-to-be.bpmn', to_be())]:
        with open(os.path.join(out, fname), 'w', encoding='utf-8', newline='\n') as f:
            f.write(model.xml())


if __name__ == '__main__':
    main()

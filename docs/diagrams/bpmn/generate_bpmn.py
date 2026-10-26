"""Generate the BPMN 2.0 models (with diagram interchange) of the Fin de Mes business processes.

The files are standard BPMN 2.0 XML: Bizagi Modeler and Camunda Modeler import them keeping the layout
(Bizagi: File > Import > BPMN). Images are rendered with bpmn-js (see README.md).

usage: python -I generate_bpmn.py <out_dir>
outputs:
  proceso-decision-as-is.bpmn    current, informal spending decision (informe 1, Tabla 16)
  proceso-decision-to-be.bpmn    main process 1: spending decision with Fin de Mes
  proceso-suscripcion.bpmn       main process 2: plan purchase with Webpay Plus and renewal (HU18-HU20, HU26)
  proceso-hogar.bpmn             main process 3: shared household (HU12-HU16, HU31)
  proceso-vinculacion-bancaria.bpmn  support process: bank linking with Fintoc (HU36)
"""
import html
import math
import os
import sys

TASK_W, TASK_H = 150, 80

# Bizagi Modeler default palette (fill, border), sampled from Bizagi exports.
BIZAGI = {
    'start': ('#E6FF97', '#62A715'),
    'end': ('#EEAAAA', '#990000'),
    'intermediate': ('#FFFFFF', '#03689A'),
    'activity': ('#ECEFFF', '#03689A'),
    'gateway': ('#FFFFCC', '#A6A61D'),
    'data': ('#FFFFFF', '#5A5A5A'),
    'pool': ('#FFFFFF', '#000000'),
}


def bizagi_colors(tag):
    if tag is None:
        return BIZAGI['pool']
    if tag == 'startEvent':
        return BIZAGI['start']
    if tag == 'endEvent':
        return BIZAGI['end']
    if tag.endswith('Event'):
        return BIZAGI['intermediate']
    if tag.endswith('Gateway'):
        return BIZAGI['gateway']
    if tag.startswith('data'):
        return BIZAGI['data']
    if tag == 'textAnnotation':
        return None
    return BIZAGI['activity']
EVENT = 36
GATEWAY = 50
CHAR_W = 7.4      # average character width of Bizagi's label font (Bizagi clips labels to their bounds)
LINE_H = 16


def e(s):
    return html.escape(s, quote=True)


def label_h(text, width):
    lines = 0
    for part in text.split('\n'):
        lines += max(1, math.ceil(len(part) * CHAR_W / width))
    return lines * LINE_H


class Model:
    def __init__(self, name):
        self.name = name
        self.participants = []          # (id, name, process id or None)
        self.containers = {}            # process or sub-process id -> {'parent', 'nodes', 'items'}
        self.nodes = {}                 # id -> dict(container, tag, name, attrs, inner)
        self.shapes = []                # (element id, x, y, w, h, extra attrs, label bounds or None)
        self.edges = []                 # (element id, points, label bounds or None)
        self.message_flows = []
        self.bounds = {}
        self.outgoing = {}
        self.incoming = {}
        self.plane = None               # diagram that receives new shapes and edges (None = main)
        self.subplanes = []             # collapsed sub-processes, each drawn in its own diagram

    # ---------- containers ----------
    def pool(self, pid, name, process, x, y, w, h):
        # Black-box pools still reference an empty process: Bizagi drops participants without one.
        process = process or 'proc_' + pid
        self.participants.append((pid, name, process))
        self.containers[process] = {'parent': None, 'nodes': [], 'items': []}
        self._shape(pid, x, y, w, h, 'isHorizontal="true"', None)
        self.bounds[pid] = (x, y, w, h)

    def subprocess(self, container, sid, name, x, y, w, h, collapsed=False):
        """A collapsed sub-process is a task-sized box with the + marker; its content is drawn in its own
        diagram (set ``self.plane = sid`` while adding it). Bizagi imports this form; expanded ones break."""
        self.nodes[sid] = dict(container=container, tag='subProcess', name=name, attrs='', inner='')
        self.containers[container]['nodes'].append(sid)
        self.containers[sid] = {'parent': container, 'nodes': [], 'items': []}
        self.bounds[sid] = (x, y, w, h)
        if collapsed:
            self.subplanes.append(sid)
        # Bizagi draws the name of a collapsed sub-process below the box unless the label sits inside it.
        label = (x + 6, y + 8, w - 12, h - 30) if collapsed else None
        self._shape(sid, x, y, w, h, 'isExpanded="%s"' % ('false' if collapsed else 'true'), label)

    def _shape(self, sid, x, y, w, h, extra, label):
        self.shapes.append((sid, x, y, w, h, extra, label, self.plane))

    def _edge(self, eid, pts, label):
        self.edges.append((eid, pts, label, self.plane))

    # ---------- flow objects ----------
    def _node(self, container, tag, nid, name, x, y, w, h, inner='', attrs='', extra='', label=None):
        self.nodes[nid] = dict(container=container, tag=tag, name=name, attrs=attrs, inner=inner)
        self.containers[container]['nodes'].append(nid)
        self.bounds[nid] = (x, y, w, h)
        self._shape(nid, x, y, w, h, extra, label)

    def task(self, c, nid, name, cx, cy, kind='task'):
        self._node(c, kind, nid, name, cx - TASK_W // 2, cy - TASK_H // 2, TASK_W, TASK_H)

    def event(self, c, tag, nid, name, cx, cy, definition='', lw=120, above=False):
        inner = '<bpmn:%s id="%s_def"/>' % (definition, nid) if definition else ''
        lh = label_h(name, lw) if name else 0
        ly = cy - EVENT // 2 - 6 - lh if above else cy + EVENT // 2 + 4
        label = (cx - lw // 2, ly, lw, lh) if name else None
        self._node(c, tag, nid, name, cx - EVENT // 2, cy - EVENT // 2, EVENT, EVENT, inner, label=label)

    def gateway(self, c, nid, name, cx, cy, kind='exclusiveGateway', lw=130, below=False, at=None):
        lh = label_h(name, lw) if name else 0
        ly = cy + GATEWAY // 2 + 4 if below else cy - GATEWAY // 2 - 4 - lh
        label = ((at[0], at[1], lw, lh) if at else (cx - lw // 2, ly, lw, lh)) if name else None
        extra = 'isMarkerVisible="true"' if kind == 'exclusiveGateway' else ''
        self._node(c, kind, nid, name, cx - GATEWAY // 2, cy - GATEWAY // 2, GATEWAY, GATEWAY, extra=extra,
                   label=label)

    def add_inner(self, nid, xml):
        self.nodes[nid]['inner'] += xml

    # ---------- connections ----------
    @staticmethod
    def _flow_label(name, pts, at):
        if not name:
            return None
        w = max(30, int(len(name) * CHAR_W) + 6)
        if at:
            return (at[0], at[1], w, LINE_H)
        (x0, y0), (x1, y1) = pts[0], pts[1]
        if y0 == y1:
            return (x0 + 6, y0 - 18, w, LINE_H)
        return (x0 + 6, y0 + (6 if y1 > y0 else -20), w, LINE_H)

    def flow(self, c, fid, src, tgt, pts, name='', at=None):
        self.containers[c]['items'].append('<bpmn:sequenceFlow id="%s" name="%s" sourceRef="%s" targetRef="%s"/>'
                                           % (fid, e(name), src, tgt))
        self.outgoing.setdefault(src, []).append(fid)
        self.incoming.setdefault(tgt, []).append(fid)
        self._edge(fid, pts, self._flow_label(name, pts, at))

    def message(self, mid, name, src, tgt, pts, at=None, lw=120):
        self.message_flows.append('<bpmn:messageFlow id="%s" name="%s" sourceRef="%s" targetRef="%s"/>'
                                  % (mid, e(name), src, tgt))
        label = None
        if name:
            if at is None:
                (x0, y0), (x1, y1) = pts[-2], pts[-1]
                at = (min(x0, x1) + 6, (y0 + y1) // 2 - label_h(name, lw) // 2)
            label = (at[0], at[1], lw, label_h(name, lw))
        self._edge(mid, pts, label)

    def annotation(self, c, aid, text, x, y, w, target, pts):
        h = label_h(text, w - 10) + 10
        self.containers[c]['items'].append('<bpmn:textAnnotation id="%s"><bpmn:text>%s</bpmn:text>'
                                           '</bpmn:textAnnotation>' % (aid, e(text)))
        self.containers[c]['items'].append('<bpmn:association id="%s_a" sourceRef="%s" targetRef="%s"/>'
                                           % (aid, aid, target))
        self._shape(aid, x, y, w, h, '', None)
        self._edge(aid + '_a', pts, None)

    def data_store(self, c, sid, name, x, y, lw=130):
        self.containers[c]['items'].append('<bpmn:dataStoreReference id="%s" name="%s"/>' % (sid, e(name)))
        self._shape(sid, x, y, 50, 50, '', (x + 25 - lw // 2, y + 54, lw, label_h(name, lw)))
        self.bounds[sid] = (x, y, 50, 50)

    def reads(self, task, store, pts):
        aid = 'di_%s_%s' % (task, store)
        self.add_inner(task, '<bpmn:dataInputAssociation id="%s"><bpmn:sourceRef>%s</bpmn:sourceRef>'
                             '<bpmn:targetRef>%s</bpmn:targetRef></bpmn:dataInputAssociation>' % (aid, store, task))
        self._edge(aid, pts, None)

    def writes(self, task, store, pts):
        aid = 'do_%s_%s' % (task, store)
        self.add_inner(task, '<bpmn:dataOutputAssociation id="%s"><bpmn:sourceRef>%s</bpmn:sourceRef>'
                             '<bpmn:targetRef>%s</bpmn:targetRef></bpmn:dataOutputAssociation>' % (aid, task, store))
        self._edge(aid, pts, None)

    # ---------- connection points ----------
    def r(self, n, dy=0):
        x, y, w, h = self.bounds[n]
        return (x + w, y + h // 2 + dy)

    def l(self, n, dy=0):
        x, y, w, h = self.bounds[n]
        return (x, y + h // 2 + dy)

    def t(self, n, dx=0):
        x, y, w, h = self.bounds[n]
        return (x + w // 2 + dx, y)

    def b(self, n, dx=0):
        x, y, w, h = self.bounds[n]
        return (x + w // 2 + dx, y + h)

    def c(self, n):
        x, y, w, h = self.bounds[n]
        return (x + w // 2, y + h // 2)

    # shortcuts for common routes
    def h(self, c, fid, a, b, name='', at=None):
        """Straight left-to-right flow between two elements on the same row."""
        self.flow(c, fid, a, b, [self.r(a), self.l(b)], name, at)

    def down_right(self, c, fid, a, b, name='', at=None):
        """Leave a gateway by the bottom (or top) and enter the target from the left."""
        ty = self.c(b)[1]
        start = self.b(a) if ty > self.c(a)[1] else self.t(a)
        self.flow(c, fid, a, b, [start, (start[0], ty), self.l(b)], name, at)

    def right_up(self, c, fid, a, b, name='', at=None):
        """Leave by the right and enter a gateway by the bottom (or top)."""
        sx, sy = self.r(a)
        end = self.b(b) if sy > self.c(b)[1] else self.t(b)
        self.flow(c, fid, a, b, [(sx, sy), (end[0], sy), end], name, at)

    # ---------- serialization ----------
    def _container_xml(self, cid):
        out = []
        for nid in self.containers[cid]['nodes']:
            n = self.nodes[nid]
            body = ''.join('<bpmn:incoming>%s</bpmn:incoming>' % f for f in self.incoming.get(nid, []))
            body += ''.join('<bpmn:outgoing>%s</bpmn:outgoing>' % f for f in self.outgoing.get(nid, []))
            if n['tag'] == 'subProcess':
                body += self._container_xml(nid)
            out.append('<bpmn:%s id="%s" name="%s"%s>%s%s</bpmn:%s>'
                       % (n['tag'], nid, e(n['name']), n['attrs'], body, n['inner'], n['tag']))
        out += self.containers[cid]['items']
        return '\n'.join(out)

    def _header(self, key):
        return ['<?xml version="1.0" encoding="UTF-8"?>',
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
               'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
               'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
               'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
               'xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" '
               'xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" '
               'id="defs_%s" targetNamespace="https://findemes.cl/bpmn" exporter="generate_bpmn.py">' % key]

    def xml(self):
        out = self._header(self.name)
        out.append('<bpmn:collaboration id="collab_%s">' % self.name)
        for pid, name, process in self.participants:
            ref = ' processRef="%s"' % process if process else ''
            out.append('<bpmn:participant id="%s" name="%s"%s/>' % (pid, e(name), ref))
        out += self.message_flows
        out.append('</bpmn:collaboration>')
        for cid, cont in self.containers.items():
            if cont['parent'] is None:
                out.append('<bpmn:process id="%s" isExecutable="false">' % cid)
                out.append(self._container_xml(cid))
                out.append('</bpmn:process>')
        for plane in [None] + self.subplanes:
            out += self._diagram_xml(plane)
        out.append('</bpmn:definitions>')
        return '\n'.join(out) + '\n'

    def _diagram_xml(self, plane):
        """One BPMNDiagram: the collaboration (plane None) or the content of a collapsed sub-process."""
        key = self.name if plane is None else plane
        element = 'collab_%s' % self.name if plane is None else plane
        name = '' if plane is None else ' name="%s"' % e(self.nodes[plane]['name'])
        out = ['<bpmndi:BPMNDiagram id="dia_%s"%s><bpmndi:BPMNPlane id="plane_%s" bpmnElement="%s">'
               % (key, name, key, element)]
        lbl = '<bpmndi:BPMNLabel><dc:Bounds x="%d" y="%d" width="%d" height="%d"/></bpmndi:BPMNLabel>'
        lbl_black = ('<bpmndi:BPMNLabel color:color="#000000"><dc:Bounds x="%d" y="%d" width="%d" height="%d"/>'
                     '</bpmndi:BPMNLabel>')
        for sid, x, y, w, h, extra, label, p in self.shapes:
            if p != plane:
                continue
            colors = bizagi_colors(self.nodes.get(sid, {}).get('tag'))
            if colors:
                extra += (' bioc:fill="%s" bioc:stroke="%s" color:background-color="%s" color:border-color="%s"'
                          % (colors[0], colors[1], colors[0], colors[1]))
            label_xml = lbl_black % label if label else '<bpmndi:BPMNLabel color:color="#000000"/>'
            out.append('<bpmndi:BPMNShape id="%s_di" bpmnElement="%s" %s><dc:Bounds x="%d" y="%d" width="%d" '
                       'height="%d"/>%s</bpmndi:BPMNShape>' % (sid, sid, extra, x, y, w, h, label_xml))
        for fid, pts, label, p in self.edges:
            if p != plane:
                continue
            wps = ''.join('<di:waypoint x="%d" y="%d"/>' % pt for pt in pts)
            out.append('<bpmndi:BPMNEdge id="%s_di" bpmnElement="%s">%s%s</bpmndi:BPMNEdge>'
                       % (fid, fid, wps, lbl % label if label else ''))
        out.append('</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>')
        return out

    def standalone_xml(self, sid):
        """A collapsed sub-process as its own file: its content inside the pool of the participant that
        performs it. Bizagi imports it as an ordinary diagram (no need to open the sub-process)."""
        root = sid
        while self.containers[root]['parent'] is not None:
            root = self.containers[root]['parent']
        pool_name = next(name for _, name, process in self.participants if process == root)
        xs, ys = [], []
        for _, x, y, w, h, _, label, plane in self.shapes:
            if plane == sid:
                xs += [x, x + w]
                ys += [y, y + h]
                if label:
                    xs += [label[0], label[0] + label[2]]
                    ys += [label[1], label[1] + label[3]]
        for _, pts, label, plane in self.edges:
            if plane == sid:
                xs += [pt[0] for pt in pts]
                ys += [pt[1] for pt in pts]
        x0, y0 = min(xs) - 70, min(ys) - 40
        w, h = max(xs) - x0 + 40, max(ys) - y0 + 40
        out = self._header(sid)
        out.append('<bpmn:collaboration id="collab_%s">' % sid)
        out.append('<bpmn:participant id="pool_%s" name="%s" processRef="proc_%s"/>' % (sid, e(pool_name), sid))
        out.append('</bpmn:collaboration>')
        out.append('<bpmn:process id="proc_%s" name="%s" isExecutable="false">' % (sid, e(self.nodes[sid]['name'])))
        out.append(self._container_xml(sid))
        out.append('</bpmn:process>')
        body = self._diagram_xml(sid)[1:-1]
        out.append('<bpmndi:BPMNDiagram id="dia_%s" name="%s"><bpmndi:BPMNPlane id="plane_%s" bpmnElement="collab_%s">'
                   % (sid, e(self.nodes[sid]['name']), sid, sid))
        out.append('<bpmndi:BPMNShape id="pool_%s_di" bpmnElement="pool_%s" isHorizontal="true"><dc:Bounds x="%d" '
                   'y="%d" width="%d" height="%d"/><bpmndi:BPMNLabel color:color="#000000"/></bpmndi:BPMNShape>'
                   % (sid, sid, x0, y0, w, h))
        out += body
        out.append('</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>')
        out.append('</bpmn:definitions>')
        return '\n'.join(out) + '\n'


MSG = 'messageEventDefinition'
TIMER = 'timerEventDefinition'


# =====================================================================================================
# Layout rules for Bizagi: sub-processes are collapsed (task-sized box with +) and drawn in their own
# diagram; event, message and data labels stay within two short lines (Bizagi clips longer ones).
def as_is():
    """Current process: informal, from memory, without projection (informe 1, Tabla 16)."""
    m = Model('as_is')
    P = 'proc_persona'
    m.pool('pool_persona', 'Persona que decide', P, 0, 0, 1800, 340)
    m.pool('pool_hogar', 'Integrantes del hogar', None, 0, 380, 1800, 90)
    y1, y2 = 150, 260
    m.event(P, 'startEvent', 'p_start', 'Surge un gasto o crédito', 90, y1)
    m.task(P, 'p_mental', 'Comparar de memoria la cuota con el ingreso', 230, y1, 'manualTask')
    m.gateway(P, 'p_compara', '¿Compara alternativas?', 380, y1)
    m.task(P, 'p_planilla', 'Armar o editar una planilla de cálculo', 500, y2, 'manualTask')
    m.gateway(P, 'p_merge1', '', 620, y1)
    m.task(P, 'p_decide', 'Decidir con información incompleta', 760, y1, 'manualTask')
    m.gateway(P, 'p_hogar', '¿Afecta gastos del hogar?', 910, y1)
    m.task(P, 'p_coordina', 'Coordinar conversando con el hogar', 1030, y2, 'manualTask')
    m.gateway(P, 'p_merge2', '', 1150, y1)
    m.task(P, 'p_ejecuta', 'Ejecutar la decisión', 1290, y1, 'manualTask')
    m.event(P, 'intermediateCatchEvent', 'p_finmes', 'Llega el fin de mes', 1430, y1, TIMER)
    m.task(P, 'p_detecta', 'Detectar el desajuste cuando ya ocurrió', 1570, y1, 'manualTask')
    m.event(P, 'endEvent', 'p_fin', 'Desajuste asumido', 1720, y1)

    m.h(P, 'fp1', 'p_start', 'p_mental')
    m.h(P, 'fp2', 'p_mental', 'p_compara')
    m.down_right(P, 'fp3', 'p_compara', 'p_planilla', 'Sí (rara vez)')
    m.h(P, 'fp4', 'p_compara', 'p_merge1', 'No')
    m.right_up(P, 'fp5', 'p_planilla', 'p_merge1')
    m.h(P, 'fp6', 'p_merge1', 'p_decide')
    m.h(P, 'fp7', 'p_decide', 'p_hogar')
    m.down_right(P, 'fp8', 'p_hogar', 'p_coordina', 'Sí')
    m.h(P, 'fp9', 'p_hogar', 'p_merge2', 'No')
    m.right_up(P, 'fp10', 'p_coordina', 'p_merge2')
    m.h(P, 'fp11', 'p_merge2', 'p_ejecuta')
    m.h(P, 'fp12', 'p_ejecuta', 'p_finmes')
    m.h(P, 'fp13', 'p_finmes', 'p_detecta')
    m.h(P, 'fp14', 'p_detecta', 'p_fin')

    m.message('mp1', 'Ingresos y deudas', 'p_coordina', 'pool_hogar', [m.b('p_coordina'), (1030, 380)],
              at=(1040, 335), lw=130)
    m.annotation(P, 'n_mental', 'No considera los compromisos vigentes ni las cuotas pendientes.',
                 130, 20, 230, 'p_mental', [(245, 66), m.t('p_mental', 15)])
    m.annotation(P, 'n_coordina', 'Para coordinar se expone información personal.',
                 640, 285, 210, 'p_coordina', [(850, 300), m.l('p_coordina', 10)])
    return m


# =====================================================================================================
def to_be():
    """Main process 1: deciding a purchase, debt or expense with Fin de Mes."""
    m = Model('to_be')
    U, F = 'proc_usuario', 'proc_findemes'
    m.pool('pool_usuario', 'Usuario', U, 0, 0, 2060, 360)
    m.pool('pool_findemes', 'Fin de Mes', F, 0, 400, 2060, 400)
    Y = 190

    m.event(U, 'startEvent', 'u_start', 'Surge un gasto o crédito', 70, Y)

    # Sub-process 1: keep the base state up to date.
    S1 = 'sp_estado'
    m.subprocess(U, S1, 'Actualizar el estado base', 250 - TASK_W // 2, Y - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = S1
    m.event(S1, 'startEvent', 's1_start', '', 195, Y)
    m.gateway(S1, 's1_banco', '¿Tiene un banco vinculado?', 280, Y, lw=110, at=(180, 222))
    m.task(S1, 's1_sync', 'Sincronizar los movimientos del banco', 420, 135, 'userTask')
    m.task(S1, 's1_manual', 'Registrar ingresos, gastos, deudas y saldo', 420, 255, 'userTask')
    m.gateway(S1, 's1_merge', '', 560, Y)
    m.task(S1, 's1_revisa', 'Revisar la proyección del estado base', 690, Y, 'userTask')
    m.event(S1, 'endEvent', 's1_end', '', 820, Y)
    m.h(S1, 'f1', 's1_start', 's1_banco')
    m.down_right(S1, 'f2', 's1_banco', 's1_sync', 'Sí')
    m.down_right(S1, 'f3', 's1_banco', 's1_manual', 'No')
    m.right_up(S1, 'f4', 's1_sync', 's1_merge')
    m.right_up(S1, 'f5', 's1_manual', 's1_merge')
    m.h(S1, 'f6', 's1_merge', 's1_revisa')
    m.h(S1, 'f7', 's1_revisa', 's1_end')
    m.plane = None
    m.flow(U, 'fu1', 'u_start', S1, [m.r('u_start'), m.l(S1)])

    # Sub-process 2: simulate and compare scenarios.
    S2 = 'sp_simular'
    m.subprocess(U, S2, 'Simular y comparar escenarios', 450 - TASK_W // 2, Y - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = S2
    m.event(S2, 'startEvent', 's2_start', '', 980, Y)
    m.gateway(S2, 's2_merge', '', 1060, Y)
    m.task(S2, 's2_crear', 'Crear un escenario a partir del estado base', 1190, Y, 'userTask')
    m.task(S2, 's2_aplicar', 'Aplicar la decisión e ingresar sus parámetros', 1370, Y, 'userTask')
    m.event(S2, 'intermediateCatchEvent', 's2_resultado', 'Resultados recibidos', 1500, Y, MSG, above=True)
    m.task(S2, 's2_revisar', 'Revisar indicadores, explicación y diferencias con la base', 1640, Y, 'userTask')
    m.gateway(S2, 's2_otra', '¿Evaluar otra alternativa?', 1790, Y, lw=120, below=True)
    m.event(S2, 'endEvent', 's2_end', 'Alternativas evaluadas', 1900, Y)
    m.h(S2, 'f8', 's2_start', 's2_merge')
    m.h(S2, 'f9', 's2_merge', 's2_crear')
    m.h(S2, 'f10', 's2_crear', 's2_aplicar')
    m.h(S2, 'f11', 's2_aplicar', 's2_resultado')
    m.h(S2, 'f12', 's2_resultado', 's2_revisar')
    m.h(S2, 'f13', 's2_revisar', 's2_otra')
    m.flow(S2, 'f14', 's2_otra', 's2_merge', [m.t('s2_otra'), (1790, 100), (1060, 100), m.t('s2_merge')], 'Sí',
           at=(1798, 120))
    m.h(S2, 'f15', 's2_otra', 's2_end', 'No')
    m.plane = None
    m.flow(U, 'fu2', S1, S2, [m.r(S1), m.l(S2)])

    m.task(U, 'u_decidir', 'Tomar la decisión', 1420, Y, 'manualTask')
    m.gateway(U, 'u_ejecuta', '¿Ejecuta la decisión?', 1570, Y)
    m.task(U, 'u_registra', 'Registrar el compromiso adquirido en el estado base', 1720, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_proy', 'Proyección actualizada', 1870, Y, MSG, above=True)
    m.event(U, 'endEvent', 'u_fin', 'Decisión registrada', 1980, Y)
    m.event(U, 'endEvent', 'u_descarta', 'Decisión descartada', 1630, 300)
    m.flow(U, 'fu3', S2, 'u_decidir', [m.r(S2), m.l('u_decidir')])
    m.h(U, 'fu4', 'u_decidir', 'u_ejecuta')
    m.h(U, 'fu5', 'u_ejecuta', 'u_registra', 'Sí')
    m.down_right(U, 'fu6', 'u_ejecuta', 'u_descarta', 'No')
    m.h(U, 'fu7', 'u_registra', 'u_proy')
    m.h(U, 'fu8', 'u_proy', 'u_fin')
    m.annotation(U, 'n_decide', 'La decisión es del usuario: el sistema calcula y describe, no recomienda.',
                 1180, 262, 200, 'u_decidir', [(1380, 280), m.b('u_decidir', -20)])

    # Fin de Mes: simulation.
    R1, R2 = 520, 630
    m.event(F, 'startEvent', 'f_inicio', 'Decisión recibida', 430, R1, MSG)
    m.gateway(F, 'f_hogar', '¿Pertenece a un hogar?', 530, R1, lw=110)
    m.task(F, 'f_aporte', 'Incorporar su aporte al hogar según la regla vigente', 660, R2, 'serviceTask')
    m.gateway(F, 'f_merge', '', 790, R1)
    m.task(F, 'f_copia', 'Aplicar la decisión sobre una copia del estado base', 920, R1, 'serviceTask')
    m.task(F, 'f_calculo', 'Calcular la proyección y los indicadores', 1080, R1, 'serviceTask')
    m.task(F, 'f_explica', 'Generar la explicación descriptiva', 1240, R1, 'serviceTask')
    m.event(F, 'endEvent', 'f_entrega', 'Resultados entregados', 1360, R1, MSG)
    m.h(F, 'ff1', 'f_inicio', 'f_hogar')
    m.down_right(F, 'ff2', 'f_hogar', 'f_aporte', 'Sí')
    m.h(F, 'ff3', 'f_hogar', 'f_merge', 'No')
    m.right_up(F, 'ff4', 'f_aporte', 'f_merge')
    m.h(F, 'ff5', 'f_merge', 'f_copia')
    m.h(F, 'ff6', 'f_copia', 'f_calculo')
    m.h(F, 'ff7', 'f_calculo', 'f_explica')
    m.h(F, 'ff8', 'f_explica', 'f_entrega')
    m.data_store(F, 'f_reglas', 'Reglas de aporte', 635, 700, lw=120)
    m.reads('f_aporte', 'f_reglas', [m.t('f_reglas'), m.b('f_aporte')])
    m.annotation(F, 'n_pre', 'Precondición: sesión iniciada y estado base registrado (HU01-HU04).',
                 150, 425, 230, 'f_inicio', [(380, 450), (416, 507)])
    m.annotation(F, 'n_hogar', 'Usa la regla vigente; no espera la respuesta de otros miembros.',
                 815, 620, 220, 'f_aporte', [(815, 645), (735, 645)])

    # Fin de Mes: base state update.
    m.event(F, 'startEvent', 'f_cambio', 'Compromiso recibido', 1720, R1, MSG)
    m.task(F, 'f_recalcula', 'Registrar el compromiso y recalcular la proyección', 1850, R1, 'serviceTask')
    m.event(F, 'endEvent', 'f_actualizada', 'Proyección actualizada', 1980, R1, MSG)
    m.h(F, 'ff9', 'f_cambio', 'f_recalcula')
    m.h(F, 'ff10', 'f_recalcula', 'f_actualizada')

    # Message flows attach to the collapsed sub-process in the main diagram.
    m.message('m1', 'Decisión y parámetros', S2, 'f_inicio', [m.b(S2, -20), m.t('f_inicio')],
              at=(436, 410), lw=100)
    m.message('m2', 'Resultados', 'f_entrega', S2,
              [m.t('f_entrega'), (1360, 380), (470, 380), m.b(S2, 20)], at=(1366, 420), lw=80)
    m.message('m3', 'Nuevo compromiso', 'u_registra', 'f_cambio', [m.b('u_registra'), m.t('f_cambio')],
              at=(1726, 410), lw=90)
    m.message('m4', 'Proyección actualizada', 'f_actualizada', 'u_proy',
              [m.t('f_actualizada'), (1980, 380), (1870, 380), m.b('u_proy')], at=(1886, 410), lw=90)
    return m


# =====================================================================================================
def subscription():
    """Main process 2: buying a plan with Webpay Plus, expiry and reconciliation (HU18-HU20, HU26)."""
    m = Model('suscripcion')
    U, F, A = 'proc_usuario', 'proc_findemes', 'proc_admin'
    W = 1240
    m.pool('pool_usuario', 'Usuario', U, 0, 0, W, 250)
    m.pool('pool_tbk', 'Transbank Webpay Plus', None, 0, 290, W, 80)
    m.pool('pool_findemes', 'Fin de Mes', F, 0, 410, W, 330)
    m.pool('pool_admin', 'Administrador de la plataforma', A, 0, 780, W, 160)
    Y = 125
    m.event(U, 'startEvent', 'u_start', 'Necesita un plan pagado', 90, Y)
    m.task(U, 'u_planes', 'Consultar y comparar los planes', 230, Y, 'userTask')
    m.task(U, 'u_elige', 'Elegir el plan y confirmar la contratación', 400, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_form', 'Formulario de pago', 560, Y, MSG, above=True)
    m.task(U, 'u_tarjeta', 'Ingresar la tarjeta en el formulario de Transbank', 700, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_resultado', 'Resultado del pago', 860, Y, MSG, above=True)
    m.gateway(U, 'u_activo', '¿Plan activado?', 960, Y)
    m.event(U, 'endEvent', 'u_ok', 'Plan pagado activo', 1080, Y)
    m.event(U, 'endEvent', 'u_no', 'Plan anterior vigente', 1080, 205)
    m.h(U, 'fu1', 'u_start', 'u_planes')
    m.h(U, 'fu2', 'u_planes', 'u_elige')
    m.h(U, 'fu3', 'u_elige', 'u_form')
    m.h(U, 'fu4', 'u_form', 'u_tarjeta')
    m.h(U, 'fu5', 'u_tarjeta', 'u_resultado')
    m.h(U, 'fu6', 'u_resultado', 'u_activo')
    m.h(U, 'fu7', 'u_activo', 'u_ok', 'Sí')
    m.down_right(U, 'fu8', 'u_activo', 'u_no', 'No')

    # Fin de Mes: payment.
    Y1 = 520
    m.event(F, 'startEvent', 'f_solicitud', 'Solicitud de contratación', 400, Y1, MSG)
    S = 'sp_pago'
    m.subprocess(F, S, 'Pagar con Webpay Plus', 560 - TASK_W // 2, Y1 - TASK_H // 2, TASK_W, TASK_H, collapsed=True)
    m.plane = S
    P1, P2, P3 = 560, 660, 740
    m.event(S, 'startEvent', 'p_start', '', 500, P1)
    m.task(S, 'p_crear', 'Crear la transacción con una orden de compra única', 620, P1, 'serviceTask')
    m.event(S, 'intermediateCatchEvent', 'p_retorno', 'Retorno de Transbank', 780, P1, MSG)
    m.gateway(S, 'p_abortado', '¿Pago cancelado?', 880, P1, lw=110)
    m.task(S, 'p_anulado', 'Registrar la transacción como anulada', 1000, P3, 'serviceTask')
    m.task(S, 'p_commit', 'Confirmar el pago con Transbank desde el servidor', 1020, P1, 'serviceTask')
    m.gateway(S, 'p_aprobada', '¿Pago aprobado?', 1160, P1, lw=110)
    m.task(S, 'p_activar', 'Activar el período del plan (una sola vez)', 1300, P1, 'serviceTask')
    m.task(S, 'p_rechazo', 'Registrar el rechazo o la diferencia de monto', 1300, P2, 'serviceTask')
    m.gateway(S, 'p_merge2', '', 1440, P2)
    m.gateway(S, 'p_merge1', '', 1440, P1)
    m.event(S, 'endEvent', 'p_end', 'Pago resuelto', 1550, P1)
    m.h(S, 'fp1', 'p_start', 'p_crear')
    m.h(S, 'fp2', 'p_crear', 'p_retorno')
    m.h(S, 'fp3', 'p_retorno', 'p_abortado')
    m.flow(S, 'fp4', 'p_abortado', 'p_anulado', [m.b('p_abortado'), (880, P3), m.l('p_anulado')], 'Sí',
           at=(886, 660))
    m.h(S, 'fp5', 'p_abortado', 'p_commit', 'No')
    m.h(S, 'fp6', 'p_commit', 'p_aprobada')
    m.h(S, 'fp7', 'p_aprobada', 'p_activar', 'Sí')
    m.down_right(S, 'fp8', 'p_aprobada', 'p_rechazo', 'No')
    m.h(S, 'fp9', 'p_rechazo', 'p_merge2')
    m.flow(S, 'fp10', 'p_anulado', 'p_merge2', [m.r('p_anulado'), (1440, P3), m.b('p_merge2')])
    m.h(S, 'fp11', 'p_activar', 'p_merge1')
    m.flow(S, 'fp11b', 'p_merge2', 'p_merge1', [m.t('p_merge2'), m.b('p_merge1')])
    m.flow(S, 'fp12', 'p_merge1', 'p_end', [m.r('p_merge1'), m.l('p_end')])
    m.annotation(S, 'n_idem', 'Restricción única sobre la orden de compra: confirmar dos veces no activa dos '
                              'períodos. Nunca se guardan datos de tarjeta.', 1500, 690, 240, 'p_merge2',
                 [(1500, 700), (1458, 672)])
    m.plane = None
    m.task(F, 'f_informa', 'Informar el resultado al usuario', 860, Y1, 'serviceTask')
    m.event(F, 'endEvent', 'f_fin', 'Solicitud atendida', 990, Y1)
    m.flow(F, 'ff1', 'f_solicitud', S, [m.r('f_solicitud'), m.l(S)])
    m.flow(F, 'ff2', S, 'f_informa', [m.r(S), m.l('f_informa')])
    m.h(F, 'ff3', 'f_informa', 'f_fin')

    # Fin de Mes: expiry and renewal.
    YR = 660
    m.event(F, 'startEvent', 'f_vence', 'Termina el período pagado', 400, YR, TIMER)
    R = 'sp_vencimiento'
    m.subprocess(F, R, 'Vencimiento y renovación', 560 - TASK_W // 2, YR - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = R
    V1, V2 = 900, 970
    m.event(R, 'startEvent', 'v_start', '', 500, V1)
    m.gateway(R, 'v_renovo', '¿Se renovó el plan?', 600, V1, lw=110)
    m.event(R, 'endEvent', 'v_vigente', 'Nuevo período vigente', 720, V1, above=True)
    m.task(R, 'v_gratis', 'Pasar al plan gratuito conservando todos los datos', 760, V2, 'serviceTask')
    m.task(R, 'v_aviso', 'Avisar al usuario por correo', 960, V2, 'sendTask')
    m.event(R, 'endEvent', 'v_end', 'Plan gratuito vigente', 1120, V2)
    m.h(R, 'fv1', 'v_start', 'v_renovo')
    m.h(R, 'fv2', 'v_renovo', 'v_vigente', 'Sí')
    m.down_right(R, 'fv3', 'v_renovo', 'v_gratis', 'No')
    m.h(R, 'fv4', 'v_gratis', 'v_aviso')
    m.h(R, 'fv5', 'v_aviso', 'v_end')
    m.plane = None
    m.event(F, 'endEvent', 'f_vence_fin', 'Suscripción al día', 720, YR)
    m.flow(F, 'ff4', 'f_vence', R, [m.r('f_vence'), m.l(R)])
    m.flow(F, 'ff5', R, 'f_vence_fin', [m.r(R), m.l('f_vence_fin')])

    # Administrator: reconciliation (HU26).
    YA = 860
    m.event(A, 'startEvent', 'a_cierre', 'Cierre del día', 90, YA, TIMER)
    C = 'sp_conciliacion'
    m.subprocess(A, C, 'Conciliar las transacciones de suscripción', 250 - TASK_W // 2, YA - TASK_H // 2, TASK_W,
                 TASK_H, collapsed=True)
    m.plane = C
    C1 = 1215
    m.event(C, 'startEvent', 'c_start', '', 190, C1)
    m.task(C, 'c_revisa', 'Revisar transacciones pendientes, rechazadas o con diferencia', 320, C1, 'userTask')
    m.gateway(C, 'c_dif', '¿Hay diferencias?', 470, C1)
    m.task(C, 'c_regulariza', 'Consultar el estado en Transbank y regularizar', 640, C1, 'userTask')
    m.gateway(C, 'c_merge', '', 800, C1)
    m.task(C, 'c_registra', 'Dejar constancia en la auditoría', 940, C1, 'userTask')
    m.event(C, 'endEvent', 'c_end', '', 1070, C1)
    m.h(C, 'fc1', 'c_start', 'c_revisa')
    m.h(C, 'fc2', 'c_revisa', 'c_dif')
    m.h(C, 'fc3', 'c_dif', 'c_regulariza', 'Sí')
    m.flow(C, 'fc4', 'c_dif', 'c_merge', [m.b('c_dif'), (470, 1285), (800, 1285), m.b('c_merge')], 'No',
           at=(478, 1248))
    m.h(C, 'fc5', 'c_regulariza', 'c_merge')
    m.h(C, 'fc6', 'c_merge', 'c_registra')
    m.h(C, 'fc7', 'c_registra', 'c_end')
    m.plane = None
    m.event(A, 'endEvent', 'a_fin', 'Transacciones conciliadas', 410, YA)
    m.flow(A, 'fa1', 'a_cierre', C, [m.r('a_cierre'), m.l(C)])
    m.flow(A, 'fa2', C, 'a_fin', [m.r(C), m.l('a_fin')])

    # Messages (those of the payment attach to the collapsed sub-process).
    m.message('m1', 'Plan elegido', 'u_elige', 'f_solicitud', [m.b('u_elige'), m.t('f_solicitud')],
              at=(320, 430), lw=75)
    m.message('m2', 'Orden de compra y monto', S, 'pool_tbk', [m.t(S, -60), (500, 370)], at=(415, 385), lw=80)
    m.message('m5', 'Código de retorno', 'pool_tbk', S, [(560, 370), m.t(S)], at=(563, 435), lw=55)
    m.message('m6', 'Confirmación del pago', S, 'pool_tbk', [m.t(S, 60), (620, 370)], at=(628, 385), lw=90)
    m.message('m3', 'Formulario de pago', 'pool_tbk', 'u_form', [(560, 290), m.b('u_form')], at=(462, 235), lw=90)
    m.message('m4', 'Datos de la tarjeta', 'u_tarjeta', 'pool_tbk', [m.b('u_tarjeta'), (700, 290)],
              at=(706, 235), lw=80)
    m.message('m7', 'Estado del plan', 'f_informa', 'u_resultado', [m.t('f_informa'), m.b('u_resultado')],
              at=(866, 385), lw=80)
    return m


# =====================================================================================================
def household():
    """Main process 3: shared household, invitations, common expenses and leaving (HU12-HU16, HU31)."""
    m = Model('hogar')
    A, F, I = 'proc_admin_hogar', 'proc_findemes', 'proc_invitado'
    W = 1900
    m.pool('pool_admin', 'Administrador de hogar', A, 0, 0, W, 380)
    m.pool('pool_findemes', 'Fin de Mes', F, 0, 420, W, 540)
    m.pool('pool_invitado', 'Persona invitada', I, 0, 1000, W, 240)
    Y = 200

    m.event(A, 'startEvent', 'a_start', 'Decide compartir gastos', 70, Y)
    m.task(A, 'a_crear', 'Crear el hogar', 200, Y, 'userTask')

    S1 = 'sp_invitar'
    m.subprocess(A, S1, 'Invitar a un miembro', 370 - TASK_W // 2, Y - TASK_H // 2, TASK_W, TASK_H, collapsed=True)
    m.plane = S1
    I1, I2 = 200, 300
    m.event(S1, 'startEvent', 'i_start', '', 350, I1)
    m.task(S1, 'i_correo', 'Ingresar el correo de la persona invitada', 470, I1, 'userTask')
    m.gateway(S1, 'i_espera', '', 620, I1, kind='eventBasedGateway')
    m.event(S1, 'intermediateCatchEvent', 'i_plazo', '7 días sin respuesta', 730, I1, TIMER, above=True)
    m.task(S1, 'i_decide', 'Decidir si reenviar la invitación', 880, I1, 'userTask')
    m.gateway(S1, 'i_reenvia', '¿Reenviar?', 1010, I1, lw=80, below=True)
    m.event(S1, 'endEvent', 'i_vencida', 'Invitación vencida', 1090, I1)
    m.event(S1, 'intermediateCatchEvent', 'i_acepto', 'Miembro incorporado', 730, I2, MSG, above=True)
    m.event(S1, 'endEvent', 'i_fin', 'Invitación aceptada', 860, I2)
    m.h(S1, 'fi1', 'i_start', 'i_correo')
    m.h(S1, 'fi2', 'i_correo', 'i_espera')
    m.h(S1, 'fi3', 'i_espera', 'i_plazo')
    m.down_right(S1, 'fi4', 'i_espera', 'i_acepto')
    m.h(S1, 'fi5', 'i_plazo', 'i_decide')
    m.h(S1, 'fi6', 'i_decide', 'i_reenvia')
    m.h(S1, 'fi7', 'i_reenvia', 'i_vencida', 'No')
    m.flow(S1, 'fi8', 'i_reenvia', 'i_correo', [m.t('i_reenvia'), (1010, 85), (470, 85), m.t('i_correo')], 'Sí',
           at=(1018, 110))
    m.h(S1, 'fi9', 'i_acepto', 'i_fin')
    m.plane = None
    m.h(A, 'fa1', 'a_start', 'a_crear')
    m.flow(A, 'fa2', 'a_crear', S1, [m.r('a_crear'), m.l(S1)])

    S2 = 'sp_gasto'
    m.subprocess(A, S2, 'Registrar un gasto común y su regla de aporte', 1250 - TASK_W // 2, Y - TASK_H // 2,
                 TASK_W, TASK_H, collapsed=True)
    m.plane = S2
    G1, G0, G2 = 200, 100, 300
    m.event(S2, 'startEvent', 'g_start', '', 1240, G1)
    m.task(S2, 'g_registra', 'Registrar el gasto común (monto y periodicidad)', 1360, G1, 'userTask')
    m.gateway(S2, 'g_tipo', '', 1500, G1)
    m.task(S2, 'g_iguales', 'Repartir en partes iguales (por defecto)', 1680, G0, 'userTask')
    m.task(S2, 'g_porc', 'Fijar porcentajes que suman 100 %', 1680, G1, 'userTask')
    m.task(S2, 'g_asigna', 'Asignar el gasto a un miembro', 1680, G2, 'userTask')
    m.gateway(S2, 'g_merge', '', 1820, G1)
    m.task(S2, 'g_guarda', 'Guardar el gasto y la regla', 1950, G1, 'userTask')
    m.event(S2, 'intermediateCatchEvent', 'g_ok', 'Confirmación recibida', 2080, G1, MSG, above=True)
    m.event(S2, 'endEvent', 'g_end', '', 2160, G1)
    m.h(S2, 'fg1', 'g_start', 'g_registra')
    m.h(S2, 'fg2', 'g_registra', 'g_tipo')
    m.down_right(S2, 'fg3', 'g_tipo', 'g_iguales', 'Iguales', at=(1508, 120))
    m.h(S2, 'fg4', 'g_tipo', 'g_porc', 'Porcentajes')
    m.down_right(S2, 'fg5', 'g_tipo', 'g_asigna', 'Asignado', at=(1508, 245))
    m.right_up(S2, 'fg6', 'g_iguales', 'g_merge')
    m.h(S2, 'fg7', 'g_porc', 'g_merge')
    m.right_up(S2, 'fg8', 'g_asigna', 'g_merge')
    m.h(S2, 'fg9', 'g_merge', 'g_guarda')
    m.h(S2, 'fg10', 'g_guarda', 'g_ok')
    m.h(S2, 'fg11', 'g_ok', 'g_end')
    m.plane = None
    m.flow(A, 'fa3', S1, S2, [m.r(S1), m.l(S2)])
    m.event(A, 'endEvent', 'a_fin', 'Gastos comunes vigentes', 1420, Y)
    m.flow(A, 'fa4', S2, 'a_fin', [m.r(S2), m.l('a_fin')])

    # Fin de Mes: invitation.
    R1 = 520
    m.event(F, 'startEvent', 'f_inv', 'Solicitud de invitación', 350, R1, MSG)
    m.task(F, 'f_enlace', 'Generar un enlace de un solo uso con vigencia de 7 días', 480, R1, 'serviceTask')
    m.task(F, 'f_envia', 'Enviar la invitación por correo', 650, R1, 'sendTask')
    m.event(F, 'intermediateCatchEvent', 'f_aceptada', 'Invitación aceptada', 800, R1, MSG, above=True)
    m.task(F, 'f_incorpora', 'Incorporar a la persona al hogar', 930, R1, 'serviceTask')
    m.event(F, 'endEvent', 'f_inv_fin', 'Miembro incorporado', 1060, R1, MSG)
    m.h(F, 'ff1', 'f_inv', 'f_enlace')
    m.h(F, 'ff2', 'f_enlace', 'f_envia')
    m.h(F, 'ff3', 'f_envia', 'f_aceptada')
    m.h(F, 'ff4', 'f_aceptada', 'f_incorpora')
    m.h(F, 'ff5', 'f_incorpora', 'f_inv_fin')

    # Fin de Mes: common expense.
    m.event(F, 'startEvent', 'f_gasto', 'Gasto y regla recibidos', 1230, R1, MSG)
    m.task(F, 'f_valida', 'Validar la regla de aporte', 1360, R1, 'serviceTask')
    m.gateway(F, 'f_valida_gw', '¿Regla válida?', 1490, R1)
    m.task(F, 'f_suma', 'Sumar el aporte de cada miembro a su proyección individual', 1630, R1, 'serviceTask')
    m.event(F, 'endEvent', 'f_gasto_fin', 'Gasto común vigente', 1770, R1, MSG)
    m.event(F, 'endEvent', 'f_rechazo', 'Regla rechazada', 1490, 620)
    m.h(F, 'ff6', 'f_gasto', 'f_valida')
    m.h(F, 'ff7', 'f_valida', 'f_valida_gw')
    m.h(F, 'ff8', 'f_valida_gw', 'f_suma', 'Sí')
    m.flow(F, 'ff9', 'f_valida_gw', 'f_rechazo', [m.b('f_valida_gw'), m.t('f_rechazo')], 'No', at=(1498, 552))
    m.h(F, 'ff10', 'f_suma', 'f_gasto_fin')
    m.data_store(F, 'f_comun', 'Espacio común del hogar', 1605, 615, lw=120)
    m.writes('f_suma', 'f_comun', [m.b('f_suma'), m.t('f_comun')])
    m.annotation(F, 'n_priv', 'La información fluye del espacio común a cada perfil, nunca al revés: nadie ve los '
                              'ingresos, deudas ni escenarios de otro miembro (HU16).', 1680, 600, 200, 'f_comun',
                 [(1680, 640), (1655, 640)])

    # Fin de Mes: a member leaves.
    YS = 800
    m.event(F, 'startEvent', 'f_sale', 'Solicitud de salida', 1090, YS, MSG)
    S3 = 'sp_salida'
    m.subprocess(F, S3, 'Salida de un miembro', 1250 - TASK_W // 2, YS - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = S3
    E1, E2 = 790, 885
    m.event(S3, 'startEvent', 's_start', '', 1400, E1)
    m.task(S3, 's_quita', 'Quitar a la persona del hogar y de sus reglas', 1520, E1, 'serviceTask')
    m.gateway(S3, 's_admin', '¿Era el administrador?', 1660, E1, lw=100)
    m.task(S3, 's_promueve', 'Promover al miembro más antiguo como administrador', 1800, E2, 'serviceTask')
    m.gateway(S3, 's_merge', '', 1940, E1)
    m.task(S3, 's_reparte', 'Repartir sus aportes en partes iguales entre los demás', 2080, E1, 'serviceTask')
    m.event(S3, 'endEvent', 's_end', '', 2200, E1)
    m.h(S3, 'fs1', 's_start', 's_quita')
    m.h(S3, 'fs2', 's_quita', 's_admin')
    m.down_right(S3, 'fs3', 's_admin', 's_promueve', 'Sí')
    m.h(S3, 'fs4', 's_admin', 's_merge', 'No')
    m.right_up(S3, 'fs5', 's_promueve', 's_merge')
    m.h(S3, 'fs6', 's_merge', 's_reparte')
    m.h(S3, 'fs7', 's_reparte', 's_end')
    m.plane = None
    m.event(F, 'endEvent', 'f_sale_fin', 'Hogar actualizado', 1410, YS)
    m.flow(F, 'ff11', 'f_sale', S3, [m.r('f_sale'), m.l(S3)])
    m.flow(F, 'ff12', S3, 'f_sale_fin', [m.r(S3), m.l('f_sale_fin')])

    # Invited person.
    YI, YI2 = 1100, 1185
    m.event(I, 'startEvent', 'v_recibe', 'Invitación recibida', 650, YI, MSG)
    m.gateway(I, 'v_cuenta', '¿Tiene cuenta?', 750, YI)
    m.task(I, 'v_crea', 'Crear la cuenta y verificar el correo', 880, YI2, 'userTask')
    m.gateway(I, 'v_merge', '', 1000, YI)
    m.task(I, 'v_acepta', 'Aceptar la invitación', 1120, YI, 'userTask')
    m.event(I, 'endEvent', 'v_fin', 'Es miembro del hogar', 1250, YI)
    m.h(I, 'fv1', 'v_recibe', 'v_cuenta')
    m.down_right(I, 'fv2', 'v_cuenta', 'v_crea', 'No')
    m.h(I, 'fv3', 'v_cuenta', 'v_merge', 'Sí')
    m.right_up(I, 'fv4', 'v_crea', 'v_merge')
    m.h(I, 'fv5', 'v_merge', 'v_acepta')
    m.h(I, 'fv6', 'v_acepta', 'v_fin')

    # Messages (those of the sub-processes attach to the collapsed box).
    m.message('m1', 'Correo del invitado', S1, 'f_inv', [m.b(S1, -20), m.t('f_inv')], at=(255, 430), lw=90)
    m.message('m2', 'Invitación con enlace', 'f_envia', 'v_recibe', [m.b('f_envia'), m.t('v_recibe')],
              at=(656, 965), lw=100)
    m.message('m3', 'Aceptación', 'v_acepta', 'f_aceptada',
              [m.t('v_acepta'), (1120, 980), (800, 980), m.b('f_aceptada')], at=(930, 962), lw=70)
    m.message('m4', 'Miembro incorporado', 'f_inv_fin', S1,
              [m.t('f_inv_fin'), (1060, 400), (390, 400), m.b(S1, 20)], at=(830, 350), lw=100)
    m.message('m5', 'Gasto y regla', S2, 'f_gasto', [m.b(S2, -20), m.t('f_gasto')], at=(1150, 385), lw=70)
    m.message('m6', 'Confirmación', 'f_gasto_fin', S2,
              [m.t('f_gasto_fin'), (1770, 400), (1270, 400), m.b(S2, 20)], at=(1520, 382), lw=70)
    return m


# =====================================================================================================
def bank_linking():
    """Support process: link a bank with Fintoc, sync and confirm recurring items, unlink (HU36, ADR-002)."""
    m = Model('vinculacion')
    U, F = 'proc_usuario', 'proc_findemes'
    W = 1800
    m.pool('pool_usuario', 'Usuario', U, 0, 0, W, 380)
    m.pool('pool_fintoc', 'Fintoc', None, 0, 420, W, 80)
    m.pool('pool_findemes', 'Fin de Mes', F, 0, 560, W, 220)
    Y = 200

    m.event(U, 'startEvent', 'u_start', 'Quiere conectar su banco', 90, Y)
    m.task(U, 'u_inicia', 'Iniciar la vinculación de un banco', 220, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_widget', 'Ventana de Fintoc', 470, Y, MSG, above=True)
    m.task(U, 'u_clave', 'Elegir el banco e ingresar la clave en la ventana de Fintoc', 610, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_movs', 'Movimientos sugeridos', 760, Y, MSG, above=True)
    m.h(U, 'fu1', 'u_start', 'u_inicia')
    m.h(U, 'fu2', 'u_inicia', 'u_widget')
    m.h(U, 'fu3', 'u_widget', 'u_clave')
    m.h(U, 'fu4', 'u_clave', 'u_movs')

    S = 'sp_confirmar'
    m.subprocess(U, S, 'Confirmar movimientos recurrentes', 900 - TASK_W // 2, Y - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = S
    m.event(S, 'startEvent', 'c_start', '', 830, Y)
    m.gateway(S, 'c_merge', '', 910, Y)
    m.task(S, 'c_revisa', 'Revisar el siguiente movimiento sugerido', 1040, Y, 'userTask')
    m.gateway(S, 'c_rec', '¿Es recurrente?', 1180, Y, lw=90, at=(1210, 210))
    m.task(S, 'c_fijo', 'Clasificarlo como ingreso o gasto fijo', 1320, 110, 'userTask')
    m.task(S, 'c_puntual', 'Dejarlo como movimiento puntual', 1320, 290, 'userTask')
    m.gateway(S, 'c_merge2', '', 1430, Y)
    m.gateway(S, 'c_quedan', '¿Quedan movimientos?', 1505, Y, lw=100)
    m.event(S, 'endEvent', 'c_end', '', 1585, Y)
    m.h(S, 'fc1', 'c_start', 'c_merge')
    m.h(S, 'fc2', 'c_merge', 'c_revisa')
    m.h(S, 'fc3', 'c_revisa', 'c_rec')
    m.down_right(S, 'fc4', 'c_rec', 'c_fijo', 'Sí')
    m.down_right(S, 'fc5', 'c_rec', 'c_puntual', 'No')
    m.right_up(S, 'fc6', 'c_fijo', 'c_merge2')
    m.right_up(S, 'fc7', 'c_puntual', 'c_merge2')
    m.h(S, 'fc8', 'c_merge2', 'c_quedan')
    m.flow(S, 'fc9', 'c_quedan', 'c_merge', [m.b('c_quedan'), (1505, 345), (910, 345), m.b('c_merge')], 'Sí',
           at=(1513, 240))
    m.h(S, 'fc10', 'c_quedan', 'c_end', 'No', at=(1532, 182))
    m.plane = None
    m.flow(U, 'fu5', 'u_movs', S, [m.r('u_movs'), m.l(S)])
    m.event(U, 'endEvent', 'u_fin', 'Estado base actualizado', 1050, Y)
    m.flow(U, 'fu6', S, 'u_fin', [m.r(S), m.l('u_fin')])
    m.annotation(U, 'n_clave', 'La clave bancaria va directo a Fintoc: nunca pasa por Fin de Mes.',
                 500, 30, 220, 'u_clave', [(610, 68), m.t('u_clave')])

    m.event(U, 'startEvent', 'u_quiere', 'Decide desvincular', 1170, Y)
    m.task(U, 'u_desvincula', 'Solicitar la desvinculación', 1300, Y, 'userTask')
    m.event(U, 'intermediateCatchEvent', 'u_ok', 'Desvinculación confirmada', 1610, Y, MSG, above=True)
    m.event(U, 'endEvent', 'u_fin2', 'Banco desvinculado', 1720, Y)
    m.h(U, 'fu7', 'u_quiere', 'u_desvincula')
    m.h(U, 'fu8', 'u_desvincula', 'u_ok')
    m.h(U, 'fu9', 'u_ok', 'u_fin2')

    # Fin de Mes.
    YF = 680
    m.event(F, 'startEvent', 'f_solicitud', 'Solicitud de vinculación', 220, YF, MSG)
    V = 'sp_vincular'
    m.subprocess(F, V, 'Vincular el banco', 450 - TASK_W // 2, YF - TASK_H // 2, TASK_W, TASK_H, collapsed=True)
    m.plane = V
    m.event(V, 'startEvent', 'v_start', '', 320, YF)
    m.task(V, 'v_intent', 'Solicitar a Fintoc el inicio del vínculo', 430, YF, 'serviceTask')
    m.event(V, 'intermediateCatchEvent', 'v_token', 'Vínculo creado', 620, YF, MSG)
    m.task(V, 'v_cifra', 'Guardar cifrada la credencial del vínculo', 760, YF, 'serviceTask')
    m.event(V, 'endEvent', 'v_end', '', 880, YF)
    m.h(V, 'fv1', 'v_start', 'v_intent')
    m.h(V, 'fv2', 'v_intent', 'v_token')
    m.h(V, 'fv3', 'v_token', 'v_cifra')
    m.h(V, 'fv4', 'v_cifra', 'v_end')
    m.plane = None
    Z = 'sp_sincronizar'
    m.subprocess(F, Z, 'Sincronizar movimientos', 680 - TASK_W // 2, YF - TASK_H // 2, TASK_W, TASK_H,
                 collapsed=True)
    m.plane = Z
    m.event(Z, 'startEvent', 'z_start', '', 1030, YF)
    m.task(Z, 'z_lee', 'Leer cuentas y movimientos en pesos (CLP)', 1150, YF, 'serviceTask')
    m.task(Z, 'z_dedup', 'Descartar duplicados y rotular el origen del dato', 1320, YF, 'serviceTask')
    m.task(Z, 'z_sugiere', 'Sugerir los movimientos que se repiten', 1490, YF, 'serviceTask')
    m.event(Z, 'endEvent', 'z_end', '', 1610, YF)
    m.h(Z, 'fz1', 'z_start', 'z_lee')
    m.h(Z, 'fz2', 'z_lee', 'z_dedup')
    m.h(Z, 'fz3', 'z_dedup', 'z_sugiere')
    m.h(Z, 'fz4', 'z_sugiere', 'z_end')
    m.data_store(Z, 'f_datos', 'Cuentas y movimientos', 1295, 800, lw=120)
    m.writes('z_dedup', 'f_datos', [m.b('z_dedup'), m.t('f_datos')])
    m.plane = None
    m.event(F, 'endEvent', 'f_movs', 'Movimientos sugeridos', 840, YF, MSG)
    m.flow(F, 'ff1', 'f_solicitud', V, [m.r('f_solicitud'), m.l(V)])
    m.flow(F, 'ff2', V, Z, [m.r(V), m.l(Z)])
    m.flow(F, 'ff3', Z, 'f_movs', [m.r(Z), m.l('f_movs')])

    m.event(F, 'startEvent', 'f_desv', 'Solicitud de desvinculación', 1300, YF, MSG)
    D = 'sp_desvincular'
    m.subprocess(F, D, 'Desvincular el banco', 1450 - TASK_W // 2, YF - TASK_H // 2, TASK_W, TASK_H, collapsed=True)
    m.plane = D
    m.event(D, 'startEvent', 'd_start', '', 2030, 880)
    m.task(D, 'd_revoca', 'Revocar el vínculo en Fintoc', 2150, 880, 'serviceTask')
    m.task(D, 'd_borra', 'Borrar la credencial cifrada', 2330, 880, 'serviceTask')
    m.event(D, 'endEvent', 'd_end', '', 2450, 880)
    m.h(D, 'fd1', 'd_start', 'd_revoca')
    m.h(D, 'fd2', 'd_revoca', 'd_borra')
    m.h(D, 'fd3', 'd_borra', 'd_end')
    m.plane = None
    m.flow(F, 'ff4', 'f_desv', D, [m.r('f_desv'), m.l(D)])
    m.event(F, 'endEvent', 'f_desv_fin', 'Desvinculación confirmada', 1610, YF, MSG)
    m.flow(F, 'ff5', D, 'f_desv_fin', [m.r(D), m.l('f_desv_fin')])

    # Messages (those of the sub-processes attach to the collapsed box).
    m.message('m1', 'Solicitud', 'u_inicia', 'f_solicitud', [m.b('u_inicia'), m.t('f_solicitud')],
              at=(226, 525), lw=60)
    m.message('m3', 'Intención de vínculo', V, 'pool_fintoc', [m.t(V, -40), (410, 500)], at=(330, 525), lw=70)
    m.message('m2', 'Ventana de Fintoc', V, 'u_widget', [m.t(V, 20), m.b('u_widget')],
              at=(476, 300), lw=70)
    m.message('m5', 'Credencial del vínculo', 'pool_fintoc', V, [(510, 500), (510, 640)], at=(516, 525), lw=80)
    m.message('m4', 'Clave bancaria', 'u_clave', 'pool_fintoc', [m.b('u_clave'), (610, 420)], at=(616, 300),
              lw=70)
    m.message('m6', 'Consulta de movimientos', Z, 'pool_fintoc', [m.t(Z), (680, 500)], at=(690, 572), lw=100)
    m.message('m7', 'Movimientos sugeridos', 'f_movs', 'u_movs', [m.t('f_movs'), (840, 530), (760, 530),
              m.b('u_movs')], at=(766, 300), lw=90)
    m.message('m8', 'Solicitud', 'u_desvincula', 'f_desv', [m.b('u_desvincula'), m.t('f_desv')],
              at=(1306, 525), lw=60)
    m.message('m9', 'Revocación', D, 'pool_fintoc', [m.t(D), (1450, 500)], at=(1456, 525), lw=70)
    m.message('m10', 'Confirmación', 'f_desv_fin', 'u_ok', [m.t('f_desv_fin'), m.b('u_ok')], at=(1616, 300),
              lw=70)
    return m


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for fname, model in [('proceso-decision-as-is.bpmn', as_is()), ('proceso-decision-to-be.bpmn', to_be()),
                         ('proceso-suscripcion.bpmn', subscription()), ('proceso-hogar.bpmn', household()),
                         ('proceso-vinculacion-bancaria.bpmn', bank_linking())]:
        with open(os.path.join(out, fname), 'w', encoding='utf-8', newline='\n') as f:
            f.write(model.xml())
        print(fname)
        for sid in model.subplanes:
            sub = fname.replace('.bpmn', '__%s.bpmn' % sid.replace('sp_', ''))
            with open(os.path.join(out, sub), 'w', encoding='utf-8', newline='\n') as f:
                f.write(model.standalone_xml(sid))
            print(sub)


if __name__ == '__main__':
    main()

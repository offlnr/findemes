"""Generate the adjusted Gantt chart (informe 2, chapter VII) as a native draw.io file.

The team works with Kanban + XP: phases F1-F4 are delivery milestones with a definition of done, not sprints.

usage: python -I generate_gantt.py <out_dir>
"""
import datetime as dt
import html
import os
import sys

START = dt.date(2026, 10, 19)
END = dt.date(2026, 12, 1)
# Weekly header with day-accurate bars: a narrow day column leaves room for print-size text.
DAY_W = 16
ROW_H = 36
NAME_W, WHO_W, DATE_W = 570, 140, 150
X0 = 20 + NAME_W + WHO_W + DATE_W
HOLIDAYS = {dt.date(2026, 10, 31), dt.date(2026, 11, 1)}   # Día de las Iglesias Evangélicas, Todos los Santos

# (id, name, responsible, start, end (inclusive), critical, depends on)
PHASES = [
    ('F1 · Motor de simulación (ruta crítica)', [
        ('T11', '1.1 Proyección y cinco tipos de decisión con TDD', 'M. Lizana', (10, 19), (10, 26), True, []),
        ('T12', '1.2 Indicadores, comparación y explicación', 'M. Lizana', (10, 27), (10, 30), True, ['T11']),
        ('T13', '1.3 Endpoint de demostración y pipeline de CI', 'M. Lizana', (10, 27), (10, 30), False, []),
        ('T14', '1.4 Diagramas pendientes y cierre del informe 2', 'J. Varas', (10, 19), (10, 23), False, []),
        ('T15', '1.5 Pruebas CP-01 a CP-06', 'M. Lizana', (10, 29), (10, 30), False, []),
        ('M1', 'Hito: fin de F1', '', (10, 30), (10, 30), True, []),
    ]),
    ('F2 · API y aplicación web (ruta crítica)', [
        ('T21', '2.1 Identidad, sesiones y registro financiero en la API', 'M. Lizana', (11, 2), (11, 8), True,
         ['T12']),
        ('T22', '2.2 Escenarios, límite del plan, Fintoc y banco de demostración', 'M. Lizana', (11, 9), (11, 13),
         True, ['T21']),
        ('T23', '2.3 App web conectada a la API (cliente OpenAPI)', 'J. Varas', (11, 2), (11, 13), True, []),
        ('T24', '2.4 Pruebas CP-07, CP-13 y CP-14', 'Ambos', (11, 12), (11, 13), False, []),
        ('M2', 'Hito: fin de F2', '', (11, 13), (11, 13), True, []),
    ]),
    ('F3 · Hogar, suscripción y móviles (con holgura)', [
        ('T31', '3.1 Hogar y reglas de aporte con privacidad verificada', 'M. Lizana', (11, 16), (11, 19), False, []),
        ('T32', '3.2 Planes y pago con Webpay Plus', 'M. Lizana', (11, 19), (11, 22), False, []),
        ('T33', '3.3 Interfaz de hogar y planes; compilación Android', 'J. Varas', (11, 16), (11, 22), False, []),
        ('T34', '3.4 Panel de administración mínimo con TOTP', 'M. Lizana', (11, 20), (11, 22), False, []),
        ('T35', '3.5 Pruebas CP-08 a CP-11', 'Ambos', (11, 21), (11, 22), False, []),
        ('T36', '3.6 Reclutamiento de participantes para la validación', 'J. Varas', (11, 16), (11, 22), False, []),
        ('M3', 'Hito: fin de F3', '', (11, 22), (11, 22), False, []),
    ]),
    ('F4 · Validación y cierre (ruta crítica)', [
        ('T41', '4.1 Validación con 8 a 12 usuarios (CP-15)', 'Ambos', (11, 23), (11, 27), True,
         ['T22', 'T23', 'T36']),
        ('T42', '4.2 Corrección de defectos y pruebas de regresión', 'Ambos', (11, 26), (11, 29), True, ['T41']),
        ('T43', '4.3 Documentación final, lecciones aprendidas y acta', 'Ambos', (11, 28), (12, 1), True, ['T42']),
        ('M4', 'Hito: cierre del proyecto (01-12-2026)', '', (12, 1), (12, 1), True, []),
    ]),
]
MONTHS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
          'noviembre', 'diciembre']
WD = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']

TXT = 'text;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;fontSize=16;fontColor=#222222;spacingLeft=6;'
HEAD = ('rounded=0;html=1;whiteSpace=wrap;fillColor=#595959;strokeColor=#595959;fontColor=#FFFFFF;fontSize=15;'
        'fontStyle=1;align=center;verticalAlign=middle;')
CELL = 'rounded=0;html=1;fillColor=%s;strokeColor=#E0E0E0;'
BAR = 'rounded=1;arcSize=20;html=1;fillColor=#63BEF2;strokeColor=#2086C9;'
BAR_CRIT = 'rounded=1;arcSize=20;html=1;fillColor=#F1948A;strokeColor=#C0392B;strokeWidth=1.5;'
MILE = 'rhombus;html=1;fillColor=#222222;strokeColor=#222222;'
PHASE = ('rounded=0;html=1;whiteSpace=wrap;fillColor=#D9E2EC;strokeColor=#D9E2EC;fontColor=#1B2A38;fontSize=17;'
         'fontStyle=1;align=left;verticalAlign=middle;spacingLeft=6;')
DEP = ('endArrow=blockThin;endFill=1;endSize=6;html=1;strokeColor=#7A1F15;strokeWidth=1;rounded=0;'
       'edgeStyle=orthogonalEdgeStyle;')


class Sheet:
    def __init__(self):
        self.cells = []
        self.n = 0
        self.box = {}

    def add(self, value, style, x, y, w, h, cid=None):
        self.n += 1
        cid = cid or 'c%d' % self.n
        self.cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1"><mxGeometry x="%d" y="%d" '
                          'width="%d" height="%d" as="geometry"/></mxCell>'
                          % (cid, html.escape(value, quote=True), style, x, y, w, h))
        self.box[cid] = (x, y, w, h)
        return cid

    def edge(self, src, tgt, pts):
        self.n += 1
        p = ''.join('<mxPoint x="%d" y="%d"/>' % q for q in pts)
        self.cells.append('<mxCell id="e%d" style="%s" edge="1" parent="1" source="%s" target="%s"><mxGeometry '
                          'relative="1" as="geometry"><Array as="points">%s</Array></mxGeometry></mxCell>'
                          % (self.n, DEP, src, tgt, p))


def xday(d):
    return X0 + (d - START).days * DAY_W


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    s = Sheet()
    days = (END - START).days + 1
    s.add('<b style="font-size:24px">Carta Gantt ajustada · Fin de Mes</b><br>Planificación por fases del 19-10-2026 '
          'al 01-12-2026 · Kanban con prácticas XP · las fases son hitos de entrega, no sprints',
          TXT, 20, 10, 1500, 64)
    y = 90
    # Headers: months and days.
    s.add('Actividad', HEAD, 20, y, NAME_W, 2 * ROW_H)
    s.add('Responsable', HEAD, 20 + NAME_W, y, WHO_W, 2 * ROW_H)
    s.add('Fechas', HEAD, 20 + NAME_W + WHO_W, y, DATE_W, 2 * ROW_H)
    d = START
    while d <= END:
        last = min(END, dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1) - dt.timedelta(days=1))
        label = '%s %d' % (MONTHS[d.month], d.year) if (last - d).days >= 8 else ''
        s.add(label, HEAD, xday(d), y, (last - d).days * DAY_W + DAY_W, ROW_H)
        d = last + dt.timedelta(days=1)
    week, n = START, 1
    while week <= END:
        span = min(7, (END - week).days + 1)
        s.add('S%d · %s' % (n, week.strftime('%d-%m')) if span >= 5 else '', HEAD, xday(week), y + ROW_H,
              span * DAY_W, ROW_H)
        week += dt.timedelta(days=7)
        n += 1
    y += 2 * ROW_H
    rows = []
    for phase, tasks in PHASES:
        rows.append(('phase', phase))
        rows += [('task', t) for t in tasks]
    top = y
    for kind, item in rows:
        if kind == 'phase':
            s.add(item, PHASE, 20, y, NAME_W + WHO_W + DATE_W + days * DAY_W, ROW_H)
            y += ROW_H
            continue
        tid, name, who, a, b, crit, deps = item
        da, db = dt.date(2026, *a), dt.date(2026, *b)
        for i in range(days):
            d = START + dt.timedelta(days=i)
            fill = '#F2F2F2' if d.weekday() >= 5 or d in HOLIDAYS else '#FFFFFF'
            s.add('', CELL % fill, xday(d), y, DAY_W, ROW_H)
        s.add(('<b>%s</b>' % name) if tid.startswith('M') else name, TXT, 20, y, NAME_W, ROW_H)
        s.add(who, TXT, 20 + NAME_W, y, WHO_W, ROW_H)
        dates = da.strftime('%d-%m') if da == db else '%s al %s' % (da.strftime('%d-%m'), db.strftime('%d-%m'))
        s.add(dates, TXT, 20 + NAME_W + WHO_W, y, DATE_W, ROW_H)
        if tid.startswith('M'):
            s.add('', MILE, xday(db) + DAY_W // 2 - 11, y + 7, 22, 22, tid)
        else:
            s.add('', BAR_CRIT if crit else BAR, xday(da) + 1, y + 8, (db - da).days * DAY_W + DAY_W - 2, 20, tid)
        item_deps = deps
        y += ROW_H
        for dep in item_deps:
            sx, sy, sw, sh = s.box[dep]
            tx, ty, tw, th = s.box[tid]
            s.edge(dep, tid, [(sx + sw + 6, sy + sh // 2), (sx + sw + 6, ty + th // 2)])
    # Legend.
    y += 20
    s.add('', BAR_CRIT, 20, y + 8, 44, 20)
    s.add('Ruta crítica (F1 → F2 → F4)', TXT, 68, y, 260, ROW_H)
    s.add('', BAR, 340, y + 8, 44, 20)
    s.add('Actividad con holgura', TXT, 388, y, 210, ROW_H)
    s.add('', MILE, 610, y + 7, 22, 22)
    s.add('Hito de cierre de fase', TXT, 636, y, 210, ROW_H)
    s.add('', CELL % '#F2F2F2', 860, y + 6, 26, 24)
    s.add('Fin de semana o feriado (31-10 y 01-11)', TXT, 890, y, 420, ROW_H)
    s.add('S = semana, con la fecha de su lunes. Las flechas indican dependencias fin-comienzo de la ruta crítica.',
          TXT, 20, y + ROW_H, 1300, ROW_H)
    xml = ('<mxfile host="drawio"><diagram name="gantt-fases" id="gantt-fases"><mxGraphModel grid="0" page="0">'
           '<root><mxCell id="0"/><mxCell id="1" parent="0"/>%s</root></mxGraphModel></diagram></mxfile>'
           % ''.join(s.cells))
    path = os.path.join(out, 'gantt-fases.drawio')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(xml)
    print(path, top)


if __name__ == '__main__':
    main()

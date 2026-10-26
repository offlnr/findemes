"""Generate the four C4 diagrams of Fin de Mes as native draw.io files, with explicit edge routing.

usage: python -I c4gen.py <out_dir>
"""
import html
import os
import re
import sys

DATE = '25-10-2026'
# Deployment and topology views were updated to show the security groups (firewall).
DATE_NET = '25-10-2026'

PERSON = ('html=1;fontSize=11;whiteSpace=wrap;fillColor=#083F75;strokeColor=#06315C;fontColor=#ffffff;'
          'shape=mxgraph.c4.person2;align=center;verticalAlign=bottom;spacingBottom=14;spacingLeft=12;'
          'spacingRight=12;metaEdit=1;')
BOX = ('rounded=1;whiteSpace=wrap;html=1;arcSize=6;absoluteArcSize=1;labelBackgroundColor=none;'
       'align=center;verticalAlign=middle;spacing=8;fontSize=11;')
SYSTEM = BOX + 'fillColor=#1061B0;strokeColor=#0D5091;fontColor=#ffffff;'
EXTERNAL = BOX + 'fillColor=#8C8496;strokeColor=#736782;fontColor=#ffffff;'
CONTAINER = BOX + 'fillColor=#23A2D9;strokeColor=#0E7DAD;fontColor=#ffffff;'
COMPONENT = BOX + 'fillColor=#63BEF2;strokeColor=#2086C9;fontColor=#000000;'
CORE = BOX + 'fillColor=#FFE699;strokeColor=#B8860B;strokeWidth=3;fontColor=#000000;spacing=14;'
PORT = BOX + 'fillColor=#FFFFFF;strokeColor=#2086C9;fontColor=#000000;dashed=1;dashPattern=4 3;spacing=2;fontSize=10;'
DB = ('shape=cylinder3;size=14;boundedLbl=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;'
      'fillColor=#23A2D9;strokeColor=#0E7DAD;fontColor=#ffffff;fontSize=11;spacing=6;')
PLANNED = 'dashed=1;dashPattern=8 4;'
BOUNDARY = ('rounded=1;arcSize=2;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#666666;'
            'fontColor=#333333;dashed=1;dashPattern=8 4;align=left;verticalAlign=bottom;spacing=10;fontSize=11;'
            'container=1;collapsible=0;pointerEvents=0;')
ADMIN_BOUNDARY = BOUNDARY.replace('#666666', '#D68910').replace('#333333', '#A6610A')
BAND = ('rounded=0;whiteSpace=wrap;html=1;fillColor=#F4F8FB;strokeColor=#C9D6E2;fontColor=#33506B;'
        'align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fontSize=11;fontStyle=1;'
        'container=1;collapsible=0;pointerEvents=0;')
NODE = ('rounded=1;arcSize=1;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B6770;'
        'fontColor=#222222;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;fontSize=11;'
        'container=1;collapsible=0;pointerEvents=0;')
NODE_GRAY = NODE.replace('fillColor=#FFFFFF', 'fillColor=#F6F7F8')
NODE_UNTRUSTED = NODE.replace('strokeColor=#5B6770', 'strokeColor=#C0392B;dashed=1;dashPattern=10 5;strokeWidth=2')
NODE_ADMIN = NODE.replace('strokeColor=#5B6770', 'strokeColor=#D68910;strokeWidth=2')
NOTE = ('rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFBE6;strokeColor=#D6B656;fontColor=#333333;'
        'align=left;verticalAlign=top;spacing=8;fontSize=10;')
TEXT = 'text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontColor=#333333;'
# Firewall boundary: an AWS security group around the resource it protects.
FIREWALL = ('rounded=1;arcSize=2;absoluteArcSize=1;whiteSpace=wrap;html=1;fillColor=#FDF2F1;strokeColor=#B03A2E;'
            'fontColor=#922B21;dashed=1;dashPattern=4 3;strokeWidth=2;align=left;verticalAlign=top;spacingLeft=8;'
            'spacingTop=2;fontSize=10;container=1;collapsible=0;pointerEvents=0;')

REL = ('endArrow=blockThin;endFill=1;endSize=10;html=1;fontSize=10;fontColor=#404040;strokeColor=#707070;'
       'strokeWidth=1.2;rounded=1;arcSize=8;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jumpStyle=arc;'
       'jumpSize=10;labelBackgroundColor=#FFFFFF;')
REL_ADMIN = REL.replace('strokeColor=#707070', 'strokeColor=#D68910').replace('strokeWidth=1.2', 'strokeWidth=2')
REL_BROWSER = REL.replace('strokeColor=#707070', 'strokeColor=#1F77B4') + 'dashed=1;dashPattern=6 4;'
REL_SECRET = REL.replace('strokeColor=#707070', 'strokeColor=#C0392B').replace('strokeWidth=1.2', 'strokeWidth=2')
REL_IMPL = ('endArrow=block;endFill=0;endSize=10;html=1;dashed=1;dashPattern=6 4;strokeColor=#6C4AB6;'
            'strokeWidth=1.2;rounded=1;arcSize=8;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jumpStyle=arc;'
            'jumpSize=10;fontSize=10;fontColor=#6C4AB6;labelBackgroundColor=#FFFFFF;')
REL_FAINT = REL.replace('strokeColor=#707070', 'strokeColor=#A0A0A0') + 'dashed=1;dashPattern=2 3;'


TEXT_K = 1.0  # text multiplier for the current view (set by each builder)


def e(s):
    return html.escape(s, quote=True)


def c4(name, kind, desc='', size=12):
    out = '<b style="font-size:%dpx">%s</b><br><span style="font-size:%dpx">[%s]</span>' % (
        round(size * TEXT_K), name, round(10 * TEXT_K), kind)
    if desc:
        out += '<br><br>' + desc
    return out


def node_label(name, kind, extra=''):
    out = '<b>%s</b><br><span style="font-size:%dpx">[%s]</span>' % (name, round(10 * TEXT_K), kind)
    if extra:
        out += '<br><span style="font-size:%dpx">%s</span>' % (round(10 * TEXT_K), extra)
    return out


class Diagram:
    def __init__(self, name):
        self.name = name
        self.cells = []
        self.abs = {'1': (0, 0)}
        self.geo = {}
        self.parent_of = {'1': None}
        self.n = 0
        self.font_scale = 1.0
        self.text_k = 1.0

    def add(self, cid, value, style, x, y, w, h, parent='1'):
        if self.text_k != 1.0:
            style = re.sub(r'fontSize=(\d+)', lambda m: 'fontSize=%d' % round(int(m.group(1)) * self.text_k), style)
        px, py = self.abs[parent]
        self.abs[cid] = (x, y)
        self.geo[cid] = (x, y, w, h)
        self.parent_of[cid] = parent
        self.cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="%s">'
                          '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                          % (cid, e(value), style, parent, x - px, y - py, w, h))
        return cid

    def _ancestors(self, cid):
        out = []
        while cid is not None:
            out.append(cid)
            cid = self.parent_of[cid]
        return out

    def fx(self, cid, x):
        """Horizontal fraction of absolute x on cell cid."""
        gx, _, gw, _ = self.geo[cid]
        return round((x - gx) / gw, 4)

    def fy(self, cid, y):
        _, gy, _, gh = self.geo[cid]
        return round((y - gy) / gh, 4)

    def rel(self, src, tgt, text='', tech='', style=REL, exit=None, entry=None, pts=None, lpos=None):
        """exit/entry: (fx, fy) fractions; pts: absolute waypoints; lpos: label position -1..1 along edge."""
        self.n += 1
        a = self._ancestors(self.parent_of[src])
        b = set(self._ancestors(self.parent_of[tgt]))
        parent = next(x for x in a if x in b)
        st = style
        if self.font_scale != 1.0:
            st = st.replace('fontSize=10', 'fontSize=%d' % round(10 * self.font_scale))
        if exit:
            st += 'exitX=%s;exitY=%s;exitDx=0;exitDy=0;' % exit
        if entry:
            st += 'entryX=%s;entryY=%s;entryDx=0;entryDy=0;' % entry
        value = text if not tech else '%s<br><span style="font-size:%dpx">[%s]</span>' % (
            text, round(9 * self.font_scale), tech)
        ox, oy = self.abs[parent]
        geo = '<mxGeometry relative="1" as="geometry"%s>' % (' x="%s"' % lpos if lpos is not None else '')
        if pts:
            geo += '<Array as="points">%s</Array>' % ''.join(
                '<mxPoint x="%d" y="%d"/>' % (px - ox, py - oy) for px, py in pts)
        geo += '</mxGeometry>'
        self.cells.append('<mxCell id="r%d" value="%s" style="%s" edge="1" parent="%s" source="%s" target="%s">%s'
                          '</mxCell>' % (self.n, e(value), st, parent, src, tgt, geo))

    def title(self, title, subtitle, x=40, y=20, w=1400):
        self.add('title', '<span style="font-size:%dpx"><b>%s</b></span><br><span style="font-size:%dpx">%s</span>'
                 % (round(20 * self.font_scale), title, round(12 * self.font_scale), subtitle), TEXT, x, y, w,
                 round(60 * self.font_scale))

    def legend(self, x, y, items, w=330):
        step = round(34 * self.font_scale)
        h = 40 + step * len(items)
        self.add('legend', '<b>Leyenda</b>', BAND.replace('#F4F8FB', '#FFFFFF'), x, y, w, h)
        for i, (kind, label) in enumerate(items):
            yy = y + step + step * i
            sid = 'lg%d' % i
            if kind.startswith('edge:'):
                self.add(sid + 'a', '', 'text;', x + 14, yy + 12, 1, 2, 'legend')
                self.add(sid + 'b', '', 'text;', x + 84, yy + 12, 1, 2, 'legend')
                self.rel(sid + 'a', sid + 'b', style=kind[5:])
            else:
                self.add(sid + 's', '', kind, x + 14, yy, 70, 26, 'legend')
            self.add(sid + 't', label, TEXT + 'verticalAlign=middle;fontSize=%d;' % round(10 * self.font_scale),
                     x + 96, yy - 2, w - 106, 30,
                     'legend')

    def write(self, out_dir):
        xml = ('<mxfile host="drawio"><diagram name="%s" id="%s"><mxGraphModel adaptiveColors="auto" grid="0" '
               'page="0" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>%s'
               '</root></mxGraphModel></diagram></mxfile>' % (self.name, self.name, ''.join(self.cells)))
        path = os.path.join(out_dir, self.name + '.drawio')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(xml)
        return path


def bottom(d, cid, x):
    return (d.fx(cid, x), 1)


def top(d, cid, x):
    return (d.fx(cid, x), 0)


def left(d, cid, y):
    return (0, d.fy(cid, y))


def right(d, cid, y):
    return (1, d.fy(cid, y))


# =====================================================================================
def context():
    d = Diagram('c4-1-contexto')
    global TEXT_K
    TEXT_K = 1.3
    d.text_k = d.font_scale = 1.3
    d.title('[Diagrama de contexto del sistema] Fin de Mes',
            'Nivel 1 del modelo C4 · ambiente de integración · ' + DATE)
    PW, PH, PY = 240, 240, 100
    d.add('usr', c4('Usuario registrado', 'Persona', 'Registra su situación financiera y simula decisiones.'),
          PERSON, 420, PY, PW, PH)
    d.add('vis', c4('Visitante', 'Persona', 'Prueba el simulador y conoce los planes sin crear cuenta.'),
          PERSON, 720, PY, PW, PH)
    d.add('mem', c4('Miembro del hogar', 'Persona', 'Comparte gastos comunes; sus datos individuales siguen '
                    'siendo privados.'), PERSON, 1020, PY, PW, PH)
    d.add('adm', c4('Administrador de la plataforma', 'Persona', 'Operador interno del equipo.'),
          PERSON, 1320, PY, PW, PH)
    d.add('sys', c4('Fin de Mes', 'Sistema de software',
                    'Registra ingresos, gastos y deudas, proyecta el saldo mes a mes y simula decisiones con una '
                    'explicación.<br>Describe efectos: no recomienda, no mueve dinero y no almacena tarjetas.', 16),
          SYSTEM, 560, 520, 1000, 200)
    d.add('fin', c4('Fintoc', 'Sistema externo · modo de prueba',
                    'Agregador bancario chileno. Su widget recibe la clave bancaria del usuario; entrega cuentas y '
                    'movimientos de solo lectura.'), EXTERNAL, 40, 520, 360, 200)
    d.add('tbk', c4('Transbank Webpay Plus', 'Sistema externo · ambiente de integración',
                    'Pasarela de pago. Recibe los datos de tarjeta en su propio formulario.'),
          EXTERNAL, 400, 900, 400, 170)
    d.add('mail', c4('Amazon SES', 'Sistema externo · correo transaccional',
                     'Entrega a los usuarios correos de verificación, restablecimiento e invitación.'),
          EXTERNAL, 1160, 900, 400, 170)

    lane = 480
    d.rel('usr', 'sys', 'Registra su situación,<br>simula decisiones y<br>compara escenarios', 'HTTPS',
          exit=bottom(d, 'usr', 600), entry=top(d, 'sys', 600))
    d.rel('usr', 'fin', 'Ingresa su clave<br>bancaria en el widget', 'HTTPS', REL_SECRET,
          exit=left(d, 'usr', 300), entry=top(d, 'fin', 220), pts=[(220, 300)])
    d.rel('usr', 'tbk', 'Paga el plan<br>en el formulario', 'HTTPS', REL_BROWSER,
          exit=bottom(d, 'usr', lane), entry=top(d, 'tbk', lane), lpos=-0.62)
    for p in ('vis', 'mem'):
        cx = d.geo[p][0] + PW // 2
        txt = {'vis': ('Prueba el modo<br>demostración y<br>consulta los planes', 'HTTPS'),
               'mem': ('Registra gastos<br>comunes y reglas<br>de aporte', 'HTTPS')}[p]
        d.rel(p, 'sys', txt[0], txt[1], exit=bottom(d, p, cx), entry=top(d, 'sys', cx))
    d.rel('adm', 'sys', 'Gestiona cuentas, concilia<br>pagos y revisa la auditoría<br>(TOTP)',
          'HTTPS sobre Tailscale', REL_ADMIN, exit=bottom(d, 'adm', 1440), entry=top(d, 'sys', 1440))
    d.rel('sys', 'fin', 'Lee cuentas y<br>movimientos<br>(solo lectura)', 'HTTPS/JSON',
          exit=left(d, 'sys', 640), entry=right(d, 'fin', 640), lpos=0.35)
    d.rel('sys', 'tbk', 'Crea y confirma (commit)<br>transacciones', 'HTTPS/JSON',
          exit=bottom(d, 'sys', 700), entry=top(d, 'tbk', 700))
    d.rel('sys', 'mail', 'Envía correos<br>transaccionales', 'HTTPS',
          exit=bottom(d, 'sys', 1360), entry=top(d, 'mail', 1360))
    d.legend(1640, 100, [
        (PERSON.replace('verticalAlign=bottom', ''), 'Persona'),
        (SYSTEM, 'Sistema de software (alcance)'),
        (EXTERNAL, 'Sistema externo'),
        ('edge:' + REL, 'Relación (la inicia el origen)'),
        ('edge:' + REL_ADMIN, 'Flujo de administración'),
        ('edge:' + REL_BROWSER, 'Redirección del navegador'),
        ('edge:' + REL_SECRET, 'Credencial que nunca toca Fin de Mes'),
    ])
    TEXT_K = 1.0
    return d


# =====================================================================================
def containers():
    d = Diagram('c4-2-contenedores')
    global TEXT_K
    TEXT_K = 1.3
    d.text_k = d.font_scale = 1.3
    d.title('[Diagrama de contenedores] Fin de Mes', 'Nivel 2 del modelo C4 · ambiente de integración · ' + DATE)
    d.add('vis', c4('Visitante', 'Persona', 'Sin cuenta.'), PERSON, 120, 90, 220, 210)
    d.add('usr', c4('Usuario registrado', 'Persona', 'Incluye a los miembros de un hogar.'),
          PERSON, 510, 90, 220, 210)
    d.add('adm', c4('Administrador', 'Persona', 'Desde un equipo de la tailnet.'), PERSON, 1570, 90, 220, 210)

    d.add('sb', '<b>Fin de Mes</b><br>[Sistema de software]', BOUNDARY, 40, 360, 1920, 680)
    d.add('web', c4('Aplicación web y sitio público', 'Contenedor: Flutter web y Astro, archivos estáticos',
                    'El sitio presenta el producto; la aplicación no recalcula: consume la API.'),
          CONTAINER, 80, 420, 320, 170, 'sb')
    d.add('mob', c4('Aplicación móvil', 'Contenedor: Flutter, Android 10+ e iOS 15+',
                    'Misma base de código. Guarda el refresh en flutter_secure_storage.'),
          CONTAINER, 460, 420, 320, 170, 'sb')
    d.add('mig', c4('Migrador', 'Contenedor: Kysely + SQL, job previo al despliegue',
                    'Aplica migraciones y crea los roles por servicio.'), CONTAINER, 980, 420, 320, 150, 'sb')
    d.add('api', c4('API pública', 'Contenedor: Node.js 24, TypeScript, Fastify',
                    'Expone /v1 (OpenAPI). Contiene los módulos y el motor de simulación, que se ejecuta en '
                    'proceso. Sin estado; varias instancias.'), CONTAINER, 460, 700, 340, 200, 'sb')
    d.add('db', c4('Base de datos', 'Contenedor: PostgreSQL 18 gestionado',
                   'Estado base, escenarios, hogares, suscripciones y auditoría encadenada por hash. RLS y un '
                   'rol por servicio.'), DB, 980, 690, 320, 220, 'sb')
    d.add('ab', '<b>Plano de administración</b><br>[solo alcanzable por Tailscale · RNF21]',
          ADMIN_BOUNDARY, 1400, 390, 520, 610, 'sb')
    d.add('pan', c4('Panel de administración', 'Contenedor: aplicación web, tecnología por definir',
                    'Cuentas, planes, conciliación y auditoría. Sin datos financieros.'),
          CONTAINER + PLANNED, 1460, 430, 400, 170, 'ab')
    d.add('aapi', c4('API de administración', 'Contenedor: Node.js 24, Fastify',
                     'Proceso separado de la API pública. Exige TOTP.'), CONTAINER, 1460, 710, 400, 170, 'ab')

    d.add('fin', c4('Fintoc', 'Sistema externo · modo de prueba', 'Widget de vinculación y API de movimientos.'),
          EXTERNAL, 60, 1180, 340, 140)
    d.add('tbk', c4('Transbank Webpay Plus', 'Sistema externo · integración', 'Formulario de pago y API.'),
          EXTERNAL, 480, 1180, 340, 140)
    d.add('mail', c4('Amazon SES', 'Sistema externo · correo transaccional', 'Verificación, recuperación e invitaciones.'),
          EXTERNAL, 900, 1180, 340, 140)

    d.rel('vis', 'web', 'Prueba el modo<br>demostración', 'HTTPS', exit=bottom(d, 'vis', 230),
          entry=top(d, 'web', 230))
    d.rel('usr', 'web', 'Usa', 'HTTPS', exit=bottom(d, 'usr', 560), entry=top(d, 'web', 360),
          pts=[(560, 380), (360, 380)])
    d.rel('usr', 'mob', 'Usa', 'HTTPS', exit=bottom(d, 'usr', 660), entry=top(d, 'mob', 660))
    d.rel('web', 'api', 'Llama a /v1', 'HTTPS/JSON, JWT', exit=bottom(d, 'web', 330), entry=left(d, 'api', 760),
          pts=[(330, 760)])
    d.rel('mob', 'api', 'Llama a /v1', 'HTTPS/JSON, JWT', exit=bottom(d, 'mob', 640), entry=top(d, 'api', 640))
    d.rel('web', 'fin', 'Abre el widget: la clave<br>bancaria va directo a Fintoc', 'HTTPS', REL_SECRET,
          exit=bottom(d, 'web', 130), entry=top(d, 'fin', 130), lpos=-0.5)
    d.rel('web', 'tbk', 'Redirige al<br>formulario de pago', 'HTTPS', REL_BROWSER,
          exit=bottom(d, 'web', 230), entry=top(d, 'tbk', 540), pts=[(230, 1120), (540, 1120)], lpos=-0.15)
    d.rel('api', 'fin', 'Crea el Link Intent, canjea<br>el token y lee movimientos', 'HTTPS/JSON',
          exit=bottom(d, 'api', 500), entry=top(d, 'fin', 340), pts=[(500, 1080), (340, 1080)], lpos=-0.75)
    d.rel('api', 'tbk', 'Crea y confirma<br>(commit) transacciones', 'HTTPS/JSON',
          exit=bottom(d, 'api', 680), entry=top(d, 'tbk', 680))
    d.rel('api', 'mail', 'Envía correos', 'HTTPS', exit=bottom(d, 'api', 780), entry=top(d, 'mail', 1000),
          pts=[(780, 1080), (1000, 1080)])
    d.rel('api', 'db', 'Lee y escribe<br>rol app_api, bajo RLS', 'SQL, TLS verify-full',
          exit=right(d, 'api', 800), entry=left(d, 'db', 800))
    d.rel('mig', 'db', 'Aplica migraciones<br>rol dueño', 'SQL, TLS', exit=bottom(d, 'mig', 1100),
          entry=top(d, 'db', 1100))
    d.rel('aapi', 'db', 'Lee cuentas, planes,<br>pagos y auditoría<br>rol app_admin', 'SQL, TLS verify-full',
          exit=left(d, 'aapi', 800), entry=right(d, 'db', 800))
    d.rel('adm', 'pan', 'Usa (TOTP)', 'HTTPS sobre Tailscale', REL_ADMIN, exit=bottom(d, 'adm', 1680),
          entry=top(d, 'pan', 1680))
    d.rel('pan', 'aapi', 'Llama a', 'HTTPS/JSON sobre Tailscale', REL_ADMIN, exit=bottom(d, 'pan', 1660),
          entry=top(d, 'aapi', 1660))
    d.legend(1380, 1110, [
        (CONTAINER, 'Contenedor'),
        (CONTAINER + PLANNED, 'Contenedor con tecnología por definir'),
        (EXTERNAL, 'Sistema externo'),
        (BOUNDARY.replace('container=1;', ''), 'Límite del sistema'),
        (ADMIN_BOUNDARY.replace('container=1;', ''), 'Plano de administración (Tailscale)'),
        ('edge:' + REL_ADMIN, 'Flujo de administración'),
        ('edge:' + REL_SECRET, 'Credencial que nunca toca Fin de Mes'),
        ('edge:' + REL_BROWSER, 'Redirección del navegador'),
    ], w=360)
    TEXT_K = 1.0
    return d


# =====================================================================================
def components():
    d = Diagram('c4-3-componentes-api')
    global TEXT_K
    TEXT_K = 1.15
    d.text_k = d.font_scale = 1.15
    d.title('[Diagrama de componentes] Fin de Mes · API pública, en capas hexagonales',
            'Nivel 3 del modelo C4 · las dependencias apuntan hacia el dominio · ' + DATE, w=1800)
    X0, STEP, W = 100, 190, 156
    G = (STEP - W) // 2
    cols = ['idn', 'hog', 'sub', 'agg', 'prv', 'aud', 'reg', 'scn', 'dem']
    cx = {c: X0 + i * STEP for i, c in enumerate(cols)}
    RIGHT = cx['dem'] + W + 40
    CORE_X = RIGHT + 110

    d.add('cli', c4('Aplicación web y móvil', 'Contenedor: Flutter', 'Cliente externo. No recalcula.'),
          CONTAINER, 700, 90, 340, 120)
    d.add('cb', '<b>API pública</b><br>[Contenedor: Node.js 24, TypeScript, Fastify]', BOUNDARY,
          40, 250, CORE_X + 460 - 40, 1350)
    BW = CORE_X + 420 - 60

    d.add('b1', 'Adaptadores de entrada · api/v1, http', BAND, 60, 280, BW, 190, 'cb')
    d.add('ctl', c4('Controladores REST /v1', 'Componente: Fastify + Zod · previsto',
                    'Traducen HTTP a casos de uso; rechazan campos desconocidos; generan openapi.yaml.'),
          COMPONENT + PLANNED, 100, 320, 400, 130, 'b1')
    d.add('pip', c4('Pipeline de entrada', 'Componente: hooks de Fastify · previsto',
                    '1 límite de tasa → 2 esquema estricto → 3 JWT (algoritmo fijo; iss, aud, exp) → Actor.<br>'
                    'Rutas autenticadas · públicas con límite (demo, registro, login, enlaces) · retorno de '
                    'Webpay, verificado con el commit.'), COMPONENT + PLANNED, 580, 310, 640, 150, 'b1')
    d.add('err', c4('Errores uniformes', 'Componente: http/ · implementado',
                    'Formato único; 404 ante recursos ajenos.'), COMPONENT, 1300, 320, 330, 130, 'b1')
    d.add('cmp', c4('Raíz de composición', 'Componente: composition/main-api.ts · implementado',
                    'Conecta puertos con adaptadores; elige Fintoc o demo-bank.'), COMPONENT, CORE_X, 320, 400,
          130, 'b1')

    d.add('b2', 'Aplicación · casos de uso (modules/*/application)', BAND, 60, 500, RIGHT - 60, 210, 'cb')
    uc = {
        'idn': ('Identidad', 'Registro, sesión y bloqueo (HU17)'),
        'hog': ('Hogar', 'Miembros, gastos comunes, reglas e invitaciones'),
        'sub': ('Suscripción', 'Planes, pago y activación idempotente'),
        'agg': ('Agregación', 'Vincula cuentas; cada dato declara su origen'),
        'prv': ('Privacidad', 'Exporta y borra datos (HU21)'),
        'aud': ('Auditoría', 'Traza encadenada (RNF10)'),
        'reg': ('Registro financiero', 'Estado base, proyección y salud financiera'),
        'scn': ('Escenarios', 'Decisiones sobre la base; usa también FinancialStateReader y HouseholdRepository'),
        'dem': ('Demo', 'Proyección sin estado con DEMO_LIMITS'),
    }
    UY, UH = 560, 130
    for c in cols:
        name, desc = uc[c]
        d.add('uc_' + c, c4(name, 'Caso de uso · previsto', desc, 11), COMPONENT + PLANNED, cx[c], UY, W, UH, 'b2')

    CORE_Y, CORE_H = 500, 520
    d.add('core', c4('Subdominio central · core', 'Componente: TypeScript puro · implementado',
                     'Estado financiero · catálogo de decisiones (5 tipos) · simulación · proyección mensual · '
                     '5 indicadores · explicación · Clp entero y YearMonth.<br><br>'
                     'Determinista y sin E/S: no conoce módulos, adaptadores, red ni base de datos '
                     '(dependency-cruiser lo verifica).<br><br>Los tipos Clp y YearMonth los usan todos los '
                     'módulos.', 14), CORE, CORE_X, CORE_Y, 400, CORE_H, 'cb')

    d.add('b3', 'Puertos · interfaces declaradas por cada módulo (modules/*/ports)', BAND, 60, 740, RIGHT - 60,
          330, 'cb')
    ports = {
        'idn': ['UserAccountRepository', 'RefreshTokenStore', 'LoginAttemptLimiter', 'PasswordHasher',
                'AccessTokenService'],
        'hog': ['HouseholdRepository', 'EmailSender<br>(notifications)'],
        'sub': ['PaymentSettlement', 'SubscriptionCanceller', 'PaymentGateway'],
        'agg': ['BankAggregator'],
        'prv': ['PersonalDataStore'],
        'aud': ['AuditLog'],
        'reg': ['FinancialStateReader'],
        'scn': ['ScenarioRepository'],
        'dem': [],
    }
    PY0, PSTEP, PH = 790, 54, 44
    pid, pgeo = {}, {}
    for c in cols:
        n = len(ports[c])
        if n == 0:
            d.add('pg_' + c, 'Sin puertos:<br>solo invoca el núcleo',
                  TEXT + 'fontSize=10;align=center;fontColor=#666666;', cx[c], 800, W, 40, 'b3')
            continue
        d.add('pg_' + c, '', 'rounded=1;arcSize=4;absoluteArcSize=1;fillColor=none;strokeColor=#9DB7CF;'
              'container=1;collapsible=0;pointerEvents=0;', cx[c] - 4, PY0 - 8, W + 8, 6 + PSTEP * n, 'b3')
        for i, p in enumerate(ports[c]):
            k = 'p_%s_%d' % (c, i)
            key = p.split('<')[0]
            pid[key] = k
            pgeo[key] = (cx[c], PY0 + PSTEP * i + PH // 2)
            d.add(k, '<b>%s</b><br><span style="font-size:9px">«interfaz»</span>' % p, PORT,
                  cx[c], PY0 + PSTEP * i, W, PH, 'pg_' + c)
    d.add('audnote', 'Todos los casos de uso, salvo Demo, escriben en AuditLog.',
          TEXT + 'fontSize=10;fontColor=#555555;', cx['aud'] - 6, 850, 100, 80, 'b3')

    d.add('b4', 'Adaptadores de salida · adapters/*', BAND, 60, 1100, BW, 440, 'cb')
    R1, R2 = 1150, 1340
    d.add('a_jwt', c4('Emisor JWT', 'Componente · previsto', 'Acceso de 15 min.', 11),
          COMPONENT + PLANNED, cx['idn'], R1, W, 100, 'b4')
    d.add('a_hash', c4('Hasher argon2id', 'Componente · previsto', 'Parámetros OWASP.', 11),
          COMPONENT + PLANNED, cx['idn'], R2, W, 100, 'b4')
    d.add('a_mail', c4('Adaptador de correo', 'Componente · previsto', 'Plantillas sin texto libre.', 11),
          COMPONENT + PLANNED, cx['hog'], R1, W, 100, 'b4')
    d.add('a_wp', c4('Adaptador Webpay Plus', 'Componente · previsto', 'Commit desde el servidor.', 11),
          COMPONENT + PLANNED, cx['sub'], R1, W, 100, 'b4')
    d.add('a_demo', c4('Adaptador demo-bank', 'Componente · implementado', 'Perfiles deterministas.', 11),
          COMPONENT, cx['agg'], R1, W, 100, 'b4')
    d.add('a_fin', c4('Adaptador Fintoc', 'Componente · previsto', 'link_token cifrado (AES-256-GCM).', 11),
          COMPONENT + PLANNED, cx['agg'], R2, W, 100, 'b4')
    PGX = cx['prv']
    PGW = cx['scn'] + W - PGX
    d.add('a_pg', c4('Repositorios PostgreSQL', 'Componente: Kysely · previsto (hoy solo existe el migrador)',
                     'withActor fija app.user_id en cada transacción: RLS como segunda barrera. Rol app_api.', 11),
          COMPONENT + PLANNED, PGX, R2, PGW, 100, 'b4')

    EY = 1680
    d.add('x_mail', c4('Amazon SES', 'Sistema externo · correo'), EXTERNAL, cx['hog'] - 40, EY, 236, 90)
    d.add('x_tbk', c4('Transbank', 'Sistema externo'), EXTERNAL, cx['sub'] + 10, EY, 200, 90)
    d.add('x_fin', c4('Fintoc', 'Sistema externo'), EXTERNAL, cx['agg'] + 30, EY, 200, 90)
    d.add('x_db', c4('Base de datos', 'Contenedor: PostgreSQL 18 gestionado'), DB, cx['aud'] + 40, EY - 10, 300,
          120)
    d.add('note_admin', '<b>API de administración</b> (contenedor aparte, composition/main-admin-api.ts): mismo '
          'patrón hexagonal, rol app_admin y solo casos de uso de cuentas, suscripción y lectura de auditoría. '
          'No invoca el núcleo ni lee datos financieros (HU23).', NOTE, cx['scn'], EY - 10, 380, 150)

    d.rel('cli', 'ctl', 'Llama a /v1', 'HTTPS/JSON', exit=left(d, 'cli', 150), entry=top(d, 'ctl', 300),
          pts=[(300, 150)])
    d.rel('ctl', 'pip', 'Pasa cada<br>petición por', exit=right(d, 'ctl', 385), entry=left(d, 'pip', 385))
    d.rel('pip', 'b2', 'Entrega Actor y comando validado', exit=bottom(d, 'pip', 900), entry=top(d, 'b2', 900))
    lane = {'reg': 530, 'scn': 542}
    for c in ('reg', 'scn'):
        x = cx[c] + W // 2
        d.rel('uc_' + c, 'core', '', exit=top(d, 'uc_' + c, x), entry=left(d, 'core', lane[c]),
              pts=[(x, lane[c])])
    d.rel('uc_dem', 'core', 'Calcula proyección,<br>indicadores y explicación', 'llamada en proceso',
          exit=right(d, 'uc_dem', UY + UH // 2), entry=left(d, 'core', UY + UH // 2))
    for c in cols:
        if c != 'dem':
            x = cx[c] + W // 2
            d.rel('uc_' + c, 'pg_' + c, 'usa', exit=bottom(d, 'uc_' + c, x), entry=top(d, 'pg_' + c, x))

    bus = R1 + 100 + 14
    pg_top = R2
    persist = {'idn': ['UserAccountRepository', 'RefreshTokenStore', 'LoginAttemptLimiter'],
               'hog': ['HouseholdRepository'],
               'sub': ['PaymentSettlement', 'SubscriptionCanceller']}
    k = 0
    for c, names in persist.items():
        for j, p in enumerate(names):
            gx = cx[c] + W + G - 6 + 6 * j
            sx = PGX + 16 + 14 * k
            k += 1
            _, py = pgeo[p]
            d.rel('a_pg', pid[p], '', style=REL_IMPL, exit=top(d, 'a_pg', sx), entry=right(d, pid[p], py),
                  pts=[(sx, bus + 6 * k), (gx, bus + 6 * k), (gx, py)])
    for c, p in (('prv', 'PersonalDataStore'), ('aud', 'AuditLog'), ('reg', 'FinancialStateReader'),
                 ('scn', 'ScenarioRepository')):
        x = cx[c] + W // 2 + 30
        d.rel('a_pg', pid[p], 'implementa' if c == 'reg' else '', style=REL_IMPL, exit=top(d, 'a_pg', x),
              entry=bottom(d, pid[p], x))
    d.rel('a_jwt', pid['AccessTokenService'], '', style=REL_IMPL, exit=top(d, 'a_jwt', cx['idn'] + 60),
          entry=bottom(d, pid['AccessTokenService'], cx['idn'] + 60))
    hy = pgeo['PasswordHasher'][1]
    d.rel('a_hash', pid['PasswordHasher'], '', style=REL_IMPL, exit=left(d, 'a_hash', R2 + 50),
          entry=left(d, pid['PasswordHasher'], hy), pts=[(cx['idn'] - 22, R2 + 50), (cx['idn'] - 22, hy)])
    d.rel('a_mail', pid['EmailSender'], '', style=REL_IMPL, exit=top(d, 'a_mail', cx['hog'] + 60),
          entry=bottom(d, pid['EmailSender'], cx['hog'] + 60))
    d.rel('a_wp', pid['PaymentGateway'], '', style=REL_IMPL, exit=top(d, 'a_wp', cx['sub'] + 60),
          entry=bottom(d, pid['PaymentGateway'], cx['sub'] + 60))
    d.rel('a_demo', pid['BankAggregator'], '', style=REL_IMPL, exit=top(d, 'a_demo', cx['agg'] + 60),
          entry=bottom(d, pid['BankAggregator'], cx['agg'] + 60))
    by = pgeo['BankAggregator'][1]
    gx = cx['agg'] + W + G - 6
    d.rel('a_fin', pid['BankAggregator'], '', style=REL_IMPL, exit=right(d, 'a_fin', R2 + 50),
          entry=right(d, pid['BankAggregator'], by), pts=[(gx, R2 + 50), (gx, by)])

    d.rel('a_mail', 'x_mail', 'Envía', 'HTTPS saliente', exit=bottom(d, 'a_mail', cx['hog'] + 100),
          entry=top(d, 'x_mail', cx['hog'] + 100))
    d.rel('a_wp', 'x_tbk', 'Crea y confirma', 'HTTPS saliente', exit=bottom(d, 'a_wp', cx['sub'] + 100),
          entry=top(d, 'x_tbk', cx['sub'] + 100))
    d.rel('a_fin', 'x_fin', 'Lee movimientos', 'HTTPS saliente', exit=bottom(d, 'a_fin', cx['agg'] + 100),
          entry=top(d, 'x_fin', cx['agg'] + 100))
    d.rel('a_pg', 'x_db', 'Lee y escribe bajo RLS', 'SQL, TLS verify-full',
          exit=bottom(d, 'a_pg', cx['aud'] + 190), entry=top(d, 'x_db', cx['aud'] + 190))
    d.legend(CORE_X, EY - 10, [
        (COMPONENT, 'Componente implementado'),
        (COMPONENT + PLANNED, 'Componente previsto'),
        (CORE, 'Subdominio central (núcleo puro)'),
        (PORT, 'Puerto («interfaz»)'),
        ('edge:' + REL, 'Usa / invoca'),
        ('edge:' + REL_IMPL, 'Implementa (realización)'),
    ], w=400)
    TEXT_K = 1.0
    return d


# =====================================================================================
def deployment():
    """Deployment view, read left to right: user device -> AWS edge -> VPC -> external services.

    Larger type than the other views so it stays legible at page width; fine details live in the report text.
    Numbers 1-6 mark the main paths, explained in a list under the figure.
    """
    d = Diagram('c4-4-despliegue')
    d.font_scale = 1.5
    big = lambda st: st.replace('fontSize=11', 'fontSize=16').replace('fontSize=10', 'fontSize=15')

    def box(name, kind, desc=''):
        out = '<b style="font-size:20px">%s</b><br><span style="font-size:15px">[%s]</span>' % (name, kind)
        return out + ('<br>' + desc if desc else '')

    def node(name, kind, extra=''):
        out = '<b style="font-size:20px">%s</b><br><span style="font-size:15px">[%s]</span>' % (name, kind)
        return out + ('<br><span style="font-size:15px">%s</span>' % extra if extra else '')

    n_node, n_gray, n_untr, n_admin = big(NODE), big(NODE_GRAY), big(NODE_UNTRUSTED), big(NODE_ADMIN)
    cont, ext, fw, dbs = big(CONTAINER), big(EXTERNAL), big(FIREWALL), big(DB)
    fw = fw.replace('fontSize=15', 'fontSize=16')

    d.title('[Diagrama de despliegue] Fin de Mes · ambiente de integración',
            'Diagrama complementario de despliegue del modelo C4 · AWS, región us-east-1 · cada flecha parte de quien '
            'inicia la conexión · los números se explican bajo la figura · ' + DATE_NET, w=2300)

    # Column A: user device (untrusted).
    d.add('dev', node('Dispositivo del usuario', 'Nodo de despliegue', 'Internet · no confiable'),
          n_untr, 40, 140, 440, 640)
    d.add('br', node('Navegador web', 'Nodo'), n_gray, 60, 225, 400, 165, 'dev')
    d.add('web', box('Aplicación web', 'Contenedor: Flutter web'), cont, 80, 280, 360, 95, 'br')
    d.add('ph', node('Teléfono', 'Nodo: Android o iOS'), n_gray, 60, 415, 400, 165, 'dev')
    d.add('mob', box('Aplicación móvil', 'Contenedor: Flutter'), cont, 80, 470, 360, 95, 'ph')
    d.add('wid', box('Ventana de Fintoc', 'Sistema externo', 'Aquí el usuario escribe su clave bancaria.'),
          ext, 80, 610, 360, 150, 'dev')

    # Column B: AWS account and its edge services.
    d.add('aws', node('AWS · cuenta findemes-int · región us-east-1', 'Nodo'), n_node, 540, 140, 1420, 1300)
    d.add('cf', node('Amazon CloudFront', 'Nodo: distribución con TLS y AWS Shield Standard',
                     'Única entrada pública.'), n_node, 570, 200, 400, 150, 'aws')
    d.add('gw', node('Amazon API Gateway', 'Nodo: API HTTP regional', 'Limita la tasa de solicitudes.'),
          n_node, 570, 410, 400, 150, 'aws')
    d.add('s3', node('Amazon S3', 'Nodo: almacenamiento privado'), n_gray, 570, 620, 400, 200, 'aws')
    d.add('st', box('Aplicación web y sitio público', 'Contenedor: archivos estáticos'), cont, 590, 690, 360, 110,
          's3')
    d.add('ssm', node('AWS Systems Manager', 'Nodo: Parameter Store y Run Command',
                      'Secretos cifrados y despliegue sin acceso manual.'), n_node, 570, 880, 400, 170, 'aws')

    # Column C: the VPC.
    d.add('vpc', node('VPC findemes-int · 10.0.0.0/16', 'Nodo: red privada virtual'), n_gray, 1010, 190, 920, 1100,
          'aws')
    d.add('igw', node('Internet Gateway', 'Nodo: salida a internet de la subred pública'), n_node,
          1040, 255, 860, 80, 'vpc')
    d.add('pub', node('Subred pública 10.0.1.0/24', 'Nodo'), n_node, 1040, 360, 860, 470, 'vpc')
    d.add('sg_api', '<b>Firewall sg-api</b> · entra solo 8080 desde el VPC Link', fw, 1060, 420, 400, 390, 'pub')
    d.add('ec2', node('EC2 api', 'Nodo: t4g.micro, Docker'), n_node, 1075, 455, 370, 340, 'sg_api')
    d.add('mig', box('Migrador', 'Contenedor: tarea previa', 'Aplica las migraciones.'), cont,
          1095, 515, 330, 120, 'ec2')
    d.add('api', box('API pública', 'Contenedor: Node.js 24, Fastify'), cont, 1095, 660, 330, 120, 'ec2')
    d.add('sg_adm', '<b>Firewall sg-admin</b> · no acepta conexiones entrantes', fw, 1480, 420, 400, 390, 'pub')
    d.add('adm', node('EC2 admin', 'Nodo: t4g.nano, Tailscale'), n_admin, 1495, 455, 370, 340, 'sg_adm')
    d.add('pan', box('Panel de administración', 'Contenedor: aplicación web'), cont + PLANNED,
          1515, 515, 330, 120, 'adm')
    d.add('aapi', box('API de administración', 'Contenedor: Node.js 24, Fastify'), cont, 1515, 660, 330, 120, 'adm')
    d.add('priv', node('Subredes privadas 10.0.11.0/24 y 10.0.12.0/24', 'Nodo: sin ruta a internet'), n_node,
          1040, 900, 860, 365, 'vpc')
    d.add('sg_rds', '<b>Firewall sg-rds</b> · entra solo 5432 desde sg-api y sg-admin', fw, 1060, 960, 820, 285,
          'priv')
    d.add('rds', node('Amazon RDS for PostgreSQL', 'Nodo: db.t4g.micro, cifrado, respaldo diario'), n_node,
          1075, 995, 790, 235, 'sg_rds')
    d.add('db', box('Base de datos findemes', 'Contenedor: PostgreSQL 18',
                    'Seguridad por fila y auditoría encadenada.'), dbs, 1095, 1065, 750, 145, 'rds')

    # Column D: external services and the operator.
    d.add('xs', node('Servicios externos', 'Sistemas de terceros'), n_gray, 2000, 140, 420, 650)
    d.add('x_fin', box('Fintoc', 'Sistema externo', 'Cuentas y movimientos.'), ext, 2030, 200, 360, 125, 'xs')
    d.add('x_tbk', box('Transbank Webpay Plus', 'Sistema externo', 'Formulario y confirmación del pago.'), ext,
          2030, 345, 360, 125, 'xs')
    d.add('x_mail', box('Amazon SES', 'Sistema externo', 'Correos de la plataforma.'), ext, 2030, 490, 360, 125, 'xs')
    d.add('x_ts', box('Tailscale', 'Sistema externo', 'Coordina la red privada; no ve el tráfico.'), ext,
          2030, 635, 360, 135, 'xs')
    d.add('opd', node('Equipo del operador', 'Nodo: equipo aprobado en la red privada'), n_admin,
          2000, 850, 420, 210)
    d.add('opb', box('Navegador', 'Contenedor'), cont.replace('#23A2D9', '#5B6770').replace('#0E7DAD', '#3D464C'),
          2030, 930, 360, 100, 'opd')
    d.add('gh', box('GitHub Actions', 'Sistema externo', 'Integración continua.'), ext, 2000, 1280, 420, 130)

    d.add('prod', '<b>Producción (fuera del alcance del MVP):</b> misma topología en otra cuenta de AWS, con servidores '
          'en subredes privadas y salida por NAT Gateway, base de datos en dos zonas, dos servidores de la API y '
          'AWS WAF en CloudFront.', big(NOTE), 540, 1470, 1880, 80)

    # Relations, numbered as in the list under the figure.
    d.rel('web', 'cf', '<b>1</b> · Abre el sitio<br>y llama a /v1', 'HTTPS 443', exit=right(d, 'web', 300),
          entry=left(d, 'cf', 260), pts=[(505, 300), (505, 260)], lpos=-0.2)
    d.rel('mob', 'cf', '<b>1</b>', '', exit=right(d, 'mob', 515), entry=left(d, 'cf', 315),
          pts=[(520, 515), (520, 315)])
    d.rel('cf', 'gw', '<b>2</b> · Enruta /v1/*', 'HTTPS 443', exit=bottom(d, 'cf', 770), entry=top(d, 'gw', 770))
    d.rel('cf', 'st', 'Sirve el sitio', 'HTTPS', exit=right(d, 'cf', 300), entry=right(d, 'st', 745),
          pts=[(990, 300), (990, 745)], lpos=0.3)
    d.rel('gw', 'api', '<b>2</b>', '', exit=right(d, 'gw', 485),
          entry=left(d, 'api', 720), pts=[(1030, 485), (1030, 720)], lpos=-0.85)
    d.rel('api', 'db', '<b>3</b> · Consulta con su rol', 'TLS 5432', exit=bottom(d, 'api', 1260),
          entry=top(d, 'db', 1260), lpos=-0.45)
    d.rel('aapi', 'db', '<b>3</b> · Rol sin datos financieros', 'TLS 5432', exit=bottom(d, 'aapi', 1680),
          entry=top(d, 'db', 1680), lpos=-0.45)
    d.rel('api', 'igw', '<b>4</b>', '', exit=right(d, 'api', 690), entry=bottom(d, 'igw', 1470),
          pts=[(1470, 690), (1470, 335)], lpos=0.93)
    d.rel('igw', 'xs', '<b>4</b> · Salida a Fintoc,<br>Webpay y correo', 'HTTPS 443', exit=right(d, 'igw', 295),
          entry=left(d, 'xs', 295))
    d.rel('opb', 'pan', '<b>5</b> · Usa el panel<br>con segundo factor', 'Tailscale', REL_ADMIN,
          exit=left(d, 'opb', 980), entry=right(d, 'pan', 575), pts=[(1945, 980), (1945, 575)], lpos=0.15)
    d.rel('gh', 'ssm', '<b>6</b> · Despliega cada versión aprobada', 'HTTPS 443', exit=left(d, 'gh', 1345),
          entry=bottom(d, 'ssm', 770), pts=[(770, 1345)], lpos=-0.3)
    d.rel('ssm', 'ec2', '<b>6</b>', '', exit=right(d, 'ssm', 965),
          entry=left(d, 'ec2', 775), pts=[(995, 965), (995, 775)], lpos=-0.6)
    d.rel('wid', 'x_fin', 'Clave bancaria del usuario (nunca pasa por Fin de Mes)', 'HTTPS', REL_SECRET,
          exit=right(d, 'wid', 690), entry=right(d, 'x_fin', 262), pts=[(500, 690), (500, 105), (2450, 105),
                                                                        (2450, 262)], lpos=0.1)
    d.legend(40, 820, [
        (n_node.replace('container=1;', ''), 'Nodo de despliegue'),
        (n_untr.replace('container=1;', ''), 'Nodo no confiable (internet)'),
        (n_admin.replace('container=1;', ''), 'Administración (red privada)'),
        (fw.replace('container=1;', ''), 'Firewall: grupo de seguridad'),
        (cont, 'Instancia de contenedor'),
        (ext, 'Sistema externo'),
        ('edge:' + REL, 'Conexión (la inicia el origen)'),
        ('edge:' + REL_ADMIN, 'Tráfico de administración'),
        ('edge:' + REL_SECRET, 'Credencial que nunca toca Fin de Mes'),
    ], w=440)
    return d


# =====================================================================================
ZONE = ('rounded=1;arcSize=2;absoluteArcSize=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=12;'
        'spacingTop=6;fontSize=19;fontStyle=1;container=1;collapsible=0;pointerEvents=0;')
Z_NET = ZONE + 'fillColor=#FDEDEC;strokeColor=#C0392B;fontColor=#922B21;dashed=1;dashPattern=10 5;strokeWidth=2;'
Z_EDGE = ZONE + 'fillColor=#EBF5FB;strokeColor=#2E86C1;fontColor=#1B4F72;'
Z_VPC = ZONE + 'fillColor=#E9F7EF;strokeColor=#239B56;fontColor=#145A32;strokeWidth=2;'
Z_PRIV = ZONE + 'fillColor=#D5F5E3;strokeColor=#1E8449;fontColor=#145A32;'
Z_EXT = ZONE + 'fillColor=#F4F2F6;strokeColor=#8C8496;fontColor=#4A4453;'
Z_TAIL = ZONE + 'fillColor=#FEF5E7;strokeColor=#D68910;fontColor=#A6610A;strokeWidth=2;'
Z_FW = FIREWALL.replace('fontSize=10', 'fontSize=15').replace('spacingTop=2', 'spacingTop=4')
DEV = ('rounded=1;whiteSpace=wrap;html=1;arcSize=8;absoluteArcSize=1;fillColor=#FFFFFF;strokeColor=#5B6770;'
       'fontColor=#222222;fontSize=18;spacing=6;')


def dev(name, kind, extra=''):
    # The third line (extra) is not drawn: it is in the connections table of the report.
    return '<b>%s</b><br><span style="font-size:15px">%s</span>' % (name, kind)


def topology():
    d = Diagram('topologia-comunicaciones')
    d.font_scale = 1.5
    d.title('[Topología de comunicaciones] Fin de Mes · ambiente de integración',
            'Zonas de confianza, protocolos, puertos y cifrado · cada flecha parte de quien inicia la conexión · '
            + DATE_NET, w=1900)

    # Zone 1: internet.
    d.add('z_net', 'Zona 1 · Internet (no confiable)', Z_NET, 40, 110, 420, 720)
    d.add('n_br', dev('Navegador', 'Aplicación web Flutter', 'Windows, macOS, Linux'), DEV, 80, 170, 340, 90,
          'z_net')
    d.add('n_ph', dev('Teléfono', 'Aplicación Android o iOS', '4G/5G o Wi-Fi doméstico'), DEV, 80, 300, 340, 90,
          'z_net')
    d.add('n_wid', dev('Widget de Fintoc', 'En el navegador o WebView', 'La clave bancaria va directo a Fintoc'),
          DEV, 80, 430, 340, 90, 'z_net')
    d.add('n_isp', dev('Proveedor de internet del usuario', 'Fibra, cable o red móvil', 'Fuera del control del '
                       'proyecto'), DEV, 80, 580, 340, 90, 'z_net')

    # Zone 2: AWS edge.
    d.add('z_edge', 'Zona 2 · Borde de AWS (público)', Z_EDGE, 520, 110, 420, 720)
    d.add('n_cf', dev('Amazon CloudFront', 'Puntos de presencia globales', 'TLS 1.2+, AWS Shield Standard'), DEV,
          560, 170, 340, 90, 'z_edge')
    d.add('n_s3', dev('Amazon S3', 'Bucket privado del sitio', 'Solo CloudFront lo lee (OAC)'), DEV, 560, 330, 340,
          90, 'z_edge')
    d.add('n_gw', dev('Amazon API Gateway', 'API HTTP regional', 'Límite de tasa; VPC Link hacia la VPC'), DEV,
          560, 490, 340, 90, 'z_edge')
    d.add('n_ssm', dev('AWS Systems Manager', 'Parameter Store y Run Command', 'Secretos y despliegue sin SSH'), DEV,
          560, 650, 340, 90, 'z_edge')

    # Zone 3: VPC.
    d.add('z_vpc', 'Zona 3 · VPC findemes-int 10.0.0.0/16 (us-east-1)', Z_VPC, 1000, 110, 600, 720)
    d.add('n_igw', dev('Internet Gateway', 'Salida a internet de la subred pública'), DEV,
          1040, 170, 520, 70, 'z_vpc')
    d.add('z_pub', 'Subred pública 10.0.1.0/24', Z_PRIV.replace('#D5F5E3', '#FFFFFF'), 1030, 250, 540, 285, 'z_vpc')
    # Security groups (firewall) around each resource, with their inbound rule.
    d.add('fw_api', '<b>Firewall (sg-api)</b><br>Entrada: 8080 desde VPC Link', Z_FW, 1045, 290, 255,
          175, 'z_pub')
    d.add('n_api', dev('EC2 api (t4g.micro)', 'API pública y migrador en Docker'), DEV, 1058, 355, 230, 100,
          'fw_api')
    d.add('fw_adm', '<b>Firewall (sg-admin)</b><br>Entrada: ninguna', Z_FW, 1310, 290, 250,
          175, 'z_pub')
    d.add('n_adm', dev('EC2 admin (t4g.nano)', 'API y panel de administración'),
          DEV + 'strokeColor=#D68910;strokeWidth=2;', 1320, 355, 230, 100, 'fw_adm')
    d.add('z_priv', 'Subredes privadas 10.0.11.0/24 y 10.0.12.0/24', Z_PRIV, 1030, 550, 540, 250, 'z_vpc')
    d.add('fw_rds', '<b>Firewall (sg-rds)</b><br>Entrada: 5432 desde sg-api y sg-admin', Z_FW, 1085, 590,
          410, 185, 'z_priv')
    d.add('n_rds', dev('Amazon RDS for PostgreSQL 18', 'db.t4g.micro, cifrado con KMS'), DEV, 1100, 660, 380,
          100, 'fw_rds')

    # Zone 4: external services.
    d.add('z_ext', 'Zona 4 · Servicios externos (SaaS)', Z_EXT, 1660, 110, 400, 720)
    d.add('n_fin', dev('Fintoc', 'API de agregación bancaria', 'Modo de prueba'), DEV, 1700, 170, 320, 80, 'z_ext')
    d.add('n_tbk', dev('Transbank Webpay Plus', 'Formulario y API de pago', 'Ambiente de integración'), DEV, 1700,
          290, 320, 80, 'z_ext')
    d.add('n_mail', dev('Amazon SES', 'Correo transaccional', ''), DEV, 1700, 410, 320, 80, 'z_ext')
    d.add('n_ts', dev('Tailscale', 'Plano de control de la tailnet', 'Coordina claves; no ve el tráfico'), DEV,
          1700, 530, 320, 80, 'z_ext')
    d.add('n_gh', dev('GitHub y GitHub Actions', 'Repositorio, CI y registro de imágenes', 'Rama main protegida'),
          DEV, 1700, 650, 320, 90, 'z_ext')

    # Zone 5: team (development and maintenance).
    d.add('z_team', 'Zona 5 · Equipo del proyecto: desarrollo y mantenimiento (tailnet con ACL tag:admin)', Z_TAIL,
          40, 880, 1460, 230)
    d.add('n_nb1', dev('Notebook J. Varas', 'Windows 11 · Docker Desktop', 'Fibra 600 Mbps · MFA'), DEV, 120, 950,
          300, 90, 'z_team')
    d.add('n_nb2', dev('Notebook M. Lizana', 'Windows 11 · Docker Desktop', 'Fibra 600 Mbps · MFA'), DEV, 480, 950,
          300, 90, 'z_team')
    d.add('n_mac', dev('Mac mini M4', 'Compilación iOS', 'Red doméstica'), DEV, 840, 950, 260, 90, 'z_team')
    d.add('n_dev', dev('Teléfonos de prueba', 'Galaxy A16 · iPhone SE', 'Validación en dispositivo'), DEV, 1160, 950,
          260, 90, 'z_team')

    # Use view.
    d.rel('n_br', 'n_cf', 'Sitio y API', 'HTTPS 443 · TLS 1.2+', exit=right(d, 'n_br', 215),
          entry=left(d, 'n_cf', 215))
    d.rel('n_ph', 'n_cf', 'API', 'HTTPS 443 · TLS 1.2+', exit=right(d, 'n_ph', 345), entry=left(d, 'n_cf', 240),
          pts=[(480, 345), (480, 240)], lpos=-0.3)
    d.rel('n_wid', 'n_fin', 'Clave bancaria', 'HTTPS 443', REL_SECRET, exit=bottom(d, 'n_wid', 250),
          entry=bottom(d, 'n_fin', 1990), pts=[(250, 545), (480, 545), (480, 850), (1640, 850), (1640, 262),
                                                (1990, 262)], lpos=-0.2)
    d.rel('n_br', 'n_tbk', 'Formulario de pago', 'HTTPS 443', REL_BROWSER, exit=top(d, 'n_br', 300),
          entry=right(d, 'n_tbk', 330), pts=[(300, 95), (2040, 95), (2040, 330)], lpos=0.35)
    d.rel('n_cf', 'n_s3', '/', 'HTTPS · OAC', exit=bottom(d, 'n_cf', 730), entry=top(d, 'n_s3', 730))
    d.rel('n_cf', 'n_gw', 'Solicitudes a la API', 'HTTPS 443', exit=bottom(d, 'n_cf', 860), entry=top(d, 'n_gw', 860),
          lpos=0.5)
    d.rel('n_gw', 'n_api', 'VPC Link', 'HTTP 8080', exit=right(d, 'n_gw', 542), entry=bottom(d, 'n_api', 1100),
          pts=[(1100, 542)], lpos=-0.3)
    d.rel('n_api', 'n_rds', 'Usuario de la API', 'TLS · 5432', exit=bottom(d, 'n_api', 1150),
          entry=top(d, 'n_rds', 1150), lpos=-0.55)
    d.rel('n_adm', 'n_rds', 'Usuario de administración', 'TLS · 5432', REL_ADMIN, exit=bottom(d, 'n_adm', 1450),
          entry=top(d, 'n_rds', 1450), lpos=-0.55)
    d.rel('n_api', 'n_igw', '', '', exit=top(d, 'n_api', 1270), entry=bottom(d, 'n_igw', 1270))
    d.rel('n_adm', 'n_igw', '', '', REL_FAINT, exit=top(d, 'n_adm', 1480), entry=bottom(d, 'n_igw', 1480))
    d.rel('n_igw', 'n_fin', 'Salidas', 'HTTPS 443', exit=right(d, 'n_igw', 190), entry=left(d, 'n_fin', 210),
          pts=[(1630, 190), (1630, 210)], lpos=0.6)
    d.rel('n_igw', 'n_tbk', '', '', exit=right(d, 'n_igw', 205), entry=left(d, 'n_tbk', 330),
          pts=[(1615, 205), (1615, 330)], lpos=0.5)
    d.rel('n_igw', 'n_mail', '', '', exit=right(d, 'n_igw', 220), entry=left(d, 'n_mail', 450),
          pts=[(1600, 220), (1600, 450)], lpos=0.6)
    d.rel('n_igw', 'n_ts', '', '', REL_FAINT, exit=right(d, 'n_igw', 230),
          entry=left(d, 'n_ts', 570), pts=[(1585, 230), (1585, 570)], lpos=0.7)
    # Development and maintenance views.
    d.rel('n_nb1', 'n_gh', 'Código y revisiones', 'HTTPS 443 / SSH 22', exit=top(d, 'n_nb1', 270),
          entry=bottom(d, 'n_gh', 1860), pts=[(270, 920), (1860, 920)], lpos=0.2)
    d.rel('n_nb2', 'n_gh', '', '', exit=top(d, 'n_nb2', 630), entry=bottom(d, 'n_gh', 1860), pts=[(630, 920)])
    d.rel('n_gh', 'n_ssm', 'Despliegue con permisos temporales', 'HTTPS 443', exit=left(d, 'n_gh', 720),
          entry=right(d, 'n_ssm', 720), pts=[(1640, 720), (1640, 790), (930, 790), (930, 720)], lpos=0.0)
    d.rel('n_nb2', 'n_adm', 'Mantenimiento (TOTP)', 'WireGuard UDP 41641 · Tailscale', REL_ADMIN,
          exit=bottom(d, 'n_nb2', 700), entry=bottom(d, 'n_adm', 1510),
          pts=[(700, 1075), (1510, 1075)], lpos=-0.6)
    d.legend(1560, 880, [
        ('edge:' + REL, 'Tráfico de usuarios y servicios'),
        ('edge:' + REL_ADMIN, 'Administración por Tailscale'),
        ('edge:' + REL_BROWSER, 'Redirección del navegador'),
        ('edge:' + REL_SECRET, 'Credencial que nunca toca Fin de Mes'),
        ('edge:' + REL_FAINT, 'Canal de control saliente'),
        (Z_FW.replace('container=1;', ''), 'Firewall: grupo de seguridad de AWS'),
    ], w=560)
    return d


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for build in (context, containers, components, deployment, topology):
        print(build().write(out))


if __name__ == '__main__':
    main()

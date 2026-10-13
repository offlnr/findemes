"""Generate the four C4 diagrams of Fin de Mes as native draw.io files, with explicit edge routing.

usage: python -I c4gen.py <out_dir>
"""
import html
import os
import sys

DATE = '11-10-2026'

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


def e(s):
    return html.escape(s, quote=True)


def c4(name, kind, desc='', size=12):
    out = '<b style="font-size:%dpx">%s</b><br><span style="font-size:10px">[%s]</span>' % (size, name, kind)
    if desc:
        out += '<br><br>' + desc
    return out


def node_label(name, kind, extra=''):
    out = '<b>%s</b><br><span style="font-size:10px">[%s]</span>' % (name, kind)
    if extra:
        out += '<br><span style="font-size:10px">%s</span>' % extra
    return out


class Diagram:
    def __init__(self, name):
        self.name = name
        self.cells = []
        self.abs = {'1': (0, 0)}
        self.geo = {}
        self.parent_of = {'1': None}
        self.n = 0

    def add(self, cid, value, style, x, y, w, h, parent='1'):
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
        if exit:
            st += 'exitX=%s;exitY=%s;exitDx=0;exitDy=0;' % exit
        if entry:
            st += 'entryX=%s;entryY=%s;entryDx=0;entryDy=0;' % entry
        value = text if not tech else '%s<br><span style="font-size:9px">[%s]</span>' % (text, tech)
        ox, oy = self.abs[parent]
        geo = '<mxGeometry relative="1" as="geometry"%s>' % (' x="%s"' % lpos if lpos is not None else '')
        if pts:
            geo += '<Array as="points">%s</Array>' % ''.join(
                '<mxPoint x="%d" y="%d"/>' % (px - ox, py - oy) for px, py in pts)
        geo += '</mxGeometry>'
        self.cells.append('<mxCell id="r%d" value="%s" style="%s" edge="1" parent="%s" source="%s" target="%s">%s'
                          '</mxCell>' % (self.n, e(value), st, parent, src, tgt, geo))

    def title(self, title, subtitle, x=40, y=20, w=1400):
        self.add('title', '<span style="font-size:20px"><b>%s</b></span><br>%s' % (title, subtitle),
                 TEXT, x, y, w, 60)

    def legend(self, x, y, items, w=330):
        h = 40 + 34 * len(items)
        self.add('legend', '<b>Leyenda</b>', BAND.replace('#F4F8FB', '#FFFFFF'), x, y, w, h)
        for i, (kind, label) in enumerate(items):
            yy = y + 34 + 34 * i
            sid = 'lg%d' % i
            if kind.startswith('edge:'):
                self.add(sid + 'a', '', 'text;', x + 14, yy + 12, 1, 2, 'legend')
                self.add(sid + 'b', '', 'text;', x + 84, yy + 12, 1, 2, 'legend')
                self.rel(sid + 'a', sid + 'b', style=kind[5:])
            else:
                self.add(sid + 's', '', kind, x + 14, yy, 70, 26, 'legend')
            self.add(sid + 't', label, TEXT + 'verticalAlign=middle;fontSize=10;', x + 96, yy - 2, w - 106, 30,
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
    d.add('mail', c4('Proveedor de correo transaccional', 'Sistema externo · por definir',
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
    return d


# =====================================================================================
def containers():
    d = Diagram('c4-2-contenedores')
    d.title('[Diagrama de contenedores] Fin de Mes', 'Nivel 2 del modelo C4 · ambiente de integración · ' + DATE)
    d.add('vis', c4('Visitante', 'Persona', 'Sin cuenta.'), PERSON, 120, 90, 220, 210)
    d.add('usr', c4('Usuario registrado', 'Persona', 'Incluye a los miembros de un hogar.'),
          PERSON, 510, 90, 220, 210)
    d.add('adm', c4('Administrador', 'Persona', 'Desde un equipo de la tailnet.'), PERSON, 1570, 90, 220, 210)

    d.add('sb', '<b>Fin de Mes</b><br>[Sistema de software]', BOUNDARY, 40, 360, 1920, 680)
    d.add('web', c4('Aplicación web', 'Contenedor: Flutter web, sitio estático',
                    'Interfaz para navegador. No recalcula: consume la API.'), CONTAINER, 80, 420, 320, 170, 'sb')
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
    d.add('mail', c4('Proveedor de correo', 'Sistema externo · por definir', 'Correo transaccional.'),
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
    return d


# =====================================================================================
def components():
    d = Diagram('c4-3-componentes-api')
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
    d.add('x_mail', c4('Proveedor de correo', 'Sistema externo'), EXTERNAL, cx['hog'] - 40, EY, 236, 90)
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
    return d


# =====================================================================================
def deployment():
    d = Diagram('c4-4-despliegue')
    d.title('[Diagrama de despliegue] Fin de Mes · ambiente de integración',
            'Nivel C4 de despliegue · DigitalOcean, región NYC · cada flecha parte de quien inicia la conexión · '
            + DATE, w=1900)

    d.add('x_fin', c4('Fintoc', 'Sistema externo · llaves sk_test_', 'API de movimientos y widget.'),
          EXTERNAL, 620, 100, 300, 130)
    d.add('x_tbk', c4('Transbank Webpay Plus', 'Sistema externo · integración', 'Formulario y API de pago.'),
          EXTERNAL, 980, 100, 300, 130)
    d.add('x_mail', c4('Proveedor de correo', 'Sistema externo · por definir', 'Correo transaccional.'),
          EXTERNAL, 1340, 100, 300, 130)
    d.add('x_ts', c4('Tailscale', 'Sistema externo · plano de control', 'Coordina la tailnet; no ve el tráfico.'),
          EXTERNAL, 1880, 100, 300, 130)

    d.add('dev', node_label('Dispositivo del usuario', 'Nodo de despliegue', 'Internet · no confiable'),
          NODE_UNTRUSTED, 40, 300, 500, 760)
    d.add('br', node_label('Navegador web', 'Nodo: Chrome, Firefox, Edge o Safari'), NODE_GRAY, 60, 370, 460, 200,
          'dev')
    d.add('web', c4('Aplicación web', 'Contenedor: Flutter web',
                    'Acceso en memoria; refresh en cookie HttpOnly, Secure, SameSite=Strict.', 11),
          CONTAINER, 80, 430, 420, 120, 'br')
    d.add('ph', node_label('Teléfono', 'Nodo: Android 10+ o iOS 15+'), NODE_GRAY, 60, 600, 460, 200, 'dev')
    d.add('mob', c4('Aplicación móvil', 'Contenedor: Flutter', 'Refresh en flutter_secure_storage.', 11),
          CONTAINER, 80, 660, 420, 120, 'ph')
    d.add('wid', c4('Widget de Fintoc', 'Sistema externo: JavaScript en el navegador o WebView',
                    'El usuario escribe aquí su clave bancaria.', 11), EXTERNAL, 80, 840, 420, 190, 'dev')

    d.add('do', node_label('DigitalOcean · región NYC', 'Nodo: proyecto findemes-int'), NODE, 600, 300, 1220, 1120)
    d.add('ap', node_label('App Platform · app findemes-int', 'Nodo: contenedores gestionados'), NODE_GRAY,
          630, 350, 760, 520, 'do')
    d.add('edge', node_label('Borde de App Platform', 'Nodo: CDN de Cloudflare, TLS gestionado, dominio propio',
                             'Único punto de entrada público. Sin WAF propio en el MVP.'),
          NODE, 660, 420, 340, 130, 'ap')
    d.add('st', c4('Aplicación web', 'Contenedor: sitio estático', 'Sirve /. Mismo dominio que la API.', 11),
          CONTAINER, 660, 600, 340, 110, 'ap')
    d.add('mig', c4('Migrador', 'Contenedor: job previo al despliegue', 'Rol dueño.', 11),
          CONTAINER, 660, 740, 340, 100, 'ap')
    d.add('api', c4('API pública', 'Contenedor: Node.js 24, Fastify · N instancias',
                    'Sirve /v1. Incluye el motor en proceso. Sin estado.', 11), CONTAINER, 1060, 560, 300, 160, 'ap')
    d.add('secr', '<b>Secretos</b> como variables cifradas de App Platform: clave AES, clave JWT, sk de Fintoc, '
          'credenciales de Webpay, de correo y de cada rol. Nunca en la imagen ni en el repositorio.',
          NOTE, 1420, 350, 370, 110, 'do')

    d.add('vpc', node_label('VPC findemes-int-vpc', 'Nodo: red privada de la región NYC'), NODE_GRAY,
          630, 920, 1170, 470, 'do')
    d.add('pgn', node_label('PostgreSQL gestionado', 'Nodo: clúster de DigitalOcean'), NODE, 660, 980, 520, 380,
          'vpc')
    d.add('db', c4('Base de datos findemes', 'Contenedor: PostgreSQL 18',
                   'RLS · roles app_api y app_admin · auditoría solo inserciones, encadenada por hash.', 11),
          DB, 690, 1080, 460, 170, 'pgn')
    d.add('pgnote', 'Trusted sources: salida de App Platform por la VPC e IP privada del Droplet. Respaldo diario y '
          'recuperación a un punto en el tiempo (7 días).', NOTE, 690, 1270, 460, 70, 'pgn')
    d.add('dro', node_label('Droplet admin', 'Nodo: Ubuntu LTS + cliente Tailscale',
                            'Cloud Firewall: 0 reglas de entrada. Los servicios escuchan solo en la interfaz '
                            'de Tailscale.'), NODE_ADMIN, 1220, 980, 560, 380, 'vpc')
    d.add('aapi', c4('API de administración', 'Contenedor: Node.js 24, Fastify', 'TOTP · rol app_admin.', 11),
          CONTAINER, 1240, 1110, 220, 170, 'dro')
    d.add('pan', c4('Panel de administración', 'Contenedor: aplicación web', 'Estático.', 11),
          CONTAINER + PLANNED, 1540, 1110, 220, 170, 'dro')

    d.add('opd', node_label('Equipo del operador', 'Nodo: dispositivo tag:admin de la tailnet',
                            'Aprobación manual · MFA en el proveedor de identidad.'),
          NODE_ADMIN, 1880, 1080, 300, 230)
    d.add('opb', 'Navegador', CONTAINER.replace('#23A2D9', '#5B6770').replace('#0E7DAD', '#3D464C'),
          1910, 1170, 240, 60, 'opd')

    d.add('prod', '<b>Producción (fuera del alcance del MVP):</b> misma topología en otro proyecto de DigitalOcean, '
          'con clúster, credenciales y respaldos propios. Webpay requiere afiliación comercial y Fintoc, llaves '
          'live y consentimiento según la Ley 21.719.', NOTE, 600, 1450, 760, 70)

    d.rel('web', 'edge', 'Descarga la app<br>y llama a /v1', 'HTTPS 443, TLS', exit=right(d, 'web', 470),
          entry=left(d, 'edge', 470), lpos=-0.55)
    d.rel('mob', 'edge', 'Llama a /v1', 'HTTPS 443, TLS', exit=right(d, 'mob', 720), entry=left(d, 'edge', 520),
          pts=[(600, 720), (600, 520)], lpos=-0.1)
    d.rel('edge', 'st', 'Sirve /', 'enrutamiento interno', exit=bottom(d, 'edge', 830), entry=top(d, 'st', 830))
    d.rel('edge', 'api', 'Enruta /v1', 'enrutamiento interno', exit=right(d, 'edge', 500),
          entry=top(d, 'api', 1120), pts=[(1120, 500)])
    d.rel('web', 'x_tbk', 'Va al formulario de pago y vuelve a la URL de retorno fija', 'HTTPS', REL_BROWSER,
          exit=top(d, 'web', 300), entry=bottom(d, 'x_tbk', 1010), pts=[(300, 262), (1010, 262)], lpos=-0.4)
    d.rel('wid', 'x_fin', 'Clave bancaria<br>del usuario', 'HTTPS', REL_SECRET, exit=right(d, 'wid', 935),
          entry=bottom(d, 'x_fin', 660), pts=[(552, 935), (552, 278), (660, 278)], lpos=-0.55)
    d.rel('api', 'x_fin', 'Link Intent, canje<br>y movimientos', 'HTTPS 443 saliente',
          exit=top(d, 'api', 1090), entry=bottom(d, 'x_fin', 880), pts=[(1090, 290), (880, 290)])
    d.rel('api', 'x_tbk', 'Crea y confirma<br>(commit)', 'HTTPS 443 saliente', exit=top(d, 'api', 1200),
          entry=bottom(d, 'x_tbk', 1200))
    d.rel('api', 'x_mail', 'Envía correos', 'HTTPS 443 saliente', exit=top(d, 'api', 1320),
          entry=bottom(d, 'x_mail', 1380), pts=[(1320, 290), (1380, 290)])
    d.rel('api', 'db', 'rol app_api', 'TLS verify-full, 25060, por la VPC', exit=bottom(d, 'api', 1110),
          entry=top(d, 'db', 1110))
    d.rel('mig', 'db', 'rol dueño', 'TLS, 25060', exit=bottom(d, 'mig', 940), entry=top(d, 'db', 940))
    d.rel('aapi', 'db', 'rol app_admin', 'TLS verify-full, IP privada', exit=left(d, 'aapi', 1165),
          entry=right(d, 'db', 1165))
    d.rel('opb', 'pan', 'Usa el panel<br>(TOTP)', 'WireGuard sobre Tailscale<br>ACL tag:admin', REL_ADMIN,
          exit=left(d, 'opb', 1200), entry=right(d, 'pan', 1200))
    d.rel('pan', 'aapi', 'Llama a', 'HTTPS en la tailnet', REL_ADMIN, exit=left(d, 'pan', 1240),
          entry=right(d, 'aapi', 1240))
    d.rel('dro', 'x_ts', 'Coordina el túnel', 'HTTPS 443 saliente', REL_FAINT, exit=top(d, 'dro', 1740),
          entry=bottom(d, 'x_ts', 1930), pts=[(1740, 960), (1850, 960), (1850, 290), (1930, 290)])
    d.rel('opd', 'x_ts', '', '', REL_FAINT, exit=top(d, 'opd', 2100), entry=bottom(d, 'x_ts', 2100))
    d.legend(40, 1110, [
        (NODE.replace('container=1;', ''), 'Nodo de despliegue'),
        (NODE_UNTRUSTED.replace('container=1;', ''), 'Nodo no confiable (internet)'),
        (NODE_ADMIN.replace('container=1;', ''), 'Plano de administración (tailnet)'),
        (CONTAINER, 'Instancia de contenedor'),
        (EXTERNAL, 'Sistema externo'),
        ('edge:' + REL, 'Conexión (la inicia el origen)'),
        ('edge:' + REL_ADMIN, 'Tráfico de administración'),
        ('edge:' + REL_BROWSER, 'Redirección del navegador'),
        ('edge:' + REL_SECRET, 'Credencial que nunca toca Fin de Mes'),
    ], w=500)
    return d


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for build in (context, containers, components, deployment):
        print(build().write(out))


if __name__ == '__main__':
    main()

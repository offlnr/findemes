"""Generate the UML component diagram of the public API interior (hexagonal layers) as a draw.io file.

usage: python -I generate_comp2.py <out_dir>
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'architecture'))
from generate_c4 import Diagram, BAND, NOTE, TEXT, top, bottom, left, right, DATE  # noqa: E402

COMP = ('shape=module;jettyWidth=10;jettyHeight=6;whiteSpace=wrap;html=1;fillColor=#E4F3FB;strokeColor=#0E7DAD;'
        'fontColor=#000000;fontSize=11;spacingLeft=12;labelBackgroundColor=none;')
COMP_PLANNED = COMP + 'dashed=1;dashPattern=6 3;'
CORE = COMP.replace('#E4F3FB', '#FFE699').replace('#0E7DAD', '#B8860B') + 'strokeWidth=2;'
IFACE = ('rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#2086C9;fontColor=#000000;fontSize=11;'
         'labelBackgroundColor=none;')
CONTAINER = ('rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0E7DAD;strokeWidth=2;'
             'fontColor=#0E4D6E;align=center;verticalAlign=top;spacingTop=6;fontSize=14;fontStyle=1;'
             'container=1;collapsible=0;pointerEvents=0;')
LAYER = BAND
CORE_LAYER = BAND.replace('#F4F8FB', '#FFF8E1').replace('#C9D6E2', '#E0C068')

DEP = ('endArrow=open;endFill=0;endSize=10;html=1;dashed=1;dashPattern=6 4;strokeColor=#4D4D4D;strokeWidth=1.2;'
       'rounded=1;arcSize=6;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;fontSize=10;fontColor=#404040;'
       'labelBackgroundColor=#FFFFFF;')
REAL = ('endArrow=block;endFill=0;endSize=12;html=1;dashed=1;dashPattern=6 4;strokeColor=#2086C9;strokeWidth=1.2;'
        'rounded=1;arcSize=6;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;fontSize=10;fontColor=#2086C9;'
        'labelBackgroundColor=#FFFFFF;')


def comp(name, desc='', stereo=''):
    out = ''
    if stereo:
        out += '<span style="font-size:9px;color:#555555">«%s»</span><br>' % stereo
    out += '<b>%s</b>' % name
    if desc:
        out += '<br><span style="font-size:9px">%s</span>' % desc
    return out


def iface(name):
    return '<span style="font-size:9px;color:#555555">«interfaz»</span><br><b>%s</b>' % name


def build():
    d = Diagram('comp-2-api-publica')
    d.title('Diagrama de componentes · Interior de la API pública (arquitectura hexagonal)',
            'UML 2.5 · las capas se leen de arriba hacia abajo · las dependencias apuntan hacia el núcleo · ' + DATE,
            w=1600)

    # External interface provided by the REST controllers.
    d.add('rest', iface('API REST /v1'), IFACE, 760, 95, 160, 46)

    d.add('api', 'API pública', CONTAINER, 40, 165, 1620, 655)

    # 1. Input adapters.
    d.add('l1', '', LAYER, 70, 205, 1560, 120, 'api')
    d.add('ctl', comp('Controladores REST', 'validan los datos y llaman al caso de uso', 'previsto'), COMP_PLANNED,
          730, 240, 220, 66, 'l1')
    d.add('err', comp('Errores HTTP uniformes', 'misma forma de error en toda la API'), COMP, 1010, 240, 220, 66, 'l1')
    d.add('root', comp('Raíz de composición', 'al iniciar, conecta cada puerto con su adaptador'), COMP,
          1330, 240, 270, 66, 'l1')

    # 2. Use cases (modules).
    d.add('l2', '', LAYER, 70, 355, 1560, 125, 'api')
    names = [('prv', 'Privacidad'), ('aud', 'Auditoría'), ('idn', 'Identidad'), ('hog', 'Hogar'),
             ('sub', 'Suscripción'), ('agg', 'Agregación bancaria'), ('reg', 'Registro financiero'),
             ('scn', 'Escenarios'), ('dem', 'Demostración')]
    for i, (cid, name) in enumerate(names):
        d.add(cid, comp(name, '', 'previsto'), COMP_PLANNED, 90 + i * 170, 390, 150, 66, 'l2')

    # 3. Ports.
    d.add('l3', '', LAYER,
          70, 510, 1560, 115, 'api')
    ports = [('p_db', 'Persistencia', 175), ('p_sec', 'Seguridad de acceso', 480), ('p_mail', 'Envío de correo', 680),
             ('p_pay', 'Pasarela de pago', 860), ('p_bank', 'Agregador bancario', 1040),
             ('p_sim', 'Simulación', 1355)]
    for cid, name, cx in ports:
        d.add(cid, iface(name), IFACE, cx - 75, 555, 150, 50, 'l3')

    # 4. Output adapters and core.
    d.add('l4', '', LAYER,
          70, 655, 1170, 140, 'api')
    adapters = [('a_pg', 'PostgreSQL', 'consultas siempre filtradas por usuario', 175, 'previsto'),
                ('a_sec', 'Seguridad', 'argon2id y emisión de sesiones', 480, 'previsto'),
                ('a_mail', 'Correo transaccional', '', 680, 'previsto'),
                ('a_wp', 'Webpay Plus', '', 860, 'previsto'),
                ('a_fin', 'Fintoc', '', 1010, 'previsto'),
                ('a_demo', 'Banco de demostración', 'mismo puerto que Fintoc', 1155, '')]
    for cid, name, desc, cx, st in adapters:
        w = {'a_wp': 150, 'a_fin': 110, 'a_demo': 150}.get(cid, 170)
        d.add(cid, comp(name, desc, st), COMP_PLANNED if st else COMP, cx - w // 2, 700, w, 70, 'l4')
    d.add('l5', '5. Núcleo', CORE_LAYER, 1260, 655, 370, 140, 'api')
    d.add('core', comp('Motor de simulación', 'cálculo puro y determinista; no depende de nada externo',
                       'núcleo'), CORE, 1270 + 15, 700, 330, 70, 'l5')

    # Layer names, written vertically so that no relation crosses them.
    strip = 'text;html=1;horizontal=0;align=center;verticalAlign=middle;fontStyle=1;fontSize=11;fontColor=#33506B;'
    for lid, name in [('l1', '1 · Entrada'), ('l2', '2 · Casos de uso'), ('l3', '3 · Puertos'), ('l4', '4 · Salida')]:
        _, y, _, h = d.geo[lid]
        d.add(lid + 'n', name, strip, 44, y, 24, h, 'api')

    # Relations: input side.
    d.rel('ctl', 'rest', '', style=REAL, exit=top(d, 'ctl', 840), entry=bottom(d, 'rest', 840))
    d.rel('ctl', 'err', 'usa', style=DEP, exit=right(d, 'ctl', 273), entry=left(d, 'err', 273))
    d.rel('ctl', 'l2', 'invoca', style=DEP, exit=bottom(d, 'ctl', 840), entry=top(d, 'l2', 840))

    # Modules require ports.
    d.add('dbnote', 'guardan y leen datos (todos los módulos salvo Demostración)',
          TEXT + 'fontSize=9;verticalAlign=middle;', 183, 481, 300, 24, 'api')
    d.rel('l2', 'p_db', '', style=DEP,
          exit=bottom(d, 'l2', 175), entry=top(d, 'p_db', 175))
    d.rel('idn', 'p_sec', '', style=DEP, exit=bottom(d, 'idn', 480), entry=top(d, 'p_sec', 480))
    d.rel('idn', 'p_mail', '', style=DEP, exit=bottom(d, 'idn', 560), entry=top(d, 'p_mail', 640),
          pts=[(560, 493), (640, 493)])
    d.rel('hog', 'p_mail', '', style=DEP, exit=bottom(d, 'hog', 700), entry=top(d, 'p_mail', 700))
    d.rel('sub', 'p_pay', '', style=DEP, exit=bottom(d, 'sub', 860), entry=top(d, 'p_pay', 860))
    d.rel('agg', 'p_bank', '', style=DEP, exit=bottom(d, 'agg', 1040), entry=top(d, 'p_bank', 1040))
    d.rel('reg', 'p_sim', '', style=DEP, exit=bottom(d, 'reg', 1200), entry=top(d, 'p_sim', 1310),
          pts=[(1200, 493), (1310, 493)])
    d.rel('scn', 'p_sim', '', style=DEP, exit=bottom(d, 'scn', 1355), entry=top(d, 'p_sim', 1355))
    d.rel('dem', 'p_sim', '', style=DEP, exit=bottom(d, 'dem', 1500), entry=top(d, 'p_sim', 1400),
          pts=[(1500, 493), (1400, 493)])

    # Adapters and core realize ports.
    for a, p, ax, px in [('a_pg', 'p_db', 175, 175), ('a_sec', 'p_sec', 480, 480), ('a_mail', 'p_mail', 680, 680),
                         ('a_wp', 'p_pay', 860, 860), ('a_fin', 'p_bank', 1010, 1010),
                         ('a_demo', 'p_bank', 1100, 1080), ('core', 'p_sim', 1355, 1355)]:
        pts = [(ax, 640), (px, 640)] if ax != px else None
        d.rel(a, p, '', style=REAL, exit=top(d, a, ax), entry=bottom(d, p, px), pts=pts)

    # Legend.
    d.add('lg', '<b>Notación UML 2.5</b>', BAND.replace('#F4F8FB', '#FFFFFF'), 40, 845, 1620, 110)
    d.add('lg1', '', COMP, 60, 885, 70, 40, 'lg')
    d.add('lg1t', 'Componente: parte reemplazable de la API.', TEXT + 'verticalAlign=middle;fontSize=10;',
          140, 885, 220, 40, 'lg')
    d.add('lg2', '', COMP_PLANNED, 370, 885, 70, 40, 'lg')
    d.add('lg2t', 'Borde discontinuo «previsto»: diseñado, aún no implementado.',
          TEXT + 'verticalAlign=middle;fontSize=10;', 450, 885, 230, 40, 'lg')
    d.add('lg3a', '', 'text;', 700, 905, 1, 2, 'lg')
    d.add('lg3b', '', 'text;', 770, 905, 1, 2, 'lg')
    d.rel('lg3a', 'lg3b', style=DEP)
    d.add('lg3t', 'Dependencia: el componente necesita esa interfaz.', TEXT + 'verticalAlign=middle;fontSize=10;',
          780, 885, 230, 40, 'lg')
    d.add('lg4a', '', 'text;', 1030, 905, 1, 2, 'lg')
    d.add('lg4b', '', 'text;', 1100, 905, 1, 2, 'lg')
    d.rel('lg4a', 'lg4b', style=REAL)
    d.add('lg4t', 'Realización: el componente implementa esa interfaz. Cambiar Fintoc por el banco de '
          'demostración no modifica los casos de uso ni el núcleo.', TEXT + 'verticalAlign=middle;fontSize=10;',
          1110, 880, 530, 50, 'lg')
    return d


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    print(build().write(out))


if __name__ == '__main__':
    main()

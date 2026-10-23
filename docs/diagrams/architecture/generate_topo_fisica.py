"""Generate the physical communications topology (star) of Fin de Mes as a draw.io file with Cisco icons.

usage: python -I generate_topo_fisica.py <out_dir>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_c4 import Diagram, TEXT, DATE  # noqa: E402

ZONE = ('rounded=0;whiteSpace=wrap;html=1;fillColor=#FFF7B3;strokeColor=#B8A100;fontColor=#4D4300;'
        'align=center;verticalAlign=top;spacingTop=4;fontSize=12;fontStyle=1;container=1;collapsible=0;'
        'pointerEvents=0;')
ZONE_AWS = ZONE.replace('#FFF7B3', '#FFE8CC').replace('#B8A100', '#D68910').replace('#4D4300', '#7A4A00')
ZONE_EXT = ZONE.replace('#FFF7B3', '#EDEDED').replace('#B8A100', '#8C8C8C').replace('#4D4300', '#333333')
ICON = ('html=1;pointerEvents=1;dashed=0;fillColor=#036897;strokeColor=#ffffff;strokeWidth=2;'
        'verticalLabelPosition=bottom;verticalAlign=top;align=center;outlineConnect=0;fontSize=10;'
        'fontColor=#222222;shape=mxgraph.cisco.')
LINK = 'endArrow=none;html=1;strokeColor=#333333;strokeWidth=1.6;rounded=0;'
WIFI = LINK.replace('#333333', '#7F7F7F') + 'dashed=1;dashPattern=4 4;'
TUNNEL = ('endArrow=none;html=1;strokeColor=#D68910;strokeWidth=2.5;dashed=1;dashPattern=10 5;rounded=1;'
          'edgeStyle=orthogonalEdgeStyle;fontSize=10;fontColor=#A6610A;labelBackgroundColor=#FFFFFF;')


def icon(d, cid, kind, label, x, y, w, h, parent='1'):
    return d.add(cid, label, ICON + kind + ';', x, y, w, h, parent)


def build():
    d = Diagram('topologia-fisica')
    d.title('[Topología física] Fin de Mes · topología en estrella extendida',
            'Internet es el nodo central de la estrella · dentro de AWS la red es jerárquica · ' + DATE, w=1600)

    # Center of the star.
    icon(d, 'inet', 'storage.cloud', '<b>Internet</b>', 730, 420, 280, 160)

    # External services.
    d.add('z_ext', 'Servicios externos', ZONE_EXT, 520, 95, 700, 175)
    for i, (cid, name) in enumerate([('fin', 'Fintoc'), ('tbk', 'Transbank<br>Webpay Plus'),
                                     ('mail', 'Amazon SES<br>(correo)'), ('gh', 'GitHub')]):
        icon(d, cid, 'storage.cloud;verticalLabelPosition=middle;verticalAlign=middle;fontColor=#FFFFFF;fontStyle=1', name, 545 + i * 165, 135, 130, 76, 'z_ext')

    # Development zones.
    d.add('z_dev1', 'Zona de desarrollo · hogar de J. Varas', ZONE, 40, 95, 440, 200)
    icon(d, 'nb1', 'computers_and_peripherals.laptop', 'Notebook de desarrollo<br>(Windows 11)', 80, 160, 70, 45,
         'z_dev1')
    icon(d, 'r_dev1', 'routers.router', 'Router del proveedor<br>de internet (fibra 600 Mbps)', 320, 165, 60, 40,
         'z_dev1')
    d.add('z_dev2', 'Zona de desarrollo · hogar de M. Lizana', ZONE, 40, 320, 440, 250)
    icon(d, 'nb2', 'computers_and_peripherals.laptop', 'Notebook de desarrollo', 70, 370, 70, 45, 'z_dev2')
    icon(d, 'mac', 'computers_and_peripherals.macintosh', 'Mac mini M4<br>(compilación iOS)', 70, 465, 50, 55,
         'z_dev2')
    icon(d, 'ph1', 'modems_and_phones.cell_phone', 'Galaxy A16', 200, 365, 26, 52, 'z_dev2')
    icon(d, 'ph2', 'modems_and_phones.cell_phone', 'iPhone SE', 200, 465, 26, 52, 'z_dev2')
    icon(d, 'r_dev2', 'routers.wireless_router', 'Router Wi-Fi del proveedor<br>de internet (fibra 600 Mbps)',
         320, 415, 60, 45, 'z_dev2')
    d.add('z_mnt', 'Zona de mantenimiento · equipo del operador', ZONE, 40, 595, 440, 200)
    icon(d, 'op', 'computers_and_peripherals.laptop', 'Equipo autorizado<br>(Tailscale, etiqueta admin)', 80, 660,
         70, 45, 'z_mnt')
    icon(d, 'r_mnt', 'routers.router', 'Router del proveedor<br>de internet', 320, 665, 60, 40, 'z_mnt')

    # Use zone.
    d.add('z_use', 'Zona de uso · usuarios de Fin de Mes', ZONE, 1260, 300, 500, 260)
    icon(d, 'pc', 'computers_and_peripherals.pc', 'PC o notebook<br>con navegador', 1640, 345, 45, 55, 'z_use')
    icon(d, 'r_use', 'routers.wireless_router', 'Router del hogar<br>del usuario', 1310, 355, 60, 45, 'z_use')
    icon(d, 'cel', 'modems_and_phones.cell_phone', 'Teléfono con la<br>app (Android o iOS)', 1650, 455, 26, 52,
         'z_use')
    icon(d, 'ant', 'wireless.radio_tower', 'Antena de red<br>móvil 4G/5G', 1320, 450, 40, 60, 'z_use')

    # AWS zone (hierarchical).
    d.add('z_aws', 'Nube de AWS · región us-east-1', ZONE_AWS, 1060, 600, 700, 400)
    icon(d, 'edge', 'security.firewall', 'Borde de AWS: CloudFront<br>y API Gateway (única entrada)', 1100, 660, 64,
         50, 'z_aws')
    icon(d, 'igw', 'routers.router;labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle', 'Router de la VPC<br>(Internet Gateway)<br>10.0.0.0/16', 1320, 665, 60, 40,
         'z_aws')
    icon(d, 'sw_pub', 'switches.workgroup_switch;labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle', 'Subred pública<br>10.0.1.0/24', 1230, 780, 64, 32, 'z_aws')
    icon(d, 'ec2_api', 'servers.fileserver', 'Servidor EC2<br>API pública', 1150, 880, 40, 58, 'z_aws')
    icon(d, 'ec2_adm', 'servers.fileserver', 'Servidor EC2<br>administración', 1320, 880, 40, 58, 'z_aws')
    icon(d, 'sw_priv', 'switches.workgroup_switch', 'Subredes privadas<br>10.0.11.0/24 y 10.0.12.0/24',
         1490, 780, 64, 32, 'z_aws')
    icon(d, 'rds', 'storage.relational_database', 'Base de datos RDS<br>PostgreSQL 18', 1665, 766, 45, 60, 'z_aws')

    # Star links to Internet.
    for z in ('r_dev1', 'r_dev2', 'r_mnt', 'r_use', 'ant', 'edge', 'fin', 'tbk', 'mail', 'gh'):
        d.rel(z, 'inet', style=LINK)
    # Local links.
    d.rel('nb1', 'r_dev1', style=LINK)
    d.rel('nb2', 'r_dev2', style=LINK)
    d.rel('mac', 'r_dev2', style=LINK)
    d.rel('ph1', 'r_dev2', style=WIFI)
    d.rel('ph2', 'r_dev2', style=WIFI)
    d.rel('op', 'r_mnt', style=LINK)
    d.rel('pc', 'r_use', style=WIFI)
    d.rel('cel', 'ant', style=WIFI)
    d.rel('edge', 'igw', style=LINK)
    d.rel('igw', 'sw_pub', style=LINK)
    d.rel('igw', 'sw_priv', style=LINK)
    d.rel('sw_pub', 'ec2_api', style=LINK)
    d.rel('sw_pub', 'ec2_adm', style=LINK)
    d.rel('sw_priv', 'rds', style=LINK)
    # Administration tunnel (overlay network over Internet).
    d.rel('op', 'ec2_adm', 'Túnel cifrado de administración (Tailscale sobre internet)', style=TUNNEL,
          exit=(0, 0.5), entry=(1, 0.5), pts=[(60, 682), (60, 1040), (1400, 1040), (1400, 909)], lpos=-0.1)

    # Legend.
    d.add('lg', '<b>Leyenda</b>', ZONE_EXT.replace('#EDEDED', '#FFFFFF').replace('align=center', 'align=left')
          .replace('spacingTop=4', 'spacingTop=4;spacingLeft=10'), 1260, 95, 500, 160)
    for i, (st, txt) in enumerate([(LINK, 'Enlace cableado o de fibra'),
                                   (WIFI, 'Enlace inalámbrico (Wi-Fi o red móvil)'),
                                   (TUNNEL.replace('edgeStyle=orthogonalEdgeStyle;', ''),
                                    'Túnel cifrado de administración')]):
        y = 135 + i * 32
        d.add('lg%da' % i, '', 'text;', 1280, y, 1, 2, 'lg')
        d.add('lg%db' % i, '', 'text;', 1360, y, 1, 2, 'lg')
        d.rel('lg%da' % i, 'lg%db' % i, style=st)
        d.add('lg%dt' % i, txt, TEXT + 'verticalAlign=middle;fontSize=10;', 1375, y - 12, 360, 26, 'lg')
    return d


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    print(build().write(out))


if __name__ == '__main__':
    main()

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../data/models.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Cuentas y movimientos vía Fintoc (HU36). La clave bancaria solo la recibe el widget de Fintoc.
class BanksScreen extends ConsumerStatefulWidget {
  const BanksScreen({super.key});
  @override
  ConsumerState<BanksScreen> createState() => _BanksScreenState();
}

class _BanksScreenState extends ConsumerState<BanksScreen> {
  bool _connected = true;

  void _demoNotice(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) {
    if (!_connected) {
      return PageBody(children: [
        const PageHeader(icon: FdmIcons.bank, title: 'Bancos', subtitle: 'Trae tus cuentas y movimientos con Fintoc, en modo de prueba durante el proyecto.'),
        ResponsiveRow(children: [
          FdmCard(title: 'Conecta tu cuenta corriente o vista', children: [
            const Muted('Se abre el widget de Fintoc. Tu clave bancaria la ingresas allí: Fin de Mes nunca la recibe. Solo obtenemos acceso de lectura y puedes desconectar cuando quieras.', size: 14),
            Wrap(spacing: 12, runSpacing: 12, children: [
              FilledButton(onPressed: () => setState(() => _connected = true), child: const Text('Conectar con Fintoc')),
              OutlinedButton(onPressed: () => setState(() => _connected = true), child: const Text('Usar banco de demostración')),
            ]),
          ]),
          const FdmCard(title: 'Qué se trae y qué no', children: [
            Bullets([
              'Cuentas corrientes y vista, con su saldo disponible.',
              'Movimientos con fecha, descripción y monto en pesos.',
              'No se traen tarjetas de crédito: tus cuotas se registran a mano.',
              'Tú confirmas qué movimientos son recurrentes.',
            ]),
          ]),
        ]),
      ]);
    }
    return AsyncBody(
      ref.watch(banksProvider),
      builder: (b) => PageBody(children: [
        PageHeader(
          icon: FdmIcons.bank,
          title: 'Bancos',
          subtitle: 'Cuentas conectadas y movimientos recientes.',
          actions: [OutlinedButton(onPressed: () => setState(() => _connected = false), child: const Text('Desconectar y revocar acceso'))],
        ),
        for (final a in b.accounts)
          FdmCard(
            title: a.bank,
            trailing: Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              OriginPill(a.origin),
              TextButton(onPressed: () => _demoNotice('Sincronización de demostración.'), child: const Text('Sincronizar ahora')),
            ]),
            children: [
              Wrap(spacing: 40, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Muted('${a.type} · ${a.number}', size: 14),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Text('Saldo disponible  ', style: FdmText.ui(14)),
                  Text(clp(a.available), style: FdmText.number(18, weight: FontWeight.w700)),
                ]),
                const Muted('Sincronizado hace 3 minutos'),
              ]),
            ],
          ),
        FdmCard(title: 'Totales por mes', children: [
          FdmTable(
            columns: const [Col('Mes', flex: 2), Col('Abonos', flex: 2), Col('Cargos', flex: 2)],
            rows: [for (final t in b.totals) [Cell(t.month), Cell(clp(t.credits), number: true), Cell(clp(-t.debits), number: true)]],
          ),
        ]),
        FdmCard(title: 'Movimientos', children: [
          const Muted('Marca lo que se repite cada mes para llevarlo a tu registro. Fin de Mes no clasifica solo tus movimientos.', size: 14),
          FdmTable(
            minWidth: 720,
            columns: const [Col('Fecha', width: 120), Col('Descripción', flex: 4), Col('Monto', flex: 2), Col('¿Recurrente?', width: 230)],
            rows: [for (final m in b.movements) _row(m)],
          ),
        ]),
      ]),
    );
  }

  List<Cell> _row(Movement m) => [
        Cell(m.date),
        Cell.w(Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [Text(m.description, style: FdmText.ui(13)), OriginPill(m.origin)])),
        Cell(m.amount > 0 ? '+${clp(m.amount)}' : clp(m.amount), number: true),
        Cell.w(m.inRegistry
            ? const Pill('En tu registro')
            : OutlinedButton(onPressed: () => _demoNotice('Modo demostración: el cambio no se guarda hasta conectar la API.'), child: const Text('Marcar como recurrente'))),
      ];
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/registry_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/chart_scale.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Proyección mensual (HU05) calculada en el servidor con el registro actual. El horizonte es
/// configurable. El motor es mensual: responde "en qué mes", no "en qué semana".
class ProjectionScreen extends ConsumerStatefulWidget {
  const ProjectionScreen({super.key});
  @override
  ConsumerState<ProjectionScreen> createState() => _ProjectionScreenState();
}

class _ProjectionScreenState extends ConsumerState<ProjectionScreen> {
  int _horizon = 12;

  @override
  Widget build(BuildContext context) => AsyncBody(
        ref.watch(projectionDataProvider(_horizon)),
        builder: (projection) => PageBody(children: [
          PageHeader(
            icon: FdmIcons.chart,
            title: 'Proyección',
            subtitle: 'Tu saldo mes a mes según tu registro actual.',
            actions: [
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 3, label: Text('3 meses')),
                  ButtonSegment(value: 6, label: Text('6 meses')),
                  ButtonSegment(value: 12, label: Text('12 meses')),
                  ButtonSegment(value: 24, label: Text('24 meses')),
                ],
                selected: {_horizon},
                showSelectedIcon: false,
                onSelectionChanged: (s) => setState(() => _horizon = s.first),
              ),
            ],
          ),
          if (projection == null) const NeedsOpeningBalance() else ..._body(projection),
        ]),
      );

  List<Widget> _body(ProjectionData p) {
    final months = p.outcome.months;
    final closings = [for (final m in months) m.closingBalance];
    final scale = ChartScale.of(closings);
    return [
      FdmCard(title: 'Saldo al cierre de cada mes', children: [
        LineChart(
          height: 280,
          semanticLabel: 'Saldo al cierre de ${months.length} meses: ${[for (final m in months) '${monthLong(m.month)} ${clp(m.closingBalance)}'].join(', ')}.',
          series: [LineSeries(name: 'Saldo al cierre', values: closings, color: FdmColors.ink, area: true)],
          labels: [for (final m in months) monthInitial(m.month)],
          min: scale.min,
          max: scale.max,
          ticks: scale.ticks,
        ),
        Muted(p.summary),
      ]),
      FdmCard(children: [
        FdmTable(
          minWidth: 860,
          columns: const [Col('Mes', flex: 2), Col('Saldo inicial', flex: 2), Col('Ingresos', flex: 2), Col('Gastos', flex: 2), Col('Cuotas', flex: 2), Col('Margen', flex: 2), Col('Saldo al cierre', flex: 2)],
          rows: [
            for (final m in months)
              [
                Cell(monthShort(m.month)),
                Cell(clp(m.openingBalance), number: true),
                Cell(clp(m.income), number: true),
                Cell(clp(m.expenses), number: true),
                Cell(clp(m.debtPayments), number: true),
                Cell(clp(m.netFlow), number: true),
                Cell(clp(m.closingBalance), number: true, strong: true),
              ],
          ],
        ),
      ]),
      const Muted('El motor es mensual: indica en qué mes ocurre algo, no en qué semana.'),
    ];
  }
}

/// Mientras no hay saldo inicial no se puede proyectar (HU04 es el punto de partida).
class NeedsOpeningBalance extends StatelessWidget {
  const NeedsOpeningBalance({super.key});
  @override
  Widget build(BuildContext context) => FdmCard(title: 'Falta tu saldo inicial', children: [
        const Muted('La proyección parte de lo que tienes al comenzar el mes. Regístralo junto con tus ingresos, gastos y deudas.', size: 14),
        Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: () => context.go('/app/registro'), child: const Text('Ir al registro'))),
      ]);
}

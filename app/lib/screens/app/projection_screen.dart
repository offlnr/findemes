import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Proyección mensual (HU05). El motor es mensual: responde "en qué mes", no "en qué semana".
class ProjectionScreen extends ConsumerStatefulWidget {
  const ProjectionScreen({super.key});
  @override
  ConsumerState<ProjectionScreen> createState() => _ProjectionScreenState();
}

class _ProjectionScreenState extends ConsumerState<ProjectionScreen> {
  int _horizon = 12;

  @override
  Widget build(BuildContext context) => AsyncBody(
        ref.watch(projectionProvider),
        builder: (all) {
          final months = all.take(_horizon).toList();
          return PageBody(children: [
            PageHeader(
              icon: FdmIcons.chart,
              title: 'Proyección',
              subtitle: 'Tu saldo mes a mes según tu registro actual.',
              actions: [
                SegmentedButton<int>(
                  segments: const [ButtonSegment(value: 3, label: Text('3 meses')), ButtonSegment(value: 6, label: Text('6 meses')), ButtonSegment(value: 12, label: Text('12 meses'))],
                  selected: {_horizon},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => setState(() => _horizon = s.first),
                ),
              ],
            ),
            FdmCard(
              title: 'Saldo al cierre de cada mes',
              children: [
                Wrap(spacing: 20, runSpacing: 8, children: [
                  _legend(FdmColors.accent, 'Mes con cuota del crédito'),
                  _legend(FdmColors.ink, 'Sin cuota del crédito'),
                ]),
                BarChart(
                  semanticLabel: 'Saldo al cierre de ${months.length} meses, desde ${clp(months.first.closing)} hasta ${clp(months.last.closing)}.',
                  values: [for (final m in months) m.closing],
                  labels: [for (final m in months) m.short],
                  colors: [for (final m in months) m.debt != 0 ? FdmColors.accent : FdmColors.ink],
                  max: 3000000,
                  ticks: const [0, 1000000, 2000000, 3000000],
                ),
                const Muted('De noviembre a marzo el saldo sube \$40.000 al mes porque se paga la cuota del crédito (\$220.000). Desde abril sube \$260.000 al mes.'),
              ],
            ),
            FdmCard(children: [
              FdmTable(
                minWidth: 980,
                columns: const [Col('Mes', flex: 2), Col('Saldo inicial', flex: 2), Col('Ingresos', flex: 2), Col('Gastos', flex: 2), Col('Aporte hogar', flex: 2), Col('Cuotas', flex: 2), Col('Margen', flex: 2), Col('Saldo al cierre', flex: 2)],
                rows: [
                  for (final m in months)
                    [
                      Cell(m.label),
                      Cell(clp(m.opening), number: true),
                      Cell(clp(m.income), number: true),
                      Cell(clp(m.expenses), number: true),
                      Cell(clp(m.household), number: true),
                      Cell(clp(m.debt), number: true),
                      Cell(clp(m.margin), number: true),
                      Cell(clp(m.closing), number: true, strong: true),
                    ],
                ],
              ),
            ]),
            const Muted('El motor es mensual: indica en qué mes ocurre algo, no en qué semana.'),
          ]);
        },
      );

  Widget _legend(Color c, String t) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 14, height: 14, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(4))),
        const SizedBox(width: 8),
        Text(t, style: FdmText.ui(12, weight: FontWeight.w500)),
      ]);
}

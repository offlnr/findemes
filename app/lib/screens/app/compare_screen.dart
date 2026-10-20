import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import 'scenario_screen.dart';

/// Comparación de escenarios (HU09). Columnas en orden de creación; ninguna se destaca.
class CompareScreen extends ConsumerStatefulWidget {
  const CompareScreen({super.key});
  @override
  ConsumerState<CompareScreen> createState() => _CompareScreenState();
}

class _CompareScreenState extends ConsumerState<CompareScreen> {
  final Set<String> _picked = {'notebook-12', 'notebook-contado'};
  static const _colors = [FdmColors.ink, FdmColors.muted, Color(0xFF7FA98F)];

  @override
  Widget build(BuildContext context) => AsyncBody(
        ref.watch(scenariosProvider),
        builder: (all) {
          final ids = [for (final s in all) if (_picked.contains(s.id)) s.id];
          return PageBody(children: [
            const PageHeader(icon: FdmIcons.columns, title: 'Comparar escenarios', subtitle: 'Indicadores de cada escenario junto a la base.'),
            FdmCard(title: 'Escenarios a comparar', children: [
              const Muted('Hasta 3 a la vez. (Plan Gratuito: 1 escenario frente a la base.)'),
              Wrap(spacing: 10, runSpacing: 10, children: [
                for (final s in all)
                  FilterChip(
                    label: Text(s.name),
                    selected: _picked.contains(s.id),
                    onSelected: (on) => setState(() {
                      if (on && _picked.length < 3) _picked.add(s.id);
                      if (!on) _picked.remove(s.id);
                    }),
                  ),
              ]),
            ]),
            if (ids.isEmpty)
              const Notice('Elige al menos un escenario.')
            else
              AsyncBody(
                ref.watch(compareProvider(ids.join(','))),
                builder: (c) {
                  final series = [
                    LineSeries(name: 'Situación base', values: c.series.first, color: FdmColors.accent, dashed: true, width: 2.5),
                    for (var i = 1; i < c.series.length; i++) LineSeries(name: c.columns[i], values: c.series[i], color: _colors[(i - 1) % _colors.length]),
                  ];
                  final hasNegative = c.series.any((s) => s.any((v) => v < 0));
                  return Gap([
                    FdmCard(children: [IndicatorTable(columns: c.columns, rows: c.rows)]),
                    const Notice('Los escenarios aparecen en el orden en que los creaste. Fin de Mes no los ordena por conveniencia ni destaca ninguno.'),
                    FdmCard(title: 'Saldo al cierre de cada mes', children: [
                      ChartLegend(series),
                      LineChart(
                        height: 320,
                        semanticLabel: 'Saldo al cierre por mes de la base y de cada escenario elegido.',
                        series: series,
                        labels: const ['nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct'],
                        min: hasNegative ? -500000 : 0,
                        max: 3000000,
                        ticks: const [0, 1000000, 2000000, 3000000],
                        marks: [
                          for (var i = 1; i < c.breakMarks.length; i++)
                            if (c.breakMarks[i] case final b?)
                              ChartMark(index: b, value: c.series[i][b], label: 'Quiebre: ${c.columns[i]}', color: _colors[(i - 1) % _colors.length], below: true),
                        ],
                      ),
                      const Muted('La línea en \$0 marca dónde el saldo al cierre quedaría negativo.'),
                    ]),
                  ]);
                },
              ),
          ]);
        },
      );
}

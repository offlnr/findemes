import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart' show IndicatorComparison;
import '../../data/scenario_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/chart_scale.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import 'scenario_screen.dart';
import 'summary_screen.dart';

/// Comparación de escenarios (HU09). Columnas en el orden elegido; ninguna se destaca ni se
/// ordena por conveniencia (regla 4). El plan gratuito compara un escenario frente a la base.
class CompareScreen extends ConsumerStatefulWidget {
  const CompareScreen({super.key});
  @override
  ConsumerState<CompareScreen> createState() => _CompareScreenState();
}

class _CompareScreenState extends ConsumerState<CompareScreen> {
  final List<String> _picked = [];
  static const _colors = [FdmColors.ink, FdmColors.muted, Color(0xFF7FA98F), Color(0xFF456B59), Color(0xFF1D4634)];

  @override
  Widget build(BuildContext context) => AsyncBody(
        ref.watch(scenarioListProvider),
        builder: (data) {
          final max = data.plan.maxComparedScenarios;
          final picked = [for (final id in _picked) if (data.scenarios.any((s) => s.id == id)) id];
          return PageBody(children: [
            const PageHeader(icon: FdmIcons.columns, title: 'Comparar escenarios', subtitle: 'Indicadores de cada escenario junto a la base.'),
            FdmCard(title: 'Escenarios a comparar', children: [
              Muted(max == 1 ? 'El plan ${data.plan.name} compara un escenario frente a la base.' : 'Hasta $max escenarios a la vez.'),
              if (data.scenarios.isEmpty) const Muted('Primero crea un escenario.'),
              Wrap(spacing: 10, runSpacing: 10, children: [
                for (final s in data.scenarios)
                  FilterChip(
                    label: Text(s.name),
                    selected: picked.contains(s.id),
                    onSelected: (on) => setState(() {
                      if (on) {
                        if (max == 1) _picked.clear();
                        if (_picked.length < max) _picked.add(s.id);
                      } else {
                        _picked.remove(s.id);
                      }
                    }),
                  ),
              ]),
            ]),
            if (picked.isEmpty)
              const Notice('Elige al menos un escenario.')
            else
              AsyncBody(ref.watch(comparisonProvider(picked.join(','))), builder: _comparison),
          ]);
        },
      );

  Widget _comparison(ComparisonData c) {
    final series = [
      LineSeries(name: 'Situación base', values: [for (final m in c.base.months) m.closingBalance], color: FdmColors.accent, dashed: true, width: 2.5),
      for (var i = 0; i < c.scenarios.length; i++)
        LineSeries(name: c.scenarios[i].name, values: [for (final m in c.scenarios[i].outcome.months) m.closingBalance], color: _colors[i % _colors.length]),
    ];
    final scale = ChartScale.of([for (final s in series) ...s.values]);
    final base = c.base.indicators;
    String breakMonth(String? m) => m == null ? 'No ocurre' : monthShort(m);
    final rows = [
      IndicatorComparison(
        label: 'Saldo mínimo proyectado',
        explanation: 'Diferencia frente a la base entre paréntesis.',
        values: [clp(base.minimumAmount), for (final s in c.scenarios) '${clp(s.outcome.indicators.minimumAmount)} (${clpSigned(s.variation.minimumBalance)})'],
      ),
      IndicatorComparison(
        label: 'Mes de quiebre',
        explanation: 'Primer mes con saldo bajo \$0.',
        values: [breakMonth(base.breakMonth), for (final s in c.scenarios) breakMonth(s.outcome.indicators.breakMonth)],
      ),
      IndicatorComparison(
        label: 'Margen del primer mes',
        explanation: 'Ingresos menos gastos y cuotas.',
        values: [clp(base.margin.first.amount), for (final s in c.scenarios) clp(s.outcome.indicators.margin.first.amount)],
      ),
      IndicatorComparison(
        label: 'Carga de deuda del primer mes',
        explanation: 'Parte del ingreso destinada a cuotas.',
        values: [
          for (final bp in [base.debtToIncome.first.basisPoints, for (final s in c.scenarios) s.outcome.indicators.debtToIncome.first.basisPoints])
            bp == null ? 'Sin ingresos' : percentFromBasisPoints(bp),
        ],
      ),
    ];
    return Gap([
      FdmCard(children: [IndicatorTable(columns: ['Base', for (final s in c.scenarios) s.name], rows: rows)]),
      const Notice('Los escenarios aparecen en el orden en que los elegiste. Fin de Mes no los ordena por conveniencia ni destaca ninguno.'),
      FdmCard(title: 'Saldo al cierre de cada mes', children: [
        ChartLegend(series),
        LineChart(
          height: 320,
          semanticLabel: 'Saldo al cierre por mes de la base y de cada escenario elegido.',
          series: series,
          labels: [for (final m in c.base.months) monthInitial(m.month)],
          min: scale.min,
          max: scale.max,
          ticks: scale.ticks,
        ),
      ]),
    ], gap: 16);
  }
}

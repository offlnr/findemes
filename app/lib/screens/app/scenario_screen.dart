import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/auth/auth_api.dart';
import '../../data/demo_api.dart';
import '../../data/models.dart' show IndicatorComparison;
import '../../data/registry_api.dart';
import '../../data/scenario_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/chart_scale.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/decision_editor.dart';
import '../../widgets/fdm_icon.dart';
import 'scenarios_screen.dart';
import 'summary_screen.dart';

/// Detalle de un escenario (HU07, HU08, HU10, HU11). Las cifras y la explicación vienen del
/// servidor; la explicación es descriptiva y no recomienda (regla 4).
class ScenarioScreen extends ConsumerWidget {
  const ScenarioScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(scenarioListProvider),
        builder: (list) {
          final summary = list.scenarios.where((s) => s.id == id).firstOrNull;
          if (summary == null) {
            return PageBody(children: [
              const Notice('No encontramos este escenario.'),
              TextButton(onPressed: () => context.go('/app/escenarios'), child: const Text('← Todos los escenarios')),
            ]);
          }
          final view = ref.watch(scenarioViewProvider(id));
          return PageBody(children: [
            PageHeader(
              icon: FdmIcons.copy,
              title: summary.name,
              subtitle: 'Escenario derivado de tu situación base. Tu registro no cambia.',
              actions: [
                TextButton(onPressed: () => context.go('/app/escenarios'), child: const Text('← Todos los escenarios')),
                OutlinedButton(onPressed: () => _rename(context, ref, summary), child: const Text('Renombrar')),
              ],
            ),
            ResponsiveRow(breakpoint: 1000, children: [
              FdmCard(
                title: 'Decisiones aplicadas',
                trailing: FilledButton(onPressed: () => _addDecision(context, ref, summary, list.plan), child: const Text('Agregar decisión')),
                children: [
                  if (summary.decisions.isEmpty) const Muted('Sin decisiones: el escenario coincide con tu situación base.'),
                  for (var i = 0; i < summary.decisions.length; i++)
                    Row(children: [
                      Expanded(
                        child: Text(
                          // Una frase del motor por decisión, en el mismo orden (HU10).
                          view.value != null && i < view.value!.details.length
                              ? view.value!.details[i]
                              : decisionKindNames[summary.decisions[i].kind] ?? summary.decisions[i].kind,
                          style: FdmText.ui(14),
                        ),
                      ),
                      TextButton(onPressed: () => _removeDecision(context, ref, summary, i), child: const Text('Quitar')),
                    ]),
                ],
              ),
              switch (view) {
                AsyncData(:final value) => _Results(view: value),
                AsyncError(:final error) => FdmCard(children: [Text(error is AuthApiException ? error.message : 'No pudimos calcular el escenario.')]),
                _ => const FdmCard(children: [Center(child: CircularProgressIndicator(color: FdmColors.ink))]),
              },
            ]),
            if (view.value case final v?)
              FdmCard(title: 'Explicación', children: [
                Text(v.summary, style: FdmText.ui(15, weight: FontWeight.w600, height: 1.4)),
                Bullets(v.details.skip(v.decisions.length).toList()),
                const Muted('La explicación describe qué ocurre y qué lo causa; no recomienda.', size: 12),
              ]),
          ]);
        },
      );

  Future<void> _save(BuildContext context, WidgetRef ref, ScenarioSummary s, {String? name, List<ScenarioDecision>? decisions}) async {
    try {
      await ref.read(scenarioApiProvider).save(id: s.id, name: name ?? s.name, decisions: decisions ?? s.decisions);
      ref.invalidate(scenarioListProvider);
      ref.invalidate(scenarioViewProvider(s.id));
    } on ScenarioApiException catch (e) {
      final detail = e.decisionMessages.values.expand((m) => m).join(' ');
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(detail.isEmpty ? e.message : '${e.message} $detail')));
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _rename(BuildContext context, WidgetRef ref, ScenarioSummary s) async {
    final name = await showDialog<String>(context: context, builder: (_) => ScenarioNameDialog(title: 'Renombrar escenario', initial: s.name));
    if (name != null && context.mounted) await _save(context, ref, s, name: name);
  }

  Future<void> _addDecision(BuildContext context, WidgetRef ref, ScenarioSummary s, PlanInfo plan) async {
    final registry = await ref.read(registryDataProvider.future);
    if (!context.mounted) return;
    final decision = await showDialog<ScenarioDecision>(
      context: context,
      builder: (_) => DecisionEditorDialog(
        fixedExpenses: [for (final e in registry.expenses) if (e.nature == 'fixed' && e.schedule is MonthlySchedule) DecisionTarget(e.id, e.label)],
        debts: [for (final d in registry.debts) DecisionTarget(d.id, d.label)],
        prepaymentsAllowed: plan.userPrepayments,
        planName: plan.name,
      ),
    );
    if (decision != null && context.mounted) await _save(context, ref, s, decisions: [...s.decisions, decision]);
  }

  Future<void> _removeDecision(BuildContext context, WidgetRef ref, ScenarioSummary s, int index) =>
      _save(context, ref, s, decisions: [...s.decisions]..removeAt(index));
}

class _Results extends StatelessWidget {
  const _Results({required this.view});
  final ScenarioViewData view;

  @override
  Widget build(BuildContext context) {
    final base = view.base.indicators;
    final scenario = view.scenario.indicators;
    final series = [
      LineSeries(name: view.name, values: [for (final m in view.scenario.months) m.closingBalance], color: FdmColors.ink, area: true),
      LineSeries(name: 'Situación base', values: [for (final m in view.base.months) m.closingBalance], color: FdmColors.muted, dashed: true, width: 2),
    ];
    final scale = ChartScale.of([for (final s in series) ...s.values]);
    return Gap([
      FdmCard(title: 'Indicadores', children: [
        IndicatorTable(columns: const ['Base', 'Escenario', 'Diferencia'], rows: indicatorRows(base, scenario, view.variation)),
      ]),
      FdmCard(title: 'Saldo al cierre: base y escenario', children: [
        ChartLegend(series),
        LineChart(
          height: 260,
          semanticLabel: 'Saldo al cierre del escenario y de la base, por mes.',
          series: series,
          labels: [for (final m in view.base.months) monthInitial(m.month)],
          min: scale.min,
          max: scale.max,
          ticks: scale.ticks,
        ),
      ]),
    ], gap: 16);
  }
}

/// Filas de la Tabla 12 para la base, un escenario y su diferencia (todo calculado por el servidor).
List<IndicatorComparison> indicatorRows(DemoIndicators base, DemoIndicators scenario, DemoVariation variation) {
  String breakMonth(String? m) => m == null ? 'No ocurre' : monthShort(m);
  String ratio(int? bp) => bp == null ? 'Sin ingresos' : percentFromBasisPoints(bp);
  String ratioDiff(int? bp) => bp == null ? '—' : '${bp > 0 ? '+' : ''}${percentFromBasisPoints(bp)}';
  return [
    IndicatorComparison(
      label: 'Saldo mínimo proyectado',
      explanation: 'El menor saldo al cierre del horizonte.',
      values: [clp(base.minimumAmount), clp(scenario.minimumAmount), clpSigned(variation.minimumBalance)],
    ),
    IndicatorComparison(
      label: 'Mes de quiebre',
      explanation: 'Primer mes con saldo bajo \$0.',
      values: [breakMonth(base.breakMonth), breakMonth(scenario.breakMonth), base.breakMonth == scenario.breakMonth ? 'Igual' : 'Cambia'],
    ),
    IndicatorComparison(
      label: 'Margen del primer mes',
      explanation: 'Ingresos menos gastos y cuotas.',
      values: [clp(base.margin.first.amount), clp(scenario.margin.first.amount), clpSigned(variation.margin.first.amount)],
    ),
    IndicatorComparison(
      label: 'Carga de deuda del primer mes',
      explanation: 'Parte del ingreso destinada a cuotas.',
      values: [ratio(base.debtToIncome.first.basisPoints), ratio(scenario.debtToIncome.first.basisPoints), ratioDiff(variation.debtToIncome.first.basisPoints)],
    ),
  ];
}

/// Tabla de indicadores con la explicación de cada uno bajo su nombre.
class IndicatorTable extends StatelessWidget {
  const IndicatorTable({super.key, required this.columns, required this.rows});
  final List<String> columns;
  final List<IndicatorComparison> rows;

  @override
  Widget build(BuildContext context) => FdmTable(
        minWidth: 160.0 * (columns.length + 1),
        columns: [const Col('Indicador', flex: 3), for (final c in columns) Col(c, flex: 2)],
        rows: [
          for (final r in rows) [Cell(r.label, sub: r.explanation), for (final v in r.values) Cell(v, number: true)],
        ],
      );
}

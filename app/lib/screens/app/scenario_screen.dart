import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/finance_repository.dart';
import '../../data/models.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import '../../widgets/form_row.dart';

/// Detalle de un escenario (HU07, HU08, HU10, HU11). La explicación es descriptiva.
class ScenarioScreen extends ConsumerWidget {
  const ScenarioScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(scenarioProvider(id)),
        builder: (s) => PageBody(children: [
          PageHeader(
            icon: FdmIcons.copy,
            title: s.name,
            subtitle: 'Escenario derivado de tu situación base.',
            actions: [
              TextButton(onPressed: () => context.go('/app/escenarios'), child: const Text('← Todos los escenarios')),
              OutlinedButton(onPressed: () {}, child: const Text('Renombrar')),
            ],
          ),
          ResponsiveRow(breakpoint: 1000, children: [
            Gap([
              FdmCard(title: 'Decisiones aplicadas', children: [
                FdmTable(
                  columns: const [Col('Decisión', flex: 5), Col('', width: 90)],
                  rows: [for (final d in s.decisions) [Cell(d), const Cell.w(RemoveButton())]],
                ),
              ]),
              const _DecisionForm(),
            ]),
            Gap([
              FdmCard(title: 'Indicadores', children: [IndicatorTable(columns: const ['Base', 'Escenario', 'Diferencia'], rows: s.indicators)]),
              FdmCard(title: 'Saldo al cierre: base y escenario', children: [
                ChartLegend(_series(s)),
                LineChart(
                  height: 260,
                  semanticLabel: 'Saldo al cierre del escenario y de la base, por mes.',
                  series: _series(s),
                  labels: const ['N', 'D', 'E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O'],
                  min: s.closings.any((v) => v < 0) ? -500000 : 0,
                  max: 3000000,
                  ticks: const [0, 1000000, 2000000, 3000000],
                  marks: [ChartMark(index: s.minIndex, value: s.closings[s.minIndex], label: 'Mín. ${clp(s.closings[s.minIndex])}', below: true)],
                ),
              ]),
            ]),
          ]),
          FdmCard(title: 'Explicación', children: [
            Bullets(s.explanation),
            const Muted('La explicación describe qué ocurre y qué lo causa; no recomienda.', size: 12),
          ]),
        ]),
      );

  List<LineSeries> _series(ScenarioDetail s) => [
        LineSeries(name: s.name, values: s.closings, color: FdmColors.ink, area: true),
        LineSeries(name: 'Situación base', values: s.baseClosings, color: FdmColors.muted, dashed: true, width: 2),
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

/// Catálogo de decisiones (Tabla 11). Agregar una solo se envía a la API; aquí avisa que es demo.
class _DecisionForm extends StatefulWidget {
  const _DecisionForm();
  @override
  State<_DecisionForm> createState() => _DecisionFormState();
}

class _DecisionFormState extends State<_DecisionForm> {
  static const _types = {
    'Compra en N cuotas': [FieldSpec('Qué compras', hint: 'Notebook'), FieldSpec('Monto total', hint: '\$899.990', width: 160), FieldSpec('N.º de cuotas', hint: '12', width: 120), FieldSpec('Primera cuota', options: ['nov 2026', 'dic 2026', 'ene 2027'], width: 160)],
    'Alta o modificación de gasto fijo': [FieldSpec('Gasto', options: ['Nuevo gasto fijo', 'Modificar: Plan de salud', 'Modificar: Transporte']), FieldSpec('Monto mensual', hint: '\$0', width: 160), FieldSpec('Desde', options: ['nov 2026', 'dic 2026'], width: 140), FieldSpec('Hasta', options: ['Sin término', 'oct 2027'], width: 140)],
    'Gasto único': [FieldSpec('Qué es', hint: 'Notebook'), FieldSpec('Monto', hint: '\$0', width: 160), FieldSpec('Mes', options: ['dic 2026', 'ene 2027'], width: 140)],
    'Adelanto o prepago de deuda': [FieldSpec('Deuda', options: ['Crédito de consumo']), FieldSpec('Monto del prepago', hint: '\$0', width: 180), FieldSpec('Mes de aplicación', options: ['nov 2026', 'dic 2026'], width: 160), FieldSpec('Modalidad (depende de tu institución)', options: ['Reducir plazo (cuota igual)', 'Reducir cuota (plazo igual)'], width: 300)],
    'Variación de ingreso': [FieldSpec('Variación mensual (+/−)', hint: '\$0', width: 200), FieldSpec('Desde', options: ['nov 2026', 'dic 2026'], width: 140), FieldSpec('Hasta', options: ['Sin término', 'oct 2027'], width: 140)],
  };
  String _type = _types.keys.first;

  @override
  Widget build(BuildContext context) => FdmCard(title: 'Agregar una decisión', children: [
        DropdownButtonFormField<String>(
          initialValue: _type,
          decoration: const InputDecoration(labelText: 'Tipo de decisión'),
          items: [for (final t in _types.keys) DropdownMenuItem(value: t, child: Text(t, style: FdmText.ui(14)))],
          onChanged: (v) => setState(() => _type = v ?? _type),
        ),
        FormRow(key: ValueKey(_type), fields: _types[_type]!, action: 'Agregar al escenario', primary: true),
      ]);
}

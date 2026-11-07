import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/demo_api.dart';
import '../../data/models.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/chart_scale.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';

/// Modo demostración sin cuenta (HU27-HU28). El cálculo lo hace `POST /v1/demo/projection`
/// (sin estado, con límite de uso); la pantalla solo envía los datos y muestra el resultado.
class DemoScreen extends ConsumerStatefulWidget {
  const DemoScreen({super.key});
  @override
  ConsumerState<DemoScreen> createState() => _DemoScreenState();
}

const _ownData = 'mis-datos';

/// Tipos de decisión de la Tabla 11, con el nombre que ve el usuario.
const _decisionNames = {
  'one_off_expense': 'Gasto único',
  'purchase_in_installments': 'Compra en cuotas',
  'fixed_expense_change': 'Alta o cambio de gasto fijo',
  'income_variation': 'Variación de ingreso',
  'debt_prepayment': 'Prepago de deuda',
};

class _DemoScreenState extends ConsumerState<DemoScreen> {
  String _base = 'familia';
  final _opening = TextEditingController(text: '300000');
  final _income = TextEditingController(text: '900000');
  final _fixedExpense = TextEditingController(text: '650000');

  String? _kind;
  final _label = TextEditingController();
  final _amount = TextEditingController();
  final _installments = TextEditingController(text: '6');
  int _monthIndex = 0;
  int? _untilIndex;
  String? _targetExpenseId;
  String? _debtId;
  String _modality = 'reduce_term';
  bool _increase = true;

  DemoProjection? _result;
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _calculate(withDecision: false);
  }

  @override
  void dispose() {
    for (final c in [_opening, _income, _fixedExpense, _label, _amount, _installments]) {
      c.dispose();
    }
    super.dispose();
  }

  static int _parse(String text) => int.tryParse(text.replaceAll('.', '').trim()) ?? 0;

  DemoBase _currentBase() => _base == _ownData
      ? OwnDataBase(openingBalance: _parse(_opening.text), monthlyIncome: _parse(_income.text), monthlyFixedExpense: _parse(_fixedExpense.text))
      : ExampleBase(_base);

  List<String> get _months => _result?.base.months.map((m) => m.month).toList() ?? const [];

  Map<String, Object?> _decisionParams() {
    final months = _months;
    final month = months.isEmpty ? '' : months[_monthIndex.clamp(0, months.length - 1)];
    final until = _untilIndex == null || months.isEmpty ? null : months[_untilIndex!.clamp(0, months.length - 1)];
    final label = _label.text.trim();
    final amount = _parse(_amount.text);
    return switch (_kind) {
      'one_off_expense' => {'label': label, 'amount': amount, 'month': month},
      'purchase_in_installments' => {'label': label, 'totalAmount': amount, 'installments': _parse(_installments.text), 'startMonth': month},
      'fixed_expense_change' => {
          if (_targetExpenseId == null) 'label': label,
          'targetExpenseId': _targetExpenseId,
          'amount': amount,
          'range': {'from': month, 'until': until},
        },
      'income_variation' => {'label': label, 'amount': _increase ? amount : -amount, 'range': {'from': month, 'until': until}},
      'debt_prepayment' => {'debtId': _debtId ?? '', 'amount': amount, 'month': month, 'modality': _modality},
      _ => const {},
    };
  }

  Future<void> _calculate({required bool withDecision}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final request = DemoRequest(
      base: _currentBase(),
      decisionKind: withDecision ? _kind : null,
      decisionParams: withDecision && _kind != null ? _decisionParams() : null,
    );
    try {
      final result = await ref.read(demoApiProvider).projection(request);
      if (!mounted) return;
      setState(() {
        _result = result;
        if (_monthIndex >= result.horizonMonths) _monthIndex = 0;
        if (_debtId != null && !result.debts.any((d) => d.id == _debtId)) _debtId = null;
        if (_targetExpenseId != null && !result.fixedExpenses.any((e) => e.id == _targetExpenseId)) _targetExpenseId = null;
        if (_kind == 'debt_prepayment' && result.debts.isEmpty) _kind = null;
      });
    } on DemoApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _selectBase(String base) {
    setState(() {
      _base = base;
      _kind = null;
    });
    _calculate(withDecision: false);
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 700;
    final examples = ref.watch(demoExamplesProvider);
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        backgroundColor: FdmColors.ink,
        foregroundColor: FdmColors.onInk,
        titleSpacing: narrow ? 16 : 48,
        title: Text('Fin de Mes', style: FdmText.serif(26, color: FdmColors.onInk)),
        actions: [
          if (!narrow) const Padding(padding: EdgeInsets.only(right: 12), child: Pill('Modo demostración', color: FdmColors.accent)),
          Padding(
            padding: EdgeInsets.only(right: narrow ? 12 : 48),
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: FdmColors.onInk, foregroundColor: FdmColors.ink),
              onPressed: () => context.go('/registro?desde=demo'),
              child: const Text('Crear cuenta y guardar'),
            ),
          ),
        ],
      ),
      body: PageBody(children: [
        Text('Modo demostración', style: FdmText.serif(narrow ? 34 : 46)),
        const Notice('Nada de lo que escribas aquí se guarda. El cálculo se hace en el servidor y tiene límite de uso.'),
        ResponsiveRow(breakpoint: 900, children: [
          Gap([
            FdmCard(title: 'Parte de un ejemplo o de tus datos', children: [
              Wrap(spacing: 10, runSpacing: 10, children: [
                ...switch (examples) {
                  AsyncData(:final value) => [
                      for (final x in value)
                        Tooltip(
                          message: x.description,
                          child: ChoiceChip(label: Text(x.name), selected: x.id == _base, onSelected: (_) => _selectBase(x.id)),
                        ),
                    ],
                  _ => const <Widget>[],
                },
                ChoiceChip(label: const Text('Mis datos'), selected: _base == _ownData, onSelected: (_) => _selectBase(_ownData)),
              ]),
              if (_base == _ownData) _ownDataFields(),
            ]),
            FdmCard(title: 'Simula una decisión', children: _decisionFields()),
          ], gap: 16),
          _results(narrow),
        ]),
      ]),
    );
  }

  Widget _ownDataFields() => Gap([
        Wrap(spacing: 12, runSpacing: 12, children: [
          _AmountField(label: 'Saldo inicial', controller: _opening, allowNegative: true),
          _AmountField(label: 'Ingreso mensual', controller: _income),
          _AmountField(label: 'Gasto fijo mensual', controller: _fixedExpense),
        ]),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(onPressed: _loading ? null : () => _calculate(withDecision: false), child: const Text('Proyectar mis datos')),
        ),
      ], gap: 12);

  List<Widget> _decisionFields() {
    final result = _result;
    final months = _months;
    final kinds = {
      for (final e in _decisionNames.entries)
        if (e.key != 'debt_prepayment' || (result?.debts.isNotEmpty ?? false)) e.key: e.value,
    };
    final monthItems = [for (var i = 0; i < months.length; i++) DropdownMenuItem(value: i, child: Text(monthLong(months[i])))];

    Widget monthField(String label) => _Labeled(
          label: label,
          child: DropdownButtonFormField<int>(
            initialValue: _monthIndex.clamp(0, months.isEmpty ? 0 : months.length - 1),
            items: monthItems,
            onChanged: (v) => setState(() => _monthIndex = v ?? 0),
          ),
        );

    Widget untilField() => _Labeled(
          label: 'Hasta',
          child: DropdownButtonFormField<int?>(
            initialValue: _untilIndex,
            items: [const DropdownMenuItem<int?>(value: null, child: Text('Sin término')), ...monthItems],
            onChanged: (v) => setState(() => _untilIndex = v),
          ),
        );

    final labelField = _TextField(label: 'Nombre', controller: _label);
    final fields = switch (_kind) {
      'one_off_expense' => [labelField, _AmountField(label: 'Monto', controller: _amount), monthField('Mes')],
      'purchase_in_installments' => [
          labelField,
          _AmountField(label: 'Monto total', controller: _amount),
          _TextField(label: 'Número de cuotas', controller: _installments, digitsOnly: true),
          monthField('Primera cuota'),
        ],
      'fixed_expense_change' => [
          _Labeled(
            label: 'Gasto',
            child: DropdownButtonFormField<String?>(
              initialValue: _targetExpenseId,
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Nuevo gasto fijo')),
                for (final e in result?.fixedExpenses ?? const <DemoEntry>[]) DropdownMenuItem<String?>(value: e.id, child: Text(e.label)),
              ],
              onChanged: (v) => setState(() => _targetExpenseId = v),
            ),
          ),
          if (_targetExpenseId == null) labelField,
          _AmountField(label: _targetExpenseId == null ? 'Monto mensual' : 'Nuevo monto mensual', controller: _amount),
          monthField('Desde'),
          untilField(),
        ],
      'income_variation' => [
          labelField,
          _Labeled(
            label: 'El ingreso',
            child: SegmentedButton<bool>(
              segments: const [ButtonSegment(value: true, label: Text('Aumenta')), ButtonSegment(value: false, label: Text('Disminuye'))],
              selected: {_increase},
              onSelectionChanged: (s) => setState(() => _increase = s.first),
            ),
          ),
          _AmountField(label: 'Monto mensual', controller: _amount),
          monthField('Desde'),
          untilField(),
        ],
      'debt_prepayment' => [
          _Labeled(
            label: 'Deuda',
            child: DropdownButtonFormField<String>(
              initialValue: _debtId,
              hint: const Text('Selecciona una deuda'),
              items: [for (final d in result?.debts ?? const <DemoEntry>[]) DropdownMenuItem(value: d.id, child: Text(d.label))],
              onChanged: (v) => setState(() => _debtId = v),
            ),
          ),
          _AmountField(label: 'Monto del prepago', controller: _amount),
          monthField('Mes del prepago'),
          _Labeled(
            label: 'Modalidad (depende de la institución)',
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'reduce_term', label: Text('Reducir plazo')),
                ButtonSegment(value: 'reduce_installment', label: Text('Reducir cuota')),
              ],
              selected: {_modality},
              onSelectionChanged: (s) => setState(() => _modality = s.first),
            ),
          ),
        ],
      _ => const <Widget>[],
    };

    return [
      _Labeled(
        label: 'Tipo de decisión',
        child: DropdownButtonFormField<String?>(
          initialValue: _kind,
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('Sin decisión')),
            for (final e in kinds.entries) DropdownMenuItem<String?>(value: e.key, child: Text(e.value)),
          ],
          onChanged: (v) => setState(() => _kind = v),
        ),
      ),
      ...fields,
      if (_error != null) Text(_error!, style: FdmText.ui(13, color: FdmColors.text, weight: FontWeight.w600)),
      Align(
        alignment: Alignment.centerLeft,
        child: FilledButton(
          onPressed: _loading || result == null ? null : () => _calculate(withDecision: _kind != null),
          child: Text(_loading ? 'Calculando…' : 'Calcular'),
        ),
      ),
    ];
  }

  Widget _results(bool narrow) {
    final result = _result;
    if (result == null) {
      return FdmCard(children: [
        if (_error != null) Text(_error!, style: FdmText.ui(14)) else const Center(child: CircularProgressIndicator(color: FdmColors.ink)),
      ]);
    }
    final shown = result.shown;
    final variation = result.variation;
    final firstMargin = shown.indicators.margin.first;
    final firstRatio = shown.indicators.debtToIncome.first;
    final horizon = '${result.horizonMonths} meses desde ${monthShort(result.startMonth)}';
    final difference = variation == null ? '' : ' · ${clpSigned(variation.minimumBalance)} frente a la base';

    final indicators = [
      Indicator(
        label: 'Saldo mínimo proyectado',
        value: clp(shown.indicators.minimumAmount),
        detail: '${monthShort(shown.indicators.minimumMonth)}$difference',
        explanation: 'El menor saldo al cierre dentro de los $horizon.',
      ),
      Indicator(
        label: 'Mes de quiebre',
        value: shown.indicators.breakMonth == null ? 'No ocurre' : monthShort(shown.indicators.breakMonth!),
        detail: horizon,
        explanation: 'Primer mes en que el saldo al cierre queda bajo \$0.',
      ),
      Indicator(
        label: 'Margen mensual disponible',
        value: clp(firstMargin.amount),
        detail: variation == null ? monthShort(firstMargin.month) : '${monthShort(firstMargin.month)} · ${clpSigned(variation.margin.first.amount)} frente a la base',
        explanation: 'Ingresos menos gastos y cuotas del mes.',
      ),
      Indicator(
        label: 'Carga de deuda sobre ingreso',
        value: firstRatio.basisPoints == null ? 'Sin ingresos' : _percent(firstRatio.basisPoints!),
        detail: monthShort(firstRatio.month),
        explanation: 'Parte del ingreso del mes destinada a cuotas.',
      ),
    ];

    final scenario = result.scenario;
    final series = [
      LineSeries(name: 'Sin la decisión', values: [for (final m in result.base.months) m.closingBalance], color: FdmColors.muted, dashed: scenario != null, area: scenario == null),
      if (scenario != null) LineSeries(name: 'Con la decisión', values: [for (final m in scenario.months) m.closingBalance], color: FdmColors.ink),
    ];
    final scale = ChartScale.of([for (final s in series) ...s.values]);

    return Gap([
      Row(children: [const Pill('Datos de demostración'), const SizedBox(width: 8), Expanded(child: Muted(horizon, size: 12))]),
      LayoutBuilder(builder: (context, c) {
        final w = c.maxWidth >= 460 ? (c.maxWidth - 16) / 2 : c.maxWidth;
        return Wrap(spacing: 16, runSpacing: 16, children: [for (final i in indicators) SizedBox(width: w, child: KpiCard(i))]);
      }),
      FdmCard(title: 'Saldo al cierre de cada mes', children: [
        if (scenario != null) ChartLegend(series),
        LineChart(
          height: 260,
          semanticLabel: 'Saldo al cierre de cada mes: ${[for (final m in shown.months) '${monthLong(m.month)} ${clp(m.closingBalance)}'].join(', ')}.',
          series: series,
          labels: [for (final m in result.base.months) monthInitial(m.month)],
          min: scale.min,
          max: scale.max,
          ticks: scale.ticks,
        ),
      ]),
      FdmCard(title: 'Cómo se obtuvo este resultado', children: [
        Text(result.summary, style: FdmText.ui(15, weight: FontWeight.w600, height: 1.4)),
        Bullets(result.details),
      ]),
      Notice(result.limitNotice, action: TextButton(onPressed: () => context.go('/registro?desde=demo'), child: const Text('Crear cuenta'))),
    ], gap: 16);
  }

  static String _percent(int basisPoints) {
    final tenths = (basisPoints / 10).round();
    return '${tenths ~/ 10},${tenths % 10} %';
  }
}

class _Labeled extends StatelessWidget {
  const _Labeled({required this.label, required this.child});
  final String label;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
        const SizedBox(height: 6),
        child,
      ]);
}

class _TextField extends StatelessWidget {
  const _TextField({required this.label, required this.controller, this.digitsOnly = false});
  final String label;
  final TextEditingController controller;
  final bool digitsOnly;
  @override
  Widget build(BuildContext context) => _Labeled(
        label: label,
        child: TextField(
          controller: controller,
          maxLength: digitsOnly ? 3 : 80,
          keyboardType: digitsOnly ? TextInputType.number : TextInputType.text,
          inputFormatters: digitsOnly ? [FilteringTextInputFormatter.digitsOnly] : null,
          decoration: const InputDecoration(counterText: ''),
        ),
      );
}

class _AmountField extends StatelessWidget {
  const _AmountField({required this.label, required this.controller, this.allowNegative = false});
  final String label;
  final TextEditingController controller;
  final bool allowNegative;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 200,
        child: _Labeled(
          label: label,
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.numberWithOptions(signed: allowNegative),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(allowNegative ? r'^-?\d{0,13}' : r'^\d{0,13}'))],
            decoration: const InputDecoration(prefixText: '\$ '),
          ),
        ),
      );
}

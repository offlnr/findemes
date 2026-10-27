import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/scenario_api.dart';
import '../format/months.dart';
import '../theme/tokens.dart';
import 'common.dart';

/// Nombres de los tipos de decisión de la Tabla 11, tal como los ve el usuario.
const decisionKindNames = {
  'purchase_in_installments': 'Compra en cuotas',
  'fixed_expense_change': 'Alta o cambio de gasto fijo',
  'one_off_expense': 'Gasto único',
  'debt_prepayment': 'Prepago de deuda',
  'income_variation': 'Variación de ingreso',
};

/// Elemento del registro que una decisión puede referir (gasto fijo o deuda).
class DecisionTarget {
  const DecisionTarget(this.id, this.label);
  final String id;
  final String label;
}

/// Diálogo para armar una decisión. Solo reúne lo que el usuario escribe: los parámetros los
/// valida el motor en el servidor al guardar el escenario (regla 8).
class DecisionEditorDialog extends StatefulWidget {
  const DecisionEditorDialog({super.key, required this.fixedExpenses, required this.debts, required this.prepaymentsAllowed, this.planName});
  final List<DecisionTarget> fixedExpenses;
  final List<DecisionTarget> debts;
  final bool prepaymentsAllowed;
  final String? planName;

  @override
  State<DecisionEditorDialog> createState() => _DecisionEditorDialogState();
}

class _DecisionEditorDialogState extends State<DecisionEditorDialog> {
  String _kind = 'one_off_expense';
  final _label = TextEditingController();
  final _amount = TextEditingController();
  final _installments = TextEditingController(text: '12');
  late String _month = monthOf(DateTime.now());
  String? _until;
  String? _targetExpenseId;
  String? _debtId;
  String _modality = 'reduce_term';
  bool _increase = true;
  String? _error;

  @override
  void dispose() {
    for (final c in [_label, _amount, _installments]) {
      c.dispose();
    }
    super.dispose();
  }

  int? get _amountValue => int.tryParse(_amount.text.replaceAll('.', '').trim());

  void _submit() {
    final amount = _amountValue;
    if (amount == null) {
      setState(() => _error = 'Ingresa un monto en pesos, sin decimales.');
      return;
    }
    if (_kind == 'debt_prepayment' && _debtId == null) {
      setState(() => _error = 'Selecciona la deuda.');
      return;
    }
    final label = _label.text.trim();
    final params = switch (_kind) {
      'purchase_in_installments' => {'label': label, 'totalAmount': amount, 'installments': int.tryParse(_installments.text) ?? 0, 'startMonth': _month},
      'fixed_expense_change' => {
          if (_targetExpenseId == null) 'label': label,
          'targetExpenseId': _targetExpenseId,
          'amount': amount,
          'range': {'from': _month, 'until': _until},
        },
      'income_variation' => {'label': label, 'amount': _increase ? amount : -amount, 'range': {'from': _month, 'until': _until}},
      'debt_prepayment' => {'debtId': _debtId, 'amount': amount, 'month': _month, 'modality': _modality},
      _ => {'label': label, 'amount': amount, 'month': _month},
    };
    Navigator.pop(context, ScenarioDecision(_kind, params));
  }

  @override
  Widget build(BuildContext context) {
    final months = monthOptions(DateTime.now(), before: 1, after: 36);
    Widget monthField(String label) => _field(
          label,
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: months.contains(_month) ? _month : months[1],
            items: [for (final m in months) DropdownMenuItem(value: m, child: Text(monthLong(m)))],
            onChanged: (v) => setState(() => _month = v ?? _month),
          ),
        );
    Widget untilField() => _field(
          'Hasta',
          DropdownButtonFormField<String?>(
            isExpanded: true,
            initialValue: _until,
            items: [const DropdownMenuItem<String?>(value: null, child: Text('Sin término')), for (final m in months) DropdownMenuItem<String?>(value: m, child: Text(monthLong(m)))],
            onChanged: (v) => setState(() => _until = v),
          ),
        );
    final name = _field('Nombre', TextField(controller: _label, maxLength: 80, decoration: const InputDecoration(counterText: '')));
    final amount = _field(
      _kind == 'purchase_in_installments' ? 'Monto total (CLP)' : 'Monto (CLP)',
      TextField(
        controller: _amount,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: const InputDecoration(prefixText: r'$ '),
      ),
    );

    final fields = switch (_kind) {
      'purchase_in_installments' => [
          name,
          amount,
          _field('Número de cuotas', TextField(controller: _installments, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly])),
          monthField('Primera cuota'),
          const Muted('Se asume que el monto total ya incluye los intereses.', size: 12),
        ],
      'fixed_expense_change' => [
          _field(
            'Gasto',
            DropdownButtonFormField<String?>(
              isExpanded: true,
              initialValue: _targetExpenseId,
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Nuevo gasto fijo')),
                for (final e in widget.fixedExpenses) DropdownMenuItem<String?>(value: e.id, child: Text('Cambiar: ${e.label}')),
              ],
              onChanged: (v) => setState(() => _targetExpenseId = v),
            ),
          ),
          if (_targetExpenseId == null) name,
          amount,
          monthField('Desde'),
          untilField(),
        ],
      'income_variation' => [
          name,
          _field(
            'El ingreso',
            SegmentedButton<bool>(
              segments: const [ButtonSegment(value: true, label: Text('Aumenta')), ButtonSegment(value: false, label: Text('Disminuye'))],
              selected: {_increase},
              onSelectionChanged: (s) => setState(() => _increase = s.first),
            ),
          ),
          amount,
          monthField('Desde'),
          untilField(),
        ],
      'debt_prepayment' => [
          _field(
            'Deuda',
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _debtId,
              hint: const Text('Selecciona una deuda'),
              items: [for (final d in widget.debts) DropdownMenuItem(value: d.id, child: Text(d.label))],
              onChanged: (v) => setState(() => _debtId = v),
            ),
          ),
          amount,
          monthField('Mes del prepago'),
          _field(
            'Modalidad (depende de tu institución)',
            SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'reduce_term', label: Text('Reducir plazo')), ButtonSegment(value: 'reduce_installment', label: Text('Reducir cuota'))],
              selected: {_modality},
              onSelectionChanged: (s) => setState(() => _modality = s.first),
            ),
          ),
        ],
      _ => [name, amount, monthField('Mes')],
    };

    final kinds = {
      for (final e in decisionKindNames.entries)
        if (e.key != 'debt_prepayment' || (widget.prepaymentsAllowed && widget.debts.isNotEmpty)) e.key: e.value,
    };

    return AlertDialog(
      title: const Text('Agregar una decisión'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Gap([
            _field(
              'Tipo de decisión',
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _kind,
                items: [for (final e in kinds.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                onChanged: (v) => setState(() {
                  _kind = v ?? _kind;
                  _error = null;
                }),
              ),
            ),
            if (!widget.prepaymentsAllowed) Muted('La simulación de prepagos de deuda no está incluida en el plan ${widget.planName ?? 'actual'}.', size: 12),
            ...fields,
            if (_error != null) Text(_error!, style: FdmText.ui(13, weight: FontWeight.w600)),
          ], gap: 14),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: _submit, child: const Text('Agregar')),
      ],
    );
  }

  Widget _field(String label, Widget child) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
        const SizedBox(height: 6),
        child,
      ]);
}

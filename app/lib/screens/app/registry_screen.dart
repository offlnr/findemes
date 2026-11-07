import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/auth/auth_api.dart';
import '../../data/registry_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Registro del estado base (HU01-HU04). Cada cambio se guarda en el servidor y la proyección
/// se recalcula allí; esta pantalla no calcula nada (regla 8).
class RegistryScreen extends ConsumerWidget {
  const RegistryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
    ref.watch(registryDataProvider),
    builder: (r) => PageBody(
      children: [
        const PageHeader(icon: FdmIcons.receipt, title: 'Registro', subtitle: 'Tu estado base. La proyección se recalcula en el servidor con cada cambio.'),
        FdmCard(
          title: 'Saldo inicial',
          children: [
            const Muted('Lo que tienes al comenzar el mes, positivo o negativo. La proyección parte de este mes.'),
            _OpeningBalanceForm(key: ValueKey('${r.openingBalance}-${r.balanceMonth}'), amount: r.openingBalance, month: r.balanceMonth),
          ],
        ),
        FdmCard(
          title: 'Ingresos',
          trailing: OutlinedButton(
            onPressed: () => _openEntry(context, kind: _EntryKind.income),
            child: const Text('Agregar ingreso'),
          ),
          children: [
            if (r.incomes.isEmpty) const Muted('Aún no registras ingresos.'),
            for (final e in r.incomes)
              _EntryRow(
                entry: e,
                onEdit: () => _openEntry(context, kind: _EntryKind.income, entry: e),
                onDelete: () => _delete(context, ref, 'incomes', e.id, e.label),
              ),
          ],
        ),
        FdmCard(
          title: 'Gastos',
          trailing: OutlinedButton(
            onPressed: () => _openEntry(context, kind: _EntryKind.expense),
            child: const Text('Agregar gasto'),
          ),
          children: [
            const Notice('Los gastos comunes del hogar no van aquí: tu aporte se suma solo desde el espacio común.'),
            if (r.expenses.isEmpty) const Muted('Aún no registras gastos.'),
            for (final e in r.expenses)
              _EntryRow(
                entry: e,
                onEdit: () => _openEntry(context, kind: _EntryKind.expense, entry: e),
                onDelete: () => _delete(context, ref, 'expenses', e.id, e.label),
              ),
          ],
        ),
        FdmCard(
          title: 'Deudas en cuotas',
          trailing: OutlinedButton(onPressed: () => _openDebt(context), child: const Text('Agregar deuda')),
          children: [
            const Notice('Las tarjetas de crédito no se sincronizan con el banco: registra aquí tus compras en cuotas.'),
            if (r.debts.isEmpty) const Muted('Aún no registras deudas.'),
            for (final d in r.debts)
              _DebtRow(
                debt: d,
                onEdit: () => _openDebt(context, debt: d),
                onDelete: () => _delete(context, ref, 'debts', d.id, d.label),
              ),
          ],
        ),
      ],
    ),
  );

  void _openEntry(BuildContext context, {required _EntryKind kind, RegistryEntry? entry}) => showDialog<void>(
    context: context,
    builder: (_) => _EntryDialog(kind: kind, entry: entry),
  );

  void _openDebt(BuildContext context, {RegistryDebt? debt}) => showDialog<void>(
    context: context,
    builder: (_) => _DebtDialog(debt: debt),
  );

  Future<void> _delete(BuildContext context, WidgetRef ref, String kind, String id, String label) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Eliminar «$label»?'),
        content: const Text('Se quitará de tu registro y de la proyección.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(registryApiProvider).delete(kind, id);
      _refresh(ref);
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}

/// Tras cada cambio, el registro y las proyecciones se vuelven a pedir al servidor.
void _refresh(WidgetRef ref) {
  ref.invalidate(registryDataProvider);
  ref.invalidate(projectionDataProvider);
}

String describeSchedule(Schedule schedule) => switch (schedule) {
  OnceSchedule(:final month) => 'Una vez, ${monthShort(month)}',
  MonthlySchedule(:final from, :final until) => 'Mensual desde ${monthShort(from)}${until == null ? '' : ' hasta ${monthShort(until)}'}',
  EveryNMonthsSchedule(:final intervalMonths, :final from, :final until) =>
    'Cada $intervalMonths meses desde ${monthShort(from)}${until == null ? '' : ' hasta ${monthShort(until)}'}',
};

class _EntryRow extends StatelessWidget {
  const _EntryRow({required this.entry, required this.onEdit, required this.onDelete});
  final RegistryEntry entry;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final nature = switch (entry.nature) {
      'fixed' => 'Fijo · ',
      'variable_estimate' => 'Variable estimado · ',
      _ => '',
    };
    return _Row(title: entry.label, detail: '$nature${describeSchedule(entry.schedule)}', amount: clp(entry.amount), onEdit: onEdit, onDelete: onDelete);
  }
}

class _DebtRow extends StatelessWidget {
  const _DebtRow({required this.debt, required this.onEdit, required this.onDelete});
  final RegistryDebt debt;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final progress = debt.totalInstallments == null ? '' : ' de ${debt.totalInstallments}';
    final detail = debt.nextMonth == null
        ? 'Sin cuotas pendientes'
        : '${debt.pendingInstallments}$progress cuotas pendientes · próxima ${monthShort(debt.nextMonth!)} · última ${monthShort(debt.lastMonth!)}';
    return _Row(
      title: debt.label,
      detail: detail,
      amount: debt.nextAmount == null ? '—' : '${clp(debt.nextAmount!)} / mes',
      onEdit: onEdit,
      onDelete: onDelete,
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.title, required this.detail, required this.amount, required this.onEdit, required this.onDelete});
  final String title;
  final String detail;
  final String amount;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 10),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: FdmColors.surface)),
    ),
    child: Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 12,
      runSpacing: 6,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 220, maxWidth: 520),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: FdmText.ui(15, weight: FontWeight.w600)),
              Muted(detail, size: 12),
            ],
          ),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(amount, style: FdmText.number(16)),
            const SizedBox(width: 8),
            TextButton(onPressed: onEdit, child: const Text('Editar')),
            TextButton(onPressed: onDelete, child: const Text('Eliminar')),
          ],
        ),
      ],
    ),
  );
}

int? _parseAmount(String text) => int.tryParse(text.replaceAll('.', '').replaceAll(r'$', '').trim());

class _OpeningBalanceForm extends ConsumerStatefulWidget {
  const _OpeningBalanceForm({super.key, required this.amount, required this.month});
  final int? amount;
  final String? month;
  @override
  ConsumerState<_OpeningBalanceForm> createState() => _OpeningBalanceFormState();
}

class _OpeningBalanceFormState extends ConsumerState<_OpeningBalanceForm> {
  late final _amount = TextEditingController(text: widget.amount?.toString() ?? '');
  late String _month = widget.month ?? monthOf(DateTime.now());
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = _parseAmount(_amount.text);
    if (amount == null) {
      setState(() => _error = 'Ingresa un monto en pesos, sin decimales.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(registryApiProvider).setOpeningBalance(amount, _month);
      _refresh(ref);
    } on AuthApiException catch (e) {
      setState(() => _error = e.fieldMessages.values.firstOrNull ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final months = monthOptions(DateTime.now(), before: 12, after: 1);
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      crossAxisAlignment: WrapCrossAlignment.end,
      children: [
        SizedBox(
          width: 220,
          child: _AmountField(label: 'Saldo (CLP)', controller: _amount, allowNegative: true, error: _error),
        ),
        SizedBox(
          width: 220,
          child: _Labeled(
            'Al comenzar',
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: months.contains(_month) ? _month : months.last,
              items: [for (final m in months) DropdownMenuItem(value: m, child: Text(monthLong(m)))],
              onChanged: (v) => setState(() => _month = v ?? _month),
            ),
          ),
        ),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Guardando…' : 'Guardar')),
      ],
    );
  }
}

enum _EntryKind { income, expense }

class _EntryDialog extends ConsumerStatefulWidget {
  const _EntryDialog({required this.kind, this.entry});
  final _EntryKind kind;
  final RegistryEntry? entry;
  @override
  ConsumerState<_EntryDialog> createState() => _EntryDialogState();
}

class _EntryDialogState extends ConsumerState<_EntryDialog> {
  late final _label = TextEditingController(text: widget.entry?.label ?? '');
  late final _amount = TextEditingController(text: widget.entry?.amount.toString() ?? '');
  late String _nature = widget.entry?.nature ?? 'fixed';
  late String _kind = switch (widget.entry?.schedule) {
    OnceSchedule() => 'once',
    EveryNMonthsSchedule() => 'every_n_months',
    _ => 'monthly',
  };
  late String _from = switch (widget.entry?.schedule) {
    OnceSchedule(:final month) => month,
    MonthlySchedule(:final from) => from,
    EveryNMonthsSchedule(:final from) => from,
    null => monthOf(DateTime.now()),
  };
  late String? _until = switch (widget.entry?.schedule) {
    MonthlySchedule(:final until) => until,
    EveryNMonthsSchedule(:final until) => until,
    _ => null,
  };
  late int _interval = switch (widget.entry?.schedule) {
    EveryNMonthsSchedule(:final intervalMonths) => intervalMonths,
    _ => 3,
  };
  Map<String, String> _errors = const {};
  String? _error;
  bool _busy = false;

  bool get _income => widget.kind == _EntryKind.income;

  @override
  void dispose() {
    _label.dispose();
    _amount.dispose();
    super.dispose();
  }

  Schedule get _schedule => switch (_kind) {
    'once' => OnceSchedule(_from),
    'every_n_months' => EveryNMonthsSchedule(_interval, _from, _until),
    _ => MonthlySchedule(_from, _until),
  };

  Future<void> _save() async {
    final amount = _parseAmount(_amount.text);
    if (amount == null) {
      setState(() => _errors = {'amount': 'Ingresa un monto en pesos, sin decimales.'});
      return;
    }
    setState(() {
      _busy = true;
      _errors = const {};
      _error = null;
    });
    final api = ref.read(registryApiProvider);
    try {
      if (_income) {
        await api.saveIncome(id: widget.entry?.id, label: _label.text, amount: amount, schedule: _schedule);
      } else {
        await api.saveExpense(id: widget.entry?.id, label: _label.text, amount: amount, nature: _nature, schedule: _schedule);
      }
      _refresh(ref);
      if (mounted) Navigator.pop(context);
    } on AuthApiException catch (e) {
      setState(() {
        _errors = e.fieldMessages;
        _error = e.fieldMessages.isEmpty ? e.message : null;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final months = monthOptions(DateTime.now());
    final title = '${widget.entry == null ? 'Agregar' : 'Editar'} ${_income ? 'ingreso' : 'gasto'}';
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Gap([
            _Labeled(
              'Nombre',
              TextField(
                controller: _label,
                maxLength: 80,
                decoration: InputDecoration(hintText: _income ? 'Ej.: Sueldo' : 'Ej.: Arriendo', errorText: _errors['label'], counterText: ''),
              ),
            ),
            _AmountField(label: 'Monto (CLP)', controller: _amount, error: _errors['amount']),
            if (!_income)
              _Labeled(
                'Tipo de gasto',
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'fixed', label: Text('Fijo')),
                    ButtonSegment(value: 'variable_estimate', label: Text('Variable estimado')),
                  ],
                  selected: {_nature},
                  onSelectionChanged: (s) => setState(() => _nature = s.first),
                ),
              ),
            _Labeled(
              'Periodicidad',
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _kind,
                items: const [
                  DropdownMenuItem(value: 'monthly', child: Text('Todos los meses')),
                  DropdownMenuItem(value: 'every_n_months', child: Text('Cada cierta cantidad de meses')),
                  DropdownMenuItem(value: 'once', child: Text('Una sola vez')),
                ],
                onChanged: (v) => setState(() => _kind = v ?? _kind),
              ),
            ),
            if (_kind == 'every_n_months')
              _Labeled(
                'Cada cuántos meses',
                DropdownButtonFormField<int>(
                  isExpanded: true,
                  initialValue: _interval,
                  items: [for (var n = 2; n <= 24; n++) DropdownMenuItem(value: n, child: Text('Cada $n meses'))],
                  onChanged: (v) => setState(() => _interval = v ?? _interval),
                ),
              ),
            _Labeled(
              _kind == 'once' ? 'Mes' : 'Desde',
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: months.contains(_from) ? _from : months[12],
                items: [for (final m in months) DropdownMenuItem(value: m, child: Text(monthLong(m)))],
                onChanged: (v) => setState(() => _from = v ?? _from),
              ),
            ),
            if (_kind != 'once')
              _Labeled(
                'Hasta',
                DropdownButtonFormField<String?>(
                  isExpanded: true,
                  initialValue: _until != null && months.contains(_until) ? _until : null,
                  decoration: InputDecoration(errorText: _errors['schedule.until']),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('Sin término')),
                    for (final m in months) DropdownMenuItem<String?>(value: m, child: Text(monthLong(m))),
                  ],
                  onChanged: (v) => setState(() => _until = v),
                ),
              ),
            if (_error != null) Text(_error!, style: FdmText.ui(13, weight: FontWeight.w600)),
          ], gap: 14),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Guardando…' : 'Guardar')),
      ],
    );
  }
}

class _DebtDialog extends ConsumerStatefulWidget {
  const _DebtDialog({this.debt});
  final RegistryDebt? debt;
  @override
  ConsumerState<_DebtDialog> createState() => _DebtDialogState();
}

class _DebtDialogState extends ConsumerState<_DebtDialog> {
  late final _label = TextEditingController(text: widget.debt?.label ?? '');
  late final _installment = TextEditingController(text: widget.debt?.nextAmount?.toString() ?? '');
  late final _pending = TextEditingController(text: widget.debt?.pendingInstallments.toString() ?? '');
  late final _total = TextEditingController(text: widget.debt?.totalInstallments?.toString() ?? '');
  late String _next = widget.debt?.nextMonth ?? monthOf(DateTime.now());
  Map<String, String> _errors = const {};
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_label, _installment, _pending, _total]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final installment = _parseAmount(_installment.text);
    final pending = int.tryParse(_pending.text.trim());
    if (installment == null || pending == null) {
      setState(
        () => _errors = {
          if (installment == null) 'installmentAmount': 'Ingresa la cuota en pesos, sin decimales.',
          if (pending == null) 'pendingInstallments': 'Ingresa cuántas cuotas quedan.',
        },
      );
      return;
    }
    setState(() {
      _busy = true;
      _errors = const {};
      _error = null;
    });
    try {
      await ref
          .read(registryApiProvider)
          .saveDebt(
            id: widget.debt?.id,
            label: _label.text,
            installmentAmount: installment,
            pendingInstallments: pending,
            nextInstallmentMonth: _next,
            totalInstallments: int.tryParse(_total.text.trim()),
          );
      _refresh(ref);
      if (mounted) Navigator.pop(context);
    } on AuthApiException catch (e) {
      setState(() {
        _errors = e.fieldMessages;
        _error = e.fieldMessages.isEmpty ? e.message : null;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final months = monthOptions(DateTime.now(), before: 1, after: 24);
    return AlertDialog(
      title: Text(widget.debt == null ? 'Agregar deuda' : 'Editar deuda'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Gap([
            _Labeled(
              'Nombre',
              TextField(
                controller: _label,
                maxLength: 80,
                decoration: InputDecoration(hintText: 'Ej.: Notebook en cuotas', errorText: _errors['label'], counterText: ''),
              ),
            ),
            _AmountField(label: 'Cuota mensual (CLP)', controller: _installment, error: _errors['installmentAmount']),
            _Labeled(
              'Cuotas pendientes',
              TextField(
                controller: _pending,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(errorText: _errors['pendingInstallments']),
              ),
            ),
            _Labeled(
              'Total de cuotas (opcional)',
              TextField(
                controller: _total,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(hintText: 'Para mostrar «cuota 3 de 12»', errorText: _errors['totalInstallments']),
              ),
            ),
            _Labeled(
              'Mes de la próxima cuota',
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: months.contains(_next) ? _next : months[1],
                items: [for (final m in months) DropdownMenuItem(value: m, child: Text(monthLong(m)))],
                onChanged: (v) => setState(() => _next = v ?? _next),
              ),
            ),
            const Muted('Las cuotas se agotan solas al término del plazo. La app no paga deudas: solo las proyecta.', size: 12),
            if (_error != null) Text(_error!, style: FdmText.ui(13, weight: FontWeight.w600)),
          ], gap: 14),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Guardando…' : 'Guardar')),
      ],
    );
  }
}

class _Labeled extends StatelessWidget {
  const _Labeled(this.label, this.child);
  final String label;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
      const SizedBox(height: 6),
      child,
    ],
  );
}

class _AmountField extends StatelessWidget {
  const _AmountField({required this.label, required this.controller, this.allowNegative = false, this.error});
  final String label;
  final TextEditingController controller;
  final bool allowNegative;
  final String? error;
  @override
  Widget build(BuildContext context) => _Labeled(
    label,
    TextField(
      controller: controller,
      keyboardType: TextInputType.numberWithOptions(signed: allowNegative),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(allowNegative ? r'^-?\d{0,13}' : r'^\d{0,13}'))],
      decoration: InputDecoration(prefixText: r'$ ', errorText: error, errorMaxLines: 3),
    ),
  );
}

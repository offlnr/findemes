import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/auth/auth_api.dart';
import '../../data/household_api.dart';
import '../../data/registry_api.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import 'registry_screen.dart' show describeSchedule;

/// Hogar (HU12-HU16, HU20, HU31). La información fluye del espacio común a cada perfil, nunca al
/// revés: aquí solo hay nombres, roles y gastos comunes. Los repartos los calcula el servidor.
class HouseholdScreen extends ConsumerWidget {
  const HouseholdScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(householdDataProvider),
        builder: (h) => h == null ? const _NoHousehold() : _HouseholdView(h: h),
      );
}

void _snack(BuildContext context, String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

String currentMonthKey() {
  final now = DateTime.now();
  return '${now.year}-${now.month.toString().padLeft(2, '0')}';
}

const _privacyTable = FdmCard(title: 'Qué ve cada quien', children: [
  FdmTable(
    columns: [Col('', flex: 3), Col('Integrantes del hogar', flex: 2), Col('Solo tú', flex: 1)],
    rows: [
      [Cell('Gastos comunes y reglas de aporte'), Cell('Sí'), Cell('')],
      [Cell('Aporte de cada integrante'), Cell('Sí'), Cell('')],
      [Cell('Tus ingresos y gastos personales'), Cell(''), Cell('Sí')],
      [Cell('Tus deudas y cuotas'), Cell(''), Cell('Sí')],
      [Cell('Tus escenarios'), Cell(''), Cell('Sí')],
    ],
  ),
  Muted('Esto aplica también a quien administra el hogar. El servidor lo verifica en cada solicitud.', size: 12),
]);

class _NoHousehold extends ConsumerStatefulWidget {
  const _NoHousehold();
  @override
  ConsumerState<_NoHousehold> createState() => _NoHouseholdState();
}

class _NoHouseholdState extends ConsumerState<_NoHousehold> {
  final _name = TextEditingController();
  final _alias = TextEditingController();
  final _link = TextEditingController();
  Map<String, String> _errors = const {};
  String? _planMessage;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _alias.dispose();
    _link.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _errors = const {};
      _planMessage = null;
    });
    try {
      await ref.read(householdApiProvider).create(_name.text.trim(), _alias.text.trim());
      ref.invalidate(householdDataProvider);
    } on AuthApiException catch (e) {
      setState(() {
        if (e.code == 'plan_limit') {
          _planMessage = e.message;
        } else {
          _errors = e.fieldMessages.isEmpty ? {'name': e.message} : e.fieldMessages;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openLink() {
    final token = RegExp(r'token=([A-Za-z0-9_-]{43})').firstMatch(_link.text)?.group(1);
    if (token == null) {
      _snack(context, 'Pega el enlace completo que te enviaron.');
      return;
    }
    context.go('/invitacion?token=$token');
  }

  @override
  Widget build(BuildContext context) {
    final pending = ref.watch(pendingInvitationProvider);
    return PageBody(children: [
      const PageHeader(icon: FdmIcons.home, title: 'Hogar', subtitle: 'Gastos comunes y aportes. Lo individual de cada integrante no se comparte.'),
      if (pending != null)
        Notice('Tienes una invitación a un hogar pendiente de aceptar.', action: FilledButton(onPressed: () => context.go('/invitacion?token=$pending'), child: const Text('Ver invitación'))),
      ResponsiveRow(children: [
        FdmCard(title: 'Crear un hogar', children: [
          const Muted('Quien crea el hogar lo administra: invita integrantes y define cómo se reparte cada gasto común. Requiere el plan Familiar.', size: 14),
          TextField(controller: _name, maxLength: 80, decoration: InputDecoration(labelText: 'Nombre del hogar', hintText: 'Ej.: Depto Ñuñoa', errorText: _errors['name'])),
          TextField(controller: _alias, maxLength: 80, decoration: InputDecoration(labelText: 'Tu nombre en el hogar', errorText: _errors['displayName'])),
          if (_planMessage != null) Notice(_planMessage!, action: TextButton(onPressed: () => context.go('/app/plan'), child: const Text('Ver planes'))),
          Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: _busy ? null : _create, child: const Text('Crear hogar'))),
        ]),
        FdmCard(title: '¿Te invitaron?', children: [
          const Muted('Abre el enlace que te enviaron o pégalo aquí. Antes de aceptar verás qué se comparte.', size: 14),
          TextField(controller: _link, decoration: const InputDecoration(labelText: 'Enlace de invitación')),
          Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: _openLink, child: const Text('Abrir invitación'))),
        ]),
      ]),
      _privacyTable,
    ]);
  }
}

class _HouseholdView extends ConsumerWidget {
  const _HouseholdView({required this.h});
  final HouseholdData h;
  static const _palette = [FdmColors.ink, FdmColors.muted, FdmColors.accent, FdmColors.border];

  Future<void> _invite(BuildContext context, WidgetRef ref) async {
    try {
      final url = await ref.read(householdApiProvider).invite();
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Enlace de invitación', style: FdmText.serif(26)),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Compártelo con la persona que quieres sumar. Sirve una sola vez y vence en 7 días.'),
            const SizedBox(height: 12),
            SelectableText(url, style: FdmText.ui(12)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
            FilledButton(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (ctx.mounted) Navigator.pop(ctx);
                if (context.mounted) _snack(context, 'Enlace copiado.');
              },
              child: const Text('Copiar enlace'),
            ),
          ],
        ),
      );
    } on AuthApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, HouseholdMemberData member) async {
    final leaving = member.isMe;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(leaving ? '¿Salir del hogar?' : '¿Remover a ${member.displayName}?'),
        content: Text(leaving
            ? 'Dejarás de ver los gastos comunes y tu aporte saldrá de tu proyección. Si administras el hogar, la administración pasa al integrante más antiguo.'
            : 'Dejará de ver los gastos comunes. Sus datos personales no se ven afectados.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(leaving ? 'Salir' : 'Remover')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(householdApiProvider).removeMember(member.userId);
      ref.invalidate(householdDataProvider);
      ref.invalidate(projectionDataProvider);
    } on AuthApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
  }

  Future<void> _deleteExpense(BuildContext context, WidgetRef ref, SharedExpenseData e) async {
    try {
      await ref.read(householdApiProvider).deleteExpense(e.id);
      ref.invalidate(householdDataProvider);
      ref.invalidate(projectionDataProvider);
    } on AuthApiException catch (error) {
      if (context.mounted) _snack(context, error.message);
    }
  }

  String _ruleText(ContributionRule rule) => switch (rule) {
        EqualRule() => 'Partes iguales',
        AssignedRule(:final userId) => 'Asignado a ${h.nameOf(userId)}',
        PercentageRule(:final basisPoints) => basisPoints.entries.map((e) => '${h.nameOf(e.key)} ${_percent(e.value)}').join(' · '),
      };

  static String _percent(int basisPoints) => '${(basisPoints / 100).toStringAsFixed(basisPoints % 100 == 0 ? 0 : 2).replaceAll('.', ',')} %';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final monthly = h.expenses.where((e) => e.schedule is MonthlySchedule).toList();
    return PageBody(children: [
      PageHeader(
        icon: FdmIcons.home,
        title: h.name,
        subtitle: h.isAdmin ? 'Administras este hogar.' : 'Integrante del hogar.',
        actions: [if (h.isAdmin && !h.readOnly) FilledButton(onPressed: () => _invite(context, ref), child: const Text('Invitar integrante'))],
      ),
      if (h.readOnly)
        Notice('El espacio del hogar está en modo de solo lectura: ningún integrante tiene un plan Familiar vigente. Los datos se conservan y al renovar vuelve el acceso completo.',
            action: TextButton(onPressed: () => context.go('/app/plan'), child: const Text('Ver planes'))),
      ResponsiveRow(children: [
        FdmCard(title: 'Integrantes', children: [
          FdmTable(
            columns: const [Col('Persona', flex: 3), Col('Rol', flex: 2), Col('', flex: 2)],
            rows: [
              for (final m in h.members)
                [
                  Cell(m.isMe ? '${m.displayName} (tú)' : m.displayName),
                  Cell(m.isAdmin ? 'Administra' : 'Integrante'),
                  if (m.isMe)
                    Cell.w(TextButton(onPressed: () => _remove(context, ref, m), child: const Text('Salir')))
                  else if (h.isAdmin)
                    Cell.w(TextButton(onPressed: () => _remove(context, ref, m), child: const Text('Remover')))
                  else
                    const Cell(''),
                ],
            ],
          ),
          const Muted('Cada integrante aparece con el nombre que eligió para el hogar. Los correos no se muestran.', size: 12),
        ]),
        _privacyTable,
      ]),
      if (monthly.isNotEmpty)
        FdmCard(title: 'Gasto común mensual', children: [
          ResponsiveRow(breakpoint: 900, children: [
            Wrap(spacing: 28, runSpacing: 20, crossAxisAlignment: WrapCrossAlignment.center, children: [
              DonutChart(
                semanticLabel: 'Gasto común mensual: ${[for (final e in monthly) '${e.label} ${clp(e.amount)}'].join(', ')}.',
                slices: [for (var i = 0; i < monthly.length; i++) DonutSlice(monthly[i].amount, _palette[i % _palette.length])],
                centerLabel: 'Total al mes',
                centerValue: clp(h.monthlyTotal),
              ),
            ]),
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Aporte mensual de cada integrante', style: FdmText.ui(13, weight: FontWeight.w500, color: FdmColors.muted)),
              const SizedBox(height: 12),
              for (final m in h.members)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(children: [
                    Expanded(child: Text(m.isMe ? '${m.displayName} (tú)' : m.displayName, style: FdmText.ui(14))),
                    Text(clp(h.memberMonthlyTotals[m.userId] ?? 0), style: FdmText.number(15)),
                  ]),
                ),
            ]),
          ]),
        ]),
      FdmCard(
        title: 'Gastos comunes',
        trailing: h.readOnly
            ? null
            : OutlinedButton(onPressed: () => showDialog<void>(context: context, builder: (_) => _ExpenseDialog(h: h)), child: const Text('Agregar gasto común')),
        children: [
          if (h.expenses.isEmpty) const Muted('Aún no hay gastos comunes. Cualquier integrante puede registrarlos.'),
          if (h.expenses.isNotEmpty)
            FdmTable(
              minWidth: 860,
              columns: [
                const Col('Gasto', flex: 3),
                const Col('Monto', flex: 2),
                const Col('Regla de aporte', flex: 3),
                for (final m in h.members) Col(m.displayName, flex: 2),
                const Col('Registró', flex: 2),
                const Col('', flex: 2),
              ],
              rows: [
                for (final e in h.expenses)
                  [
                    Cell(e.label, sub: describeSchedule(e.schedule)),
                    Cell(clp(e.amount), number: true),
                    Cell(_ruleText(e.rule)),
                    for (final m in h.members) Cell(clp(e.shares[m.userId] ?? 0), number: true),
                    Cell(e.createdByName),
                    e.canEdit
                        ? Cell.w(Wrap(children: [
                            IconButton(tooltip: 'Editar', onPressed: () => showDialog<void>(context: context, builder: (_) => _ExpenseDialog(h: h, expense: e)), icon: const Icon(Icons.edit_outlined, size: 18)),
                            IconButton(tooltip: 'Eliminar', onPressed: () => _deleteExpense(context, ref, e), icon: const Icon(Icons.delete_outline, size: 18)),
                          ]))
                        : const Cell(''),
                  ],
              ],
            ),
          if (!h.isAdmin) const Muted('Puedes editar los gastos que registraste. Las reglas de aporte las define quien administra el hogar.', size: 12),
        ],
      ),
      FdmCard(title: 'Tu aporte en tu proyección', children: [
        Text(
          'Tu aporte de ${clp(h.myMonthlyContribution)} mensuales aparece como un compromiso fijo en tu proyección individual. '
          'Los demás integrantes no ven el resto de tu presupuesto.',
          style: FdmText.ui(14),
        ),
      ]),
    ]);
  }
}

/// Alta o edición de un gasto común (HU13, HU14). El administrador elige la regla de aporte.
class _ExpenseDialog extends ConsumerStatefulWidget {
  const _ExpenseDialog({required this.h, this.expense});
  final HouseholdData h;
  final SharedExpenseData? expense;
  @override
  ConsumerState<_ExpenseDialog> createState() => _ExpenseDialogState();
}

class _ExpenseDialogState extends ConsumerState<_ExpenseDialog> {
  late final _label = TextEditingController(text: widget.expense?.label);
  late final _amount = TextEditingController(text: widget.expense?.amount.toString());
  late String _mode = switch (widget.expense?.rule) {
    AssignedRule() => 'assigned',
    PercentageRule() => 'percentage',
    _ => 'equal',
  };
  late String? _assignee = switch (widget.expense?.rule) {
    AssignedRule(:final userId) => userId,
    _ => widget.h.members.first.userId,
  };
  late final Map<String, TextEditingController> _percents = {
    for (final m in widget.h.members)
      m.userId: TextEditingController(
        text: switch (widget.expense?.rule) {
          PercentageRule(:final basisPoints) => ((basisPoints[m.userId] ?? 0) / 100).toStringAsFixed(0),
          _ => '',
        },
      ),
  };
  late bool _monthly = widget.expense == null || widget.expense!.schedule is MonthlySchedule;
  Map<String, String> _errors = const {};
  bool _busy = false;

  @override
  void dispose() {
    _label.dispose();
    _amount.dispose();
    for (final c in _percents.values) {
      c.dispose();
    }
    super.dispose();
  }

  ContributionRule? _rule() {
    if (!widget.h.isAdmin) return widget.expense?.rule;
    return switch (_mode) {
      'assigned' => AssignedRule(_assignee!),
      'percentage' => PercentageRule({
          for (final e in _percents.entries)
            if ((double.tryParse(e.value.text.replaceAll(',', '.')) ?? 0) > 0) e.key: ((double.tryParse(e.value.text.replaceAll(',', '.')) ?? 0) * 100).round(),
        }),
      _ => const EqualRule(),
    };
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _errors = const {};
    });
    final month = currentMonthKey();
    final schedule = _monthly
        ? (widget.expense?.schedule is MonthlySchedule ? widget.expense!.schedule : MonthlySchedule(month, null))
        : (widget.expense?.schedule is OnceSchedule ? widget.expense!.schedule : OnceSchedule(month));
    try {
      await ref.read(householdApiProvider).saveExpense(
            id: widget.expense?.id,
            label: _label.text.trim(),
            amount: int.tryParse(_amount.text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0,
            schedule: schedule,
            rule: _rule(),
          );
      ref.invalidate(householdDataProvider);
      ref.invalidate(projectionDataProvider);
      if (mounted) Navigator.pop(context);
    } on AuthApiException catch (e) {
      setState(() => _errors = e.fieldMessages.isEmpty ? {'form': e.message} : e.fieldMessages);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.expense == null ? 'Nuevo gasto común' : 'Editar gasto común', style: FdmText.serif(26)),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextField(controller: _label, maxLength: 80, decoration: InputDecoration(labelText: 'Gasto', hintText: 'Ej.: Luz y agua', errorText: _errors['label'])),
              TextField(
                controller: _amount,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(labelText: 'Monto en pesos', errorText: _errors['amount']),
              ),
              const SizedBox(height: 8),
              SegmentedButton<bool>(
                segments: const [ButtonSegment(value: true, label: Text('Todos los meses')), ButtonSegment(value: false, label: Text('Solo este mes'))],
                selected: {_monthly},
                onSelectionChanged: (v) => setState(() => _monthly = v.first),
              ),
              if (widget.h.isAdmin) ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: _mode,
                  decoration: const InputDecoration(labelText: 'Regla de aporte'),
                  items: const [
                    DropdownMenuItem(value: 'equal', child: Text('Partes iguales')),
                    DropdownMenuItem(value: 'percentage', child: Text('Porcentajes')),
                    DropdownMenuItem(value: 'assigned', child: Text('Asignado a un integrante')),
                  ],
                  onChanged: (v) => setState(() => _mode = v ?? 'equal'),
                ),
                if (_mode == 'assigned')
                  DropdownButtonFormField<String>(
                    initialValue: _assignee,
                    decoration: const InputDecoration(labelText: 'Integrante'),
                    items: [for (final m in widget.h.members) DropdownMenuItem(value: m.userId, child: Text(m.displayName))],
                    onChanged: (v) => setState(() => _assignee = v),
                  ),
                if (_mode == 'percentage')
                  for (final m in widget.h.members)
                    TextField(
                      controller: _percents[m.userId],
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(labelText: '% de ${m.displayName}', suffixText: '%'),
                    ),
                if (_errors['rule.shares'] != null || _errors['rule.userId'] != null)
                  Padding(padding: const EdgeInsets.only(top: 8), child: Text(_errors['rule.shares'] ?? _errors['rule.userId']!, style: FdmText.ui(12, color: Colors.red.shade800))),
              ],
              if (_errors['form'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_errors['form']!, style: FdmText.ui(12, color: Colors.red.shade800))),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(onPressed: _busy ? null : _save, child: const Text('Guardar')),
        ],
      );
}

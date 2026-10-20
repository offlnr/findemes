import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../data/models.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import '../../widgets/form_row.dart';

/// Hogar (HU12-HU16, HU31). La información fluye del espacio común a cada perfil, nunca al revés.
class HouseholdScreen extends ConsumerWidget {
  const HouseholdScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(householdProvider),
        builder: (h) => PageBody(children: [
          PageHeader(icon: FdmIcons.home, title: h.name, subtitle: 'Gastos comunes y aportes. Lo individual de cada miembro no se comparte.'),
          ResponsiveRow(children: [
            FdmCard(title: 'Miembros', children: [
              FdmTable(
                columns: const [Col('Persona', flex: 3), Col('Rol / estado', flex: 2)],
                rows: [
                  for (final m in h.members) [Cell(m.me ? '${m.name} (tú)' : m.name), m.pending ? Cell.w(Pill(m.role)) : Cell(m.role)],
                ],
              ),
              const FormRow(fields: [FieldSpec('Invitar por correo', hint: 'correo@ejemplo.cl', width: 260)], action: 'Invitar'),
              const Muted('El enlace de invitación es de un solo uso.', size: 12),
            ]),
            const FdmCard(title: 'Qué ve cada quien', children: [
              FdmTable(
                columns: [Col('', flex: 3), Col('Miembros del hogar', flex: 2), Col('Solo tú', flex: 1)],
                rows: [
                  [Cell('Gastos comunes y reglas'), Cell('Sí'), Cell('')],
                  [Cell('Aporte de cada miembro'), Cell('Sí'), Cell('')],
                  [Cell('Tus ingresos y gastos'), Cell(''), Cell('Sí')],
                  [Cell('Tus deudas'), Cell(''), Cell('Sí')],
                  [Cell('Tus escenarios'), Cell(''), Cell('Sí')],
                ],
              ),
              Muted('Esto aplica también a quien administra el hogar. El servidor lo verifica en cada solicitud.', size: 12),
            ]),
          ]),
          _SpendingCard(h: h),
          FdmCard(title: 'Gastos comunes', children: [
            FdmTable(
              minWidth: 860,
              columns: [const Col('Gasto', flex: 3), const Col('Monto', flex: 2), const Col('Regla de aporte', flex: 3), for (final n in h.memberNames) Col(n, flex: 2), const Col('Registró', flex: 2)],
              rows: [
                for (final e in h.expenses) [Cell(e.name), Cell(clp(e.amount), number: true), Cell(e.rule), for (final p in e.parts) Cell(clp(p), number: true), Cell(e.author)],
                [const Cell('Total', strong: true), Cell(clp(h.total), number: true, strong: true), const Cell(''), for (final c in h.contributions) Cell(clp(c.amount), number: true, strong: true), const Cell('')],
              ],
            ),
            const FormRow(
              fields: [
                FieldSpec('Gasto común', hint: 'Ej.: Luz y agua'),
                FieldSpec('Monto mensual', hint: '\$0', width: 160),
                FieldSpec('Regla', options: ['Partes iguales', 'Porcentaje', 'Asignado a Camila', 'Asignado a Diego'], width: 220),
                FieldSpec('% para ti (si es porcentaje)', hint: '', width: 200),
              ],
              action: 'Agregar',
            ),
          ]),
          FdmCard(title: 'Tu aporte en tu proyección', children: [
            Text('Tu aporte de ${clp(h.myContribution)} mensuales aparece como un compromiso en tu proyección individual. Los demás miembros no ven el resto de tu presupuesto.', style: FdmText.ui(14)),
          ]),
        ]),
      );
}

class _SpendingCard extends StatelessWidget {
  const _SpendingCard({required this.h});
  final Household h;
  static const _palette = [FdmColors.ink, FdmColors.muted, FdmColors.accent, FdmColors.border];

  @override
  Widget build(BuildContext context) {
    final byCategory = Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: FdmColors.canvas, borderRadius: BorderRadius.circular(FdmRadius.tile)),
      child: Wrap(spacing: 28, runSpacing: 20, crossAxisAlignment: WrapCrossAlignment.center, children: [
        DonutChart(
          semanticLabel: 'Gasto común por categoría: ${[for (final e in h.expenses) '${e.name} ${clp(e.amount)}'].join(', ')}.',
          slices: [for (var i = 0; i < h.expenses.length; i++) DonutSlice(h.expenses[i].amount, _palette[i % _palette.length])],
          centerLabel: 'Total al mes',
          centerValue: clp(h.total),
        ),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 240),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (var i = 0; i < h.expenses.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Container(width: 12, height: 12, decoration: BoxDecoration(color: _palette[i % _palette.length], borderRadius: BorderRadius.circular(3))),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(h.expenses[i].name, style: FdmText.ui(13, weight: FontWeight.w500)),
                      Text(clp(h.expenses[i].amount), style: FdmText.number(15)),
                    ]),
                  ),
                ]),
              ),
          ]),
        ),
      ]),
    );
    final contributions = Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: FdmColors.canvas, borderRadius: BorderRadius.circular(FdmRadius.tile)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Aporte de cada miembro', style: FdmText.ui(13, weight: FontWeight.w500, color: FdmColors.muted)),
        const SizedBox(height: 14),
        SplitBar(a: h.contributions[0].amount, b: h.contributions[1].amount),
        const SizedBox(height: 10),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          for (final c in h.contributions)
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.name, style: FdmText.ui(12, weight: FontWeight.w500, color: FdmColors.muted)),
              Text(clp(c.amount), style: FdmText.number(16)),
            ]),
        ]),
        const SizedBox(height: 20),
        Text('Gasto común total, últimos 6 meses', style: FdmText.ui(13, weight: FontWeight.w500, color: FdmColors.muted)),
        const SizedBox(height: 8),
        BarChart(
          height: 160,
          semanticLabel: 'Gasto común total de los últimos seis meses.',
          values: [for (final m in h.history) m.amount],
          labels: [for (final m in h.history) m.name],
          colors: [for (var i = 0; i < h.history.length; i++) i == h.history.length - 1 ? FdmColors.ink : FdmColors.accent],
          max: 1200000,
          ticks: const [],
        ),
      ]),
    );
    return FdmCard(title: 'Gasto del hogar', children: [
      Muted('Gastos comunes de ${h.monthLabel}: en qué se van y cuánto pone cada miembro. Solo datos del espacio común.', size: 14),
      ResponsiveRow(breakpoint: 900, children: [byCategory, contributions]),
      const Muted('Cada miembro ve estos totales del espacio común. Nadie ve los ingresos, deudas ni escenarios personales de los demás.', size: 12),
    ]);
  }
}

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

/// Mi situación (HU39, HU10) y salud financiera (propuesta fuera de las 43 HU: describe, no califica).
class SummaryScreen extends ConsumerWidget {
  const SummaryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(summaryProvider),
        builder: (s) => PageBody(children: [
          PageHeader(
            icon: FdmIcons.steps,
            title: 'Mi situación',
            subtitle: 'Resumen calculado con tu registro actual, a ${s.asOf}.',
            actions: [OutlinedButton(onPressed: () => context.go('/app/escenarios'), child: const Text('Crear escenario'))],
          ),
          _Hero(summary: s),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth >= 1000 ? 4 : (c.maxWidth >= 560 ? 2 : 1);
            final w = (c.maxWidth - 16 * (cols - 1)) / cols;
            return Wrap(spacing: 16, runSpacing: 16, children: [for (final i in s.indicators) SizedBox(width: w, child: KpiCard(i))]);
          }),
          _DebtHealthCard(h: s.debtHealth),
          FdmCard(
            title: 'Saldo proyectado',
            trailing: TextButton(onPressed: () => context.go('/app/proyeccion'), child: const Text('Ver detalle mes a mes')),
            children: [
              Muted('Saldo al cierre de cada mes · ${s.months.first.label} a ${s.months.last.label}'),
              LineChart(
                semanticLabel: 'Saldo al cierre de cada mes, de ${clp(s.months.first.closing)} en ${s.months.first.label} a ${clp(s.months.last.closing)} en ${s.months.last.label}.',
                series: [LineSeries(name: 'Saldo', values: [for (final m in s.months) m.closing], color: FdmColors.ink, area: true)],
                labels: [for (final m in s.months) m.short],
                min: 0,
                max: 3000000,
                ticks: const [0, 1000000, 2000000, 3000000],
                marks: [
                  ChartMark(index: 0, value: s.months.first.closing, label: 'Más bajo: ${clp(s.months.first.closing)}', below: true),
                  ChartMark(index: 5, value: s.months[5].closing, label: 'Abril: termina el crédito', alignLeft: true),
                  ChartMark(index: s.months.length - 1, value: s.months.last.closing, label: 'Octubre: ${clp(s.months.last.closing)}', alignLeft: true, below: true),
                ],
              ),
            ],
          ),
          FdmCard(title: 'Cómo se obtiene', children: [Bullets(s.explanation)]),
          ResponsiveRow(children: [
            FdmCard(title: 'Cuotas pendientes', children: [
              FdmTable(
                columns: const [Col('Deuda', flex: 3), Col('Cuota', flex: 2), Col('Pendientes', flex: 2), Col('Termina', flex: 2)],
                rows: [
                  for (final d in s.debts) [Cell(d.name), Cell(clp(d.installment), number: true), Cell('${d.remaining}', number: true), Cell(d.lastMonth)],
                ],
              ),
            ]),
            FdmCard(title: 'Aporte al hogar este mes', children: [
              FdmTable(
                columns: const [Col('Gasto común', flex: 3), Col('Tu parte', flex: 2)],
                rows: [
                  for (final sh in s.householdShares) [Cell(sh.name, strong: sh.name == 'Total'), Cell(clp(sh.amount), number: true, strong: sh.name == 'Total')],
                ],
              ),
            ]),
          ]),
        ]),
      );
}

class _Hero extends StatelessWidget {
  const _Hero({required this.summary});
  final Summary summary;

  @override
  Widget build(BuildContext context) {
    final months = summary.months;
    final max = months.map((m) => m.closing).reduce((a, b) => a > b ? a : b);
    final figure = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(summary.finalLabel, style: FdmText.ui(14, weight: FontWeight.w500, color: FdmColors.accent)),
      const SizedBox(height: 8),
      FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(clp(summary.finalClosing), style: FdmText.number(84, color: FdmColors.onInk))),
      const SizedBox(height: 10),
      ConstrainedBox(constraints: const BoxConstraints(maxWidth: 400), child: Text(summary.heroSentence, style: FdmText.ui(16, color: FdmColors.onInk))),
    ]);
    final bars = Semantics(
      label: 'Barras del saldo al cierre de cada mes. Las claras son meses con cuota del crédito.',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        SizedBox(
          height: 150,
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
            for (final m in months)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Container(
                  width: 26,
                  height: 150 * m.closing / max,
                  decoration: BoxDecoration(
                    color: m.debt != 0 ? FdmColors.accent.withValues(alpha: 0.6) : FdmColors.onInk,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                  ),
                ),
              ),
          ]),
        ),
        const SizedBox(height: 6),
        Row(mainAxisSize: MainAxisSize.min, children: [
          for (final m in months)
            SizedBox(width: 32, child: Text(m.short[0].toUpperCase(), style: FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.accent), textAlign: TextAlign.left)),
        ]),
        const SizedBox(height: 6),
        Text('Las barras claras pagan la cuota del crédito.', style: FdmText.ui(12, color: FdmColors.accent)),
      ]),
    );
    return Container(
      padding: const EdgeInsets.all(40),
      decoration: BoxDecoration(color: FdmColors.ink, borderRadius: BorderRadius.circular(28)),
      child: LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < 760) return Gap([figure, FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: bars)], gap: 28);
        return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [Expanded(child: figure), const SizedBox(width: 48), bars]);
      }),
    );
  }
}

class _DebtHealthCard extends StatelessWidget {
  const _DebtHealthCard({required this.h});
  final DebtHealth h;

  Widget _tile(String label, Widget value, String sub) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: FdmColors.canvas, borderRadius: BorderRadius.circular(FdmRadius.tile)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: FdmText.ui(13, weight: FontWeight.w500, color: FdmColors.muted)),
          const SizedBox(height: 8),
          value,
          const SizedBox(height: 8),
          Muted(sub, size: 12),
        ]),
      );

  @override
  Widget build(BuildContext context) => FdmCard(title: 'Salud financiera', children: [
        const Muted('El estado de tus deudas: si vas al día, cuánto llevas pagado y cuándo terminan. Fin de Mes lo describe; no lo califica ni lo compara con otras personas.', size: 14),
        LayoutBuilder(builder: (context, c) {
          final cols = c.maxWidth >= 900 ? 4 : (c.maxWidth >= 480 ? 2 : 1);
          final w = (c.maxWidth - 16 * (cols - 1)) / cols;
          final tiles = [
            _tile(
              'Cuotas al día',
              Row(children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: const BoxDecoration(color: FdmColors.ink, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, size: 18, color: FdmColors.accent),
                ),
                const SizedBox(width: 10),
                Text('${h.duePaid} de ${h.due}', style: FdmText.number(28)),
              ]),
              'Cuotas vencidas pagadas. Se detectan en tu cuenta (Fintoc) o las confirmas tú.',
            ),
            _tile(h.debt.name, InstallmentDots(paid: h.debt.paid, total: h.debt.total), '${h.debt.paid} pagadas, quedan ${h.debt.remaining}. La última es en ${h.debt.lastMonth}.'),
            _tile('Deuda pendiente', Text(clp(h.pendingAmount), style: FdmText.number(28)), '${h.debt.remaining} cuotas de ${clp(h.debt.installment)}.'),
            _tile('Sin cuotas desde', Text(h.freeFrom, style: FdmText.number(28)), 'Si no agregas deudas nuevas.'),
          ];
          return Wrap(spacing: 16, runSpacing: 16, children: [for (final t in tiles) SizedBox(width: w, child: t)]);
        }),
      ]);
}

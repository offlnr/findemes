import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/registry_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/chart_scale.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import 'projection_screen.dart';

/// Mi situación (HU39) con la explicación del resultado (HU10). Todo viene calculado por el
/// servidor desde el registro; la pantalla describe y no califica la situación (regla 4).
class SummaryScreen extends ConsumerWidget {
  const SummaryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(projectionDataProvider(12)),
        builder: (p) => PageBody(children: [
          PageHeader(
            icon: FdmIcons.steps,
            title: 'Mi situación',
            subtitle: p == null ? 'Resumen calculado con tu registro.' : 'Resumen calculado con tu registro, desde ${monthLong(p.startMonth)}.',
            actions: [OutlinedButton(onPressed: () => context.go('/app/registro'), child: const Text('Editar registro'))],
          ),
          if (p == null) const NeedsOpeningBalance() else ..._body(context, p),
        ]),
      );

  List<Widget> _body(BuildContext context, ProjectionData p) {
    final indicators = p.outcome.indicators;
    final months = p.outcome.months;
    final firstMargin = indicators.margin.first;
    final firstRatio = indicators.debtToIncome.first;
    final closings = [for (final m in months) m.closingBalance];
    final scale = ChartScale.of(closings);
    final horizon = '${p.horizonMonths} meses desde ${monthShort(p.startMonth)}';
    final kpis = [
      Indicator(
        label: 'Saldo mínimo proyectado',
        value: clp(indicators.minimumAmount),
        detail: monthShort(indicators.minimumMonth),
        explanation: 'El menor saldo al cierre dentro de los $horizon.',
      ),
      Indicator(
        label: 'Mes de quiebre',
        value: indicators.breakMonth == null ? 'No ocurre' : monthShort(indicators.breakMonth!),
        detail: horizon,
        explanation: 'Primer mes en que el saldo al cierre queda bajo \$0.',
      ),
      Indicator(
        label: 'Margen mensual disponible',
        value: clp(firstMargin.amount),
        detail: monthShort(firstMargin.month),
        explanation: 'Ingresos menos gastos y cuotas del mes.',
      ),
      Indicator(
        label: 'Carga de deuda sobre ingreso',
        value: firstRatio.basisPoints == null ? 'Sin ingresos' : percentFromBasisPoints(firstRatio.basisPoints!),
        detail: monthShort(firstRatio.month),
        explanation: 'Parte del ingreso del mes destinada a cuotas.',
      ),
    ];

    return [
      FdmCard(color: FdmColors.ink, children: [
        Text(p.summary, style: FdmText.serif(28, color: FdmColors.onInk).copyWith(height: 1.2)),
      ]),
      LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 1000 ? 4 : (c.maxWidth >= 560 ? 2 : 1);
        final w = (c.maxWidth - 16 * (cols - 1)) / cols;
        return Wrap(spacing: 16, runSpacing: 16, children: [for (final i in kpis) SizedBox(width: w, child: KpiCard(i))]);
      }),
      FdmCard(
        title: 'Saldo proyectado',
        trailing: TextButton(onPressed: () => context.go('/app/proyeccion'), child: const Text('Ver detalle mes a mes')),
        children: [
          Muted('Saldo al cierre de cada mes · ${monthShort(months.first.month)} a ${monthShort(months.last.month)}'),
          LineChart(
            semanticLabel: 'Saldo al cierre de cada mes: ${[for (final m in months) '${monthLong(m.month)} ${clp(m.closingBalance)}'].join(', ')}.',
            series: [LineSeries(name: 'Saldo', values: closings, color: FdmColors.ink, area: true)],
            labels: [for (final m in months) monthInitial(m.month)],
            min: scale.min,
            max: scale.max,
            ticks: scale.ticks,
          ),
        ],
      ),
      FdmCard(title: 'Cómo se obtiene', children: [Bullets(p.details)]),
    ];
  }
}

/// `1913` puntos básicos → `19,1 %`. Solo da formato al valor que entrega la API.
String percentFromBasisPoints(int basisPoints) {
  final tenths = (basisPoints / 10).round();
  return '${tenths ~/ 10},${tenths % 10} %';
}

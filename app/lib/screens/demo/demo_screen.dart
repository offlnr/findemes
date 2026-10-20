import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/finance_repository.dart';
import '../../data/models.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/charts/charts.dart';
import '../../widgets/common.dart';

/// Modo demostración sin cuenta (HU27-HU29). En producción el cálculo lo hace
/// `POST /v1/demo/projection` (sin estado, con límite de uso); aquí se muestran perfiles fijos.
class DemoScreen extends ConsumerStatefulWidget {
  const DemoScreen({super.key});
  @override
  ConsumerState<DemoScreen> createState() => _DemoScreenState();
}

class _DemoScreenState extends ConsumerState<DemoScreen> {
  String _profile = 'familia';

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 700;
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
      body: AsyncBody(
        ref.watch(demoProfilesProvider),
        builder: (profiles) {
          final p = profiles.firstWhere((x) => x.id == _profile);
          return PageBody(children: [
            Text('Modo demostración', style: FdmText.serif(narrow ? 34 : 46)),
            const Notice('Nada de lo que escribas aquí se guarda. El cálculo se hace en el servidor y tiene límite de uso.'),
            ResponsiveRow(breakpoint: 900, children: [
              FdmCard(title: 'Parte de un ejemplo', children: [
                Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final x in profiles)
                    ChoiceChip(label: Text(x.name), selected: x.id == _profile, onSelected: (_) => setState(() => _profile = x.id)),
                ]),
                _Fields(key: ValueKey(p.id), p: p),
              ]),
              Gap([
                LayoutBuilder(builder: (context, c) {
                  final w = c.maxWidth >= 460 ? (c.maxWidth - 16) / 2 : c.maxWidth;
                  return Wrap(spacing: 16, runSpacing: 16, children: [for (final i in p.indicators) SizedBox(width: w, child: KpiCard(i))]);
                }),
                FdmCard(title: 'Saldo al cierre de cada mes', children: [
                  LineChart(
                    height: 260,
                    semanticLabel: 'Saldo al cierre de cada mes del ejemplo ${p.name}.',
                    series: [LineSeries(name: p.name, values: p.closings, color: FdmColors.ink, area: true)],
                    labels: const ['N', 'D', 'E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O'],
                    min: p.closings.any((v) => v < 0) ? -1000000 : 0,
                    max: 3000000,
                    ticks: const [0, 1000000, 2000000, 3000000],
                  ),
                ]),
              ], gap: 16),
            ]),
          ]);
        },
      ),
    );
  }
}

class _Fields extends StatelessWidget {
  const _Fields({super.key, required this.p});
  final DemoProfile p;

  Widget _f(String label, int v) => SizedBox(
        width: 200,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
          const SizedBox(height: 6),
          TextFormField(initialValue: clp(v)),
        ]),
      );

  @override
  Widget build(BuildContext context) => Gap([
        Wrap(spacing: 12, runSpacing: 12, children: [
          _f('Saldo inicial', p.opening),
          _f('Ingresos mensuales', p.income),
          _f('Gastos mensuales', p.expenses),
          _f('Cuota de deudas', p.debt),
        ]),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Con la API conectada, esto envía los montos a /v1/demo/projection.'))),
            child: const Text('Calcular'),
          ),
        ),
      ], gap: 16);
}

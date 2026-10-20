import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/finance_repository.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Escenarios guardados (HU06, HU11). Aparecen en el orden en que se crearon, del mismo
/// tamaño y sin destacar ninguno (CLAUDE.md, regla 4).
class ScenariosScreen extends ConsumerWidget {
  const ScenariosScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(scenariosProvider),
        builder: (list) => PageBody(children: [
          PageHeader(
            icon: FdmIcons.copy,
            title: 'Escenarios',
            subtitle: 'Variantes hipotéticas de tu situación, comparadas con la base.',
            actions: [
              FilledButton(
                onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Modo demostración: crear escenarios requiere la API.'))),
                child: const Text('Crear desde mi situación actual'),
              ),
            ],
          ),
          const Notice('Escenarios ilimitados en tu plan. Cada escenario guarda solo sus decisiones; tu situación base no cambia.'),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth >= 760 ? 2 : 1;
            final w = (c.maxWidth - 24 * (cols - 1)) / cols;
            return Wrap(spacing: 24, runSpacing: 24, children: [
              for (final s in list)
                SizedBox(
                  width: w,
                  child: FdmCard(
                    title: s.name,
                    trailing: Wrap(spacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      OutlinedButton(onPressed: () => context.go('/app/escenarios/${s.id}'), child: const Text('Abrir')),
                      TextButton(
                        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Modo demostración: el cambio no se guarda hasta conectar la API.'))),
                        child: const Text('Eliminar'),
                      ),
                    ]),
                    children: [
                      Wrap(spacing: 32, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        Muted(s.decisionCount == 1 ? '1 decisión' : '${s.decisionCount} decisiones'),
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          Text('Saldo mínimo  ', style: FdmText.ui(14, weight: FontWeight.w600)),
                          Text(clp(s.minBalance), style: FdmText.number(15, weight: FontWeight.w700)),
                        ]),
                      ]),
                    ],
                  ),
                ),
            ]);
          }),
        ]),
      );
}

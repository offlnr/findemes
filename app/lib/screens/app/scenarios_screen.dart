import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/auth/auth_api.dart';
import '../../data/scenario_api.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Escenarios guardados (HU06, HU11). Aparecen en el orden en que se crearon, del mismo
/// tamaño y sin destacar ninguno (regla 4). El límite del plan lo aplica el servidor (Tabla 13).
class ScenariosScreen extends ConsumerWidget {
  const ScenariosScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(scenarioListProvider),
        builder: (data) {
          final limit = data.plan.maxSavedScenarios;
          return PageBody(children: [
            PageHeader(
              icon: FdmIcons.copy,
              title: 'Escenarios',
              subtitle: 'Variantes hipotéticas de tu situación, comparadas con la base.',
              actions: [
                if (data.scenarios.isNotEmpty) OutlinedButton(onPressed: () => context.go('/app/comparar'), child: const Text('Comparar')),
                FilledButton(onPressed: () => _create(context, ref), child: const Text('Crear desde mi situación actual')),
              ],
            ),
            Notice(
              limit == null
                  ? 'Escenarios ilimitados en el plan ${data.plan.name}. Cada escenario guarda solo sus decisiones; tu situación base no cambia.'
                  : 'Plan ${data.plan.name}: ${data.scenarios.length} de $limit escenarios guardados. Cada escenario guarda solo sus decisiones; tu situación base no cambia.',
            ),
            if (data.scenarios.isEmpty) const Muted('Aún no tienes escenarios. Crea uno y agrégale decisiones para ver su efecto.'),
            LayoutBuilder(builder: (context, c) {
              final cols = c.maxWidth >= 760 ? 2 : 1;
              final w = (c.maxWidth - 24 * (cols - 1)) / cols;
              return Wrap(spacing: 24, runSpacing: 24, children: [
                for (final s in data.scenarios)
                  SizedBox(
                    width: w,
                    child: FdmCard(
                      title: s.name,
                      trailing: Wrap(spacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        OutlinedButton(onPressed: () => context.go('/app/escenarios/${s.id}'), child: const Text('Abrir')),
                        TextButton(onPressed: () => _delete(context, ref, s), child: const Text('Eliminar')),
                      ]),
                      children: [Muted(s.decisions.length == 1 ? '1 decisión' : '${s.decisions.length} decisiones')],
                    ),
                  ),
              ]);
            }),
          ]);
        },
      );

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final name = await showDialog<String>(context: context, builder: (_) => const ScenarioNameDialog(title: 'Nuevo escenario'));
    if (name == null || !context.mounted) return;
    try {
      final id = await ref.read(scenarioApiProvider).save(name: name, decisions: const []);
      ref.invalidate(scenarioListProvider);
      if (context.mounted) context.go('/app/escenarios/$id');
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, ScenarioSummary scenario) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Eliminar «${scenario.name}»?'),
        content: const Text('Tu registro y tus otros escenarios no cambian.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(scenarioApiProvider).delete(scenario.id);
      ref.invalidate(scenarioListProvider);
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}

/// Pide el nombre de un escenario (crear o renombrar).
class ScenarioNameDialog extends StatefulWidget {
  const ScenarioNameDialog({super.key, required this.title, this.initial = ''});
  final String title;
  final String initial;
  @override
  State<ScenarioNameDialog> createState() => _ScenarioNameDialogState();
}

class _ScenarioNameDialogState extends State<ScenarioNameDialog> {
  late final _name = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: SizedBox(
          width: 400,
          child: TextField(
            controller: _name,
            autofocus: true,
            maxLength: 80,
            decoration: const InputDecoration(labelText: 'Nombre', hintText: 'Ej.: Notebook en 12 cuotas'),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(onPressed: () => _name.text.trim().isEmpty ? null : Navigator.pop(context, _name.text.trim()), child: const Text('Guardar')),
        ],
      );
}

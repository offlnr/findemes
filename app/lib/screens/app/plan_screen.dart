import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/finance_repository.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Plan y suscripción (HU18-HU20). El pago va por Webpay Plus y lo confirma el backend
/// (CLAUDE.md, regla 6): la app solo inicia el flujo y muestra el resultado.
class PlanScreen extends ConsumerWidget {
  const PlanScreen({super.key});

  Future<void> _checkout(BuildContext context, String planName) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Contratar plan $planName', style: FdmText.serif(28)),
        content: const Text(
          'Con la API conectada, el backend crea la transacción en Transbank y te lleva a Webpay Plus. '
          'Al volver, el backend confirma el pago y te muestra el resultado. Fin de Mes no guarda datos de tu tarjeta.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ver resultado de ejemplo')),
        ],
      ),
    );
    if (go == true && context.mounted) context.go('/app/pago/resultado?estado=confirmado');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(subscriptionProvider),
        builder: (s) => PageBody(children: [
          const PageHeader(icon: FdmIcons.tag, title: 'Plan y suscripción', subtitle: 'Contratación con Webpay Plus, en ambiente de integración durante el proyecto.'),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth >= 900 ? 3 : 1;
            final w = (c.maxWidth - 24 * (cols - 1)) / cols;
            return Wrap(spacing: 24, runSpacing: 24, children: [
              for (final o in s.offers)
                SizedBox(
                  width: w,
                  child: FdmCard(
                    title: o.name,
                    trailing: o.id == s.currentPlanId ? const Pill('Tu plan actual') : null,
                    children: [
                      Muted(o.description, size: 14),
                      Text(o.price, style: o.price.startsWith('\$') ? FdmText.number(26, weight: FontWeight.w700) : FdmText.ui(22, weight: FontWeight.w700)),
                      Muted(o.period, size: 12),
                      if (o.id != 'gratuito')
                        o.id == s.currentPlanId
                            ? OutlinedButton(onPressed: () => _checkout(context, o.name), child: const Text('Renovar'))
                            : FilledButton(onPressed: () => _checkout(context, o.name), child: const Text('Contratar')),
                    ],
                  ),
                ),
            ]);
          }),
          FdmCard(title: 'Estado de tu suscripción', children: [
            FdmTable(
              columns: const [Col('Plan contratado', flex: 2), Col('Estado', flex: 2), Col('Período', flex: 3)],
              rows: [[Cell(s.planName), Cell(s.state), Cell(s.period)]],
            ),
            Wrap(spacing: 16, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              OutlinedButton(onPressed: () {}, child: const Text('Cancelar renovación')),
              const Muted('Si cancelas, mantienes el plan hasta el término del período ya pagado.'),
            ]),
          ]),
          const Muted('Fin de Mes no guarda datos de tu tarjeta. La activación se confirma desde nuestro servidor con Transbank: aunque cierres el navegador durante el pago, el resultado queda registrado una sola vez.'),
        ]),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/auth/auth_api.dart';
import '../../data/subscription_api.dart';
import '../../format/money.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Plan y suscripción (HU18-HU20, Tabla 13, Tabla 14). El pago va por Webpay Plus y lo confirma el
/// backend con Transbank (regla 6): la app solo inicia el flujo y muestra lo que informa el servidor.
class PlanScreen extends ConsumerWidget {
  const PlanScreen({super.key});

  static const _states = {
    'gratuito': ('Plan gratuito', 'Sin suscripción pagada.'),
    'pendiente': ('Pago pendiente', 'Hay un pago iniciado que aún no se confirma. Se mantiene tu plan anterior.'),
    'activa': ('Activa', 'Acceso completo al plan contratado.'),
    'por_vencer': ('Por vencer', 'Tu período termina pronto. Puedes renovarlo cuando quieras.'),
    'vencida': ('Vencida', 'Volviste al plan gratuito sin perder datos. El espacio del hogar queda de solo lectura.'),
    'fallida': ('Pago rechazado', 'Transbank rechazó el último pago. Se mantiene tu plan anterior.'),
    'cancelada': ('Renovación cancelada', 'Mantienes el plan hasta el término del período ya pagado.'),
  };

  Future<void> _checkout(BuildContext context, WidgetRef ref, PlanOffer plan) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Contratar plan ${plan.name}', style: FdmText.serif(28)),
        content: Text(
          'Te llevaremos a Webpay Plus para pagar ${clp(plan.priceClp ?? 0)} por un mes. Durante el proyecto es el ambiente de integración de Transbank: '
          'usa una tarjeta de prueba, no se hace ningún cobro real. Fin de Mes no guarda datos de tu tarjeta.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ir a Webpay')),
        ],
      ),
    );
    if (go != true) return;
    try {
      final url = await ref.read(subscriptionApiProvider).checkout(plan.code);
      await launchUrl(Uri.parse(url), webOnlyWindowName: '_self');
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    try {
      final cancelled = await ref.read(subscriptionApiProvider).cancelRenewal();
      ref.invalidate(subscriptionStatusProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cancelled ? 'Renovación cancelada. Mantienes el plan hasta el término del período.' : 'No tienes un plan pagado vigente.')));
      }
    } on AuthApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(subscriptionStatusProvider),
        builder: (s) => PageBody(children: [
          const PageHeader(icon: FdmIcons.tag, title: 'Plan y suscripción', subtitle: 'Contratación con Webpay Plus, en ambiente de integración durante el proyecto.'),
          AsyncBody(
            ref.watch(plansProvider),
            builder: (plans) => LayoutBuilder(builder: (context, c) {
              final cols = c.maxWidth >= 900 ? 3 : 1;
              final w = (c.maxWidth - 24 * (cols - 1)) / cols;
              return Wrap(spacing: 24, runSpacing: 24, children: [
                for (final plan in plans)
                  SizedBox(
                    width: w,
                    child: FdmCard(
                      title: plan.name,
                      trailing: plan.code == s.planCode ? const Pill('Tu plan actual') : null,
                      children: [
                        Text(plan.priceClp == null ? 'Gratis' : clp(plan.priceClp!), style: FdmText.number(26, weight: FontWeight.w700)),
                        Muted(plan.priceClp == null ? 'Sin costo' : 'Por mes', size: 12),
                        for (final cap in plan.capabilities)
                          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Icon(cap.included ? Icons.check : Icons.remove, size: 16, color: cap.included ? FdmColors.ink : FdmColors.muted),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(cap.label, style: FdmText.ui(13, weight: FontWeight.w500)),
                                Muted(cap.detail, size: 12),
                              ]),
                            ),
                          ]),
                        if (plan.priceClp != null)
                          plan.code == s.planCode
                              ? OutlinedButton(onPressed: () => _checkout(context, ref, plan), child: const Text('Renovar'))
                              : FilledButton(onPressed: () => _checkout(context, ref, plan), child: const Text('Contratar')),
                      ],
                    ),
                  ),
              ]);
            }),
          ),
          FdmCard(title: 'Estado de tu suscripción', children: [
            FdmTable(
              columns: const [Col('Plan', flex: 2), Col('Estado', flex: 2), Col('Acceso hasta', flex: 2)],
              rows: [
                [Cell(s.planName), Cell(_states[s.state]?.$1 ?? s.state), Cell(s.periodEnd ?? '—')],
              ],
            ),
            Muted(_states[s.state]?.$2 ?? '', size: 13),
            if (s.planCode != 'free' && !s.cancelAtPeriodEnd)
              Wrap(spacing: 16, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                OutlinedButton(onPressed: () => _cancel(context, ref), child: const Text('Cancelar renovación')),
                const Muted('Si cancelas, mantienes el plan hasta el término del período ya pagado.'),
              ]),
          ]),
          const Muted(
            'Fin de Mes no guarda datos de tu tarjeta. La activación se confirma desde nuestro servidor con Transbank: aunque cierres el navegador durante el pago, el resultado queda registrado una sola vez.',
          ),
        ]),
      );
}

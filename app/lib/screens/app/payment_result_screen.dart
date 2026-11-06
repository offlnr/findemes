import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/subscription_api.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Resultado del pago. Webpay vuelve al backend, que confirma con Transbank (una sola vez) y
/// redirige aquí con `?estado=`. Esta pantalla no confirma nada por sí misma: el plan vigente se
/// vuelve a pedir al servidor.
class PaymentResultScreen extends ConsumerWidget {
  const PaymentResultScreen({super.key, required this.state});
  final String state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (title, text, action, path) = switch (state) {
      'aprobado' => ('Pago confirmado', 'Transbank confirmó el pago y tu plan quedó activo.', 'Ir a Mi situación', '/app/resumen'),
      'rechazado' => ('Pago rechazado', 'Transbank rechazó la transacción. No se hizo ningún cobro y se mantiene tu plan anterior.', 'Intentar de nuevo', '/app/plan'),
      'anulado' => ('Pago anulado', 'Saliste de Webpay antes de terminar o se agotó el tiempo. No se hizo ningún cobro.', 'Volver a Plan', '/app/plan'),
      'en_revision' => ('Pago en revisión', 'El monto informado no coincide con el del plan. No activamos el plan y revisaremos la transacción.', 'Volver a Plan', '/app/plan'),
      _ => ('Pago pendiente', 'Estamos confirmando el pago con Transbank. Mientras tanto se mantiene tu plan anterior.', 'Volver a Plan', '/app/plan'),
    };
    final status = ref.watch(subscriptionStatusProvider);
    return PageBody(children: [
      const PageHeader(icon: FdmIcons.tag, title: 'Resultado del pago', subtitle: 'El resultado lo confirma el servidor con Transbank.'),
      FdmCard(title: title, children: [
        Muted(text, size: 15),
        if (status.hasValue) Muted('Plan vigente: ${status.value!.planName}${status.value!.periodEnd == null ? '' : ', con acceso hasta el ${status.value!.periodEnd}'}.', size: 14),
        Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: () => context.go(path), child: Text(action))),
      ]),
    ]);
  }
}

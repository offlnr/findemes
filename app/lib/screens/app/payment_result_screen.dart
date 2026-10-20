import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Resultado del pago. Webpay vuelve al backend (return_url, POST); el backend hace el commit
/// idempotente y redirige aquí con `?estado=`. Esta pantalla no confirma nada por sí misma.
class PaymentResultScreen extends StatelessWidget {
  const PaymentResultScreen({super.key, required this.state});
  final String state;

  @override
  Widget build(BuildContext context) {
    final (title, text, action, path) = switch (state) {
      'confirmado' => ('Pago confirmado', 'Tu plan está activo hasta el 15-12-2026. Orden de compra 000123.', 'Ir a Mi situación', '/app/resumen'),
      'rechazado' => ('Pago rechazado o anulado', 'Transbank rechazó la transacción o la anulaste. No se hizo ningún cobro y se mantiene tu plan anterior.', 'Intentar de nuevo', '/app/plan'),
      _ => ('Pago pendiente', 'Estamos confirmando el pago con Transbank. Mientras tanto se mantiene tu plan anterior.', 'Volver a Plan', '/app/plan'),
    };
    return PageBody(children: [
      const PageHeader(icon: FdmIcons.tag, title: 'Resultado del pago', subtitle: 'El resultado lo confirma el servidor con Transbank.'),
      FdmCard(title: title, children: [
        Muted(text, size: 15),
        Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: () => context.go(path), child: Text(action))),
      ]),
    ]);
  }
}

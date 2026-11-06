import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// Planes y suscripción (HU18-HU20, HU30). El pago va por Webpay Plus y lo confirma el backend
/// con Transbank (regla 6): la app solo inicia el flujo y muestra lo que el servidor informa.
final subscriptionApiProvider = Provider<SubscriptionApi>((ref) => SubscriptionApi(ref.watch(apiClientProvider)));
final plansProvider = FutureProvider.autoDispose<List<PlanOffer>>((ref) => ref.watch(subscriptionApiProvider).plans());
final subscriptionStatusProvider = FutureProvider.autoDispose<SubscriptionStatus>((ref) => ref.watch(subscriptionApiProvider).status());

class PlanCapability {
  const PlanCapability({required this.label, required this.included, required this.detail});
  final String label;
  final bool included;
  final String detail;
}

List<PlanCapability> _capabilities(List<dynamic> json) => [
      for (final c in json) PlanCapability(label: (c as Map<String, dynamic>)['label'] as String, included: c['included'] as bool, detail: c['detail'] as String),
    ];

class PlanOffer {
  const PlanOffer({required this.code, required this.name, required this.priceClp, required this.capabilities});
  final String code;
  final String name;
  final int? priceClp;
  final List<PlanCapability> capabilities;
}

/// Tabla 14: gratuito, pendiente, activa, por_vencer, vencida, fallida o cancelada.
class SubscriptionStatus {
  const SubscriptionStatus({required this.planCode, required this.planName, required this.state, required this.periodEnd, required this.cancelAtPeriodEnd, required this.capabilities});
  final String planCode;
  final String planName;
  final String state;
  final String? periodEnd;
  final bool cancelAtPeriodEnd;
  final List<PlanCapability> capabilities;
}

class SubscriptionApi {
  SubscriptionApi(this._api);
  final ApiClient _api;

  Future<List<PlanOffer>> plans() async {
    final json = await _api.sendPublic('GET', '/v1/plans') as Map<String, dynamic>;
    return [
      for (final p in json['plans'] as List<dynamic>)
        PlanOffer(
          code: (p as Map<String, dynamic>)['code'] as String,
          name: p['name'] as String,
          priceClp: p['priceClp'] as int?,
          capabilities: _capabilities(p['capabilities'] as List<dynamic>),
        ),
    ];
  }

  Future<SubscriptionStatus> status() async {
    final json = await _api.send('GET', '/v1/subscription') as Map<String, dynamic>;
    final plan = json['plan'] as Map<String, dynamic>;
    return SubscriptionStatus(
      planCode: plan['code'] as String,
      planName: plan['name'] as String,
      state: json['state'] as String,
      periodEnd: json['periodEnd'] as String?,
      cancelAtPeriodEnd: json['cancelAtPeriodEnd'] as bool,
      capabilities: _capabilities(json['capabilities'] as List<dynamic>),
    );
  }

  /// URL de Webpay a la que se lleva el navegador.
  Future<String> checkout(String plan) async => ((await _api.send('POST', '/v1/subscription/checkout', {'plan': plan})) as Map<String, dynamic>)['redirectUrl'] as String;

  Future<bool> cancelRenewal() async => ((await _api.send('POST', '/v1/subscription/cancel')) as Map<String, dynamic>)['cancelled'] as bool;
}

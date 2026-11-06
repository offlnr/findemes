import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// Derechos sobre los datos personales (HU21) y consentimientos (HU32, Ley 21.719).
final privacyApiProvider = Provider<PrivacyApi>((ref) => PrivacyApi(ref.watch(apiClientProvider)));
final consentsProvider = FutureProvider.autoDispose<List<ConsentData>>((ref) => ref.watch(privacyApiProvider).consents());

class ConsentData {
  const ConsentData({required this.kind, required this.documentVersion, required this.acceptedAt, required this.withdrawnAt});
  final String kind;
  final String documentVersion;
  final DateTime acceptedAt;
  final DateTime? withdrawnAt;
  bool get active => withdrawnAt == null;
}

const consentLabels = {
  'terms': 'Términos y condiciones',
  'privacy_policy': 'Política de privacidad',
  'bank_connection': 'Conexión bancaria',
};

class PrivacyApi {
  PrivacyApi(this._api);
  final ApiClient _api;

  /// Documento JSON con todos los datos de la cuenta, con formato legible.
  Future<String> exportJson() async => const JsonEncoder.withIndent('  ').convert(await _api.send('GET', '/v1/me/export'));

  Future<void> rename(String displayName) => _api.send('PATCH', '/v1/me', {'displayName': displayName});

  /// Borrado efectivo, confirmado con la contraseña vigente.
  Future<void> eraseAccount(String password) => _api.send('DELETE', '/v1/me', {'password': password});

  Future<List<ConsentData>> consents() async {
    final json = await _api.send('GET', '/v1/consents') as Map<String, dynamic>;
    return [
      for (final c in json['consents'] as List<dynamic>)
        ConsentData(
          kind: (c as Map<String, dynamic>)['kind'] as String,
          documentVersion: c['documentVersion'] as String,
          acceptedAt: DateTime.parse(c['acceptedAt'] as String),
          withdrawnAt: c['withdrawnAt'] == null ? null : DateTime.parse(c['withdrawnAt'] as String),
        ),
    ];
  }

  Future<void> accept(String kind) => _api.send('POST', '/v1/consents', {'kind': kind});
  Future<void> withdraw(String kind) => _api.send('DELETE', '/v1/consents/$kind');
}

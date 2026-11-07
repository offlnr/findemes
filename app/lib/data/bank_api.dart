import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'models.dart';
import 'registry_api.dart';

/// Bancos (HU36) desde la API: Fintoc en modo de prueba o el banco de demostración. Todo dato que
/// no es real llega rotulado con su origen y la app lo muestra (ADR-002).
final bankApiProvider = Provider<BankApi>((ref) => BankApi(ref.watch(apiClientProvider)));
final bankProvidersProvider = FutureProvider.autoDispose<BankProviders>((ref) => ref.watch(bankApiProvider).providers());
final bankLinksProvider = FutureProvider.autoDispose<List<BankLinkData>>((ref) => ref.watch(bankApiProvider).links());
final bankMovementsProvider = FutureProvider.autoDispose.family<BankMovements, int>((ref, months) => ref.watch(bankApiProvider).movements(months));

DataOrigin originOf(String? value) => switch (value) {
      'provider_test' => DataOrigin.providerTest,
      'demo' => DataOrigin.demo,
      'real' => DataOrigin.real,
      _ => DataOrigin.manual,
    };

class BankProviders {
  const BankProviders({required this.fintoc, required this.demoProfiles});
  final bool fintoc;
  final List<({String id, String label})> demoProfiles;
}

class BankAccountData {
  const BankAccountData({required this.id, required this.name, required this.type, required this.availableBalance, required this.origin});
  final String id;
  final String name;
  final String type;
  final int availableBalance;
  final DataOrigin origin;
}

class BankLinkData {
  const BankLinkData({required this.id, required this.institutionName, required this.origin, required this.lastSyncedAt, required this.accounts});
  final String id;
  final String institutionName;
  final DataOrigin origin;
  final DateTime? lastSyncedAt;
  final List<BankAccountData> accounts;
}

class BankMovementData {
  const BankMovementData({required this.id, required this.accountId, required this.postedOn, required this.amount, required this.description, required this.origin, required this.confirmedAs});
  final String id;
  final String accountId;
  final String postedOn;
  final int amount;
  final String description;
  final DataOrigin origin;
  final String? confirmedAs;
}

class BankMovements {
  const BankMovements({required this.movements, required this.totals});
  final List<BankMovementData> movements;
  final List<({String month, int credits, int debits})> totals;
}

class BankApi {
  BankApi(this._api);
  final ApiClient _api;

  Future<BankProviders> providers() async {
    final json = await _api.send('GET', '/v1/bank/providers') as Map<String, dynamic>;
    return BankProviders(
      fintoc: (json['fintoc'] as Map<String, dynamic>)['available'] as bool,
      demoProfiles: [for (final p in json['demoProfiles'] as List<dynamic>) (id: (p as Map<String, dynamic>)['id'] as String, label: p['label'] as String)],
    );
  }

  Future<List<BankLinkData>> links() async {
    final json = await _api.send('GET', '/v1/bank/links') as Map<String, dynamic>;
    return [
      for (final l in json['links'] as List<dynamic>)
        BankLinkData(
          id: (l as Map<String, dynamic>)['id'] as String,
          institutionName: l['institutionName'] as String,
          origin: originOf(l['origin'] as String),
          lastSyncedAt: l['lastSyncedAt'] == null ? null : DateTime.parse(l['lastSyncedAt'] as String),
          accounts: [
            for (final a in l['accounts'] as List<dynamic>)
              BankAccountData(
                id: (a as Map<String, dynamic>)['id'] as String,
                name: a['name'] as String,
                type: a['type'] as String,
                availableBalance: a['availableBalance'] as int,
                origin: originOf(a['origin'] as String),
              ),
          ],
        ),
    ];
  }

  Future<BankMovements> movements(int months) async {
    final json = await _api.send('GET', '/v1/bank/movements?months=$months') as Map<String, dynamic>;
    return BankMovements(
      movements: [
        for (final m in json['movements'] as List<dynamic>)
          BankMovementData(
            id: (m as Map<String, dynamic>)['id'] as String,
            accountId: m['accountId'] as String,
            postedOn: m['postedOn'] as String,
            amount: m['amount'] as int,
            description: m['description'] as String,
            origin: originOf(m['origin'] as String),
            confirmedAs: m['confirmedAs'] as String?,
          ),
      ],
      totals: [for (final t in json['totals'] as List<dynamic>) (month: (t as Map<String, dynamic>)['month'] as String, credits: t['credits'] as int, debits: t['debits'] as int)],
    );
  }

  /// Ley 21.719: antes de conectar, el usuario acepta el consentimiento de conexión bancaria.
  Future<void> acceptBankConsent() => _api.send('POST', '/v1/consents', {'kind': 'bank_connection'});

  Future<({String widgetToken, String publicKey})> fintocIntent() async {
    final json = await _api.send('POST', '/v1/bank/fintoc/link-intents') as Map<String, dynamic>;
    return (widgetToken: json['widgetToken'] as String, publicKey: json['publicKey'] as String);
  }

  Future<void> connectFintoc(String exchangeToken) => _api.send('POST', '/v1/bank/links', {'provider': 'fintoc', 'exchangeToken': exchangeToken});
  Future<void> connectDemo(String profileId) => _api.send('POST', '/v1/bank/links', {'provider': 'demo', 'profileId': profileId});
  Future<void> sync(String linkId) => _api.send('POST', '/v1/bank/links/$linkId/sync');
  Future<void> disconnect(String linkId) => _api.send('DELETE', '/v1/bank/links/$linkId');
  Future<void> useAsOpeningBalance(String accountId) => _api.send('POST', '/v1/bank/accounts/$accountId/opening-balance');

  /// Abono → ingreso; cargo → gasto. Mensual desde el mes del movimiento si no se indica otra.
  Future<void> confirmRecurring(String movementId, {required String label, Schedule? schedule, String? nature}) => _api.send(
        'POST',
        '/v1/bank/movements/$movementId/confirm',
        {'label': label, if (schedule != null) 'schedule': schedule.toJson(), 'nature': ?nature},
      );
}

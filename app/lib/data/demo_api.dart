import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'auth/api_http_client.dart';

/// URL base de la API pública. Se fija al compilar: `--dart-define=API_BASE_URL=https://...`.
const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000');

final httpClientProvider = Provider<http.Client>((ref) {
  final client = createApiHttpClient();
  ref.onDispose(client.close);
  return client;
});

final demoApiProvider = Provider<DemoApi>((ref) => DemoApi(ref.watch(httpClientProvider), Uri.parse(apiBaseUrl)));

final demoExamplesProvider = FutureProvider<List<DemoExample>>((ref) => ref.watch(demoApiProvider).examples());

/// Cliente del modo demostración (HU27-HU28): `GET /v1/demo/examples` y
/// `POST /v1/demo/projection`. Todo el cálculo ocurre en el servidor (regla 8); aquí solo se
/// envían los datos y se leen los resultados.
class DemoApi {
  DemoApi(this._client, this._baseUrl);
  final http.Client _client;
  final Uri _baseUrl;

  Future<List<DemoExample>> examples() async {
    final response = await _send(() => _client.get(_baseUrl.resolve('/v1/demo/examples')));
    return [for (final item in response as List<dynamic>) DemoExample.fromJson(item as Map<String, dynamic>)];
  }

  Future<DemoProjection> projection(DemoRequest request) async {
    final response = await _send(
      () => _client.post(
        _baseUrl.resolve('/v1/demo/projection'),
        headers: const {'content-type': 'application/json'},
        body: jsonEncode(request.toJson()),
      ),
    );
    return DemoProjection.fromJson(response as Map<String, dynamic>);
  }

  Future<Object?> _send(Future<http.Response> Function() call) async {
    final http.Response response;
    try {
      response = await call();
    } on Exception {
      throw const DemoApiException('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    }
    final body = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode == 200) return body;
    if (response.statusCode == 429) {
      throw const DemoApiException('Se alcanzó el límite de uso del modo demostración. Intenta en un minuto.');
    }
    if (response.statusCode == 422 && body is Map<String, dynamic>) {
      final issues = [for (final issue in body['issues'] as List<dynamic>) (issue as Map<String, dynamic>)['message'] as String];
      throw DemoApiException('Revisa la decisión: ${issues.join(' ')}');
    }
    throw const DemoApiException('No pudimos calcular la proyección. Revisa los datos ingresados.');
  }
}

class DemoApiException implements Exception {
  const DemoApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class DemoExample {
  const DemoExample({required this.id, required this.name, required this.description});
  factory DemoExample.fromJson(Map<String, dynamic> json) =>
      DemoExample(id: json['id'] as String, name: json['name'] as String, description: json['description'] as String);
  final String id;
  final String name;
  final String description;
}

/// Estado base enviado: un ejemplo ficticio o los datos mínimos del visitante (HU28).
sealed class DemoBase {
  const DemoBase();
  Map<String, Object> toJson();
}

class ExampleBase extends DemoBase {
  const ExampleBase(this.exampleId);
  final String exampleId;
  @override
  Map<String, Object> toJson() => {'example': exampleId};
}

class OwnDataBase extends DemoBase {
  const OwnDataBase({required this.openingBalance, required this.monthlyIncome, required this.monthlyFixedExpense});
  final int openingBalance;
  final int monthlyIncome;
  final int monthlyFixedExpense;
  @override
  Map<String, Object> toJson() =>
      {'openingBalance': openingBalance, 'monthlyIncome': monthlyIncome, 'monthlyFixedExpense': monthlyFixedExpense};
}

class DemoRequest {
  const DemoRequest({required this.base, this.decisionKind, this.decisionParams});
  final DemoBase base;
  final String? decisionKind;
  final Map<String, Object?>? decisionParams;

  Map<String, Object?> toJson() => {
        'base': base.toJson(),
        'decision': decisionKind == null ? null : {'kind': decisionKind, 'params': decisionParams ?? const {}},
      };
}

class MonthFlow {
  const MonthFlow({
    required this.month,
    required this.openingBalance,
    required this.income,
    required this.expenses,
    required this.debtPayments,
    required this.netFlow,
    required this.closingBalance,
  });
  factory MonthFlow.fromJson(Map<String, dynamic> json) => MonthFlow(
        month: json['month'] as String,
        openingBalance: json['openingBalance'] as int,
        netFlow: json['netFlow'] as int,
        income: json['income'] as int,
        expenses: json['expenses'] as int,
        debtPayments: json['debtPayments'] as int,
        closingBalance: json['closingBalance'] as int,
      );
  final String month;
  final int openingBalance;
  final int income;
  final int expenses;
  final int debtPayments;
  final int netFlow;
  final int closingBalance;
}

class MonthAmount {
  const MonthAmount(this.month, this.amount);
  final String month;
  final int amount;
}

class MonthRatio {
  const MonthRatio(this.month, this.basisPoints);
  final String month;
  final int? basisPoints;
}

class DemoIndicators {
  const DemoIndicators({required this.minimumAmount, required this.minimumMonth, required this.breakMonth, required this.margin, required this.debtToIncome});
  factory DemoIndicators.fromJson(Map<String, dynamic> json) {
    final minimum = json['minimumProjectedBalance'] as Map<String, dynamic>;
    return DemoIndicators(
      minimumAmount: minimum['amount'] as int,
      minimumMonth: minimum['month'] as String,
      breakMonth: json['breakMonth'] as String?,
      margin: [
        for (final e in json['monthlyAvailableMargin'] as List<dynamic>)
          MonthAmount((e as Map<String, dynamic>)['month'] as String, e['amount'] as int),
      ],
      debtToIncome: [
        for (final e in json['debtToIncome'] as List<dynamic>)
          MonthRatio((e as Map<String, dynamic>)['month'] as String, e['basisPoints'] as int?),
      ],
    );
  }
  final int minimumAmount;
  final String minimumMonth;
  final String? breakMonth;
  final List<MonthAmount> margin;
  final List<MonthRatio> debtToIncome;
}

class DemoOutcome {
  const DemoOutcome({required this.months, required this.indicators});
  factory DemoOutcome.fromJson(Map<String, dynamic> json) => DemoOutcome(
        months: [for (final m in json['months'] as List<dynamic>) MonthFlow.fromJson(m as Map<String, dynamic>)],
        indicators: DemoIndicators.fromJson(json['indicators'] as Map<String, dynamic>),
      );
  final List<MonthFlow> months;
  final DemoIndicators indicators;
}

/// Diferencia de cada indicador frente a la base (escenario menos base), sin juicio.
class DemoVariation {
  const DemoVariation({required this.minimumBalance, required this.margin, required this.debtToIncome});
  factory DemoVariation.fromJson(Map<String, dynamic> json) => DemoVariation(
        minimumBalance: json['minimumProjectedBalance'] as int,
        margin: [
          for (final e in json['monthlyAvailableMargin'] as List<dynamic>)
            MonthAmount((e as Map<String, dynamic>)['month'] as String, e['amount'] as int),
        ],
        debtToIncome: [
          for (final e in json['debtToIncome'] as List<dynamic>)
            MonthRatio((e as Map<String, dynamic>)['month'] as String, e['basisPoints'] as int?),
        ],
      );
  final int minimumBalance;
  final List<MonthAmount> margin;
  final List<MonthRatio> debtToIncome;
}

class DemoEntry {
  const DemoEntry({required this.id, required this.label});
  final String id;
  final String label;
}

class DemoProjection {
  const DemoProjection({
    required this.startMonth,
    required this.horizonMonths,
    required this.fixedExpenses,
    required this.debts,
    required this.base,
    required this.scenario,
    required this.variation,
    required this.summary,
    required this.details,
    required this.limitNotice,
  });

  factory DemoProjection.fromJson(Map<String, dynamic> json) {
    final entries = json['entries'] as Map<String, dynamic>;
    return DemoProjection(
      startMonth: json['startMonth'] as String,
      horizonMonths: json['horizonMonths'] as int,
      fixedExpenses: [
        for (final e in entries['expenses'] as List<dynamic>)
          if ((e as Map<String, dynamic>)['nature'] == 'fixed') DemoEntry(id: e['id'] as String, label: e['label'] as String),
      ],
      debts: [
        for (final d in entries['debts'] as List<dynamic>)
          DemoEntry(id: (d as Map<String, dynamic>)['id'] as String, label: d['label'] as String),
      ],
      base: DemoOutcome.fromJson(json['base'] as Map<String, dynamic>),
      scenario: json['scenario'] == null ? null : DemoOutcome.fromJson(json['scenario'] as Map<String, dynamic>),
      variation: json['variation'] == null ? null : DemoVariation.fromJson(json['variation'] as Map<String, dynamic>),
      summary: (json['explanation'] as Map<String, dynamic>)['summary'] as String,
      details: [for (final d in (json['explanation'] as Map<String, dynamic>)['details'] as List<dynamic>) d as String],
      limitNotice: json['limitNotice'] as String,
    );
  }

  final String startMonth;
  final int horizonMonths;
  final List<DemoEntry> fixedExpenses;
  final List<DemoEntry> debts;
  final DemoOutcome base;
  final DemoOutcome? scenario;
  final DemoVariation? variation;
  final String summary;
  final List<String> details;
  final String limitNotice;

  /// Resultado que se muestra: el escenario si se aplicó una decisión, si no la base.
  DemoOutcome get shown => scenario ?? base;
}

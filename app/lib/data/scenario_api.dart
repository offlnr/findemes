import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'auth/auth_api.dart';
import 'auth/auth_controller.dart';
import 'demo_api.dart';

/// Escenarios (HU06-HU11) desde la API. Cada simulación y comparación la calcula el servidor.
final scenarioApiProvider = Provider<ScenarioApi>((ref) => ScenarioApi(ref, ref.watch(httpClientProvider), Uri.parse(apiBaseUrl)));

final scenarioListProvider = FutureProvider.autoDispose<ScenarioList>((ref) => ref.watch(scenarioApiProvider).list());
final scenarioViewProvider = FutureProvider.autoDispose.family<ScenarioViewData, String>((ref, id) => ref.watch(scenarioApiProvider).view(id));

/// Comparación de los ids separados por coma, en el orden elegido.
final comparisonProvider = FutureProvider.autoDispose.family<ComparisonData, String>((ref, ids) => ref.watch(scenarioApiProvider).compare(ids));

/// Decisión tal como la guarda el escenario: tipo de la Tabla 11 y sus parámetros.
class ScenarioDecision {
  const ScenarioDecision(this.kind, this.params);
  factory ScenarioDecision.fromJson(Map<String, dynamic> json) => ScenarioDecision(json['kind'] as String, json['params'] as Map<String, dynamic>);
  final String kind;
  final Map<String, dynamic> params;
  Map<String, Object?> toJson() => {'kind': kind, 'params': params};
}

class PlanInfo {
  const PlanInfo({required this.name, required this.maxSavedScenarios, required this.maxComparedScenarios, required this.userPrepayments});
  final String name;
  final int? maxSavedScenarios;
  final int maxComparedScenarios;
  final bool userPrepayments;
}

class ScenarioSummary {
  const ScenarioSummary({required this.id, required this.name, required this.decisions});
  final String id;
  final String name;
  final List<ScenarioDecision> decisions;
}

class ScenarioList {
  const ScenarioList({required this.plan, required this.scenarios});
  final PlanInfo plan;
  final List<ScenarioSummary> scenarios;
}

class ScenarioViewData {
  const ScenarioViewData({required this.id, required this.name, required this.decisions, required this.base, required this.scenario, required this.variation, required this.summary, required this.details});
  final String id;
  final String name;
  final List<ScenarioDecision> decisions;
  final DemoOutcome base;
  final DemoOutcome scenario;
  final DemoVariation variation;
  final String summary;

  /// Una frase por decisión, en orden, seguida de las frases sobre el resultado (HU10).
  final List<String> details;
}

class ComparedScenario {
  const ComparedScenario({required this.id, required this.name, required this.outcome, required this.variation});
  final String id;
  final String name;
  final DemoOutcome outcome;
  final DemoVariation variation;
}

class ComparisonData {
  const ComparisonData({required this.base, required this.scenarios});
  final DemoOutcome base;
  final List<ComparedScenario> scenarios;
}

/// Rechazo del servidor con la razón (`plan_limit`, `invalid_decisions`, …) para mostrarla.
class ScenarioApiException extends AuthApiException {
  const ScenarioApiException(super.message, {required this.error, this.decisionMessages = const {}, super.status});
  final String error;

  /// Mensajes por posición de la decisión rechazada.
  final Map<int, List<String>> decisionMessages;
}

class ScenarioApi {
  ScenarioApi(this._ref, this._client, this._baseUrl);
  final Ref _ref;
  final http.Client _client;
  final Uri _baseUrl;

  List<ScenarioDecision> _decisions(Object? json) => [for (final d in json as List<dynamic>) ScenarioDecision.fromJson(d as Map<String, dynamic>)];

  Future<ScenarioList> list() async {
    final json = await _send('GET', '/v1/scenarios') as Map<String, dynamic>;
    final plan = json['plan'] as Map<String, dynamic>;
    return ScenarioList(
      plan: PlanInfo(
        name: plan['name'] as String,
        maxSavedScenarios: plan['maxSavedScenarios'] as int?,
        maxComparedScenarios: plan['maxComparedScenarios'] as int,
        userPrepayments: plan['userPrepayments'] as bool,
      ),
      scenarios: [
        for (final s in json['scenarios'] as List<dynamic>)
          ScenarioSummary(id: (s as Map<String, dynamic>)['id'] as String, name: s['name'] as String, decisions: _decisions(s['decisions'])),
      ],
    );
  }

  Future<ScenarioViewData> view(String id) async {
    final json = await _send('GET', '/v1/scenarios/$id?months=12') as Map<String, dynamic>;
    final explanation = json['explanation'] as Map<String, dynamic>;
    return ScenarioViewData(
      id: json['id'] as String,
      name: json['name'] as String,
      decisions: _decisions(json['decisions']),
      base: DemoOutcome.fromJson(json['base'] as Map<String, dynamic>),
      scenario: DemoOutcome.fromJson(json['scenario'] as Map<String, dynamic>),
      variation: DemoVariation.fromJson(json['variation'] as Map<String, dynamic>),
      summary: explanation['summary'] as String,
      details: [for (final d in explanation['details'] as List<dynamic>) d as String],
    );
  }

  Future<ComparisonData> compare(String ids) async {
    final json = await _send('GET', '/v1/scenarios/compare?ids=$ids&months=12') as Map<String, dynamic>;
    return ComparisonData(
      base: DemoOutcome.fromJson(json['base'] as Map<String, dynamic>),
      scenarios: [
        for (final s in json['scenarios'] as List<dynamic>)
          ComparedScenario(
            id: (s as Map<String, dynamic>)['id'] as String,
            name: s['name'] as String,
            outcome: DemoOutcome.fromJson(s['scenario'] as Map<String, dynamic>),
            variation: DemoVariation.fromJson(s['variation'] as Map<String, dynamic>),
          ),
      ],
    );
  }

  /// Crea (sin `id`) o actualiza un escenario. Devuelve su id.
  Future<String> save({String? id, required String name, required List<ScenarioDecision> decisions}) async {
    final body = {'name': name, 'decisions': [for (final d in decisions) d.toJson()]};
    final json = await _send(id == null ? 'POST' : 'PUT', id == null ? '/v1/scenarios' : '/v1/scenarios/$id', body) as Map<String, dynamic>;
    return json['id'] as String;
  }

  Future<void> delete(String id) => _send('DELETE', '/v1/scenarios/$id');

  Future<Object?> _send(String method, String path, [Map<String, Object?>? body]) =>
      _ref.read(authControllerProvider.notifier).authorized((token) async {
        final request = http.Request(method, _baseUrl.resolve(path))..headers['authorization'] = 'Bearer $token';
        if (body != null) {
          request.headers['content-type'] = 'application/json';
          request.body = jsonEncode(body);
        }
        final http.Response response;
        try {
          response = await http.Response.fromStream(await _client.send(request));
        } on Exception {
          throw const AuthApiException('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
        }
        final decoded = response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
        if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
        if (response.statusCode == 401) throw const AuthApiException('Se requiere iniciar sesión.', status: 401);
        final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
        final issues = <int, List<String>>{};
        if (map['error'] == 'invalid_decisions') {
          for (final entry in map['issues'] as List<dynamic>) {
            final e = entry as Map<String, dynamic>;
            issues[e['decisionIndex'] as int] = [for (final i in e['issues'] as List<dynamic>) (i as Map<String, dynamic>)['message'] as String];
          }
        }
        throw ScenarioApiException(
          map['message'] as String? ?? 'No pudimos completar la solicitud.',
          error: map['error'] as String? ?? 'error',
          decisionMessages: issues,
          status: response.statusCode,
        );
      });
}

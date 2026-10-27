import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'auth/auth_api.dart';
import 'auth/auth_controller.dart';
import 'demo_api.dart';

/// Registro financiero (HU01-HU04) y proyección (HU05, HU39) desde la API. Todo se calcula en
/// el servidor; la app solo envía lo que el usuario escribe y muestra lo que recibe (regla 8).
final registryApiProvider = Provider<RegistryApi>((ref) => RegistryApi(ref, ref.watch(httpClientProvider), Uri.parse(apiBaseUrl)));

final registryDataProvider = FutureProvider.autoDispose<RegistryData>((ref) => ref.watch(registryApiProvider).registry());

/// Proyección para un horizonte; `null` cuando falta el saldo inicial.
final projectionDataProvider = FutureProvider.autoDispose.family<ProjectionData?, int>((ref, months) => ref.watch(registryApiProvider).projection(months));

/// Periodicidad de un ingreso o gasto (HU01), con meses `AAAA-MM`.
sealed class Schedule {
  const Schedule();
  factory Schedule.fromJson(Map<String, dynamic> json) => switch (json['kind']) {
        'once' => OnceSchedule(json['month'] as String),
        'every_n_months' => EveryNMonthsSchedule(json['intervalMonths'] as int, json['from'] as String, json['until'] as String?),
        _ => MonthlySchedule(json['from'] as String, json['until'] as String?),
      };
  Map<String, Object?> toJson();
}

class OnceSchedule extends Schedule {
  const OnceSchedule(this.month);
  final String month;
  @override
  Map<String, Object?> toJson() => {'kind': 'once', 'month': month};
}

class MonthlySchedule extends Schedule {
  const MonthlySchedule(this.from, this.until);
  final String from;
  final String? until;
  @override
  Map<String, Object?> toJson() => {'kind': 'monthly', 'from': from, 'until': until};
}

class EveryNMonthsSchedule extends Schedule {
  const EveryNMonthsSchedule(this.intervalMonths, this.from, this.until);
  final int intervalMonths;
  final String from;
  final String? until;
  @override
  Map<String, Object?> toJson() => {'kind': 'every_n_months', 'intervalMonths': intervalMonths, 'from': from, 'until': until};
}

class RegistryEntry {
  const RegistryEntry({required this.id, required this.label, required this.amount, required this.schedule, this.nature});
  factory RegistryEntry.fromJson(Map<String, dynamic> json) => RegistryEntry(
        id: json['id'] as String,
        label: json['label'] as String,
        amount: json['amount'] as int,
        schedule: Schedule.fromJson(json['schedule'] as Map<String, dynamic>),
        nature: json['nature'] as String?,
      );
  final String id;
  final String label;
  final int amount;
  final Schedule schedule;

  /// Solo gastos: `fixed` o `variable_estimate` (HU02).
  final String? nature;
}

class RegistryDebt {
  const RegistryDebt({required this.id, required this.label, required this.totalInstallments, required this.pendingInstallments, required this.nextMonth, required this.nextAmount, required this.lastMonth});
  factory RegistryDebt.fromJson(Map<String, dynamic> json) {
    final next = json['nextInstallment'] as Map<String, dynamic>?;
    final installments = json['installments'] as List<dynamic>;
    return RegistryDebt(
      id: json['id'] as String,
      label: json['label'] as String,
      totalInstallments: json['totalInstallments'] as int?,
      pendingInstallments: json['pendingInstallments'] as int,
      nextMonth: next?['month'] as String?,
      nextAmount: next?['amount'] as int?,
      lastMonth: installments.isEmpty ? null : (installments.last as Map<String, dynamic>)['month'] as String,
    );
  }
  final String id;
  final String label;
  final int? totalInstallments;
  final int pendingInstallments;
  final String? nextMonth;
  final int? nextAmount;
  final String? lastMonth;
}

class RegistryData {
  const RegistryData({required this.openingBalance, required this.balanceMonth, required this.incomes, required this.expenses, required this.debts});
  factory RegistryData.fromJson(Map<String, dynamic> json) {
    final balance = json['openingBalance'] as Map<String, dynamic>?;
    return RegistryData(
      openingBalance: balance?['amount'] as int?,
      balanceMonth: balance?['month'] as String?,
      incomes: [for (final e in json['incomes'] as List<dynamic>) RegistryEntry.fromJson(e as Map<String, dynamic>)],
      expenses: [for (final e in json['expenses'] as List<dynamic>) RegistryEntry.fromJson(e as Map<String, dynamic>)],
      debts: [for (final d in json['debts'] as List<dynamic>) RegistryDebt.fromJson(d as Map<String, dynamic>)],
    );
  }
  final int? openingBalance;
  final String? balanceMonth;
  final List<RegistryEntry> incomes;
  final List<RegistryEntry> expenses;
  final List<RegistryDebt> debts;
}

class ProjectionData {
  const ProjectionData({required this.startMonth, required this.horizonMonths, required this.outcome, required this.summary, required this.details});
  factory ProjectionData.fromJson(Map<String, dynamic> json) {
    final explanation = json['explanation'] as Map<String, dynamic>;
    return ProjectionData(
      startMonth: json['startMonth'] as String,
      horizonMonths: json['horizonMonths'] as int,
      outcome: DemoOutcome.fromJson(json['base'] as Map<String, dynamic>),
      summary: explanation['summary'] as String,
      details: [for (final d in explanation['details'] as List<dynamic>) d as String],
    );
  }
  final String startMonth;
  final int horizonMonths;

  /// Misma forma que el resultado del modo demostración: meses e indicadores de la Tabla 12.
  final DemoOutcome outcome;
  final String summary;
  final List<String> details;
}

class RegistryApi {
  RegistryApi(this._ref, this._client, this._baseUrl);
  final Ref _ref;
  final http.Client _client;
  final Uri _baseUrl;

  Future<RegistryData> registry() async => RegistryData.fromJson(await _send('GET', '/v1/registry') as Map<String, dynamic>);

  Future<ProjectionData?> projection(int months) async {
    try {
      return ProjectionData.fromJson(await _send('GET', '/v1/projection?months=$months') as Map<String, dynamic>);
    } on AuthApiException catch (e) {
      if (e.status == 409) return null;
      rethrow;
    }
  }

  Future<void> setOpeningBalance(int amount, String month) => _send('PUT', '/v1/registry/opening-balance', {'amount': amount, 'month': month});

  Future<void> saveIncome({String? id, required String label, required int amount, required Schedule schedule}) =>
      _send(id == null ? 'POST' : 'PUT', id == null ? '/v1/registry/incomes' : '/v1/registry/incomes/$id', {'label': label, 'amount': amount, 'schedule': schedule.toJson()});

  Future<void> saveExpense({String? id, required String label, required int amount, required String nature, required Schedule schedule}) => _send(
        id == null ? 'POST' : 'PUT',
        id == null ? '/v1/registry/expenses' : '/v1/registry/expenses/$id',
        {'label': label, 'amount': amount, 'nature': nature, 'schedule': schedule.toJson()},
      );

  Future<void> saveDebt({String? id, required String label, required int installmentAmount, required int pendingInstallments, required String nextInstallmentMonth, int? totalInstallments}) => _send(
        id == null ? 'POST' : 'PUT',
        id == null ? '/v1/registry/debts' : '/v1/registry/debts/$id',
        {
          'label': label,
          'installmentAmount': installmentAmount,
          'pendingInstallments': pendingInstallments,
          'nextInstallmentMonth': nextInstallmentMonth,
          'totalInstallments': totalInstallments,
        },
      );

  /// `kind`: incomes, expenses o debts.
  Future<void> delete(String kind, String id) => _send('DELETE', '/v1/registry/$kind/$id');

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
        final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
        throw AuthApiException(
          map['message'] as String? ?? 'No pudimos completar la solicitud.',
          status: response.statusCode,
          fieldMessages: {
            for (final issue in (map['issues'] as List<dynamic>? ?? const []))
              (issue as Map<String, dynamic>)['field'] as String: issue['message'] as String,
          },
        );
      });
}

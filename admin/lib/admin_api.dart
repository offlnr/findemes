import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

/// URL de la API de administración, fijada al compilar. Solo es alcanzable por Tailscale (RNF21).
const adminApiBaseUrl = String.fromEnvironment('ADMIN_API_BASE_URL', defaultValue: 'http://localhost:3001');

final httpClientProvider = Provider<http.Client>((ref) => http.Client());
final adminSessionProvider = NotifierProvider<AdminSession, String?>(AdminSession.new);
final adminApiProvider = Provider<AdminApi>((ref) => AdminApi(ref, ref.watch(httpClientProvider), Uri.parse(adminApiBaseUrl)));

/// Token de la sesión de administración: solo en memoria, nunca en el almacenamiento del navegador.
class AdminSession extends Notifier<String?> {
  @override
  String? build() => null;
  void open(String token) => state = token;
  void close() => state = null;
}

class AdminApiException implements Exception {
  const AdminApiException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}

class AccountRow {
  const AccountRow(this.json);
  final Map<String, dynamic> json;
  String get id => json['id'] as String;
  String get email => json['email'] as String;
  String get status => json['status'] as String;
  bool get emailVerified => json['emailVerified'] as bool;
  String get planCode => json['planCode'] as String;
  String? get periodEnd => json['periodEnd'] as String?;
  bool get cancelAtPeriodEnd => json['cancelAtPeriodEnd'] as bool;
  DateTime get createdAt => DateTime.parse(json['createdAt'] as String);
}

class AuditRow {
  const AuditRow(this.json);
  final Map<String, dynamic> json;
  int get seq => json['seq'] as int;
  DateTime get occurredAt => DateTime.parse(json['occurredAt'] as String);
  String get actorType => json['actorType'] as String;
  String? get actorId => json['actorId'] as String?;
  String get action => json['action'] as String;
  String get targetType => json['targetType'] as String;
  String? get targetId => json['targetId'] as String?;
  String? get originIp => json['originIp'] as String?;
}

class PaymentRow {
  const PaymentRow(this.json);
  final Map<String, dynamic> json;
  String get buyOrder => json['buyOrder'] as String;
  String get planCode => json['planCode'] as String;
  int get amount => json['amount'] as int;
  String get status => json['status'] as String;
  int? get authorizedAmount => json['authorizedAmount'] as int?;
  DateTime get createdAt => DateTime.parse(json['createdAt'] as String);
  bool get hasProviderToken => json['hasProviderToken'] as bool;
  List<String> get flags => [for (final f in json['flags'] as List<dynamic>) f as String];
}

/// Cliente de `/admin/v1`. Ninguna ruta entrega datos financieros de los usuarios (HU23).
class AdminApi {
  AdminApi(this._ref, this._client, this._baseUrl);
  final Ref _ref;
  final http.Client _client;
  final Uri _baseUrl;

  Future<void> login(String email, String password, String code) async {
    final json = await _send('POST', '/admin/v1/auth/login', body: {'email': email, 'password': password, 'code': code}, auth: false) as Map<String, dynamic>;
    _ref.read(adminSessionProvider.notifier).open(json['accessToken'] as String);
  }

  Future<List<AccountRow>> accounts(String query) async {
    final json = await _send('GET', '/admin/v1/accounts?${Uri(queryParameters: {'q': query}).query}') as Map<String, dynamic>;
    return [for (final a in json['accounts'] as List<dynamic>) AccountRow(a as Map<String, dynamic>)];
  }

  Future<void> setStatus(String id, {required bool suspend}) => _send('POST', '/admin/v1/accounts/$id/${suspend ? 'suspend' : 'reactivate'}');

  Future<({List<AuditRow> entries, int? brokenAtSeq})> audit({String? action, int? beforeSeq}) async {
    final params = {'limit': '100', 'action': ?action, if (beforeSeq != null) 'beforeSeq': '$beforeSeq'};
    final json = await _send('GET', '/admin/v1/audit?${Uri(queryParameters: params).query}') as Map<String, dynamic>;
    return (entries: [for (final e in json['entries'] as List<dynamic>) AuditRow(e as Map<String, dynamic>)], brokenAtSeq: json['brokenAtSeq'] as int?);
  }

  Future<List<PaymentRow>> payments({String? status, String? from, String? to}) async {
    final params = {'status': ?status, 'from': ?from, 'to': ?to};
    final json = await _send('GET', '/admin/v1/payments?${Uri(queryParameters: params).query}') as Map<String, dynamic>;
    return [for (final p in json['payments'] as List<dynamic>) PaymentRow(p as Map<String, dynamic>)];
  }

  Future<({String flag, String providerStatus})> reconcile(String buyOrder) async {
    final json = await _send('POST', '/admin/v1/payments/$buyOrder/reconcile') as Map<String, dynamic>;
    return (flag: json['flag'] as String, providerStatus: json['providerStatus'] as String);
  }

  Future<Map<String, dynamic>> metrics() async => await _send('GET', '/admin/v1/metrics') as Map<String, dynamic>;

  Future<Object?> _send(String method, String path, {Map<String, Object?>? body, bool auth = true}) async {
    final request = http.Request(method, _baseUrl.resolve(path));
    final token = _ref.read(adminSessionProvider);
    if (auth) {
      if (token == null) throw const AdminApiException('Se requiere iniciar sesión.', status: 401);
      request.headers['authorization'] = 'Bearer $token';
    }
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final http.Response response;
    try {
      response = await http.Response.fromStream(await _client.send(request));
    } on Exception {
      throw const AdminApiException('No se pudo conectar con la API de administración. ¿Estás en la red de administración?');
    }
    final decoded = response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
    if (response.statusCode == 401 && auth) _ref.read(adminSessionProvider.notifier).close();
    final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
    throw AdminApiException(map['message'] as String? ?? 'No se pudo completar la solicitud.', status: response.statusCode);
  }
}

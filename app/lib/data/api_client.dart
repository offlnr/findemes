import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'auth/auth_api.dart';
import 'auth/auth_controller.dart';
import 'demo_api.dart';

/// Cliente común de la API v1: agrega el token de acceso, renueva la sesión ante un 401 y
/// convierte las respuestas de error en [AuthApiException] con el mensaje del servidor.
final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref, ref.watch(httpClientProvider), Uri.parse(apiBaseUrl)));

class ApiClient {
  ApiClient(this._ref, this._client, this._baseUrl);
  final Ref _ref;
  final http.Client _client;
  final Uri _baseUrl;

  /// Solicitud con sesión.
  Future<Object?> send(String method, String path, [Map<String, Object?>? body]) =>
      _ref.read(authControllerProvider.notifier).authorized((token) => _raw(method, path, body, token));

  /// Solicitud sin sesión (por ejemplo, los planes o la vista previa de una invitación).
  Future<Object?> sendPublic(String method, String path, [Map<String, Object?>? body]) => _raw(method, path, body, null);

  Future<Object?> _raw(String method, String path, Map<String, Object?>? body, String? token) async {
    final request = http.Request(method, _baseUrl.resolve(path));
    if (token != null) request.headers['authorization'] = 'Bearer $token';
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
      code: map['error'] as String?,
      fieldMessages: {
        for (final issue in (map['issues'] as List<dynamic>? ?? const [])) (issue as Map<String, dynamic>)['field'] as String: issue['message'] as String,
      },
    );
  }
}

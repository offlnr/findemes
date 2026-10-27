import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../demo_api.dart';

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(httpClientProvider), Uri.parse(apiBaseUrl), web: kIsWeb));

/// Sesión emitida por la API. En la web el refresh token y el dispositivo viajan en cookies
/// HttpOnly, así que solo el token de acceso llega aquí (y se guarda solo en memoria).
class AuthSession {
  const AuthSession({required this.accessToken, this.refreshToken, this.deviceId});
  final String accessToken;
  final String? refreshToken;
  final String? deviceId;
}

class Account {
  const Account({required this.email, required this.displayName});
  final String email;
  final String displayName;
}

sealed class LoginOutcome {
  const LoginOutcome();
}

class LoginAuthenticated extends LoginOutcome {
  const LoginAuthenticated(this.session);
  final AuthSession session;
}

class LoginCodeRequired extends LoginOutcome {
  const LoginCodeRequired({required this.challengeId, this.deviceId});
  final String challengeId;
  final String? deviceId;
}

/// Error con un mensaje para mostrar y, si corresponde, los mensajes por campo.
class AuthApiException implements Exception {
  const AuthApiException(this.message, {this.fieldMessages = const {}, this.status});
  final String message;
  final Map<String, String> fieldMessages;

  /// Código HTTP de la respuesta; null si no se pudo contactar al servidor.
  final int? status;
  @override
  String toString() => message;
}

/// Cliente de `/v1/auth/*` y `/v1/me` (HU17, HU17.1-HU17.4, CU-11). No valida reglas de negocio:
/// los mensajes de error vienen del servidor (regla 8).
class AuthApi {
  AuthApi(this._client, this._baseUrl, {required this.web});
  final http.Client _client;
  final Uri _baseUrl;
  final bool web;

  String get _clientKind => web ? 'web' : 'mobile';

  Future<void> register({required String email, required String password, required String displayName}) async {
    await _post('/v1/auth/register', {'email': email, 'password': password, 'displayName': displayName});
  }

  Future<void> verifyEmail(String token) async {
    await _post('/v1/auth/verify-email', {'token': token});
  }

  Future<LoginOutcome> login({required String email, required String password, String? deviceId}) async {
    final body = await _post('/v1/auth/login', {
      'email': email,
      'password': password,
      'client': _clientKind,
      'deviceId': ?deviceId,
    }) as Map<String, dynamic>;
    if (body['status'] == 'authenticated') {
      return LoginAuthenticated(_session(body['session'] as Map<String, dynamic>));
    }
    return LoginCodeRequired(challengeId: body['challengeId'] as String, deviceId: body['deviceId'] as String?);
  }

  Future<AuthSession> confirmCode({required String challengeId, required String code}) async {
    final body = await _post('/v1/auth/login/code', {'challengeId': challengeId, 'code': code, 'client': _clientKind});
    return _session(body as Map<String, dynamic>);
  }

  /// Renueva la sesión. En la web usa la cookie; en móvil, el refresh token guardado.
  Future<AuthSession> refresh({String? refreshToken}) async {
    final body = await _post('/v1/auth/refresh', refreshToken == null ? null : {'refreshToken': refreshToken});
    return _session(body as Map<String, dynamic>, fallbackDeviceId: null);
  }

  Future<void> logout({required String accessToken, String? refreshToken}) async {
    await _post('/v1/auth/logout', refreshToken == null ? null : {'refreshToken': refreshToken}, accessToken: accessToken);
  }

  Future<void> requestPasswordReset(String email) async {
    await _post('/v1/auth/password-reset', {'email': email});
  }

  Future<void> confirmPasswordReset({required String token, required String newPassword}) async {
    await _post('/v1/auth/password-reset/confirm', {'token': token, 'newPassword': newPassword});
  }

  Future<Account> me(String accessToken) async {
    final response = await _call(() => _client.get(_baseUrl.resolve('/v1/me'), headers: {'authorization': 'Bearer $accessToken'}));
    final body = response as Map<String, dynamic>;
    return Account(email: body['email'] as String, displayName: body['displayName'] as String);
  }

  AuthSession _session(Map<String, dynamic> json, {String? fallbackDeviceId}) => AuthSession(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String?,
        deviceId: json['deviceId'] as String? ?? fallbackDeviceId,
      );

  Future<Object?> _post(String path, Map<String, Object?>? body, {String? accessToken}) => _call(
        () => _client.post(
          _baseUrl.resolve(path),
          headers: {
            if (body != null) 'content-type': 'application/json',
            if (accessToken != null) 'authorization': 'Bearer $accessToken',
          },
          body: body == null ? null : jsonEncode(body),
        ),
      );

  Future<Object?> _call(Future<http.Response> Function() request) async {
    final http.Response response;
    try {
      response = await request();
    } on Exception {
      throw const AuthApiException('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    }
    final body = response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode >= 200 && response.statusCode < 300) return body;

    final map = body is Map<String, dynamic> ? body : const <String, dynamic>{};
    final issues = {
      for (final issue in (map['issues'] as List<dynamic>? ?? const []))
        (issue as Map<String, dynamic>)['field'] as String: issue['message'] as String,
    };
    final message = response.statusCode == 429 && map['error'] == null
        ? 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.'
        : (map['message'] as String? ?? 'No pudimos completar la solicitud.');
    throw AuthApiException(message, fieldMessages: issues, status: response.statusCode);
  }
}

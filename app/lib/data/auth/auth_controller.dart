import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_api.dart';
import 'token_vault.dart';

enum AuthStatus { unknown, signedOut, signedIn }

@immutable
class AuthState {
  const AuthState._(this.status, {this.accessToken, this.account});
  const AuthState.unknown() : this._(AuthStatus.unknown);
  const AuthState.signedOut() : this._(AuthStatus.signedOut);
  const AuthState.signedIn({required String accessToken, required Account account})
      : this._(AuthStatus.signedIn, accessToken: accessToken, account: account);

  final AuthStatus status;

  /// Solo en memoria (CLAUDE.md, Sesiones): nunca en almacenamiento del navegador.
  final String? accessToken;
  final Account? account;
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Estado de la sesión. Al abrir la app intenta renovarla en silencio (cookie en la web,
/// refresh token guardado en móvil); si no puede, queda fuera de sesión.
class AuthController extends Notifier<AuthState> {
  AuthApi get _api => ref.read(authApiProvider);
  TokenVault get _vault => ref.read(tokenVaultProvider);

  @override
  AuthState build() {
    Future.microtask(restore);
    return const AuthState.unknown();
  }

  Future<void> restore() async {
    try {
      final stored = await _vault.read(refreshTokenKey);
      if (!_api.web && stored == null) {
        state = const AuthState.signedOut();
        return;
      }
      await _open(await _api.refresh(refreshToken: stored));
    } on AuthApiException {
      await _vault.write(refreshTokenKey, null);
      state = const AuthState.signedOut();
    }
  }

  /// Devuelve el desafío cuando el dispositivo debe confirmar un código (CU-11).
  Future<LoginCodeRequired?> login(String email, String password) async {
    final outcome = await _api.login(email: email, password: password, deviceId: await _vault.read(deviceIdKey));
    switch (outcome) {
      case LoginAuthenticated(:final session):
        await _open(session);
        return null;
      case LoginCodeRequired():
        if (outcome.deviceId != null) await _vault.write(deviceIdKey, outcome.deviceId);
        return outcome;
    }
  }

  Future<void> confirmCode(String challengeId, String code) async {
    await _open(await _api.confirmCode(challengeId: challengeId, code: code));
  }

  /// Ejecuta una llamada autenticada. Si el token de acceso de 15 minutos venció (401), renueva
  /// la sesión una vez y reintenta; si no puede renovarla, cierra la sesión.
  Future<T> authorized<T>(Future<T> Function(String accessToken) call) async {
    final token = state.accessToken;
    if (token == null) throw const AuthApiException('Se requiere iniciar sesión.', status: 401);
    try {
      return await call(token);
    } on AuthApiException catch (e) {
      if (e.status != 401) rethrow;
      try {
        await _open(await _api.refresh(refreshToken: await _vault.read(refreshTokenKey)), keepAccount: true);
      } on AuthApiException {
        await _vault.write(refreshTokenKey, null);
        state = const AuthState.signedOut();
        rethrow;
      }
      return call(state.accessToken!);
    }
  }

  Future<void> logout() async {
    final token = state.accessToken;
    final refresh = await _vault.read(refreshTokenKey);
    if (token != null) {
      try {
        await _api.logout(accessToken: token, refreshToken: refresh);
      } on AuthApiException {
        // Se cierra localmente aunque el servidor no responda; el token vence en 15 minutos.
      }
    }
    await _vault.write(refreshTokenKey, null);
    state = const AuthState.signedOut();
  }

  /// HU17.3: cierra la sesión en todos los dispositivos.
  Future<void> logoutAll() async {
    try {
      await authorized((token) => _api.logoutAll(accessToken: token));
    } on AuthApiException {
      // Se cierra localmente de todos modos.
    }
    await _vault.write(refreshTokenKey, null);
    state = const AuthState.signedOut();
  }

  /// HU17.4: la sesión actual se reemplaza por la nueva que entrega el servidor.
  Future<void> changePassword(String currentPassword, String newPassword) async {
    final session = await authorized((token) => _api.changePassword(accessToken: token, currentPassword: currentPassword, newPassword: newPassword));
    await _open(session, keepAccount: true);
  }

  /// Tras eliminar la cuenta (HU21) ya no hay sesión que cerrar en el servidor.
  Future<void> forgetSession() async {
    await _vault.write(refreshTokenKey, null);
    await _vault.write(deviceIdKey, null);
    state = const AuthState.signedOut();
  }

  /// Recarga el alias después de rectificarlo (HU21).
  Future<void> reloadAccount() async {
    final token = state.accessToken;
    if (token == null) return;
    state = AuthState.signedIn(accessToken: token, account: await _api.me(token));
  }

  Future<void> _open(AuthSession session, {bool keepAccount = false}) async {
    if (session.refreshToken != null) await _vault.write(refreshTokenKey, session.refreshToken);
    if (session.deviceId != null) await _vault.write(deviceIdKey, session.deviceId);
    final current = state.account;
    final account = keepAccount && current != null ? current : await _api.me(session.accessToken);
    state = AuthState.signedIn(accessToken: session.accessToken, account: account);
  }
}

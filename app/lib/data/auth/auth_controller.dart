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

  Future<void> _open(AuthSession session) async {
    if (session.refreshToken != null) await _vault.write(refreshTokenKey, session.refreshToken);
    if (session.deviceId != null) await _vault.write(deviceIdKey, session.deviceId);
    final account = await _api.me(session.accessToken);
    state = AuthState.signedIn(accessToken: session.accessToken, account: account);
  }
}

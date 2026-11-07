import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Dónde vive lo que debe sobrevivir a cerrar la app. En la web nada: el refresh token y el
/// dispositivo están en cookies HttpOnly que el código no puede leer. En Android e iOS se usa
/// `flutter_secure_storage` (Keychain / Keystore), como exige el CLAUDE.md.
abstract interface class TokenVault {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

const refreshTokenKey = 'refresh_token';
const deviceIdKey = 'device_id';

final tokenVaultProvider = Provider<TokenVault>((ref) => kIsWeb ? const CookieOnlyVault() : SecureStorageVault());

class CookieOnlyVault implements TokenVault {
  const CookieOnlyVault();
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String? value) async {}
}

class SecureStorageVault implements TokenVault {
  final _storage = const FlutterSecureStorage();
  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String? value) => value == null ? _storage.delete(key: key) : _storage.write(key: key, value: value);
}

/// Para pruebas.
class MemoryVault implements TokenVault {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async => value == null ? values.remove(key) : values[key] = value;
}

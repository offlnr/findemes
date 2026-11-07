import 'dart:convert';

import 'package:findemes_app/data/auth/token_vault.dart';
import 'package:findemes_app/data/demo_api.dart';
import 'package:findemes_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

/// API simulada con la forma de docs/openapi.yaml: el dispositivo nuevo pide código (CU-11).
MockClient _api(List<String> calls) => MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      final body = request.body.isEmpty ? <String, dynamic>{} : jsonDecode(request.body) as Map<String, dynamic>;
      switch (request.url.path) {
        case '/v1/auth/refresh':
          return _json({'error': 'unauthorized', 'message': 'La sesión terminó. Inicia sesión de nuevo.'}, 401);
        case '/v1/auth/login':
          if (body['password'] != 'correcto caballo batería') {
            return _json({'error': 'invalid_credentials', 'message': 'Correo o contraseña incorrectos.'}, 401);
          }
          return _json({'status': 'code_required', 'challengeId': '3f2b8c1e-7d4a-4f6b-9c2d-1a2b3c4d5e6f', 'deviceId': 'dispositivo-de-prueba-0123456789'});
        case '/v1/auth/login/code':
          if (body['code'] != '123456') return _json({'error': 'invalid_code', 'message': 'El código no es válido o ya venció.'}, 401);
          return _json({
            'accessToken': 'a.b.c',
            'accessTokenExpiresAt': '2026-11-15T12:15:00Z',
            'refreshToken': 'refresh-token-de-prueba-0123456789',
            'refreshTokenExpiresAt': '2026-12-15T12:00:00Z',
          });
        case '/v1/me':
          return _json({'id': '3f2b8c1e-7d4a-4f6b-9c2d-1a2b3c4d5e6f', 'email': 'ana@example.cl', 'displayName': 'Ana Rojas'});
        case '/v1/auth/logout':
          return http.Response('', 204);
        case '/v1/projection':
          return _json({'error': 'opening_balance_required', 'message': 'Registra tu saldo inicial para ver la proyección.'}, 409);
      }
      return _json({'error': 'not_found', 'message': 'Recurso no encontrado.'}, 404);
    });

Future<MemoryVault> _pumpApp(WidgetTester tester, List<String> calls) async {
  tester.view.physicalSize = const Size(1440, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final vault = MemoryVault();
  await tester.pumpWidget(ProviderScope(
    overrides: [httpClientProvider.overrideWithValue(_api(calls)), tokenVaultProvider.overrideWithValue(vault)],
    child: const FinDeMesApp(),
  ));
  await tester.pumpAndSettle();
  return vault;
}

Future<void> _type(WidgetTester tester, String label, String text) async {
  final field = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextFormField));
  await tester.enterText(field, text);
}

void main() {
  testWidgets('sin sesión, /app vuelve a Iniciar sesión', (tester) async {
    await _pumpApp(tester, []);
    expect(find.text('Iniciar sesión'), findsWidgets);
    expect(find.text('Mi situación'), findsNothing);
  });

  testWidgets('muestra el error del servidor sin revelar si el correo existe', (tester) async {
    await _pumpApp(tester, []);
    await _type(tester, 'Correo', 'ana@example.cl');
    await _type(tester, 'Contraseña', 'no es la clave');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
  });

  testWidgets('entra con el código del correo, guarda el refresh token y pide el saldo inicial', (tester) async {
    final calls = <String>[];
    final vault = await _pumpApp(tester, calls);

    await _type(tester, 'Correo', 'ana@example.cl');
    await _type(tester, 'Contraseña', 'correcto caballo batería');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Revisa tu correo'), findsOneWidget);

    await _type(tester, 'Código', '123456');
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar'));
    await tester.pumpAndSettle();

    expect(find.text('Mi situación'), findsWidgets);
    expect(find.text('Ana Rojas'), findsOneWidget);
    expect(find.text('Falta tu saldo inicial'), findsOneWidget);
    // Mi situación ya usa datos reales: no lleva el aviso de cifras de ejemplo.
    expect(find.textContaining('son de ejemplo'), findsNothing);
    expect(vault.values[refreshTokenKey], 'refresh-token-de-prueba-0123456789');
    expect(vault.values[deviceIdKey], 'dispositivo-de-prueba-0123456789');

    await tester.tap(find.text('Cerrar sesión'));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /v1/auth/logout'));
    expect(vault.values[refreshTokenKey], isNull);
    expect(find.widgetWithText(FilledButton, 'Entrar'), findsOneWidget);
  });
}

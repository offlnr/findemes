import 'dart:convert';

import 'package:findemes_admin/admin_api.dart';
import 'package:findemes_admin/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

void main() {
  testWidgets('entra con contraseña y código, busca una cuenta y la suspende sin ver datos financieros', (tester) async {
    tester.view.physicalSize = const Size(2000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final requests = <http.Request>[];
    var status = 'active';
    await tester.pumpWidget(ProviderScope(
      overrides: [
        httpClientProvider.overrideWithValue(MockClient((r) async {
          requests.add(r);
          switch (r.url.path) {
            case '/admin/v1/auth/login':
              final body = jsonDecode(r.body) as Map<String, dynamic>;
              return body['code'] == '123456' ? _json({'accessToken': 'a.b.c', 'expiresAt': '2026-11-06T15:15:00Z'}) : _json({'error': 'invalid_credentials', 'message': 'Credenciales o código incorrectos.'}, 401);
            case '/admin/v1/metrics':
              return _json({
                'users': 3,
                'verifiedUsers': 2,
                'suspendedUsers': 0,
                'onboardingStarted': 2,
                'onboardingCompleted': 1,
                'onboardingMedianMinutes': 7,
                'activeSubscriptions': {'family': 1},
                'publicApi': {'up': true, 'latencyMs': 12},
              });
            case '/admin/v1/accounts':
              return _json({
                'accounts': [
                  {'id': '00000000-0000-4000-8000-000000000001', 'email': 'ana@example.cl', 'status': status, 'emailVerified': true, 'createdAt': '2026-11-01T10:00:00Z', 'planCode': 'free', 'periodEnd': null, 'cancelAtPeriodEnd': false},
                ],
              });
            default:
              status = 'suspended';
              return http.Response('', 204);
          }
        })),
      ],
      child: const AdminApp(),
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Correo'), 'admin@findemes.cl');
    await tester.enterText(find.widgetWithText(TextField, 'Contraseña'), 'clave');
    await tester.enterText(find.widgetWithText(TextField, 'Código de 6 dígitos'), '000000');
    await tester.tap(find.text('Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Credenciales o código incorrectos.'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Código de 6 dígitos'), '123456');
    await tester.tap(find.text('Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Estado de la plataforma'), findsOneWidget);
    expect(find.text('Disponible · 12 ms'), findsOneWidget);
    expect(find.text('50 % (1 de 2)'), findsOneWidget);

    await tester.tap(find.descendant(of: find.byType(NavigationRail), matching: find.text('Cuentas')));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Buscar por correo'), 'ana');
    await tester.tap(find.text('Buscar'));
    await tester.pumpAndSettle();
    expect(find.text('ana@example.cl'), findsOneWidget);
    await tester.tap(find.text('Suspender'));
    await tester.pumpAndSettle();
    expect(find.text('Reactivar'), findsOneWidget);
    expect(requests.any((r) => r.url.path.endsWith('/suspend') && r.headers['authorization'] == 'Bearer a.b.c'), isTrue);
  });
}

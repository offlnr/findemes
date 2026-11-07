import 'dart:convert';

import 'package:findemes_app/data/auth/auth_api.dart';
import 'package:findemes_app/data/auth/auth_controller.dart';
import 'package:findemes_app/data/demo_api.dart';
import 'package:findemes_app/screens/app/registry_screen.dart';
import 'package:findemes_app/screens/app/summary_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

/// Sesión iniciada sin pasar por la pantalla de inicio de sesión.
class _SignedIn extends AuthController {
  @override
  AuthState build() => const AuthState.signedIn(accessToken: 'a.b.c', account: Account(email: 'ana@example.cl', displayName: 'Ana'));
}

Map<String, Object?> _registry({List<Map<String, Object?>> incomes = const []}) => {
      'openingBalance': {'amount': -50000, 'month': '2026-11'},
      'incomes': incomes,
      'expenses': [
        {'id': '00000000-0000-4000-8000-000000000002', 'label': 'Arriendo', 'amount': 600000, 'nature': 'fixed', 'schedule': {'kind': 'monthly', 'from': '2026-11', 'until': null}},
      ],
      'debts': [
        {
          'id': '00000000-0000-4000-8000-000000000003',
          'label': 'Tarjeta',
          'totalInstallments': 6,
          'pendingInstallments': 2,
          'nextInstallment': {'month': '2026-11', 'amount': 150000},
          'installments': [
            {'month': '2026-11', 'amount': 150000},
            {'month': '2026-12', 'amount': 150000},
          ],
        },
      ],
    };

Map<String, Object?> _month(String month, int closing) => {
      'month': month,
      'openingBalance': 0,
      'income': 900000,
      'expenses': 600000,
      'debtPayments': 150000,
      'netFlow': 150000,
      'closingBalance': closing,
    };

Future<List<http.Request>> _pump(WidgetTester tester, Widget screen, Future<http.Response> Function(http.Request) handler) async {
  tester.view.physicalSize = const Size(1440, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final requests = <http.Request>[];
  await tester.pumpWidget(ProviderScope(
    overrides: [
      authControllerProvider.overrideWith(_SignedIn.new),
      httpClientProvider.overrideWithValue(MockClient((r) {
        requests.add(r);
        return handler(r);
      })),
    ],
    child: MaterialApp(home: Scaffold(body: screen)),
  ));
  await tester.pumpAndSettle();
  return requests;
}

void main() {
  testWidgets('muestra el registro del servidor y agrega un ingreso con la sesión', (tester) async {
    var incomes = <Map<String, Object?>>[];
    final requests = await _pump(tester, const RegistryScreen(), (r) async {
      if (r.method == 'POST' && r.url.path == '/v1/registry/incomes') {
        final body = jsonDecode(r.body) as Map<String, dynamic>;
        incomes = [
          {'id': '00000000-0000-4000-8000-000000000001', ...body},
        ];
        return _json({'id': '00000000-0000-4000-8000-000000000001'}, 201);
      }
      return _json(_registry(incomes: incomes));
    });

    expect(find.text('Arriendo'), findsOneWidget);
    expect(find.text('Fijo · Mensual desde nov 2026'), findsOneWidget);
    expect(find.text('2 de 6 cuotas pendientes · próxima nov 2026 · última dic 2026'), findsOneWidget);
    expect(requests.first.headers['authorization'], 'Bearer a.b.c');

    await tester.tap(find.text('Agregar ingreso'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Ej.: Sueldo'), 'Sueldo');
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).at(1), '900000');
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Guardar')));
    await tester.pumpAndSettle();

    final post = jsonDecode(requests.firstWhere((r) => r.method == 'POST').body) as Map<String, dynamic>;
    expect(post['label'], 'Sueldo');
    expect(post['amount'], 900000);
    final schedule = post['schedule'] as Map<String, dynamic>;
    expect(schedule['kind'], 'monthly');
    expect(schedule['until'], isNull);
    expect(schedule['from'], matches(RegExp(r'^\d{4}-\d{2}$')));
    // Tras guardar, el registro se vuelve a pedir y aparece el ingreso nuevo.
    expect(find.text('Sueldo'), findsOneWidget);
  });

  testWidgets('muestra los errores de campo que entrega el servidor', (tester) async {
    await _pump(tester, const RegistryScreen(), (r) async {
      if (r.method == 'POST') {
        return _json({
          'error': 'invalid_fields',
          'message': 'Revisa los datos ingresados.',
          'issues': [
            {'field': 'label', 'message': 'Ingresa un nombre de hasta 80 caracteres.'},
          ],
        }, 400);
      }
      return _json(_registry());
    });
    await tester.tap(find.text('Agregar gasto'));
    await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).at(1), '1000');
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Guardar')));
    await tester.pumpAndSettle();
    expect(find.text('Ingresa un nombre de hasta 80 caracteres.'), findsOneWidget);
  });

  testWidgets('Mi situación muestra los indicadores y la explicación calculados por el servidor', (tester) async {
    await _pump(tester, const SummaryScreen(), (r) async => _json({
          'startMonth': '2026-11',
          'horizonMonths': 2,
          'base': {
            'months': [_month('2026-11', 100000), _month('2026-12', 250000)],
            'indicators': {
              'minimumProjectedBalance': {'amount': 100000, 'month': '2026-11'},
              'breakMonth': null,
              'monthlyAvailableMargin': [
                {'month': '2026-11', 'amount': 150000},
                {'month': '2026-12', 'amount': 150000},
              ],
              'debtToIncome': [
                {'month': '2026-11', 'basisPoints': 1667},
                {'month': '2026-12', 'basisPoints': 1667},
              ],
            },
          },
          'explanation': {
            'summary': 'El saldo proyectado se mantiene en cero o más durante todo el horizonte.',
            'details': ['En noviembre de 2026 ingresan \$900.000.'],
          },
        }));

    expect(find.text('El saldo proyectado se mantiene en cero o más durante todo el horizonte.'), findsOneWidget);
    expect(find.text('No ocurre'), findsOneWidget);
    expect(find.text('16,7 %'), findsOneWidget);
    expect(find.text('\$150.000'), findsOneWidget);
  });
}

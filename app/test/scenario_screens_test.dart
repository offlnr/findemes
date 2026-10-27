import 'dart:convert';

import 'package:findemes_app/data/auth/auth_api.dart';
import 'package:findemes_app/data/auth/auth_controller.dart';
import 'package:findemes_app/data/demo_api.dart';
import 'package:findemes_app/screens/app/compare_screen.dart';
import 'package:findemes_app/screens/app/scenario_screen.dart';
import 'package:findemes_app/screens/app/scenarios_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

class _SignedIn extends AuthController {
  @override
  AuthState build() => const AuthState.signedIn(accessToken: 'a.b.c', account: Account(email: 'ana@example.cl', displayName: 'Ana'));
}

const _a = '00000000-0000-4000-8000-00000000000a';
const _b = '00000000-0000-4000-8000-00000000000b';
const _repair = {'kind': 'one_off_expense', 'params': {'label': 'Reparación', 'amount': 500000, 'month': '2026-12'}};

Map<String, Object?> _list() => {
      'plan': {'code': 'free', 'name': 'Gratuito', 'maxSavedScenarios': 2, 'maxComparedScenarios': 1, 'userPrepayments': false},
      'scenarios': [
        {'id': _a, 'name': 'Arreglar el auto', 'decisions': [_repair]},
        {'id': _b, 'name': 'Sin cambios', 'decisions': <Object>[]},
      ],
    };

Map<String, Object?> _outcome(List<int> closings, {String? breakMonth}) => {
      'months': [
        for (var i = 0; i < closings.length; i++)
          {'month': '2026-1${i + 1}', 'openingBalance': 0, 'income': 0, 'expenses': 0, 'debtPayments': 0, 'netFlow': 0, 'closingBalance': closings[i]},
      ],
      'indicators': {
        'minimumProjectedBalance': {'amount': closings.reduce((a, b) => a < b ? a : b), 'month': '2026-11'},
        'breakMonth': breakMonth,
        'monthlyAvailableMargin': [for (var i = 0; i < closings.length; i++) {'month': '2026-1${i + 1}', 'amount': 0}],
        'debtToIncome': [for (var i = 0; i < closings.length; i++) {'month': '2026-1${i + 1}', 'basisPoints': 0}],
      },
    };

Map<String, Object?> _variation(int min) => {
      'minimumProjectedBalance': min,
      'breakMonth': {'base': null, 'scenario': '2026-12'},
      'monthlyAvailableMargin': [
        {'month': '2026-11', 'amount': 0},
        {'month': '2026-12', 'amount': -500000},
      ],
      'debtToIncome': [
        {'month': '2026-11', 'basisPoints': 0},
        {'month': '2026-12', 'basisPoints': 0},
      ],
    };

Future<List<http.Request>> _pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1440, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final requests = <http.Request>[];
  await tester.pumpWidget(ProviderScope(
    overrides: [
      authControllerProvider.overrideWith(_SignedIn.new),
      httpClientProvider.overrideWithValue(MockClient((r) async {
        requests.add(r);
        final path = r.url.path;
        if (path == '/v1/scenarios' && r.method == 'GET') return _json(_list());
        if (path == '/v1/scenarios' && r.method == 'POST') return _json({'id': _b}, 201);
        if (path == '/v1/scenarios/compare') {
          return _json({
            'horizonMonths': 2,
            'base': _outcome([200000, 200000]),
            'scenarios': [
              {'id': _a, 'name': 'Arreglar el auto', 'scenario': _outcome([200000, -300000], breakMonth: '2026-12'), 'variation': _variation(-500000), 'explanation': {'summary': 's', 'details': <String>[]}},
            ],
          });
        }
        if (path == '/v1/scenarios/$_a') {
          return _json({
            'id': _a,
            'name': 'Arreglar el auto',
            'decisions': [_repair],
            'startMonth': '2026-11',
            'horizonMonths': 2,
            'base': _outcome([200000, 200000]),
            'scenario': _outcome([200000, -300000], breakMonth: '2026-12'),
            'variation': _variation(-500000),
            'explanation': {
              'summary': 'Con la decisión aplicada, el saldo mínimo proyectado es -\$300.000 en diciembre de 2026.',
              'details': ['Gasto único «Reparación» de \$500.000 en diciembre de 2026.', 'El saldo pasa a ser negativo en diciembre de 2026.'],
            },
          });
        }
        if (path == '/v1/registry') return _json({'openingBalance': null, 'incomes': <Object>[], 'expenses': <Object>[], 'debts': <Object>[]});
        return _json({'error': 'not_found', 'message': 'Recurso no encontrado.'}, 404);
      })),
    ],
    child: MaterialApp(home: Scaffold(body: screen)),
  ));
  await tester.pumpAndSettle();
  return requests;
}

void main() {
  testWidgets('la lista muestra el límite del plan y los escenarios en el orden de creación', (tester) async {
    await _pump(tester, const ScenariosScreen());
    expect(find.textContaining('Plan Gratuito: 2 de 2 escenarios guardados'), findsOneWidget);
    final first = tester.getTopLeft(find.text('Arreglar el auto'));
    final second = tester.getTopLeft(find.text('Sin cambios'));
    expect(first.dx < second.dx || first.dy < second.dy, isTrue);
  });

  testWidgets('el detalle muestra la frase del motor por decisión y la variación frente a la base', (tester) async {
    await _pump(tester, const ScenarioScreen(id: _a));
    expect(find.text('Gasto único «Reparación» de \$500.000 en diciembre de 2026.'), findsOneWidget);
    expect(find.text('−\$500.000'), findsOneWidget);
    expect(find.text('Con la decisión aplicada, el saldo mínimo proyectado es -\$300.000 en diciembre de 2026.'), findsOneWidget);
    expect(find.text('El saldo pasa a ser negativo en diciembre de 2026.'), findsOneWidget);
  });

  testWidgets('el plan gratuito compara un escenario frente a la base', (tester) async {
    final requests = await _pump(tester, const CompareScreen());
    expect(find.text('El plan Gratuito compara un escenario frente a la base.'), findsOneWidget);
    await tester.tap(find.text('Arreglar el auto'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sin cambios'));
    await tester.pumpAndSettle();
    // Al elegir otro, reemplaza al anterior: nunca pide más de lo que el plan permite.
    final compare = requests.where((r) => r.url.path == '/v1/scenarios/compare').map((r) => r.url.queryParameters['ids']).toList();
    expect(compare, [_a, _b]);
  });
}

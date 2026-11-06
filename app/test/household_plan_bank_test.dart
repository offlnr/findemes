import 'dart:convert';

import 'package:findemes_app/data/auth/auth_api.dart';
import 'package:findemes_app/data/auth/auth_controller.dart';
import 'package:findemes_app/data/demo_api.dart';
import 'package:findemes_app/screens/app/banks_screen.dart';
import 'package:findemes_app/screens/app/household_screen.dart';
import 'package:findemes_app/screens/app/plan_screen.dart';
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

const _ana = '00000000-0000-4000-8000-00000000000a';
const _beto = '00000000-0000-4000-8000-00000000000b';

Future<List<http.Request>> _pump(WidgetTester tester, Widget screen, Future<http.Response> Function(http.Request) handler) async {
  tester.view.physicalSize = const Size(1440, 2600);
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

Map<String, Object?> _household({bool readOnly = false}) => {
      'household': {
        'id': '00000000-0000-4000-8000-0000000000f0',
        'name': 'Depto Ñuñoa',
        'myRole': 'admin',
        'readOnly': readOnly,
        'members': [
          {'userId': _ana, 'displayName': 'Ana', 'role': 'admin', 'isMe': true},
          {'userId': _beto, 'displayName': 'Beto', 'role': 'member', 'isMe': false},
        ],
        'expenses': [
          {
            'id': '00000000-0000-4000-8000-0000000000e1',
            'label': 'Arriendo',
            'amount': 600000,
            'schedule': {'kind': 'monthly', 'from': '2026-11', 'until': null},
            'rule': {'mode': 'equal'},
            'createdByName': 'Beto',
            'canEdit': true,
            'myShare': 300000,
            'shares': [
              {'userId': _ana, 'amount': 300000},
              {'userId': _beto, 'amount': 300000},
            ],
          },
        ],
        'myMonthlyContribution': 300000,
        'monthlyTotal': 600000,
        'memberMonthlyTotals': [
          {'userId': _ana, 'amount': 300000},
          {'userId': _beto, 'amount': 300000},
        ],
      },
    };

void main() {
  testWidgets('Hogar muestra integrantes, gastos comunes, el reparto del servidor y mi aporte', (tester) async {
    await _pump(tester, const HouseholdScreen(), (r) async => _json(_household()));
    expect(find.text('Depto Ñuñoa'), findsOneWidget);
    expect(find.text('Ana (tú)'), findsWidgets);
    expect(find.text('Arriendo'), findsOneWidget);
    expect(find.text('Partes iguales'), findsOneWidget);
    expect(find.textContaining('Tu aporte de \$300.000'), findsOneWidget);
    expect(find.text('Invitar integrante'), findsOneWidget);
  });

  testWidgets('Hogar en solo lectura avisa y no ofrece agregar gastos (HU20)', (tester) async {
    await _pump(tester, const HouseholdScreen(), (r) async => _json(_household(readOnly: true)));
    expect(find.textContaining('modo de solo lectura'), findsOneWidget);
    expect(find.text('Agregar gasto común'), findsNothing);
    expect(find.text('Invitar integrante'), findsNothing);
  });

  testWidgets('Sin hogar, crear uno con el plan gratuito muestra el límite del plan', (tester) async {
    final requests = await _pump(tester, const HouseholdScreen(), (r) async {
      if (r.method == 'POST') return _json({'error': 'plan_limit', 'message': 'El espacio del hogar no está incluido en el plan Gratuito.'}, 403);
      return _json({'household': null});
    });
    await tester.enterText(find.widgetWithText(TextField, 'Nombre del hogar'), 'Casa');
    await tester.enterText(find.widgetWithText(TextField, 'Tu nombre en el hogar'), 'Ana');
    await tester.tap(find.text('Crear hogar'));
    await tester.pumpAndSettle();
    expect(requests.last.url.path, '/v1/household');
    expect(jsonDecode(requests.last.body), {'name': 'Casa', 'displayName': 'Ana'});
    expect(find.textContaining('no está incluido en el plan Gratuito'), findsOneWidget);
    expect(find.text('Ver planes'), findsOneWidget);
  });

  testWidgets('Plan muestra los planes del servidor y el estado de la Tabla 14', (tester) async {
    await _pump(tester, const PlanScreen(), (r) async {
      if (r.url.path == '/v1/plans') {
        return _json({
          'plans': [
            {'code': 'free', 'name': 'Gratuito', 'priceClp': null, 'periodMonths': 1, 'capabilities': [{'label': 'Escenarios guardados', 'included': true, 'detail': 'Hasta 2 escenarios guardados.'}]},
            {'code': 'family', 'name': 'Familiar', 'priceClp': 9990, 'periodMonths': 1, 'capabilities': [{'label': 'Hogar', 'included': true, 'detail': 'Incluido.'}]},
          ],
        });
      }
      return _json({
        'plan': {'code': 'family', 'name': 'Familiar'},
        'state': 'cancelada',
        'periodEnd': '2026-12-06',
        'cancelAtPeriodEnd': true,
        'capabilities': <Object>[],
        'latestPayment': null,
      });
    });
    expect(find.text('\$9.990'), findsOneWidget);
    expect(find.text('Hasta 2 escenarios guardados.'), findsOneWidget);
    expect(find.text('Renovación cancelada'), findsOneWidget);
    expect(find.text('Renovar'), findsOneWidget);
    expect(find.text('Cancelar renovación'), findsNothing);
  });

  testWidgets('Bancos rotula los datos de demostración y confirma un movimiento como recurrente', (tester) async {
    final requests = await _pump(tester, const BanksScreen(), (r) async {
      switch (r.url.path) {
        case '/v1/bank/providers':
          return _json({'fintoc': {'available': false, 'mode': 'test'}, 'demoProfiles': [{'id': 'familia', 'label': 'Familia'}]});
        case '/v1/bank/links':
          return _json({
            'links': [
              {
                'id': '00000000-0000-4000-8000-0000000000c1',
                'provider': 'demo',
                'institutionName': 'Banco de demostración',
                'origin': 'demo',
                'status': 'active',
                'connectedAt': '2026-11-06T12:00:00Z',
                'lastSyncedAt': '2026-11-06T12:00:00Z',
                'accounts': [{'id': '00000000-0000-4000-8000-0000000000a1', 'name': 'Cuenta Corriente', 'type': 'checking_account', 'availableBalance': 812000, 'origin': 'demo'}],
              },
            ],
          });
        case '/v1/bank/movements':
          return _json({
            'movements': [
              {'id': '00000000-0000-4000-8000-0000000000d1', 'accountId': '00000000-0000-4000-8000-0000000000a1', 'postedOn': '2026-10-30', 'amount': 1500000, 'description': 'Sueldo', 'origin': 'demo', 'confirmedAs': null},
            ],
            'totals': [{'month': '2026-10', 'credits': 1500000, 'debits': 0}],
          });
        default:
          return _json({'id': '00000000-0000-4000-8000-0000000000aa'}, 201);
      }
    });
    expect(find.text('Demostración'), findsOneWidget);
    expect(find.text('\$812.000'), findsOneWidget);
    await tester.tap(find.text('Es recurrente'));
    await tester.pumpAndSettle();
    expect(find.text('Agregar como ingreso recurrente'), findsOneWidget);
    await tester.tap(find.text('Agregar'));
    await tester.pumpAndSettle();
    final confirm = requests.firstWhere((r) => r.url.path.endsWith('/confirm'));
    expect(jsonDecode(confirm.body), {'label': 'Sueldo'});
  });
}

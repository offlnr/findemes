import 'dart:convert';

import 'package:findemes_app/data/demo_api.dart';
import 'package:findemes_app/screens/demo/demo_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Respuesta con la forma de `POST /v1/demo/projection` (docs/openapi.yaml).
Map<String, Object?> _projection({required bool withDecision}) {
  Map<String, Object?> outcome(List<int> closings) => {
        'months': [
          for (var i = 0; i < closings.length; i++)
            {
              'month': '2026-1${i + 1}',
              'openingBalance': 0,
              'income': 900000,
              'expenses': 650000,
              'debtPayments': 0,
              'netFlow': 250000,
              'closingBalance': closings[i],
            },
        ],
        'indicators': {
          'minimumProjectedBalance': {'amount': closings.reduce((a, b) => a < b ? a : b), 'month': '2026-11'},
          'breakMonth': closings.any((c) => c < 0) ? '2026-12' : null,
          'monthlyAvailableMargin': [
            for (var i = 0; i < closings.length; i++) {'month': '2026-1${i + 1}', 'amount': 250000},
          ],
          'debtToIncome': [
            for (var i = 0; i < closings.length; i++) {'month': '2026-1${i + 1}', 'basisPoints': 1913},
          ],
        },
      };
  return {
    'origin': 'demo',
    'startMonth': '2026-11',
    'horizonMonths': 2,
    'entries': {
      'openingBalance': 300000,
      'incomes': [
        {'id': 'ingreso', 'label': 'Ingreso mensual', 'amount': 900000},
      ],
      'expenses': [
        {'id': 'gasto-fijo', 'label': 'Gasto fijo mensual', 'amount': 650000, 'nature': 'fixed'},
      ],
      'debts': <Object>[],
    },
    'base': outcome([550000, 800000]),
    'scenario': withDecision ? outcome([550000, -200000]) : null,
    'variation': withDecision
        ? {
            'minimumProjectedBalance': -750000,
            'breakMonth': {'base': null, 'scenario': '2026-12'},
            'monthlyAvailableMargin': [
              {'month': '2026-11', 'amount': 0},
              {'month': '2026-12', 'amount': -1000000},
            ],
            'debtToIncome': [
              {'month': '2026-11', 'basisPoints': 0},
              {'month': '2026-12', 'basisPoints': 0},
            ],
          }
        : null,
    'explanation': {
      'summary': withDecision ? 'Con la decisión aplicada, el saldo cambia.' : 'El saldo proyectado se mantiene en cero o más.',
      'details': ['Detalle del cálculo.'],
    },
    'limitNotice': 'Con una cuenta puedes registrar todos tus ingresos.',
  };
}

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

Future<void> _pump(WidgetTester tester, http.Client client) async {
  tester.view.physicalSize = const Size(1440, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [httpClientProvider.overrideWithValue(client)],
    child: const MaterialApp(home: DemoScreen()),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('muestra la proyección de un ejemplo y la explicación que entrega la API', (tester) async {
    final requests = <Map<String, dynamic>>[];
    await _pump(
      tester,
      MockClient((request) async {
        if (request.url.path == '/v1/demo/examples') {
          return _json([
            {'id': 'familia', 'name': 'Familia', 'description': 'Un ingreso familiar.'},
          ]);
        }
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        return _json(_projection(withDecision: false));
      }),
    );

    expect(requests.single, {
      'base': {'example': 'familia'},
      'decision': null,
    });
    expect(find.text('Datos de demostración'), findsOneWidget);
    expect(find.text('El saldo proyectado se mantiene en cero o más.'), findsOneWidget);
    expect(find.text('No ocurre'), findsOneWidget);
    expect(find.text('19,1 %'), findsOneWidget);
  });

  testWidgets('envía los datos propios del visitante sin calcular nada en el cliente', (tester) async {
    final requests = <Map<String, dynamic>>[];
    await _pump(
      tester,
      MockClient((request) async {
        if (request.url.path == '/v1/demo/examples') return _json(<Object>[]);
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        return _json(_projection(withDecision: false));
      }),
    );

    await tester.tap(find.text('Mis datos'));
    await tester.pumpAndSettle();

    expect(requests.last, {
      'base': {'openingBalance': 300000, 'monthlyIncome': 900000, 'monthlyFixedExpense': 650000},
      'decision': null,
    });
  });

  testWidgets('muestra los mensajes del servidor cuando rechaza la decisión', (tester) async {
    await _pump(
      tester,
      MockClient((request) async {
        if (request.url.path == '/v1/demo/examples') return _json(<Object>[]);
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['decision'] == null) return _json(_projection(withDecision: false));
        return _json({
          'error': 'invalid_decision',
          'message': 'La decisión no es válida.',
          'issues': [
            {'field': 'amount', 'message': 'El monto debe ser mayor que cero.'},
          ],
        }, 422);
      }),
    );

    await tester.tap(find.text('Sin decisión'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Gasto único').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Calcular'));
    await tester.pumpAndSettle();

    expect(find.text('Revisa la decisión: El monto debe ser mayor que cero.'), findsOneWidget);
  });
}

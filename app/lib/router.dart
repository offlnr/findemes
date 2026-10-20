import 'package:go_router/go_router.dart';

import 'screens/app/account_screen.dart';
import 'screens/app/banks_screen.dart';
import 'screens/app/compare_screen.dart';
import 'screens/app/household_screen.dart';
import 'screens/app/payment_result_screen.dart';
import 'screens/app/plan_screen.dart';
import 'screens/app/projection_screen.dart';
import 'screens/app/registry_screen.dart';
import 'screens/app/scenario_screen.dart';
import 'screens/app/scenarios_screen.dart';
import 'screens/app/summary_screen.dart';
import 'screens/auth/auth_screens.dart';
import 'screens/demo/demo_screen.dart';
import 'widgets/app_shell.dart';

/// Rutas con hash (#/registro, #/login, #/demo...), las mismas que usa la landing.
GoRouter buildRouter() => GoRouter(
      initialLocation: '/login',
      routes: [
        GoRoute(path: '/', redirect: (_, _) => '/login'),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(
          path: '/registro',
          builder: (_, s) => SignupScreen(
            plan: s.uri.queryParameters['plan'],
            connectBank: s.uri.queryParameters['conectar'] == 'fintoc',
            fromDemo: s.uri.queryParameters['desde'] == 'demo',
          ),
        ),
        GoRoute(path: '/verificar', builder: (_, s) => VerifyScreen(plan: s.uri.queryParameters['plan'])),
        GoRoute(path: '/recuperar', builder: (_, _) => const RecoverScreen()),
        GoRoute(path: '/restablecer', builder: (_, _) => const ResetPasswordScreen()),
        GoRoute(path: '/invitacion', builder: (_, _) => const InvitationScreen()),
        GoRoute(path: '/demo', builder: (_, _) => const DemoScreen()),
        GoRoute(path: '/app', redirect: (_, _) => '/app/resumen'),
        ShellRoute(
          builder: (_, s, child) => AppShell(location: s.uri.path, child: child),
          routes: [
            GoRoute(path: '/app/resumen', builder: (_, _) => const SummaryScreen()),
            GoRoute(path: '/app/registro', builder: (_, _) => const RegistryScreen()),
            GoRoute(path: '/app/bancos', builder: (_, _) => const BanksScreen()),
            GoRoute(path: '/app/proyeccion', builder: (_, _) => const ProjectionScreen()),
            GoRoute(path: '/app/escenarios', builder: (_, _) => const ScenariosScreen()),
            GoRoute(path: '/app/escenarios/:id', builder: (_, s) => ScenarioScreen(id: s.pathParameters['id']!)),
            GoRoute(path: '/app/comparar', builder: (_, _) => const CompareScreen()),
            GoRoute(path: '/app/hogar', builder: (_, _) => const HouseholdScreen()),
            GoRoute(path: '/app/plan', builder: (_, _) => const PlanScreen()),
            GoRoute(path: '/app/pago/resultado', builder: (_, s) => PaymentResultScreen(state: s.uri.queryParameters['estado'] ?? 'pendiente')),
            GoRoute(path: '/app/cuenta', builder: (_, _) => const AccountScreen()),
          ],
        ),
      ],
    );

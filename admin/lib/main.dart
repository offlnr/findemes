import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'admin_api.dart';
import 'screens.dart';

/// Panel de administración de Fin de Mes (HU22-HU26). Aplicación separada del sitio público que
/// consume solo la API de administración, alcanzable por Tailscale y con segundo factor TOTP.
void main() => runApp(const ProviderScope(child: AdminApp()));

const _ink = Color(0xFF1D4634);

class AdminApp extends ConsumerWidget {
  const AdminApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp(
        title: 'Fin de Mes · Administración',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: _ink), useMaterial3: true),
        home: ref.watch(adminSessionProvider) == null ? const LoginScreen() : const AdminShell(),
      );
}

class AdminShell extends ConsumerStatefulWidget {
  const AdminShell({super.key});
  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> {
  int _index = 0;
  static const _pages = [MetricsScreen(), AccountsScreen(), AuditScreen(), PaymentsScreen()];

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Fin de Mes · Administración'),
          actions: [TextButton(onPressed: () => ref.read(adminSessionProvider.notifier).close(), child: const Text('Cerrar sesión'))],
        ),
        body: Row(children: [
          NavigationRail(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() => _index = i),
            labelType: NavigationRailLabelType.all,
            destinations: const [
              NavigationRailDestination(icon: Icon(Icons.monitor_heart_outlined), label: Text('Estado')),
              NavigationRailDestination(icon: Icon(Icons.people_outline), label: Text('Cuentas')),
              NavigationRailDestination(icon: Icon(Icons.fact_check_outlined), label: Text('Auditoría')),
              NavigationRailDestination(icon: Icon(Icons.receipt_long_outlined), label: Text('Pagos')),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: _pages[_index]),
        ]),
      );
}

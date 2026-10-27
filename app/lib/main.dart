import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'data/auth/auth_controller.dart';
import 'router.dart';
import 'theme/theme.dart';

void main() => runApp(const ProviderScope(child: FinDeMesApp()));

class FinDeMesApp extends ConsumerStatefulWidget {
  const FinDeMesApp({super.key});

  @override
  ConsumerState<FinDeMesApp> createState() => _FinDeMesAppState();
}

class _FinDeMesAppState extends ConsumerState<FinDeMesApp> {
  late final ValueNotifier<AuthStatus> _status = ValueNotifier(ref.read(authControllerProvider).status);
  late final GoRouter _router = buildRouter(refresh: _status, status: () => _status.value);

  @override
  void dispose() {
    _router.dispose();
    _status.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authControllerProvider, (_, next) => _status.value = next.status);
    return MaterialApp.router(
        title: 'Fin de Mes',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: _router,
      );
  }
}

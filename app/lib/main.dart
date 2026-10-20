import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'router.dart';
import 'theme/theme.dart';

void main() => runApp(const ProviderScope(child: FinDeMesApp()));

class FinDeMesApp extends StatefulWidget {
  const FinDeMesApp({super.key});

  @override
  State<FinDeMesApp> createState() => _FinDeMesAppState();
}

class _FinDeMesAppState extends State<FinDeMesApp> {
  late final GoRouter _router = buildRouter();

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: 'Fin de Mes',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: _router,
      );
}

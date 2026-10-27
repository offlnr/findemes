import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/auth/auth_controller.dart';
import '../theme/tokens.dart';
import 'fdm_icon.dart';

class NavEntry {
  const NavEntry(this.label, this.path, this.icon);
  final String label;
  final String path;
  final FdmIcons icon;
}

/// Pantallas que ya muestran datos reales del usuario desde la API.
const connectedPaths = ['/app/resumen', '/app/registro', '/app/proyeccion'];

const navEntries = [
  NavEntry('Mi situación', '/app/resumen', FdmIcons.steps),
  NavEntry('Registro', '/app/registro', FdmIcons.receipt),
  NavEntry('Bancos', '/app/bancos', FdmIcons.bank),
  NavEntry('Proyección', '/app/proyeccion', FdmIcons.chart),
  NavEntry('Escenarios', '/app/escenarios', FdmIcons.copy),
  NavEntry('Comparar', '/app/comparar', FdmIcons.columns),
  NavEntry('Hogar', '/app/hogar', FdmIcons.home),
  NavEntry('Plan', '/app/plan', FdmIcons.tag),
  NavEntry('Cuenta', '/app/cuenta', FdmIcons.lock),
];

/// Menú lateral verde en pantallas anchas; cajón en pantallas angostas.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    final menu = _Sidebar(location: location);
    final body = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // Las cifras de ejemplo nunca se presentan como propias: se rotulan las pantallas aún no conectadas.
      if (!connectedPaths.any(location.startsWith)) const ColoredBox(
        color: FdmColors.accentSoft,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 24, vertical: 10),
          child: Text('Las cifras de estas pantallas son de ejemplo: todavía no se conectan a tu registro.', textAlign: TextAlign.center),
        ),
      ),
      Expanded(child: child),
    ]);
    if (wide) {
      return Scaffold(body: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [SizedBox(width: 240, child: menu), Expanded(child: body)]));
    }
    return Scaffold(
      appBar: AppBar(
        backgroundColor: FdmColors.ink,
        foregroundColor: FdmColors.onInk,
        title: Text('Fin de Mes', style: FdmText.serif(24, color: FdmColors.onInk)),
      ),
      drawer: Drawer(backgroundColor: FdmColors.ink, child: menu),
      body: body,
    );
  }
}

class _Sidebar extends ConsumerWidget {
  const _Sidebar({required this.location});
  final String location;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = ref.watch(authControllerProvider).account;
    return ColoredBox(
      color: FdmColors.ink,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 28, 16, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(left: 8, bottom: 20),
                child: Text('Fin de Mes', style: FdmText.serif(28, color: FdmColors.onInk)),
              ),
              for (final e in navEntries) _NavItem(entry: e, active: location.startsWith(e.path)),
              const Spacer(),
              if (account != null)
                Row(children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: FdmColors.accent,
                    child: Text(_initials(account.displayName), style: FdmText.ui(14, weight: FontWeight.w700, color: FdmColors.ink)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(account.displayName, overflow: TextOverflow.ellipsis, style: FdmText.ui(14, weight: FontWeight.w600, color: FdmColors.onInk)),
                      Text(account.email, overflow: TextOverflow.ellipsis, style: FdmText.ui(12, color: FdmColors.accent)),
                      InkWell(
                        onTap: () => ref.read(authControllerProvider.notifier).logout(),
                        child: Text('Cerrar sesión', style: FdmText.ui(12, weight: FontWeight.w500, color: FdmColors.onInk).copyWith(decoration: TextDecoration.underline, decorationColor: FdmColors.onInk)),
                      ),
                    ]),
                  ),
                ]),
            ],
          ),
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2);
  return parts.map((p) => p.characters.first.toUpperCase()).join();
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.entry, required this.active});
  final NavEntry entry;
  final bool active;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Material(
          color: active ? FdmColors.accent : Colors.transparent,
          shape: const StadiumBorder(),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: () {
              Scaffold.maybeOf(context)?.closeDrawer();
              context.go(entry.path);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(children: [
                FdmIcon(entry.icon, color: active ? FdmColors.ink : FdmColors.accent),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    entry.label,
                    overflow: TextOverflow.ellipsis,
                    style: FdmText.ui(14, weight: active ? FontWeight.w600 : FontWeight.w400, color: active ? FdmColors.ink : FdmColors.onInk),
                  ),
                ),
              ]),
            ),
          ),
        ),
      );
}

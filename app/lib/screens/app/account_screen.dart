import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/auth/auth_api.dart';
import '../../data/auth/auth_controller.dart';
import '../../data/privacy_api.dart';
import '../../platform/browser.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Cuenta y privacidad (HU17.3, HU17.4, HU21, HU32). Cada acción la valida y ejecuta el servidor.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = ref.watch(authControllerProvider).account;
    return PageBody(children: [
      const PageHeader(icon: FdmIcons.lock, title: 'Cuenta y privacidad', subtitle: 'Tus datos de acceso y tus derechos sobre tus datos personales.'),
      ResponsiveRow(children: [
        const _PasswordCard(),
        FdmCard(title: 'Sesiones', children: [
          Muted('Conectado como ${account?.email ?? ''}.', size: 14),
          const Muted('Si usaste la cuenta en un equipo compartido, cierra la sesión en todos los dispositivos. Tendrás que volver a entrar aquí también.', size: 13),
          Wrap(spacing: 12, runSpacing: 12, children: [
            OutlinedButton(onPressed: () => ref.read(authControllerProvider.notifier).logout(), child: const Text('Cerrar sesión')),
            OutlinedButton(onPressed: () => ref.read(authControllerProvider.notifier).logoutAll(), child: const Text('Cerrar todas las sesiones')),
          ]),
        ]),
      ]),
      _AliasCard(current: account?.displayName ?? ''),
      const _ConsentsCard(),
      FdmCard(title: 'Tus datos', children: [
        const Muted('Puedes descargar todo lo que guardamos de ti en un archivo JSON, o eliminar tu cuenta con borrado efectivo (Ley 21.719).', size: 14),
        Wrap(spacing: 12, runSpacing: 12, children: [
          OutlinedButton(
            onPressed: () async {
              try {
                final message = await saveTextFile('fin-de-mes-mis-datos.json', await ref.read(privacyApiProvider).exportJson());
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
              } on AuthApiException catch (e) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
              }
            },
            child: const Text('Exportar mis datos'),
          ),
          FilledButton(onPressed: () => showDialog<void>(context: context, builder: (_) => const _DeleteDialog()), child: const Text('Eliminar mi cuenta')),
        ]),
        const Muted(
          'Al eliminar tu cuenta se borran tu registro, tus escenarios y tus datos bancarios, y se revoca el acceso de Fintoc. '
          'En el hogar, los gastos que registraste aparecerán como "Ex miembro" y la administración pasa al integrante más antiguo. '
          'Los comprobantes de pago se conservan solo con un identificador seudónimo.',
        ),
      ]),
    ]);
  }
}

class _PasswordCard extends ConsumerStatefulWidget {
  const _PasswordCard();
  @override
  ConsumerState<_PasswordCard> createState() => _PasswordCardState();
}

class _PasswordCardState extends ConsumerState<_PasswordCard> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  Map<String, String> _errors = const {};
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _errors = const {};
    });
    try {
      await ref.read(authControllerProvider.notifier).changePassword(_current.text, _next.text);
      _current.clear();
      _next.clear();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contraseña actualizada. Cerramos tus otras sesiones y te avisamos por correo.')));
    } on AuthApiException catch (e) {
      setState(() => _errors = e.fieldMessages.isEmpty ? {'currentPassword': e.message} : e.fieldMessages);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => FdmCard(title: 'Cambiar contraseña', children: [
        TextField(controller: _current, obscureText: true, decoration: InputDecoration(labelText: 'Contraseña actual', errorText: _errors['currentPassword'])),
        TextField(controller: _next, obscureText: true, decoration: InputDecoration(labelText: 'Nueva contraseña (mínimo 10 caracteres)', errorText: _errors['newPassword'])),
        Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: _busy ? null : _save, child: const Text('Guardar'))),
      ]);
}

class _AliasCard extends ConsumerStatefulWidget {
  const _AliasCard({required this.current});
  final String current;
  @override
  ConsumerState<_AliasCard> createState() => _AliasCardState();
}

class _AliasCardState extends ConsumerState<_AliasCard> {
  late final _alias = TextEditingController(text: widget.current);
  String? _error;

  @override
  void dispose() {
    _alias.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _error = null);
    try {
      await ref.read(privacyApiProvider).rename(_alias.text.trim());
      await ref.read(authControllerProvider.notifier).reloadAccount();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Datos actualizados.')));
    } on AuthApiException catch (e) {
      setState(() => _error = e.fieldMessages['displayName'] ?? e.message);
    }
  }

  @override
  Widget build(BuildContext context) => FdmCard(title: 'Rectificar tus datos', children: [
        const Muted('Tu nombre en la aplicación. Tus ingresos, gastos y deudas se corrigen en Registro.', size: 13),
        Wrap(spacing: 12, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.end, children: [
          SizedBox(width: 320, child: TextField(controller: _alias, maxLength: 80, decoration: InputDecoration(labelText: 'Nombre', errorText: _error))),
          OutlinedButton(onPressed: _save, child: const Text('Guardar nombre')),
        ]),
      ]);
}

class _ConsentsCard extends ConsumerWidget {
  const _ConsentsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(consentsProvider),
        builder: (consents) {
          final active = {for (final c in consents.where((c) => c.active)) c.kind: c};
          return FdmCard(title: 'Consentimientos', children: [
            const Muted('Lo que autorizaste y cuándo. Retirar un consentimiento queda registrado; el historial se conserva.', size: 13),
            FdmTable(
              columns: const [Col('Documento', flex: 3), Col('Estado', flex: 3), Col('', flex: 2)],
              rows: [
                for (final kind in consentLabels.keys)
                  [
                    Cell(consentLabels[kind]!),
                    Cell(active[kind] == null ? 'No vigente' : 'Aceptado el ${active[kind]!.acceptedAt.toLocal().toString().substring(0, 10)} (versión ${active[kind]!.documentVersion})'),
                    Cell.w(TextButton(
                      onPressed: () async {
                        final api = ref.read(privacyApiProvider);
                        try {
                          active[kind] == null ? await api.accept(kind) : await api.withdraw(kind);
                          ref.invalidate(consentsProvider);
                        } on AuthApiException catch (e) {
                          if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                        }
                      },
                      child: Text(active[kind] == null ? 'Aceptar' : 'Retirar'),
                    )),
                  ],
              ],
            ),
          ]);
        },
      );
}

/// Borrado efectivo (HU21): se confirma con la contraseña vigente.
class _DeleteDialog extends ConsumerStatefulWidget {
  const _DeleteDialog();
  @override
  ConsumerState<_DeleteDialog> createState() => _DeleteDialogState();
}

class _DeleteDialogState extends ConsumerState<_DeleteDialog> {
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _erase() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(privacyApiProvider).eraseAccount(_password.text);
      await ref.read(authControllerProvider.notifier).forgetSession();
      if (mounted) {
        Navigator.pop(context);
        context.go('/login');
      }
    } on AuthApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('Eliminar tu cuenta', style: FdmText.serif(28)),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Esta acción no se puede deshacer. Para confirmar, escribe tu contraseña.'),
            const SizedBox(height: 12),
            TextField(controller: _password, obscureText: true, decoration: InputDecoration(labelText: 'Contraseña', errorText: _error)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(onPressed: _busy ? null : _erase, child: const Text('Eliminar definitivamente')),
        ],
      );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import '../../widgets/form_row.dart';

/// Cuenta y privacidad (HU17.3, HU17.4, HU21).
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  Future<void> _confirmDelete(BuildContext context) => showDialog<void>(
        context: context,
        builder: (ctx) => const _DeleteDialog(email: 'camila@ejemplo.cl'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageBody(children: [
        const PageHeader(icon: FdmIcons.lock, title: 'Cuenta y privacidad', subtitle: 'Tus datos de acceso y tus derechos sobre tus datos personales.'),
        ResponsiveRow(children: [
          const FdmCard(title: 'Cambiar contraseña', children: [
            LabeledInput(FieldSpec('Contraseña actual', obscure: true)),
            LabeledInput(FieldSpec('Nueva contraseña (mín. 10)', obscure: true)),
            _SaveButton(),
          ]),
          FdmCard(title: 'Sesiones', children: [
            AsyncBody(
              ref.watch(deviceSessionsProvider),
              builder: (list) => FdmTable(
                columns: const [Col('Dispositivo', flex: 3), Col('Último uso', flex: 2), Col('', width: 130)],
                rows: [
                  for (final s in list) [Cell(s.device), Cell(s.lastUse), s.current ? const Cell('') : Cell.w(TextButton(onPressed: () {}, child: const Text('Cerrar sesión')))],
                ],
              ),
            ),
            Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: () {}, child: const Text('Cerrar las demás sesiones'))),
          ]),
        ]),
        FdmCard(title: 'Tus datos', children: [
          Wrap(spacing: 12, runSpacing: 12, children: [
            OutlinedButton(onPressed: () {}, child: const Text('Exportar mis datos')),
            OutlinedButton(onPressed: () {}, child: const Text('Rectificar')),
            FilledButton(onPressed: () => _confirmDelete(context), child: const Text('Eliminar mi cuenta')),
          ]),
          const Muted(
            'Al eliminar tu cuenta se borran tu registro, tus escenarios y tus datos bancarios, y se revoca el acceso de Fintoc. '
            'En el hogar, los gastos que registraste aparecerán como "Ex miembro". Los comprobantes de pago se conservan solo con un identificador seudónimo (Ley 21.719).',
          ),
        ]),
      ]);
}

class _SaveButton extends StatelessWidget {
  const _SaveButton();
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: FilledButton(
          onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Modo demostración: el cambio no se guarda hasta conectar la API.'))),
          child: const Text('Guardar'),
        ),
      );
}

/// Confirmación de borrado: hay que escribir el correo de la cuenta.
class _DeleteDialog extends StatefulWidget {
  const _DeleteDialog({required this.email});
  final String email;
  @override
  State<_DeleteDialog> createState() => _DeleteDialogState();
}

class _DeleteDialogState extends State<_DeleteDialog> {
  String _typed = '';
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('Eliminar tu cuenta', style: FdmText.serif(28)),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Esta acción no se puede deshacer. Para confirmar, escribe el correo de tu cuenta.'),
            const SizedBox(height: 12),
            TextField(onChanged: (v) => setState(() => _typed = v), decoration: InputDecoration(hintText: widget.email)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(
            onPressed: _typed.trim() == widget.email ? () => Navigator.pop(context) : null,
            child: const Text('Eliminar definitivamente'),
          ),
        ],
      );
}

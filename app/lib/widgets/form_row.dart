import 'package:flutter/material.dart';

import '../theme/tokens.dart';

class FieldSpec {
  const FieldSpec(this.label, {this.hint, this.initial, this.width = 220, this.options, this.obscure = false});
  final String label;
  final String? hint;
  final String? initial;
  final double width;
  final bool obscure;

  /// Si se indica, el campo es un selector.
  final List<String>? options;
}

/// Fila de campos con un botón al final. Sin API, guardar solo avisa que es una demostración.
class FormRow extends StatelessWidget {
  const FormRow({super.key, required this.fields, required this.action, this.extra = const [], this.primary = false});
  final List<FieldSpec> fields;
  final String action;
  final List<Widget> extra;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    void save() => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Modo demostración: el cambio no se guarda hasta conectar la API.')));
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      crossAxisAlignment: WrapCrossAlignment.end,
      children: [
        for (final f in fields) SizedBox(width: f.width, child: LabeledInput(f)),
        primary ? FilledButton(onPressed: save, child: Text(action)) : OutlinedButton(onPressed: save, child: Text(action)),
        ...extra,
      ],
    );
  }
}

class LabeledInput extends StatelessWidget {
  const LabeledInput(this.spec, {super.key});
  final FieldSpec spec;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(spec.label, style: FdmText.ui(13, weight: FontWeight.w500)),
          const SizedBox(height: 6),
          if (spec.options != null)
            DropdownButtonFormField<String>(
              initialValue: spec.initial ?? spec.options!.first,
              items: [for (final o in spec.options!) DropdownMenuItem(value: o, child: Text(o, style: FdmText.ui(14)))],
              onChanged: (_) {},
            )
          else
            TextFormField(initialValue: spec.initial, obscureText: spec.obscure, decoration: InputDecoration(hintText: spec.hint)),
        ],
      );
}

class RemoveButton extends StatelessWidget {
  const RemoveButton({super.key});
  @override
  Widget build(BuildContext context) => TextButton(
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Modo demostración: el cambio no se guarda hasta conectar la API.'))),
        child: const Text('Eliminar'),
      );
}

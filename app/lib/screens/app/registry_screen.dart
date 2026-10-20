import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/finance_repository.dart';
import '../../format/money.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';
import '../../widgets/form_row.dart';

/// Registro del estado base (HU01-HU04).
class RegistryScreen extends ConsumerWidget {
  const RegistryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(registryProvider),
        builder: (r) => PageBody(children: [
          const PageHeader(icon: FdmIcons.receipt, title: 'Registro', subtitle: 'Tu estado base. La proyección se recalcula en el servidor con cada cambio.'),
          FdmCard(title: 'Saldo inicial', children: [
            FormRow(fields: [FieldSpec(r.openingLabel, initial: clp(r.opening), width: 260)], action: 'Guardar', extra: [OriginPill(r.openingOrigin)]),
          ]),
          FdmCard(title: 'Ingresos', children: [
            FdmTable(
              minWidth: 560,
              columns: const [Col('Nombre', flex: 4), Col('Tipo', flex: 3), Col('Monto', flex: 2), Col('', width: 110)],
              rows: [
                for (final e in r.incomes)
                  [Cell.w(Row(children: [Text(e.name), const SizedBox(width: 8), OriginPill(e.origin)])), Cell(e.kind), Cell(clp(e.amount), number: true), const Cell.w(RemoveButton())],
              ],
            ),
            const FormRow(fields: [FieldSpec('Nombre', hint: 'Ej.: Bono'), FieldSpec('Monto mensual (CLP)', hint: '\$0'), FieldSpec('Tipo', options: ['Recurrente', 'Esporádico'])], action: 'Agregar'),
          ]),
          FdmCard(title: 'Gastos', children: [
            const Notice('Los gastos comunes del hogar no van aquí: tu aporte se suma solo desde el espacio común.'),
            FdmTable(
              minWidth: 560,
              columns: const [Col('Nombre', flex: 4), Col('Tipo', flex: 3), Col('Monto', flex: 2), Col('', width: 110)],
              rows: [
                for (final e in r.expenses)
                  [Cell.w(Row(children: [Text(e.name), const SizedBox(width: 8), OriginPill(e.origin)])), Cell(e.kind), Cell(clp(e.amount), number: true), const Cell.w(RemoveButton())],
              ],
            ),
            const FormRow(fields: [FieldSpec('Nombre', hint: 'Ej.: Gimnasio'), FieldSpec('Monto mensual (CLP)', hint: '\$0'), FieldSpec('Tipo', options: ['Fijo', 'Variable (estimado)', 'Esporádico'])], action: 'Agregar'),
          ]),
          FdmCard(title: 'Deudas en cuotas', children: [
            const Notice('Las tarjetas de crédito no se sincronizan con el banco: registra aquí tus compras en cuotas.'),
            FdmTable(
              minWidth: 720,
              columns: const [Col('Deuda', flex: 4), Col('Cuota', flex: 2), Col('Pendientes', flex: 2), Col('Última cuota', flex: 2), Col('Total pendiente', flex: 2), Col('', width: 110)],
              rows: [
                for (final d in r.debts)
                  [Cell(d.name), Cell(clp(d.installment), number: true), Cell('${d.remaining}', number: true), Cell(d.lastMonth), Cell(clp(d.pendingAmount), number: true), const Cell.w(RemoveButton())],
              ],
            ),
            const FormRow(fields: [FieldSpec('Nombre', hint: 'Ej.: Notebook'), FieldSpec('Cuota mensual', hint: '\$0'), FieldSpec('Cuotas pendientes', hint: '0')], action: 'Agregar deuda'),
          ]),
        ]),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/auth/auth_api.dart';
import '../../data/bank_api.dart';
import '../../data/registry_api.dart';
import '../../format/money.dart';
import '../../format/months.dart';
import '../../platform/browser.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';
import '../../widgets/fdm_icon.dart';

/// Bancos (HU36, ADR-002). La clave bancaria solo la recibe el widget de Fintoc. Los movimientos
/// se muestran tal como llegan; el usuario decide cuáles son recurrentes (el sistema no clasifica).
class BanksScreen extends ConsumerWidget {
  const BanksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(bankLinksProvider),
        builder: (links) => PageBody(children: [
          const PageHeader(icon: FdmIcons.bank, title: 'Bancos', subtitle: 'Tus cuentas y movimientos con Fintoc, en modo de prueba durante el proyecto.'),
          const _ConnectCard(),
          for (final link in links) _LinkCard(link: link),
          if (links.isNotEmpty) const _MovementsCard(),
        ]),
      );
}

void _snack(BuildContext context, String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

void _refreshBank(WidgetRef ref) {
  ref.invalidate(bankLinksProvider);
  ref.invalidate(bankMovementsProvider);
  ref.invalidate(registryDataProvider);
  ref.invalidate(projectionDataProvider);
}

class _ConnectCard extends ConsumerStatefulWidget {
  const _ConnectCard();
  @override
  ConsumerState<_ConnectCard> createState() => _ConnectCardState();
}

class _ConnectCardState extends ConsumerState<_ConnectCard> {
  bool _consent = false;
  bool _busy = false;
  String? _profile;

  Future<void> _run(Future<void> Function(BankApi api) work, String done) async {
    if (!_consent) {
      _snack(context, 'Acepta el consentimiento de conexión bancaria para continuar.');
      return;
    }
    setState(() => _busy = true);
    try {
      final api = ref.read(bankApiProvider);
      await api.acceptBankConsent();
      await work(api);
      _refreshBank(ref);
      if (mounted) _snack(context, done);
    } on AuthApiException catch (e) {
      if (mounted) _snack(context, e.message);
    } on Object catch (e) {
      if (mounted) _snack(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _fintoc(BankApi api) async {
    final intent = await api.fintocIntent();
    final exchangeToken = await openFintocWidget(widgetToken: intent.widgetToken, publicKey: intent.publicKey);
    if (exchangeToken == null) throw const AuthApiException('Cerraste el widget de Fintoc sin conectar un banco.');
    await api.connectFintoc(exchangeToken);
  }

  @override
  Widget build(BuildContext context) => AsyncBody(
        ref.watch(bankProvidersProvider),
        builder: (providers) => ResponsiveRow(children: [
          FdmCard(title: 'Conectar un banco', children: [
            const Muted(
              'Se abre el widget de Fintoc y tu clave bancaria la ingresas allí: Fin de Mes nunca la recibe. Solo obtenemos acceso de lectura y puedes desconectar cuando quieras. '
              'Durante el proyecto Fintoc opera en modo de prueba, con datos ficticios que se rotulan como tales.',
              size: 14,
            ),
            MergeSemantics(
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Checkbox(value: _consent, onChanged: (v) => setState(() => _consent = v ?? false)),
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _consent = !_consent),
                    child: Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        'Autorizo leer los saldos y movimientos de las cuentas que conecte, para mostrarlos y usarlos en mi proyección (Ley 21.719). Puedo retirar esta autorización en Cuenta.',
                        style: FdmText.ui(13),
                      ),
                    ),
                  ),
                ),
              ]),
            ),
            Wrap(spacing: 12, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [
              if (providers.fintoc && fintocWidgetSupported)
                FilledButton(onPressed: _busy ? null : () => _run(_fintoc, 'Banco conectado y sincronizado.'), child: const Text('Conectar con Fintoc')),
              if (providers.fintoc && !fintocWidgetSupported) const Muted('La conexión con Fintoc está disponible en la versión web.'),
              if (!providers.fintoc) const Muted('Fintoc no está configurado en este ambiente.'),
            ]),
            const Divider(),
            Text('Banco de demostración', style: FdmText.ui(14, weight: FontWeight.w600)),
            const Muted('Perfiles ficticios y realistas para probar la aplicación. Todo se rotula como demostración.', size: 13),
            Wrap(spacing: 12, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [
              SizedBox(
                width: 300,
                child: DropdownButtonFormField<String>(
                  initialValue: _profile,
                  hint: const Text('Elige un perfil'),
                  items: [for (final p in providers.demoProfiles) DropdownMenuItem(value: p.id, child: Text(p.label, overflow: TextOverflow.ellipsis))],
                  onChanged: (v) => setState(() => _profile = v),
                ),
              ),
              OutlinedButton(
                onPressed: _busy || _profile == null ? null : () => _run((api) => api.connectDemo(_profile!), 'Banco de demostración conectado.'),
                child: const Text('Usar banco de demostración'),
              ),
            ]),
          ]),
          const FdmCard(title: 'Qué se trae y qué no', children: [
            Bullets([
              'Cuentas corrientes y vista, con su saldo disponible.',
              'Movimientos con fecha, descripción y monto en pesos.',
              'No se traen tarjetas de crédito: tus cuotas se registran a mano.',
              'Tú confirmas qué movimientos son recurrentes; el sistema no los clasifica.',
              'Puedes conectar más de un banco y desconectar cada uno por separado.',
            ]),
          ]),
        ]),
      );
}

class _LinkCard extends ConsumerWidget {
  const _LinkCard({required this.link});
  final BankLinkData link;

  Future<void> _act(BuildContext context, WidgetRef ref, Future<void> Function() work, String done) async {
    try {
      await work();
      _refreshBank(ref);
      if (context.mounted) _snack(context, done);
    } on AuthApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(bankApiProvider);
    final synced = link.lastSyncedAt == null ? 'sin sincronizar' : 'sincronizado el ${link.lastSyncedAt!.toLocal().toString().substring(0, 16)}';
    return FdmCard(
      title: link.institutionName,
      trailing: Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        OriginPill(link.origin),
        TextButton(onPressed: () => _act(context, ref, () => api.sync(link.id), 'Movimientos actualizados.'), child: const Text('Sincronizar')),
        TextButton(onPressed: () => _act(context, ref, () => api.disconnect(link.id), 'Banco desconectado. Lo que confirmaste en tu registro se mantiene.'), child: const Text('Desconectar')),
      ]),
      children: [
        Muted('Conexión de lectura, $synced.', size: 12),
        FdmTable(
          columns: const [Col('Cuenta', flex: 3), Col('Saldo disponible', flex: 2), Col('', flex: 3)],
          rows: [
            for (final a in link.accounts)
              [
                Cell(a.name, sub: a.type == 'checking_account' ? 'Cuenta corriente' : 'Cuenta vista'),
                Cell(clp(a.availableBalance), number: true),
                Cell.w(TextButton(
                  onPressed: () => _act(context, ref, () => api.useAsOpeningBalance(a.id), 'Saldo inicial actualizado con esta cuenta.'),
                  child: const Text('Usar como saldo inicial'),
                )),
              ],
          ],
        ),
      ],
    );
  }
}

class _MovementsCard extends ConsumerWidget {
  const _MovementsCard();

  Future<void> _confirm(BuildContext context, WidgetRef ref, BankMovementData m) async {
    final label = TextEditingController(text: m.description.length > 80 ? m.description.substring(0, 80) : m.description);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(m.amount > 0 ? 'Agregar como ingreso recurrente' : 'Agregar como gasto recurrente', style: FdmText.serif(24)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Se agregará a tu registro por ${clp(m.amount.abs())} todos los meses desde ${monthShort(m.postedOn.substring(0, 7))}. Puedes editarlo después.', style: FdmText.ui(14)),
          const SizedBox(height: 12),
          TextField(controller: label, maxLength: 80, decoration: const InputDecoration(labelText: 'Nombre en tu registro')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Agregar')),
        ],
      ),
    );
    final text = label.text.trim();
    label.dispose();
    if (ok != true) return;
    try {
      await ref.read(bankApiProvider).confirmRecurring(m.id, label: text);
      _refreshBank(ref);
      if (context.mounted) _snack(context, 'Agregado a tu registro.');
    } on AuthApiException catch (e) {
      if (context.mounted) _snack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
        ref.watch(bankMovementsProvider(3)),
        builder: (data) => FdmCard(title: 'Movimientos de los últimos 3 meses', children: [
          FdmTable(
            columns: const [Col('Mes', flex: 2), Col('Abonos', flex: 2), Col('Cargos', flex: 2)],
            rows: [for (final t in data.totals) [Cell(monthShort(t.month)), Cell(clp(t.credits), number: true), Cell(clp(t.debits), number: true)]],
          ),
          const Muted('Totales del mes tal como vienen del banco. Confirma los que se repiten para que entren a tu proyección.', size: 12),
          FdmTable(
            minWidth: 720,
            columns: const [Col('Fecha', flex: 2), Col('Descripción', flex: 4), Col('Monto', flex: 2), Col('', flex: 3)],
            rows: [
              for (final m in data.movements.take(60))
                [
                  Cell(m.postedOn),
                  Cell(m.description),
                  Cell(clp(m.amount), number: true),
                  m.confirmedAs != null
                      ? Cell.w(Pill(m.confirmedAs == 'income' ? 'En tu registro como ingreso' : 'En tu registro como gasto'))
                      : Cell.w(TextButton(onPressed: () => _confirm(context, ref, m), child: const Text('Es recurrente'))),
                ],
            ],
          ),
        ]),
      );
}

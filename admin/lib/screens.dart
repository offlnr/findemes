import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'admin_api.dart';

void _snack(BuildContext context, String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
String _date(DateTime d) => d.toLocal().toString().substring(0, 16);
String _clp(int amount) {
  final digits = amount.abs().toString();
  final grouped = digits.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');
  return '${amount < 0 ? '-' : ''}\$$grouped';
}

/// Inicio de sesión con contraseña y código TOTP (HU22, RNF22).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(adminApiProvider).login(_email.text.trim(), _password.text, _code.text.trim());
    } on AdminApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: AutofillGroup(
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('Panel de administración', style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    const Text('Solo para administradores de la plataforma. Se requiere el código de tu app de autenticación.'),
                    const SizedBox(height: 20),
                    TextField(controller: _email, autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Correo')),
                    TextField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.password], decoration: const InputDecoration(labelText: 'Contraseña')),
                    TextField(
                      controller: _code,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      decoration: const InputDecoration(labelText: 'Código de 6 dígitos'),
                      onSubmitted: (_) => _login(),
                    ),
                    if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                    FilledButton(onPressed: _busy ? null : _login, child: const Text('Entrar')),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}

class _Page extends StatelessWidget {
  const _Page({required this.title, required this.subtitle, required this.children});
  final String title;
  final String subtitle;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(28), children: [
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 20),
        ...children,
      ]);
}

/// HU24 y KPI de registro inicial: solo cifras agregadas.
class MetricsScreen extends ConsumerStatefulWidget {
  const MetricsScreen({super.key});
  @override
  ConsumerState<MetricsScreen> createState() => _MetricsScreenState();
}

class _MetricsScreenState extends ConsumerState<MetricsScreen> {
  late Future<Map<String, dynamic>> _metrics = ref.read(adminApiProvider).metrics();

  Widget _tile(String label, String value) => Card(
        child: SizedBox(
          width: 220,
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label), const SizedBox(height: 6), Text(value, style: Theme.of(context).textTheme.headlineSmall)]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => _Page(title: 'Estado de la plataforma', subtitle: 'Cifras agregadas. Sin datos financieros de ninguna persona.', children: [
        Align(alignment: Alignment.centerLeft, child: OutlinedButton(
            onPressed: () {
              final metrics = ref.read(adminApiProvider).metrics();
              setState(() {
                _metrics = metrics;
              });
            },
            child: const Text('Actualizar'),
          )),
        const SizedBox(height: 12),
        FutureBuilder(
          future: _metrics,
          builder: (context, snapshot) {
            if (snapshot.hasError) return Text('${snapshot.error}');
            final m = snapshot.data;
            if (m == null) return const LinearProgressIndicator();
            final api = m['publicApi'] as Map<String, dynamic>?;
            final plans = (m['activeSubscriptions'] as Map<String, dynamic>).entries.map((e) => '${e.key}: ${e.value}').join(' · ');
            final started = m['onboardingStarted'] as int;
            final completed = m['onboardingCompleted'] as int;
            return Wrap(spacing: 12, runSpacing: 12, children: [
              _tile('API pública', api == null ? 'Sin monitoreo' : (api['up'] as bool ? 'Disponible · ${api['latencyMs']} ms' : 'No responde')),
              _tile('Cuentas', '${m['users']}'),
              _tile('Correo verificado', '${m['verifiedUsers']}'),
              _tile('Suspendidas', '${m['suspendedUsers']}'),
              _tile('Registro inicial completado', started == 0 ? '—' : '${(completed * 100 / started).round()} % ($completed de $started)'),
              _tile('Mediana del registro inicial', m['onboardingMedianMinutes'] == null ? '—' : '${m['onboardingMedianMinutes']} min'),
              _tile('Planes pagados vigentes', plans.isEmpty ? 'Ninguno' : plans),
            ]);
          },
        ),
      ]);
}

/// HU23: buscar cuentas, ver plan y suscripción, suspender y reactivar.
class AccountsScreen extends ConsumerStatefulWidget {
  const AccountsScreen({super.key});
  @override
  ConsumerState<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends ConsumerState<AccountsScreen> {
  final _query = TextEditingController();
  Future<List<AccountRow>>? _results;

  void _search() {
    final results = ref.read(adminApiProvider).accounts(_query.text.trim());
    setState(() {
      _results = results;
    });
  }

  Future<void> _toggle(AccountRow a) async {
    try {
      await ref.read(adminApiProvider).setStatus(a.id, suspend: a.status == 'active');
      _search();
    } on AdminApiException catch (e) {
      if (mounted) _snack(context, e.message);
    }
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _Page(
        title: 'Cuentas',
        subtitle: 'Plan y estado de la suscripción. Este panel no puede ver ingresos, gastos, deudas ni escenarios.',
        children: [
          Row(children: [
            SizedBox(width: 360, child: TextField(controller: _query, decoration: const InputDecoration(labelText: 'Buscar por correo'), onSubmitted: (_) => _search())),
            const SizedBox(width: 12),
            FilledButton(onPressed: _search, child: const Text('Buscar')),
          ]),
          const SizedBox(height: 16),
          if (_results != null)
            FutureBuilder(
              future: _results,
              builder: (context, snapshot) {
                if (snapshot.hasError) return Text('${snapshot.error}');
                final rows = snapshot.data;
                if (rows == null) return const LinearProgressIndicator();
                if (rows.isEmpty) return const Text('Sin resultados.');
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(columns: const [
                    DataColumn(label: Text('Correo')),
                    DataColumn(label: Text('Estado')),
                    DataColumn(label: Text('Verificado')),
                    DataColumn(label: Text('Plan')),
                    DataColumn(label: Text('Vigencia')),
                    DataColumn(label: Text('Creada')),
                    DataColumn(label: Text('')),
                  ], rows: [
                    for (final a in rows)
                      DataRow(cells: [
                        DataCell(Text(a.email)),
                        DataCell(Text(a.status == 'active' ? 'Activa' : 'Suspendida')),
                        DataCell(Text(a.emailVerified ? 'Sí' : 'No')),
                        DataCell(Text(a.planCode)),
                        DataCell(Text(a.periodEnd == null ? '—' : '${a.periodEnd}${a.cancelAtPeriodEnd ? ' (no renueva)' : ''}')),
                        DataCell(Text(_date(a.createdAt))),
                        DataCell(TextButton(onPressed: () => _toggle(a), child: Text(a.status == 'active' ? 'Suspender' : 'Reactivar'))),
                      ]),
                  ]),
                );
              },
            ),
        ],
      );
}

/// HU25: traza de solo lectura con verificación de la cadena de hash.
class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});
  @override
  ConsumerState<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends ConsumerState<AuditScreen> {
  final _action = TextEditingController();
  late Future<({List<AuditRow> entries, int? brokenAtSeq})> _audit = ref.read(adminApiProvider).audit();

  void _load() {
    final audit = ref.read(adminApiProvider).audit(action: _action.text.trim().isEmpty ? null : _action.text.trim());
    setState(() {
      _audit = audit;
    });
  }

  @override
  void dispose() {
    _action.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _Page(
        title: 'Traza de auditoría',
        subtitle: 'Fecha, cuenta, acción y origen de cada acceso o cambio sobre datos personales. Solo lectura.',
        children: [
          Row(children: [
            SizedBox(width: 300, child: TextField(controller: _action, decoration: const InputDecoration(labelText: 'Filtrar por acción (ej.: admin. o privacy.)'), onSubmitted: (_) => _load())),
            const SizedBox(width: 12),
            FilledButton(onPressed: _load, child: const Text('Filtrar')),
          ]),
          const SizedBox(height: 16),
          FutureBuilder(
            future: _audit,
            builder: (context, snapshot) {
              if (snapshot.hasError) return Text('${snapshot.error}');
              final data = snapshot.data;
              if (data == null) return const LinearProgressIndicator();
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Chip(
                  avatar: Icon(data.brokenAtSeq == null ? Icons.verified_outlined : Icons.warning_amber_outlined),
                  label: Text(data.brokenAtSeq == null ? 'Cadena de hash íntegra' : 'La cadena no coincide desde la entrada ${data.brokenAtSeq}'),
                ),
                const SizedBox(height: 12),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(columns: const [
                    DataColumn(label: Text('#')),
                    DataColumn(label: Text('Fecha')),
                    DataColumn(label: Text('Actor')),
                    DataColumn(label: Text('Acción')),
                    DataColumn(label: Text('Objeto')),
                    DataColumn(label: Text('Origen')),
                  ], rows: [
                    for (final e in data.entries)
                      DataRow(cells: [
                        DataCell(Text('${e.seq}')),
                        DataCell(Text(_date(e.occurredAt))),
                        DataCell(Text('${e.actorType} ${e.actorId?.substring(0, 8) ?? ''}')),
                        DataCell(Text(e.action)),
                        DataCell(Text('${e.targetType} ${e.targetId?.substring(0, 8) ?? ''}')),
                        DataCell(Text(e.originIp ?? '—')),
                      ]),
                  ]),
                ),
              ]);
            },
          ),
        ],
      );
}

/// HU26: transacciones por estado y período, inconsistencias y conciliación con Transbank.
class PaymentsScreen extends ConsumerStatefulWidget {
  const PaymentsScreen({super.key});
  @override
  ConsumerState<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends ConsumerState<PaymentsScreen> {
  String? _status;
  late Future<List<PaymentRow>> _payments = ref.read(adminApiProvider).payments();
  static const _flagLabels = {'monto_distinto': 'Monto distinto', 'sin_confirmar': 'Sin confirmar', 'autorizada_sin_activar': 'Autorizada sin activar'};
  static const _reconcileLabels = {
    'cobro_sin_activacion': 'Cobro sin activación',
    'activacion_sin_cobro': 'Activación sin cobro',
    'monto_distinto': 'Monto distinto',
    'sin_diferencias': 'Sin diferencias',
  };

  void _load() {
    final payments = ref.read(adminApiProvider).payments(status: _status);
    setState(() {
      _payments = payments;
    });
  }

  Future<void> _reconcile(PaymentRow p) async {
    try {
      final r = await ref.read(adminApiProvider).reconcile(p.buyOrder);
      if (mounted) _snack(context, '${p.buyOrder}: ${_reconcileLabels[r.flag] ?? r.flag} (Transbank: ${r.providerStatus}).');
    } on AdminApiException catch (e) {
      if (mounted) _snack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) => _Page(
        title: 'Pagos',
        subtitle: 'Órdenes de Webpay. La conciliación consulta a Transbank y compara con el registro propio, sin modificar nada.',
        children: [
          Row(children: [
            SizedBox(
              width: 260,
              child: DropdownButtonFormField<String?>(
                initialValue: _status,
                decoration: const InputDecoration(labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: null, child: Text('Todos')),
                  DropdownMenuItem(value: 'created', child: Text('Iniciada')),
                  DropdownMenuItem(value: 'authorized', child: Text('Autorizada')),
                  DropdownMenuItem(value: 'rejected', child: Text('Rechazada')),
                  DropdownMenuItem(value: 'aborted', child: Text('Anulada')),
                  DropdownMenuItem(value: 'amount_mismatch', child: Text('Monto distinto')),
                ],
                onChanged: (v) => setState(() => _status = v),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(onPressed: _load, child: const Text('Filtrar')),
          ]),
          const SizedBox(height: 16),
          FutureBuilder(
            future: _payments,
            builder: (context, snapshot) {
              if (snapshot.hasError) return Text('${snapshot.error}');
              final rows = snapshot.data;
              if (rows == null) return const LinearProgressIndicator();
              if (rows.isEmpty) return const Text('Sin órdenes.');
              return SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(columns: const [
                  DataColumn(label: Text('Orden')),
                  DataColumn(label: Text('Plan')),
                  DataColumn(label: Text('Monto')),
                  DataColumn(label: Text('Estado')),
                  DataColumn(label: Text('Creada')),
                  DataColumn(label: Text('Revisar')),
                  DataColumn(label: Text('')),
                ], rows: [
                  for (final p in rows)
                    DataRow(cells: [
                      DataCell(Text(p.buyOrder)),
                      DataCell(Text(p.planCode)),
                      DataCell(Text(_clp(p.amount))),
                      DataCell(Text(p.status)),
                      DataCell(Text(_date(p.createdAt))),
                      DataCell(Text(p.flags.map((f) => _flagLabels[f] ?? f).join(', '))),
                      DataCell(p.hasProviderToken ? TextButton(onPressed: () => _reconcile(p), child: const Text('Conciliar')) : const Text('—')),
                    ]),
                ]),
              );
            },
          ),
        ],
      );
}

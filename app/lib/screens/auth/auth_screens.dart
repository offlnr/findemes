import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/auth/auth_api.dart';
import '../../data/auth/auth_controller.dart';
import '../../theme/tokens.dart';
import '../../widgets/common.dart';

/// Pantallas fuera de sesión (HU17, HU17.1, HU17.2, CU-08, CU-11) conectadas a `/v1/auth/*`.
/// La invitación al hogar (HU31) todavía navega sin enviar datos.
class AuthLayout extends StatelessWidget {
  const AuthLayout({super.key, required this.line1, required this.line2, required this.lead, required this.title, required this.children});
  final String line1;
  final String line2;
  final String lead;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 980;
    final tagline = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Fin de Mes', style: FdmText.serif(30, color: FdmColors.accent)),
        const SizedBox(height: 28),
        Text(line1, style: FdmText.serif(wide ? 104 : 56, color: FdmColors.accent).copyWith(height: 0.9)),
        Text(line2, style: FdmText.serif(wide ? 104 : 56, color: FdmColors.onInk).copyWith(height: 0.95)),
        const SizedBox(height: 28),
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 440), child: Text(lead, style: FdmText.ui(18, color: FdmColors.onInk))),
      ],
    );
    final form = ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Container(
        padding: const EdgeInsets.all(44),
        decoration: BoxDecoration(color: FdmColors.bg, borderRadius: BorderRadius.circular(28), boxShadow: fdmShadow),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: FdmText.serif(36)),
            const SizedBox(height: 20),
            Gap(children, gap: 16),
          ],
        ),
      ),
    );
    return Scaffold(
      backgroundColor: FdmColors.ink,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(horizontal: wide ? 120 : 16, vertical: 32),
            child: wide
                ? Row(children: [Expanded(child: tagline), const SizedBox(width: 48), form])
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [tagline, const SizedBox(height: 40), form]),
          ),
        ),
      ),
    );
  }
}

class LabeledField extends StatelessWidget {
  const LabeledField(this.label, {super.key, this.hint, this.obscure = false, this.keyboard, this.helper, this.initial, this.controller, this.error, this.autofill});
  final String label;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboard;
  final String? helper;
  final String? initial;
  final TextEditingController? controller;
  final String? error;
  final Iterable<String>? autofill;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
          const SizedBox(height: 6),
          TextFormField(
            controller: controller,
            initialValue: controller == null ? initial : null,
            obscureText: obscure,
            keyboardType: keyboard,
            autofillHints: autofill,
            decoration: InputDecoration(hintText: hint, errorText: error, errorMaxLines: 3),
          ),
          if (helper != null) ...[const SizedBox(height: 6), Muted(helper!, size: 12)],
        ],
      );
}

class _Links extends StatelessWidget {
  const _Links(this.links);
  final List<(String, String)> links;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, children: [
        for (final (label, path) in links) TextButton(onPressed: () => context.go(path), child: Text(label)),
      ]);
}

/// Mensaje de error general del formulario, anunciado a lectores de pantalla.
class _FormError extends StatelessWidget {
  const _FormError(this.message);
  final String? message;
  @override
  Widget build(BuildContext context) => message == null
      ? const SizedBox.shrink()
      : Semantics(liveRegion: true, child: Text(message!, style: FdmText.ui(13, weight: FontWeight.w600, color: FdmColors.text)));
}

/// Botón que muestra el estado de envío y se desactiva mientras espera.
class _Submit extends StatelessWidget {
  const _Submit({required this.label, required this.busy, required this.onPressed});
  final String label;
  final bool busy;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => FilledButton(onPressed: busy ? null : onPressed, child: Text(busy ? 'Enviando…' : label));
}

/// Ejecuta una llamada a la API mostrando el estado de envío y el error del servidor.
mixin _Submitting<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  bool busy = false;
  String? error;
  Map<String, String> fieldErrors = const {};

  Future<bool> submit(Future<void> Function() call) async {
    setState(() {
      busy = true;
      error = null;
      fieldErrors = const {};
    });
    try {
      await call();
      return true;
    } on AuthApiException catch (e) {
      if (mounted) {
        setState(() {
          error = e.fieldMessages.isEmpty ? e.message : null;
          fieldErrors = e.fieldMessages;
        });
      }
      return false;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> with _Submitting {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  String? _challengeId;

  @override
  void dispose() {
    for (final c in [_email, _password, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _login() async {
    final auth = ref.read(authControllerProvider.notifier);
    LoginCodeRequired? challenge;
    final ok = await submit(() async => challenge = await auth.login(_email.text, _password.text));
    if (!ok || !mounted) return;
    final pending = challenge;
    if (pending != null) {
      setState(() => _challengeId = pending.challengeId);
    } else {
      context.go('/app/resumen');
    }
  }

  Future<void> _confirm(String challengeId) async {
    final ok = await submit(() => ref.read(authControllerProvider.notifier).confirmCode(challengeId, _code.text.trim()));
    if (ok && mounted) context.go('/app/resumen');
  }

  @override
  Widget build(BuildContext context) {
    final challenge = _challengeId;
    return AuthLayout(
      line1: 'Tus gastos,',
      line2: 'a la vista.',
      lead: 'Entra y revisa cómo cierra cada uno de tus próximos doce meses.',
      title: challenge == null ? 'Iniciar sesión' : 'Revisa tu correo',
      children: challenge == null
          ? [
              LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress, controller: _email, autofill: const [AutofillHints.email]),
              LabeledField('Contraseña', obscure: true, controller: _password, autofill: const [AutofillHints.password]),
              _FormError(error),
              _Submit(label: 'Entrar', busy: busy, onPressed: _login),
              const _Links([('Olvidé mi contraseña', '/recuperar'), ('Crear cuenta', '/registro')]),
              const Muted('Tras varios intentos fallidos, la cuenta espera un tiempo creciente antes de permitir otro intento. Nunca se bloquea de forma permanente.', size: 12),
              const _Links([('Probar sin cuenta', '/demo')]),
            ]
          : [
              const Muted('Es la primera vez que entras desde este dispositivo. Te enviamos un código de 6 dígitos que vence en 10 minutos.', size: 14),
              LabeledField('Código', hint: '000000', keyboard: TextInputType.number, controller: _code, autofill: const [AutofillHints.oneTimeCode]),
              _FormError(error),
              _Submit(label: 'Confirmar', busy: busy, onPressed: () => _confirm(challenge)),
              TextButton(onPressed: () => setState(() => _challengeId = null), child: const Text('Volver')),
            ],
    );
  }
}

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key, this.plan, this.connectBank = false, this.fromDemo = false});
  final String? plan;
  final bool connectBank;
  final bool fromDemo;
  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> with _Submitting {
  final _email = TextEditingController();
  final _name = TextEditingController();
  final _password = TextEditingController();
  bool _consent = false;

  @override
  void dispose() {
    for (final c in [_email, _name, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _signup() async {
    if (!_consent) {
      setState(() => error = 'Para crear la cuenta debes aceptar la política de privacidad y los términos.');
      return;
    }
    final ok = await submit(() => ref.read(authApiProvider).register(email: _email.text, password: _password.text, displayName: _name.text));
    if (ok && mounted) context.go(widget.plan == null ? '/verificar' : '/verificar?plan=${widget.plan}');
  }

  @override
  Widget build(BuildContext context) {
    final planName = switch (widget.plan) { 'individual' => 'Individual', 'familiar' => 'Familiar', _ => null };
    return AuthLayout(
      line1: 'Antes de decidir,',
      line2: 'mira el mes.',
      lead: 'Crea tu cuenta gratis y conecta tu banco con Fintoc cuando quieras.',
      title: 'Crear cuenta',
      children: [
        if (widget.fromDemo) const Notice('Tus datos del modo demostración se traspasarán a la cuenta nueva.'),
        if (planName != null) Notice('Elegiste el plan $planName. Lo pagas con Webpay después de confirmar tu correo.'),
        if (widget.connectBank) const Notice('Después de crear la cuenta te llevamos a conectar tu banco con Fintoc.'),
        LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress, controller: _email, error: fieldErrors['email'], autofill: const [AutofillHints.email]),
        LabeledField('¿Cómo te llamamos?', hint: 'Un nombre o apodo', controller: _name, error: fieldErrors['displayName'], helper: 'Solo se usa para saludarte en la app y en los correos.'),
        LabeledField(
          'Contraseña',
          obscure: true,
          controller: _password,
          error: fieldErrors['password'],
          autofill: const [AutofillHints.newPassword],
          helper: 'Mínimo 10 caracteres. Se revisa contra una lista local de contraseñas filtradas.',
        ),
        CheckboxListTile(
          value: _consent,
          onChanged: (v) => setState(() => _consent = v ?? false),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          activeColor: FdmColors.ink,
          title: Text('Leí la política de privacidad y los términos.', style: FdmText.ui(13)),
        ),
        _FormError(error),
        _Submit(label: 'Crear cuenta', busy: busy, onPressed: _signup),
        const _Links([('Ya tengo cuenta', '/login')]),
      ],
    );
  }
}

/// Sin token: indica revisar el correo. Con `?token=` (el enlace del correo): confirma la cuenta.
class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key, this.plan, this.token});
  final String? plan;
  final String? token;
  @override
  ConsumerState<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends ConsumerState<VerifyScreen> with _Submitting {
  bool _verified = false;

  @override
  void initState() {
    super.initState();
    final token = widget.token;
    if (token != null) {
      Future.microtask(() async {
        final ok = await submit(() => ref.read(authApiProvider).verifyEmail(token));
        if (ok && mounted) setState(() => _verified = true);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final children = widget.token == null
        ? <Widget>[
            const Muted('Te enviamos un enlace para confirmar tu correo. Es de un solo uso y vence en 24 horas.', size: 14),
            const Muted('Si no llega en unos minutos, revisa la carpeta de spam.', size: 13),
            const _Links([('Ir a iniciar sesión', '/login')]),
          ]
        : <Widget>[
            if (busy) const Muted('Confirmando tu correo…', size: 14),
            if (_verified) ...[
              const Notice('Tu correo quedó confirmado. Ya puedes iniciar sesión.'),
              FilledButton(onPressed: () => context.go('/login'), child: const Text('Iniciar sesión')),
            ],
            if (error != null) ...[_FormError(error), const _Links([('Volver a iniciar sesión', '/login')])],
          ];
    return AuthLayout(
      line1: 'Un paso',
      line2: 'más.',
      lead: 'Confirma tu correo para empezar a registrar y proyectar.',
      title: widget.token == null ? 'Revisa tu correo' : 'Confirmar correo',
      children: children,
    );
  }
}

class RecoverScreen extends ConsumerStatefulWidget {
  const RecoverScreen({super.key});
  @override
  ConsumerState<RecoverScreen> createState() => _RecoverScreenState();
}

class _RecoverScreenState extends ConsumerState<RecoverScreen> with _Submitting {
  final _email = TextEditingController();
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final ok = await submit(() => ref.read(authApiProvider).requestPasswordReset(_email.text));
    if (ok && mounted) setState(() => _sent = true);
  }

  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'Volvamos',
        line2: 'a entrar.',
        lead: 'Te enviamos un enlace de un solo uso para crear otra contraseña.',
        title: 'Recuperar acceso',
        children: _sent
            ? const [
                Notice('Si el correo tiene una cuenta, te enviamos un enlace. Vence en 30 minutos.'),
                _Links([('Volver a iniciar sesión', '/login')]),
              ]
            : [
                const Muted('El enlace vence en 30 minutos.', size: 14),
                LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress, controller: _email, autofill: const [AutofillHints.email]),
                _FormError(error),
                _Submit(label: 'Enviar enlace', busy: busy, onPressed: _send),
                const _Links([('Volver a iniciar sesión', '/login')]),
              ],
      );
}

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, this.token});
  final String? token;
  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> with _Submitting {
  final _password = TextEditingController();
  final _repeat = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    _password.dispose();
    _repeat.dispose();
    super.dispose();
  }

  Future<void> _save(String token) async {
    if (_password.text != _repeat.text) {
      setState(() => error = 'Las contraseñas no coinciden.');
      return;
    }
    final ok = await submit(() => ref.read(authApiProvider).confirmPasswordReset(token: token, newPassword: _password.text));
    if (ok && mounted) setState(() => _done = true);
  }

  @override
  Widget build(BuildContext context) {
    final token = widget.token;
    return AuthLayout(
      line1: 'Una clave',
      line2: 'nueva.',
      lead: 'Mínimo 10 caracteres. Se revisa contra una lista local de contraseñas filtradas.',
      title: 'Nueva contraseña',
      children: token == null
          ? const [
              Muted('Abre el enlace que te enviamos por correo para elegir una contraseña nueva.', size: 14),
              _Links([('Pedir un enlace', '/recuperar')]),
            ]
          : _done
              ? [
                  const Notice('Listo. Cerramos las sesiones abiertas; entra con tu contraseña nueva.'),
                  FilledButton(onPressed: () => context.go('/login'), child: const Text('Iniciar sesión')),
                ]
              : [
                  LabeledField('Nueva contraseña (mín. 10)', obscure: true, controller: _password, error: fieldErrors['newPassword'], autofill: const [AutofillHints.newPassword]),
                  LabeledField('Repite la contraseña', obscure: true, controller: _repeat),
                  _FormError(error),
                  _Submit(label: 'Guardar', busy: busy, onPressed: () => _save(token)),
                  const Muted('Si el enlace venció o ya se usó, te pedimos solicitar otro.', size: 12),
                ],
    );
  }
}

class InvitationScreen extends StatelessWidget {
  const InvitationScreen({super.key});
  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'La casa,',
        line2: 'en común.',
        lead: 'Los gastos del hogar se comparten. Tus finanzas personales, no.',
        title: 'Te invitaron a un hogar',
        children: [
          const Muted('Camila te invitó al hogar "Rojas Pérez". Verás los gastos comunes y cuánto aporta cada uno. Tus ingresos, deudas y escenarios seguirán siendo solo tuyos.', size: 14),
          FilledButton(onPressed: () => context.go('/app/hogar'), child: const Text('Aceptar e iniciar sesión')),
          OutlinedButton(onPressed: () => context.go('/registro'), child: const Text('Crear cuenta y aceptar')),
          const _Links([('Rechazar invitación', '/login')]),
        ],
      );
}

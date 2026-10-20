import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/tokens.dart';
import '../../widgets/common.dart';

/// Pantallas fuera de sesión (HU17, HU17.1, HU17.2, HU29, HU31). Sin API todavía: los
/// botones navegan como lo haría el flujo real, sin enviar datos.
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
  const LabeledField(this.label, {super.key, this.hint, this.obscure = false, this.keyboard, this.helper, this.initial});
  final String label;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboard;
  final String? helper;
  final String? initial;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: FdmText.ui(13, weight: FontWeight.w500)),
          const SizedBox(height: 6),
          TextFormField(initialValue: initial, obscureText: obscure, keyboardType: keyboard, decoration: InputDecoration(hintText: hint)),
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

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});
  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'Tus gastos,',
        line2: 'a la vista.',
        lead: 'Entra y revisa cómo cierra cada uno de tus próximos doce meses.',
        title: 'Iniciar sesión',
        children: [
          const LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress),
          const LabeledField('Contraseña', obscure: true),
          FilledButton(onPressed: () => context.go('/app/resumen'), child: const Text('Entrar')),
          const _Links([('Olvidé mi contraseña', '/recuperar'), ('Crear cuenta', '/registro')]),
          const Muted('Tras varios intentos fallidos, la cuenta espera un tiempo creciente antes de permitir otro intento. Nunca se bloquea de forma permanente.', size: 12),
          const _Links([('Probar sin cuenta', '/demo')]),
        ],
      );
}

class SignupScreen extends StatelessWidget {
  const SignupScreen({super.key, this.plan, this.connectBank = false, this.fromDemo = false});
  final String? plan;
  final bool connectBank;
  final bool fromDemo;

  @override
  Widget build(BuildContext context) {
    final planName = switch (plan) { 'individual' => 'Individual', 'familiar' => 'Familiar', _ => null };
    return AuthLayout(
      line1: 'Antes de decidir,',
      line2: 'mira el mes.',
      lead: 'Crea tu cuenta gratis y conecta tu banco con Fintoc cuando quieras.',
      title: 'Crear cuenta',
      children: [
        if (fromDemo) const Notice('Tus datos del modo demostración se traspasarán a la cuenta nueva.'),
        if (planName != null) Notice('Elegiste el plan $planName. Lo pagas con Webpay después de confirmar tu correo.'),
        if (connectBank) const Notice('Después de crear la cuenta te llevamos a conectar tu banco con Fintoc.'),
        const LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress),
        const LabeledField('Contraseña', obscure: true, helper: 'Mínimo 10 caracteres. Se revisa contra una lista local de contraseñas filtradas.'),
        const _Consent(),
        FilledButton(onPressed: () => context.go(plan == null ? '/verificar' : '/verificar?plan=$plan'), child: const Text('Crear cuenta')),
        const _Links([('Ya tengo cuenta', '/login')]),
      ],
    );
  }
}

class _Consent extends StatefulWidget {
  const _Consent();
  @override
  State<_Consent> createState() => _ConsentState();
}

class _ConsentState extends State<_Consent> {
  bool _ok = false;
  @override
  Widget build(BuildContext context) => CheckboxListTile(
        value: _ok,
        onChanged: (v) => setState(() => _ok = v ?? false),
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        activeColor: FdmColors.ink,
        title: Text('Leí la política de privacidad y los términos.', style: FdmText.ui(13)),
      );
}

class VerifyScreen extends StatelessWidget {
  const VerifyScreen({super.key, this.plan});
  final String? plan;
  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'Un paso',
        line2: 'más.',
        lead: 'Confirma tu correo para empezar a registrar y proyectar.',
        title: 'Revisa tu correo',
        children: [
          const Muted('Te enviamos un enlace. Es de un solo uso y vence en 24 horas.', size: 14),
          OutlinedButton(
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enlace reenviado (demostración).'))),
            child: const Text('Reenviar enlace'),
          ),
          FilledButton(
            onPressed: () => context.go(plan == null ? '/app/resumen' : '/app/plan'),
            child: Text(plan == null ? 'Ya confirmé: ir a Mi situación' : 'Ya confirmé: pagar el plan'),
          ),
        ],
      );
}

class RecoverScreen extends StatelessWidget {
  const RecoverScreen({super.key});
  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'Volvamos',
        line2: 'a entrar.',
        lead: 'Te enviamos un enlace de un solo uso para crear otra contraseña.',
        title: 'Recuperar acceso',
        children: [
          const Muted('El enlace vence en 30 minutos.', size: 14),
          const LabeledField('Correo', hint: 'tu@correo.cl', keyboard: TextInputType.emailAddress),
          FilledButton(onPressed: () => context.go('/restablecer'), child: const Text('Enviar enlace')),
          const _Links([('Volver a iniciar sesión', '/login')]),
        ],
      );
}

class ResetPasswordScreen extends StatelessWidget {
  const ResetPasswordScreen({super.key});
  @override
  Widget build(BuildContext context) => AuthLayout(
        line1: 'Una clave',
        line2: 'nueva.',
        lead: 'Mínimo 10 caracteres. Se revisa contra una lista local de contraseñas filtradas.',
        title: 'Nueva contraseña',
        children: [
          const LabeledField('Nueva contraseña (mín. 10)', obscure: true),
          const LabeledField('Repite la contraseña', obscure: true),
          FilledButton(onPressed: () => context.go('/app/resumen'), child: const Text('Guardar y entrar')),
          const Muted('Si el enlace venció o ya se usó, te pedimos solicitar otro.', size: 12),
        ],
      );
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

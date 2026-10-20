/// Formato de montos en pesos chilenos. Los montos son enteros (CLAUDE.md, regla 10).
/// Solo da formato: los montos llegan calculados desde la API (regla 8).
library;

String _thousands(int value) {
  final digits = value.abs().toString();
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write('.');
    out.write(digits[i]);
  }
  return out.toString();
}

/// `1150000` → `$1.150.000`; `-34999` → `−$34.999` (signo menos tipográfico).
String clp(int amount) => '${amount < 0 ? '−' : ''}\$${_thousands(amount)}';

/// Como [clp], pero con `+` en los positivos. Para diferencias frente a la base.
String clpSigned(int amount) => amount > 0 ? '+${clp(amount)}' : clp(amount);

/// Versión corta para ejes y etiquetas de gráficos: `$652 mil`, `$2,6 M`.
String clpShort(int amount) {
  final sign = amount < 0 ? '−' : '';
  final a = amount.abs();
  if (a == 0) return '\$0';
  if (a >= 1000000) {
    final tenths = (a / 100000).round();
    final whole = tenths ~/ 10;
    final dec = tenths % 10;
    return '$sign\$$whole${dec == 0 ? '' : ',$dec'} M';
  }
  return '$sign\$${(a / 1000).round()} mil';
}

import 'package:findemes_app/format/money.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('clp da formato con punto de miles y signo menos tipográfico', () {
    expect(clp(0), '\$0');
    expect(clp(999), '\$999');
    expect(clp(1150000), '\$1.150.000');
    expect(clp(-34999), '−\$34.999');
  });

  test('clpSigned agrega + solo a los positivos', () {
    expect(clpSigned(40000), '+\$40.000');
    expect(clpSigned(-74999), '−\$74.999');
    expect(clpSigned(0), '\$0');
  });

  test('clpShort resume montos para gráficos', () {
    expect(clpShort(652340), '\$652 mil');
    expect(clpShort(2632340), '\$2,6 M');
    expect(clpShort(1000000), '\$1 M');
    expect(clpShort(-207650), '−\$208 mil');
  });
}

/// Escala del eje vertical de un gráfico: incluye el cero y redondea a un múltiplo legible.
/// Es solo presentación; los montos llegan calculados desde la API.
class ChartScale {
  const ChartScale(this.min, this.max, this.ticks);
  final int min;
  final int max;
  final List<int> ticks;

  factory ChartScale.of(List<int> values) {
    final low = values.fold<int>(0, (a, b) => b < a ? b : a);
    final high = values.fold<int>(0, (a, b) => b > a ? b : a);
    final span = (high - low) == 0 ? 100000 : high - low;
    var step = 1;
    while (step * 4 < span) {
      step *= 10;
    }
    if (step * 2 >= span) step ~/= 2;
    final min = (low / step).floor() * step;
    final max = (high / step).ceil() * step;
    return ChartScale(min, max == min ? min + step : max, [for (var v = min; v <= max; v += step) v]);
  }
}

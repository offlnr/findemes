import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../format/money.dart';
import '../../theme/tokens.dart';

/// Gráficos dibujados con CustomPainter. Solo dibujan valores que llegan de la API.

class LineSeries {
  const LineSeries({required this.name, required this.values, required this.color, this.dashed = false, this.area = false, this.width = 3});
  final String name;
  final List<int> values;
  final Color color;
  final bool dashed;
  final bool area;
  final double width;
}

class ChartMark {
  const ChartMark({required this.index, required this.value, required this.label, this.color = FdmColors.ink, this.below = false, this.alignLeft = false});
  final int index;
  final int value;
  final String label;
  final Color color;
  final bool below;
  final bool alignLeft;
}

class ChartLegend extends StatelessWidget {
  const ChartLegend(this.series, {super.key});
  final List<LineSeries> series;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 20, runSpacing: 8, children: [
        for (final s in series)
          Row(mainAxisSize: MainAxisSize.min, children: [
            CustomPaint(size: const Size(26, 8), painter: _LegendLine(s)),
            const SizedBox(width: 8),
            Text(s.name, style: FdmText.ui(12, weight: FontWeight.w500)),
          ]),
      ]);
}

class _LegendLine extends CustomPainter {
  _LegendLine(this.s);
  final LineSeries s;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = s.color
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    if (s.dashed) {
      for (double x = 2; x < size.width - 2; x += 9) {
        canvas.drawLine(Offset(x, size.height / 2), Offset(math.min(x + 5, size.width - 2), size.height / 2), p);
      }
    } else {
      canvas.drawLine(Offset(2, size.height / 2), Offset(size.width - 2, size.height / 2), p);
    }
  }

  @override
  bool shouldRepaint(_LegendLine old) => old.s != s;
}

TextPainter _tp(String text, TextStyle style) => TextPainter(text: TextSpan(text: text, style: style), textDirection: TextDirection.ltr)..layout();

/// Líneas de saldo al cierre por mes, con eje en pesos y marcas de eventos.
class LineChart extends StatelessWidget {
  const LineChart({
    super.key,
    required this.series,
    required this.labels,
    required this.min,
    required this.max,
    required this.ticks,
    this.marks = const [],
    this.height = 300,
    required this.semanticLabel,
  });
  final List<LineSeries> series;
  final List<String> labels;
  final int min;
  final int max;
  final List<int> ticks;
  final List<ChartMark> marks;
  final double height;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) => Semantics(
        label: semanticLabel,
        child: SizedBox(
          height: height,
          width: double.infinity,
          child: CustomPaint(painter: _LinePainter(this)),
        ),
      );
}

class _LinePainter extends CustomPainter {
  _LinePainter(this.c);
  final LineChart c;

  @override
  void paint(Canvas canvas, Size size) {
    const padL = 64.0, padR = 24.0, padT = 36.0, padB = 30.0;
    final cw = size.width - padL - padR, ch = size.height - padT - padB;
    double x(int i) => padL + cw * i / (c.labels.length - 1);
    double y(int v) => padT + ch * (1 - (v - c.min) / (c.max - c.min));

    for (final t in c.ticks) {
      canvas.drawLine(
        Offset(padL, y(t)),
        Offset(size.width - padR, y(t)),
        Paint()
          ..color = t == 0 ? FdmColors.muted : FdmColors.surface
          ..strokeWidth = t == 0 ? 1.5 : 1,
      );
      final tp = _tp(clpShort(t), FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.muted));
      tp.paint(canvas, Offset(padL - 10 - tp.width, y(t) - tp.height / 2));
    }
    for (var i = 0; i < c.labels.length; i++) {
      final tp = _tp(c.labels[i], FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.muted));
      tp.paint(canvas, Offset(x(i) - tp.width / 2, size.height - tp.height));
    }
    final baseline = y(math.max(c.min, 0));
    for (final s in c.series) {
      final path = Path();
      for (var i = 0; i < s.values.length; i++) {
        if (i == 0) {
          path.moveTo(x(i), y(s.values[i]));
        } else {
          path.lineTo(x(i), y(s.values[i]));
        }
      }
      if (s.area) {
        final area = Path.from(path)
          ..lineTo(x(s.values.length - 1), baseline)
          ..lineTo(x(0), baseline)
          ..close();
        canvas.drawPath(area, Paint()..color = FdmColors.accentSoft);
      }
      final stroke = Paint()
        ..color = s.color
        ..strokeWidth = s.width
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      canvas.drawPath(s.dashed ? _dash(path, 7, 6) : path, stroke);
    }
    for (final m in c.marks) {
      final o = Offset(x(m.index), y(m.value));
      canvas.drawCircle(o, 7.5, Paint()..color = FdmColors.bg);
      canvas.drawCircle(o, 5.5, Paint()..color = m.color);
      final tp = _tp(m.label, FdmText.ui(11, weight: FontWeight.w600, color: FdmColors.onInk, height: 1.2));
      final w = tp.width + 16, h = tp.height + 8;
      var bx = m.alignLeft ? o.dx - w - 12 : o.dx + 12;
      bx = bx.clamp(padL, size.width - w);
      final by = (m.below ? o.dy + 14 : o.dy - h - 14).clamp(0.0, size.height - h - padB + 4);
      canvas.drawRRect(RRect.fromLTRBR(bx, by, bx + w, by + h, const Radius.circular(999)), Paint()..color = m.color);
      tp.paint(canvas, Offset(bx + 8, by + 4));
    }
  }

  Path _dash(Path source, double on, double off) {
    final out = Path();
    for (final ui.PathMetric m in source.computeMetrics()) {
      var d = 0.0;
      while (d < m.length) {
        out.addPath(m.extractPath(d, math.min(d + on, m.length)), Offset.zero);
        d += on + off;
      }
    }
    return out;
  }

  @override
  bool shouldRepaint(_LinePainter old) => old.c != c;
}

/// Barras por mes con el monto sobre cada una.
class BarChart extends StatelessWidget {
  const BarChart({super.key, required this.values, required this.labels, required this.colors, required this.max, required this.ticks, this.height = 300, required this.semanticLabel});
  final List<int> values;
  final List<String> labels;
  final List<Color> colors;
  final int max;
  final List<int> ticks;
  final double height;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) => Semantics(
        label: semanticLabel,
        child: SizedBox(height: height, width: double.infinity, child: CustomPaint(painter: _BarPainter(this))),
      );
}

class _BarPainter extends CustomPainter {
  _BarPainter(this.c);
  final BarChart c;
  @override
  void paint(Canvas canvas, Size size) {
    final showAxis = c.ticks.isNotEmpty;
    final padL = showAxis ? 64.0 : 0.0;
    const padT = 26.0, padB = 26.0;
    final cw = size.width - padL, ch = size.height - padT - padB;
    final slot = cw / c.values.length, bw = slot * 0.6;
    double y(int v) => padT + ch * (1 - v / c.max);
    for (final t in c.ticks) {
      canvas.drawLine(Offset(padL, y(t)), Offset(size.width, y(t)), Paint()..color = FdmColors.surface);
      final tp = _tp(clpShort(t), FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.muted));
      tp.paint(canvas, Offset(padL - 10 - tp.width, y(t) - tp.height / 2));
    }
    for (var i = 0; i < c.values.length; i++) {
      final cx = padL + slot * i + slot / 2;
      final r = RRect.fromLTRBR(cx - bw / 2, y(c.values[i]), cx + bw / 2, y(0), const Radius.circular(6));
      canvas.drawRRect(r, Paint()..color = c.colors[i]);
      final v = _tp(clpShort(c.values[i]), FdmText.number(11));
      if (v.width < slot) v.paint(canvas, Offset(cx - v.width / 2, y(c.values[i]) - v.height - 4));
      final l = _tp(c.labels[i], FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.muted));
      l.paint(canvas, Offset(cx - l.width / 2, size.height - l.height));
    }
  }

  @override
  bool shouldRepaint(_BarPainter old) => old.c != c;
}

class DonutSlice {
  const DonutSlice(this.value, this.color);
  final int value;
  final Color color;
}

/// Dona por categoría, con un texto al centro.
class DonutChart extends StatelessWidget {
  const DonutChart({super.key, required this.slices, required this.centerLabel, required this.centerValue, this.size = 220, required this.semanticLabel});
  final List<DonutSlice> slices;
  final String centerLabel;
  final String centerValue;
  final double size;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) => Semantics(
        label: semanticLabel,
        child: SizedBox(
          width: size,
          height: size,
          child: CustomPaint(
            painter: _DonutPainter(slices),
            child: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(centerLabel, style: FdmText.ui(11, weight: FontWeight.w500, color: FdmColors.muted)),
                Text(centerValue, style: FdmText.number(20)),
              ]),
            ),
          ),
        ),
      );
}

class _DonutPainter extends CustomPainter {
  _DonutPainter(this.slices);
  final List<DonutSlice> slices;
  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 34.0, gap = 0.025;
    final total = slices.fold<int>(0, (a, s) => a + s.value);
    final rect = Rect.fromCircle(center: size.center(Offset.zero), radius: size.width / 2 - stroke / 2);
    var start = -math.pi / 2;
    for (final s in slices) {
      final sweep = 2 * math.pi * s.value / total;
      canvas.drawArc(
        rect,
        start + gap / 2,
        sweep - gap,
        false,
        Paint()
          ..color = s.color
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.slices != slices;
}

/// Barra horizontal partida en dos (por ejemplo, el aporte de cada miembro).
class SplitBar extends StatelessWidget {
  const SplitBar({super.key, required this.a, required this.b, this.height = 36});
  final int a;
  final int b;
  final double height;
  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
        child: Row(children: [
          Expanded(flex: a, child: Container(decoration: BoxDecoration(color: FdmColors.ink, borderRadius: BorderRadius.circular(10)))),
          const SizedBox(width: 6),
          Expanded(flex: b, child: Container(decoration: BoxDecoration(color: FdmColors.accent, borderRadius: BorderRadius.circular(10)))),
        ]),
      );
}

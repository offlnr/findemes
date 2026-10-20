import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../theme/tokens.dart';
import 'fdm_icon.dart';

/// Tarjeta blanca sin borde, esquinas de 20 y sombra suave.
class FdmCard extends StatelessWidget {
  const FdmCard({super.key, this.title, this.trailing, required this.children, this.padding = 28, this.gap = 18, this.color = FdmColors.bg});
  final String? title;
  final Widget? trailing;
  final List<Widget> children;
  final double padding;
  final double gap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final header = title == null
        ? null
        : Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: Text(title!, style: FdmText.serif(24))),
              ?trailing,
            ],
          );
    return Container(
      padding: EdgeInsets.all(padding),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(FdmRadius.card),
        boxShadow: color == FdmColors.bg ? fdmShadow : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _gapped([?header, ...children], gap),
      ),
    );
  }
}

List<Widget> _gapped(List<Widget> items, double gap) => [
      for (var i = 0; i < items.length; i++) ...[if (i > 0) SizedBox(height: gap), items[i]],
    ];

/// Columna con separación uniforme.
class Gap extends StatelessWidget {
  const Gap(this.children, {super.key, this.gap = 28});
  final List<Widget> children;
  final double gap;
  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: _gapped(children, gap));
}

/// Fila que se apila en columna en pantallas angostas.
class ResponsiveRow extends StatelessWidget {
  const ResponsiveRow({super.key, required this.children, this.breakpoint = 860, this.gap = 24, this.flex});
  final List<Widget> children;
  final double breakpoint;
  final double gap;
  final List<int>? flex;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < breakpoint) return Gap(children, gap: gap);
        // Sin IntrinsicHeight: los hijos usan LayoutBuilder (tablas y gráficos).
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0) SizedBox(width: gap),
              Expanded(flex: flex?[i] ?? 1, child: children[i]),
            ],
          ],
        );
      });
}

class KpiCard extends StatelessWidget {
  const KpiCard(this.indicator, {super.key});
  final Indicator indicator;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(color: FdmColors.bg, borderRadius: BorderRadius.circular(FdmRadius.card), boxShadow: fdmShadow),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(indicator.label, style: FdmText.ui(13, weight: FontWeight.w500, color: FdmColors.muted)),
            const SizedBox(height: 6),
            Text(indicator.value, style: FdmText.number(34)),
            const SizedBox(height: 4),
            Text(indicator.detail, style: FdmText.ui(12, color: FdmColors.muted)),
            const SizedBox(height: 10),
            const Divider(height: 1, color: FdmColors.surface),
            const SizedBox(height: 10),
            Text(indicator.explanation, style: FdmText.ui(12, color: FdmColors.muted, height: 1.4)),
          ],
        ),
      );
}

/// Rótulo en píldora, por ejemplo el origen de un dato.
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.color = FdmColors.accentSoft, this.textColor = FdmColors.ink});
  final String text;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
        child: Text(text, style: FdmText.ui(11, weight: FontWeight.w600, color: textColor, height: 1.2)),
      );
}

/// Todo dato que no es real se rotula (CLAUDE.md, decisión del banco de demostración).
class OriginPill extends StatelessWidget {
  const OriginPill(this.origin, {super.key});
  final DataOrigin origin;
  @override
  Widget build(BuildContext context) => switch (origin) {
        DataOrigin.providerTest => const Pill('Prueba Fintoc'),
        DataOrigin.demo => const Pill('Demostración'),
        DataOrigin.real => const Pill('Banco'),
        DataOrigin.manual => const SizedBox.shrink(),
      };
}

class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.action});
  final String text;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        decoration: BoxDecoration(color: FdmColors.accentSoft, borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          Expanded(child: Text(text, style: FdmText.ui(13))),
          ?action,
        ]),
      );
}

class Muted extends StatelessWidget {
  const Muted(this.text, {super.key, this.size = 13});
  final String text;
  final double size;
  @override
  Widget build(BuildContext context) => Text(text, style: FdmText.ui(size, color: FdmColors.muted));
}

class Bullets extends StatelessWidget {
  const Bullets(this.items, {super.key});
  final List<String> items;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final s in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Padding(padding: const EdgeInsets.only(top: 8, right: 10), child: Container(width: 5, height: 5, decoration: const BoxDecoration(color: FdmColors.ink, shape: BoxShape.circle))),
                Expanded(child: Text(s, style: FdmText.ui(14))),
              ]),
            ),
        ],
      );
}

class Cell {
  const Cell(this.text, {this.sub, this.number = false, this.strong = false, this.widget});
  const Cell.w(Widget this.widget) : text = '', sub = null, number = false, strong = false;
  final String text;
  final String? sub;
  final bool number;
  final bool strong;
  final Widget? widget;
}

class Col {
  const Col(this.label, {this.flex = 1, this.width});
  final String label;
  final int flex;
  final double? width;
}

/// Tabla simple: encabezado verde suave y filas con línea inferior.
class FdmTable extends StatelessWidget {
  const FdmTable({super.key, required this.columns, required this.rows, this.minWidth = 0});
  final List<Col> columns;
  final List<List<Cell>> rows;
  final double minWidth;

  Widget _wrap(Col c, Widget child) => c.width != null ? SizedBox(width: c.width, child: child) : Expanded(flex: c.flex, child: child);

  Widget _cell(Cell c) {
    if (c.widget != null) return Align(alignment: Alignment.centerLeft, child: c.widget);
    final main = Text(c.text, style: c.number ? FdmText.number(14, weight: c.strong ? FontWeight.w700 : FontWeight.w500) : FdmText.ui(13, weight: c.strong ? FontWeight.w600 : FontWeight.w400));
    if (c.sub == null) return main;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [main, const SizedBox(height: 2), Text(c.sub!, style: FdmText.ui(11, color: FdmColors.muted, height: 1.3))]);
  }

  @override
  Widget build(BuildContext context) {
    final table = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(color: FdmColors.surface, borderRadius: BorderRadius.circular(FdmRadius.small)),
          child: Row(children: [
            for (final c in columns)
              _wrap(c, Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Text(c.label, style: FdmText.ui(12, weight: FontWeight.w600, color: FdmColors.muted)))),
          ]),
        ),
        for (final r in rows)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: FdmColors.surface))),
            child: Row(children: [
              for (var i = 0; i < columns.length; i++)
                _wrap(columns[i], Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: i < r.length ? _cell(r[i]) : const SizedBox.shrink())),
            ]),
          ),
      ],
    );
    if (minWidth == 0) return table;
    return LayoutBuilder(builder: (context, c) {
      if (c.maxWidth >= minWidth) return table;
      return SingleChildScrollView(scrollDirection: Axis.horizontal, child: SizedBox(width: minWidth, child: table));
    });
  }
}

/// Encabezado de pantalla: baldosa con ícono, título en serif y bajada.
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.icon, required this.title, required this.subtitle, this.actions = const []});
  final FdmIcons icon;
  final String title;
  final String subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 700;
    final head = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(color: FdmColors.ink, borderRadius: BorderRadius.circular(16)),
          alignment: Alignment.center,
          child: FdmIcon(icon, size: 30, color: FdmColors.accent),
        ),
        const SizedBox(width: 20),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: FdmText.serif(narrow ? 34 : 46)),
            const SizedBox(height: 6),
            Text(subtitle, style: FdmText.ui(16, color: FdmColors.muted)),
          ]),
        ),
      ],
    );
    final tile = head;
    if (actions.isEmpty) return tile;
    if (narrow) return Gap([tile, Wrap(spacing: 12, runSpacing: 12, children: actions)], gap: 16);
    return Row(children: [Expanded(child: tile), const SizedBox(width: 16), Wrap(spacing: 12, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: actions)]);
  }
}

/// Estructura de cada pantalla de la app: desplazamiento, márgenes y ancho máximo.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final pad = w < 700 ? 16.0 : 56.0;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(pad, w < 700 ? 24 : 48, pad, 48),
      child: Center(
        child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 1200), child: Gap(children)),
      ),
    );
  }
}

/// Muestra carga, error o datos de un [AsyncValue].
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody(this.value, {super.key, required this.builder});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;

  @override
  Widget build(BuildContext context) => value.when(
        data: builder,
        loading: () => const Center(child: Padding(padding: EdgeInsets.all(48), child: CircularProgressIndicator(color: FdmColors.ink))),
        error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(48), child: Text('No pudimos cargar esta información. $e', style: FdmText.ui(14)))),
      );
}

/// Casillas de cuotas: llenas las pagadas.
class InstallmentDots extends StatelessWidget {
  const InstallmentDots({super.key, required this.paid, required this.total, this.size = 16});
  final int paid;
  final int total;
  final double size;
  @override
  Widget build(BuildContext context) => Semantics(
        label: '$paid de $total cuotas pagadas',
        child: Wrap(spacing: 5, runSpacing: 5, children: [
          for (var i = 0; i < total; i++)
            Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                color: i < paid ? FdmColors.ink : null,
                border: Border.all(color: FdmColors.ink, width: 2),
                borderRadius: BorderRadius.circular(5),
              ),
            ),
        ]),
      );
}

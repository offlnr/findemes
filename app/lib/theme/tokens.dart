import 'package:flutter/painting.dart';

/// Paleta "bosque" de la landing (landing/src/components/PalettePicker.astro).
abstract final class FdmColors {
  static const bg = Color(0xFFFFFFFF);
  static const canvas = Color(0xFFF6F8F5);
  static const surface = Color(0xFFE7EEE8);
  static const border = Color(0xFFC3D3C7);
  static const text = Color(0xFF1D4634);
  static const muted = Color(0xFF456B59);
  static const ink = Color(0xFF1D4634);
  static const onInk = Color(0xFFF6F8F5);
  static const accent = Color(0xFFA9D4B8);
  static const accentSoft = Color(0xFFDCEFE3);
}

abstract final class FdmRadius {
  static const card = 20.0;
  static const tile = 16.0;
  static const field = 12.0;
  static const small = 10.0;
}

const fdmShadow = [
  BoxShadow(color: Color(0x0D1C4533), offset: Offset(0, 1), blurRadius: 2),
  BoxShadow(color: Color(0x121C4533), offset: Offset(0, 8), blurRadius: 24, spreadRadius: -4),
];

/// Tipografía: Newsreader para títulos, Inter para la interfaz y Space Grotesk para cifras.
/// Las tres fuentes son variables; el peso se fija también con `fontVariations`.
abstract final class FdmText {
  static List<FontVariation> _wght(FontWeight w) => [FontVariation('wght', w.value.toDouble())];

  static TextStyle serif(double size, {Color color = FdmColors.text}) => TextStyle(
        fontFamily: 'Newsreader',
        fontSize: size,
        fontWeight: FontWeight.w500,
        fontVariations: _wght(FontWeight.w500),
        letterSpacing: -0.02 * size,
        height: 1.1,
        color: color,
      );

  static TextStyle ui(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = FdmColors.text,
    double height = 1.45,
  }) =>
      TextStyle(
        fontFamily: 'Inter',
        fontSize: size,
        fontWeight: weight,
        fontVariations: _wght(weight),
        height: height,
        color: color,
      );

  static TextStyle number(double size, {FontWeight weight = FontWeight.w500, Color color = FdmColors.text}) =>
      TextStyle(
        fontFamily: 'SpaceGrotesk',
        fontSize: size,
        fontWeight: weight,
        fontVariations: _wght(weight),
        letterSpacing: -0.02 * size,
        height: 1.15,
        color: color,
        fontFeatures: const [FontFeature.tabularFigures()],
      );
}

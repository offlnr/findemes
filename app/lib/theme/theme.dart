import 'package:flutter/material.dart';

import 'tokens.dart';

ThemeData buildTheme() {
  const pill = StadiumBorder();
  final buttonText = FdmText.ui(14, weight: FontWeight.w600, height: 1);
  const buttonPadding = EdgeInsets.symmetric(horizontal: 22, vertical: 16);

  OutlineInputBorder fieldBorder(Color color, [double width = 1.5]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(FdmRadius.field),
        borderSide: BorderSide(color: color, width: width),
      );

  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Inter',
    scaffoldBackgroundColor: FdmColors.canvas,
    colorScheme: ColorScheme.fromSeed(
      seedColor: FdmColors.ink,
      primary: FdmColors.ink,
      onPrimary: FdmColors.onInk,
      secondary: FdmColors.accent,
      surface: FdmColors.bg,
      onSurface: FdmColors.text,
    ),
    dividerColor: FdmColors.surface,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: FdmColors.ink,
        foregroundColor: FdmColors.onInk,
        shape: pill,
        padding: buttonPadding,
        textStyle: buttonText,
        minimumSize: const Size(48, 48),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: FdmColors.ink,
        side: const BorderSide(color: FdmColors.ink, width: 1.5),
        shape: pill,
        padding: buttonPadding,
        textStyle: buttonText,
        minimumSize: const Size(48, 48),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: FdmColors.ink,
        textStyle: buttonText.copyWith(decoration: TextDecoration.underline),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 14),
        minimumSize: const Size(48, 48),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: FdmColors.bg,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: FdmText.ui(14, color: FdmColors.muted),
      border: fieldBorder(FdmColors.border),
      enabledBorder: fieldBorder(FdmColors.border),
      focusedBorder: fieldBorder(FdmColors.ink, 2),
    ),
    chipTheme: ChipThemeData(
      shape: pill,
      side: const BorderSide(color: FdmColors.ink, width: 1.5),
      selectedColor: FdmColors.ink,
      backgroundColor: FdmColors.bg,
      labelStyle: FdmText.ui(13, weight: FontWeight.w600),
      secondaryLabelStyle: FdmText.ui(13, weight: FontWeight.w600, color: FdmColors.onInk),
      checkmarkColor: FdmColors.onInk,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: FdmColors.ink,
      contentTextStyle: FdmText.ui(14, color: FdmColors.onInk),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

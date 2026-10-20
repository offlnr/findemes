import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/tokens.dart';

/// Íconos de trazo de la landing (landing/src/components/IconSprite.astro).
enum FdmIcons {
  steps('<path d="M3.5 19.5h5v-5h5v-5h5v-5"/><path d="M3.5 19.5h17"/>'),
  receipt('<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'),
  bank('<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8"/><path d="M3 20h18"/>'),
  chart('<path d="M4 20h16"/><path d="M6.5 16v-2M10.5 16v-5M14.5 16v-7M18.5 16V5"/>'),
  copy('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>'),
  columns('<rect x="3" y="5" width="5" height="14" rx="1.5"/><rect x="9.5" y="5" width="5" height="14" rx="1.5"/><rect x="16" y="5" width="5" height="14" rx="1.5"/>'),
  home('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  tag('<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>'),
  lock('<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>'),
  check('<path d="M4 6.5 5.6 8 8.5 5M4 12.5 5.6 14 8.5 11M4 18.5 5.6 20l2.9-3"/><path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20"/>'),
  split('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>'),
  eyeOff('<path d="M3 12s3.5-6 9-6c1.9 0 3.6.7 5 1.7M21 12s-3.5 6-9 6c-1.9 0-3.6-.7-5-1.7"/><path d="M9.8 14.2a3 3 0 0 1 4.4-4.4"/><path d="M4 20 20 4"/>'),
  menu('<path d="M4 7h16M4 12h16M4 17h16"/>');

  const FdmIcons(this.body);
  final String body;

  String get svg =>
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">$body</svg>';
}

class FdmIcon extends StatelessWidget {
  const FdmIcon(this.icon, {super.key, this.size = 20, this.color = FdmColors.ink});
  final FdmIcons icon;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: SvgPicture.string(icon.svg, width: size, height: size, theme: SvgTheme(currentColor: color)),
      );
}

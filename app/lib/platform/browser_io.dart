import 'package:flutter/services.dart';

/// El widget de Fintoc se abre en la web. En la app móvil se usará su WebView; mientras tanto
/// se informa que la conexión se hace desde la web.
const fintocWidgetSupported = false;

Future<String?> openFintocWidget({required String widgetToken, required String publicKey}) async =>
    throw UnsupportedError('La conexión con Fintoc está disponible en la versión web.');

/// En móvil, el contenido se copia al portapapeles.
Future<String> saveTextFile(String fileName, String content) async {
  await Clipboard.setData(ClipboardData(text: content));
  return 'Copiamos tus datos al portapapeles.';
}

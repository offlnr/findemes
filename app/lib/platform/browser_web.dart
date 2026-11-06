import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

const fintocWidgetSupported = true;

@JS('Fintoc')
external _FintocSdk? get _fintoc;

extension type _FintocSdk._(JSObject _) implements JSObject {
  external _FintocWidget create(_FintocOptions options);
}

extension type _FintocWidget._(JSObject _) implements JSObject {
  external void open();
}

extension type _FintocOptions._(JSObject _) implements JSObject {
  external factory _FintocOptions({
    String publicKey,
    String widgetToken,
    String holderType,
    String product,
    String country,
    JSFunction onSuccess,
    JSFunction onExit,
  });
}

extension type _LinkIntent._(JSObject _) implements JSObject {
  external String? get exchangeToken;
}

/// Abre el widget de Fintoc (https://js.fintoc.com/v1/, cargado en web/index.html). La clave del
/// banco se escribe allí y nunca llega a la app. Devuelve el exchange token, o null si el usuario
/// cierra el widget.
Future<String?> openFintocWidget({required String widgetToken, required String publicKey}) {
  final sdk = _fintoc;
  if (sdk == null) throw StateError('No se pudo cargar el widget de Fintoc.');
  final result = Completer<String?>();
  sdk
      .create(_FintocOptions(
        publicKey: publicKey,
        widgetToken: widgetToken,
        holderType: 'individual',
        product: 'movements',
        country: 'cl',
        onSuccess: ((JSObject intent) {
          if (!result.isCompleted) result.complete((intent as _LinkIntent).exchangeToken);
        }).toJS,
        onExit: (() {
          if (!result.isCompleted) result.complete(null);
        }).toJS,
      ))
      .open();
  return result.future;
}

/// Descarga un archivo de texto generado en memoria (exportación de datos, HU21).
Future<String> saveTextFile(String fileName, String content) async {
  final blob = web.Blob([content.toJS].toJS, web.BlobPropertyBag(type: 'application/json'));
  final url = web.URL.createObjectURL(blob);
  final anchor = web.HTMLAnchorElement()
    ..href = url
    ..download = fileName;
  anchor.click();
  web.URL.revokeObjectURL(url);
  return 'Descargamos $fileName.';
}

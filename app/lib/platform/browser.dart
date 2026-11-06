// Integraciones del navegador: widget de Fintoc y descarga de archivos. En la web usan el SDK
// de Fintoc y Blob; en Android e iOS, alternativas nativas o un aviso.
export 'browser_io.dart' if (dart.library.js_interop) 'browser_web.dart';

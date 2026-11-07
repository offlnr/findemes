// Cliente HTTP de la API. En la web envía las cookies HttpOnly de la sesión (refresh token y
// dispositivo) con `withCredentials`; en Android e iOS usa el cliente estándar.
export 'api_http_client_io.dart' if (dart.library.js_interop) 'api_http_client_web.dart';

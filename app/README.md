# Fin de Mes · app (Flutter)

Una sola base de código para web, Android e iOS (ADR-001). Estado con Riverpod, rutas con
go_router (rutas con hash, las mismas que enlaza la landing: `#/registro?plan=familiar`, `#/demo`).

## Datos
La app no calcula nada (CLAUDE.md, regla 8). Lee todo a través de `FinanceRepository`
(`lib/data/finance_repository.dart`). Mientras la API no expone los endpoints, usa
`DemoFinanceRepository`: datos de ejemplo ya calculados (los mismos del wireframe en Figma) y
rotulados como demostración. Cuando exista el cliente generado desde `docs/openapi.yaml`, se
reemplaza el proveedor `financeRepositoryProvider`.

El modo demostración (`#/demo`, HU27-HU28) ya usa la API real (`lib/data/demo_api.dart`):
`GET /v1/demo/examples` y `POST /v1/demo/projection`. La URL se fija al compilar con
`--dart-define=API_BASE_URL=...` (por defecto `http://localhost:3000`); la API debe incluir el
origen de la app en `CORS_ORIGINS`.

## Comandos
```
flutter pub get
flutter run -d chrome          # o: flutter run -d web-server --web-port 8080
flutter test
flutter analyze
flutter build web
```

Las carpetas `android/` e `ios/` se generan con `flutter create --platforms android,ios .`.

## Fuentes
Inter, Newsreader y Space Grotesk (SIL Open Font License, ver `assets/fonts/OFL-*.txt`),
incluidas en la app para no depender de servidores externos.

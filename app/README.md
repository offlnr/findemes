# Fin de Mes · app (Flutter)

Una sola base de código para web, Android e iOS (ADR-001). Estado con Riverpod, rutas con
go_router (rutas con hash, las mismas que enlaza la landing: `#/registro?plan=familiar`, `#/demo`).

## Datos
La app no calcula nada (CLAUDE.md, regla 8). Lee todo a través de `FinanceRepository`
(`lib/data/finance_repository.dart`). Mientras la API no expone los endpoints, usa
`DemoFinanceRepository`: datos de ejemplo ya calculados (los mismos del wireframe en Figma) y
rotulados como demostración. Cuando exista el cliente generado desde `docs/openapi.yaml`, se
reemplaza el proveedor `financeRepositoryProvider`.

## Comandos
```
flutter pub get
flutter run -d chrome          # o: flutter run -d web-server
flutter test
flutter analyze
flutter build web
```

Las carpetas `android/` e `ios/` se generan con `flutter create --platforms android,ios .`.

## Fuentes
Inter, Newsreader y Space Grotesk (SIL Open Font License, ver `assets/fonts/OFL-*.txt`),
incluidas en la app para no depender de servidores externos.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'demo_finance_repository.dart';
import 'models.dart';

/// Puerto de lectura de la app. La implementación real usará el cliente generado desde
/// `docs/openapi.yaml` (ADR-001); mientras la API no expone estos endpoints se usa
/// [DemoFinanceRepository], con datos de ejemplo ya calculados y rotulados como demostración.
abstract interface class FinanceRepository {
  Future<Session> session();
  Future<Summary> summary();
  Future<Registry> registry();
  Future<BankData> banks();
  Future<List<ProjectionMonth>> projection();
  Future<List<ScenarioSummary>> scenarios();
  Future<ScenarioDetail> scenario(String id);
  Future<Comparison> compare(List<String> scenarioIds);
  Future<Household> household();
  Future<Subscription> subscription();
  Future<List<DeviceSession>> deviceSessions();
  Future<List<DemoProfile>> demoProfiles();
}

final financeRepositoryProvider = Provider<FinanceRepository>((ref) => const DemoFinanceRepository());

final sessionProvider = FutureProvider<Session>((ref) => ref.watch(financeRepositoryProvider).session());
final summaryProvider = FutureProvider<Summary>((ref) => ref.watch(financeRepositoryProvider).summary());
final registryProvider = FutureProvider<Registry>((ref) => ref.watch(financeRepositoryProvider).registry());
final banksProvider = FutureProvider<BankData>((ref) => ref.watch(financeRepositoryProvider).banks());
final projectionProvider = FutureProvider<List<ProjectionMonth>>((ref) => ref.watch(financeRepositoryProvider).projection());
final scenariosProvider = FutureProvider<List<ScenarioSummary>>((ref) => ref.watch(financeRepositoryProvider).scenarios());
final scenarioProvider = FutureProvider.family<ScenarioDetail, String>((ref, id) => ref.watch(financeRepositoryProvider).scenario(id));
final compareProvider = FutureProvider.family<Comparison, String>(
  (ref, ids) => ref.watch(financeRepositoryProvider).compare(ids.split(',')),
);
final householdProvider = FutureProvider<Household>((ref) => ref.watch(financeRepositoryProvider).household());
final subscriptionProvider = FutureProvider<Subscription>((ref) => ref.watch(financeRepositoryProvider).subscription());
final deviceSessionsProvider = FutureProvider<List<DeviceSession>>((ref) => ref.watch(financeRepositoryProvider).deviceSessions());
final demoProfilesProvider = FutureProvider<List<DemoProfile>>((ref) => ref.watch(financeRepositoryProvider).demoProfiles());

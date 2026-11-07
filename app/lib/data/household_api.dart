import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'registry_api.dart';

/// Hogar (HU12-HU16, HU31) desde la API. Solo datos del espacio común: nombres, roles y gastos
/// comunes con el aporte de cada quien. Lo individual de cada integrante nunca llega aquí.
final householdApiProvider = Provider<HouseholdApi>((ref) => HouseholdApi(ref.watch(apiClientProvider)));
/// Invitación abierta sin sesión (HU31): se acepta desde Hogar después de entrar o registrarse.
final pendingInvitationProvider = NotifierProvider<PendingInvitation, String?>(PendingInvitation.new);

class PendingInvitation extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? token) => state = token;
}

final householdDataProvider = FutureProvider.autoDispose<HouseholdData?>((ref) => ref.watch(householdApiProvider).household());

class HouseholdMemberData {
  const HouseholdMemberData({required this.userId, required this.displayName, required this.role, required this.isMe});
  final String userId;
  final String displayName;
  final String role;
  final bool isMe;
  bool get isAdmin => role == 'admin';
}

/// Regla de aporte (HU14). Porcentajes en puntos base (10000 = 100 %).
sealed class ContributionRule {
  const ContributionRule();
  factory ContributionRule.fromJson(Map<String, dynamic> json) => switch (json['mode']) {
        'assigned' => AssignedRule(json['userId'] as String),
        'percentage' => PercentageRule({
            for (final s in json['shares'] as List<dynamic>) (s as Map<String, dynamic>)['userId'] as String: s['basisPoints'] as int,
          }),
        _ => const EqualRule(),
      };
  Map<String, Object?> toJson();
}

class EqualRule extends ContributionRule {
  const EqualRule();
  @override
  Map<String, Object?> toJson() => {'mode': 'equal'};
}

class AssignedRule extends ContributionRule {
  const AssignedRule(this.userId);
  final String userId;
  @override
  Map<String, Object?> toJson() => {'mode': 'assigned', 'userId': userId};
}

class PercentageRule extends ContributionRule {
  const PercentageRule(this.basisPoints);
  final Map<String, int> basisPoints;
  @override
  Map<String, Object?> toJson() => {
        'mode': 'percentage',
        'shares': [for (final e in basisPoints.entries) {'userId': e.key, 'basisPoints': e.value}],
      };
}

class SharedExpenseData {
  const SharedExpenseData({
    required this.id,
    required this.label,
    required this.amount,
    required this.schedule,
    required this.rule,
    required this.createdByName,
    required this.canEdit,
    required this.myShare,
    required this.shares,
  });
  final String id;
  final String label;
  final int amount;
  final Schedule schedule;
  final ContributionRule rule;
  final String createdByName;
  final bool canEdit;
  final int myShare;

  /// Parte de cada integrante, calculada por el servidor.
  final Map<String, int> shares;
}

class HouseholdData {
  const HouseholdData({
    required this.id,
    required this.name,
    required this.myRole,
    required this.readOnly,
    required this.members,
    required this.expenses,
    required this.myMonthlyContribution,
    required this.monthlyTotal,
    required this.memberMonthlyTotals,
  });
  factory HouseholdData.fromJson(Map<String, dynamic> json) => HouseholdData(
        id: json['id'] as String,
        name: json['name'] as String,
        myRole: json['myRole'] as String,
        readOnly: json['readOnly'] as bool,
        myMonthlyContribution: json['myMonthlyContribution'] as int,
        monthlyTotal: json['monthlyTotal'] as int,
        memberMonthlyTotals: {
          for (final t in json['memberMonthlyTotals'] as List<dynamic>) (t as Map<String, dynamic>)['userId'] as String: t['amount'] as int,
        },
        members: [
          for (final m in json['members'] as List<dynamic>)
            HouseholdMemberData(
              userId: (m as Map<String, dynamic>)['userId'] as String,
              displayName: m['displayName'] as String,
              role: m['role'] as String,
              isMe: m['isMe'] as bool,
            ),
        ],
        expenses: [
          for (final e in json['expenses'] as List<dynamic>)
            SharedExpenseData(
              id: (e as Map<String, dynamic>)['id'] as String,
              label: e['label'] as String,
              amount: e['amount'] as int,
              schedule: Schedule.fromJson(e['schedule'] as Map<String, dynamic>),
              rule: ContributionRule.fromJson(e['rule'] as Map<String, dynamic>),
              createdByName: e['createdByName'] as String,
              canEdit: e['canEdit'] as bool,
              myShare: e['myShare'] as int,
              shares: {for (final s in e['shares'] as List<dynamic>) (s as Map<String, dynamic>)['userId'] as String: s['amount'] as int},
            ),
        ],
      );
  final String id;
  final String name;
  final String myRole;
  final bool readOnly;
  final List<HouseholdMemberData> members;
  final List<SharedExpenseData> expenses;
  final int myMonthlyContribution;

  /// Suma de los gastos comunes mensuales y aporte mensual de cada integrante, del servidor.
  final int monthlyTotal;
  final Map<String, int> memberMonthlyTotals;
  bool get isAdmin => myRole == 'admin';
  String nameOf(String userId) => members.where((m) => m.userId == userId).map((m) => m.displayName).firstOrNull ?? 'Ex integrante';
}

class InvitationPreview {
  const InvitationPreview({required this.householdName, required this.memberCount, required this.visibleToMembers, required this.private});
  final String householdName;
  final int memberCount;
  final List<String> visibleToMembers;
  final List<String> private;
}

class HouseholdApi {
  HouseholdApi(this._api);
  final ApiClient _api;

  Future<HouseholdData?> household() async {
    final json = await _api.send('GET', '/v1/household') as Map<String, dynamic>;
    final household = json['household'] as Map<String, dynamic>?;
    return household == null ? null : HouseholdData.fromJson(household);
  }

  Future<void> create(String name, String displayName) => _api.send('POST', '/v1/household', {'name': name, 'displayName': displayName});

  /// Enlace de un solo uso, vigente 7 días.
  Future<String> invite() async => ((await _api.send('POST', '/v1/household/invitations')) as Map<String, dynamic>)['url'] as String;

  Future<InvitationPreview> preview(String token) async {
    final json = await _api.sendPublic('POST', '/v1/household/invitations/preview', {'token': token}) as Map<String, dynamic>;
    return InvitationPreview(
      householdName: json['householdName'] as String,
      memberCount: json['memberCount'] as int,
      visibleToMembers: [for (final s in json['visibleToMembers'] as List<dynamic>) s as String],
      private: [for (final s in json['private'] as List<dynamic>) s as String],
    );
  }

  Future<void> accept(String token, String displayName) => _api.send('POST', '/v1/household/invitations/accept', {'token': token, 'displayName': displayName});

  Future<void> removeMember(String userId) => _api.send('DELETE', '/v1/household/members/$userId');

  Future<void> saveExpense({String? id, required String label, required int amount, required Schedule schedule, ContributionRule? rule}) => _api.send(
        id == null ? 'POST' : 'PUT',
        id == null ? '/v1/household/expenses' : '/v1/household/expenses/$id',
        {'label': label, 'amount': amount, 'schedule': schedule.toJson(), if (rule != null) 'rule': rule.toJson()},
      );

  Future<void> deleteExpense(String id) => _api.send('DELETE', '/v1/household/expenses/$id');
}

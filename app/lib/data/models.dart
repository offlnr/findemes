/// Modelos de lectura que la app recibe de la API. Todo valor llega calculado por el
/// servidor: la app no proyecta ni compara (CLAUDE.md, regla 8).
library;

/// Origen de un dato agregado. Lo que no es `real` se rotula en pantalla.
enum DataOrigin { manual, real, providerTest, demo }

class Session {
  const Session({required this.name, required this.initials, required this.planLabel});
  final String name;
  final String initials;
  final String planLabel;
}

class Indicator {
  const Indicator({required this.label, required this.value, required this.detail, required this.explanation});
  final String label;
  final String value;
  final String detail;
  final String explanation;
}

class ProjectionMonth {
  const ProjectionMonth({
    required this.label,
    required this.short,
    required this.opening,
    required this.income,
    required this.expenses,
    required this.household,
    required this.debt,
    required this.margin,
    required this.closing,
  });
  final String label;
  final String short;
  final int opening;
  final int income;
  final int expenses;
  final int household;
  final int debt;
  final int margin;
  final int closing;
}

class Debt {
  const Debt({
    required this.name,
    required this.installment,
    required this.paid,
    required this.total,
    required this.remaining,
    required this.pendingAmount,
    required this.lastMonth,
    this.origin = DataOrigin.manual,
  });
  final String name;
  final int installment;
  final int paid;
  final int total;
  final int remaining;
  final int pendingAmount;
  final String lastMonth;
  final DataOrigin origin;
}

class DebtHealth {
  const DebtHealth({
    required this.duePaid,
    required this.due,
    required this.debt,
    required this.pendingAmount,
    required this.freeFrom,
  });
  final int duePaid;
  final int due;
  final Debt debt;
  final int pendingAmount;
  final String freeFrom;
}

class Share {
  const Share(this.name, this.amount);
  final String name;
  final int amount;
}

class Summary {
  const Summary({
    required this.asOf,
    required this.finalLabel,
    required this.finalClosing,
    required this.heroSentence,
    required this.indicators,
    required this.months,
    required this.explanation,
    required this.debts,
    required this.debtHealth,
    required this.householdShares,
  });
  final String asOf;
  final String finalLabel;
  final int finalClosing;
  final String heroSentence;
  final List<Indicator> indicators;
  final List<ProjectionMonth> months;
  final List<String> explanation;
  final List<Debt> debts;
  final DebtHealth debtHealth;
  final List<Share> householdShares;
}

class Entry {
  const Entry({required this.name, required this.kind, required this.amount, this.origin = DataOrigin.manual});
  final String name;
  final String kind;
  final int amount;
  final DataOrigin origin;
}

class Registry {
  const Registry({
    required this.openingLabel,
    required this.opening,
    required this.openingOrigin,
    required this.incomes,
    required this.expenses,
    required this.debts,
  });
  final String openingLabel;
  final int opening;
  final DataOrigin openingOrigin;
  final List<Entry> incomes;
  final List<Entry> expenses;
  final List<Debt> debts;
}

class BankAccount {
  const BankAccount({required this.bank, required this.type, required this.number, required this.available, required this.origin});
  final String bank;
  final String type;
  final String number;
  final int available;
  final DataOrigin origin;
}

class Movement {
  const Movement({required this.date, required this.description, required this.amount, required this.inRegistry, required this.origin});
  final String date;
  final String description;
  final int amount;
  final bool inRegistry;
  final DataOrigin origin;
}

class MonthTotals {
  const MonthTotals(this.month, this.credits, this.debits);
  final String month;
  final int credits;
  final int debits;
}

class BankData {
  const BankData({required this.accounts, required this.totals, required this.movements});
  final List<BankAccount> accounts;
  final List<MonthTotals> totals;
  final List<Movement> movements;
}

class ScenarioSummary {
  const ScenarioSummary({required this.id, required this.name, required this.decisionCount, required this.minBalance});
  final String id;
  final String name;
  final int decisionCount;
  final int minBalance;
}

class IndicatorComparison {
  const IndicatorComparison({required this.label, required this.explanation, required this.values});
  final String label;
  final String explanation;

  /// Un valor por columna, en el orden de las columnas de la tabla.
  final List<String> values;
}

class ScenarioDetail {
  const ScenarioDetail({
    required this.id,
    required this.name,
    required this.decisions,
    required this.indicators,
    required this.closings,
    required this.baseClosings,
    required this.minIndex,
    required this.explanation,
  });
  final String id;
  final String name;
  final List<String> decisions;
  final List<IndicatorComparison> indicators;
  final List<int> closings;
  final List<int> baseClosings;
  final int minIndex;
  final List<String> explanation;
}

class Comparison {
  const Comparison({required this.columns, required this.rows, required this.series, required this.breakMarks});
  final List<String> columns;
  final List<IndicatorComparison> rows;

  /// Saldo al cierre por mes de cada columna (la primera es la base).
  final List<List<int>> series;

  /// Índice del mes de quiebre por columna, o null si no ocurre.
  final List<int?> breakMarks;
}

class HouseholdMember {
  const HouseholdMember(this.name, this.role, {this.me = false, this.pending = false});
  final String name;
  final String role;
  final bool me;
  final bool pending;
}

class CommonExpense {
  const CommonExpense({required this.name, required this.amount, required this.rule, required this.parts, required this.author});
  final String name;
  final int amount;
  final String rule;
  final List<int> parts;
  final String author;
}

class Household {
  const Household({
    required this.name,
    required this.monthLabel,
    required this.members,
    required this.memberNames,
    required this.expenses,
    required this.contributions,
    required this.history,
    required this.myContribution,
    required this.total,
  });
  final String name;
  final String monthLabel;
  final List<HouseholdMember> members;
  final List<String> memberNames;
  final List<CommonExpense> expenses;
  final List<Share> contributions;
  final List<Share> history;
  final int myContribution;
  final int total;
}

class PlanOffer {
  const PlanOffer({required this.id, required this.name, required this.description, required this.price, required this.period});
  final String id;
  final String name;
  final String description;
  final String price;
  final String period;
}

class Subscription {
  const Subscription({required this.currentPlanId, required this.planName, required this.state, required this.period, required this.offers});
  final String currentPlanId;
  final String planName;
  final String state;
  final String period;
  final List<PlanOffer> offers;
}

class DeviceSession {
  const DeviceSession(this.device, this.lastUse, {this.current = false});
  final String device;
  final String lastUse;
  final bool current;
}

class DemoProfile {
  const DemoProfile({required this.id, required this.name, required this.opening, required this.income, required this.expenses, required this.debt, required this.indicators, required this.closings});
  final String id;
  final String name;
  final int opening;
  final int income;
  final int expenses;
  final int debt;
  final List<Indicator> indicators;
  final List<int> closings;
}

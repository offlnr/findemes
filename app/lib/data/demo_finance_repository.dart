import 'finance_repository.dart';
import 'models.dart';

/// Datos de ejemplo, ya calculados, para usar la app sin API (los mismos del wireframe en
/// Figma). No reemplaza al motor: la app solo los muestra. Todo dato se rotula como demostración.
class DemoFinanceRepository implements FinanceRepository {
  const DemoFinanceRepository();

  static const _credit = Debt(
    name: 'Crédito de consumo',
    installment: 220000,
    paid: 7,
    total: 12,
    remaining: 5,
    pendingAmount: 1100000,
    lastMonth: 'mar 2027',
  );

  static const _months = [
    ProjectionMonth(label: 'nov 2026', short: 'nov', opening: 612340, income: 1150000, expenses: -330000, household: -560000, debt: -220000, margin: 40000, closing: 652340),
    ProjectionMonth(label: 'dic 2026', short: 'dic', opening: 652340, income: 1150000, expenses: -330000, household: -560000, debt: -220000, margin: 40000, closing: 692340),
    ProjectionMonth(label: 'ene 2027', short: 'ene', opening: 692340, income: 1150000, expenses: -330000, household: -560000, debt: -220000, margin: 40000, closing: 732340),
    ProjectionMonth(label: 'feb 2027', short: 'feb', opening: 732340, income: 1150000, expenses: -330000, household: -560000, debt: -220000, margin: 40000, closing: 772340),
    ProjectionMonth(label: 'mar 2027', short: 'mar', opening: 772340, income: 1150000, expenses: -330000, household: -560000, debt: -220000, margin: 40000, closing: 812340),
    ProjectionMonth(label: 'abr 2027', short: 'abr', opening: 812340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 1072340),
    ProjectionMonth(label: 'may 2027', short: 'may', opening: 1072340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 1332340),
    ProjectionMonth(label: 'jun 2027', short: 'jun', opening: 1332340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 1592340),
    ProjectionMonth(label: 'jul 2027', short: 'jul', opening: 1592340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 1852340),
    ProjectionMonth(label: 'ago 2027', short: 'ago', opening: 1852340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 2112340),
    ProjectionMonth(label: 'sep 2027', short: 'sep', opening: 2112340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 2372340),
    ProjectionMonth(label: 'oct 2027', short: 'oct', opening: 2372340, income: 1150000, expenses: -330000, household: -560000, debt: 0, margin: 260000, closing: 2632340),
  ];

  static const _base = [652340, 692340, 732340, 772340, 812340, 1072340, 1332340, 1592340, 1852340, 2112340, 2372340, 2632340];

  static const _ix = {
    'min': 'El saldo al cierre más bajo de los 12 meses.',
    'minMonth': 'En qué mes ocurre ese saldo.',
    'break': 'Primer mes con saldo al cierre bajo \$0.',
    'margin': 'Ingresos menos gastos, aporte al hogar y cuotas.',
    'load': 'Cuotas del mes divididas por el ingreso.',
    'final': 'Saldo al final del horizonte.',
  };

  static const _baseCompare = ['\$652.340', 'nov 2026', 'No ocurre', '\$40.000', '19 %', '\$2.632.340'];

  static const _scenarios = {
    'notebook-12': (
      name: 'Notebook en 12 cuotas',
      decisions: ['Compra en 12 cuotas: Notebook, \$899.990, primera cuota en nov 2026'],
      closings: [577341, 542342, 507343, 472344, 437345, 622346, 807347, 992348, 1177349, 1362350, 1547351, 1732352],
      minIndex: 4,
      breakIndex: null,
      detail: [
        ['\$437.345', '−\$214.995'],
        ['No ocurre', 'sin diferencia'],
        ['−\$34.999', '−\$74.999'],
        ['26 %', '+7 pp'],
        ['\$1.732.352', '−\$899.988'],
      ],
      compare: ['\$437.345  (−\$214.995 vs. base)', 'mar 2027', 'No ocurre', '−\$34.999  (−\$74.999 vs. base)', '26 %', '\$1.732.352'],
      explanation: [
        'En noviembre de 2026 se agrega la cuota del notebook: \$74.999 durante 12 meses.',
        'Hasta marzo de 2027 se suma a la cuota del crédito (\$220.000): el margen mensual queda en −\$34.999 y el saldo baja cada mes hasta \$437.345.',
        'En abril termina el crédito: desde ese mes el saldo sube \$185.001 al mes y cierra octubre de 2027 en \$1.732.352.',
      ],
    ),
    'notebook-6': (
      name: 'Notebook en 6 cuotas',
      decisions: ['Compra en 6 cuotas: Notebook, \$899.990, primera cuota en nov 2026'],
      closings: [502342, 392344, 282346, 172348, 62350, 172352, 432352, 692352, 952352, 1212352, 1472352, 1732352],
      minIndex: 4,
      breakIndex: null,
      detail: [
        ['\$62.350', '−\$589.990'],
        ['No ocurre', 'sin diferencia'],
        ['−\$109.998', '−\$149.998'],
        ['32 %', '+13 pp'],
        ['\$1.732.352', '−\$899.988'],
      ],
      compare: ['\$62.350  (−\$589.990 vs. base)', 'mar 2027', 'No ocurre', '−\$109.998  (−\$149.998 vs. base)', '32 %', '\$1.732.352'],
      explanation: [
        'En noviembre de 2026 se agrega la cuota del notebook: \$149.998 durante 6 meses.',
        'Hasta marzo de 2027 se suma a la cuota del crédito: el margen mensual queda en −\$109.998 y el saldo baja cada mes hasta \$62.350.',
        'En abril termina el crédito y se paga la última cuota del notebook; desde mayo el saldo sube \$260.000 al mes.',
      ],
    ),
    'notebook-contado': (
      name: 'Notebook al contado',
      decisions: ['Gasto único: Notebook, \$899.990, en dic 2026'],
      closings: [652340, -207650, -167650, -127650, -87650, 172350, 432350, 692350, 952350, 1212350, 1472350, 1732350],
      minIndex: 1,
      breakIndex: 1,
      detail: [
        ['−\$207.650', '−\$859.990'],
        ['dic 2026', 'cambia'],
        ['\$40.000', 'sin diferencia'],
        ['19 %', 'sin diferencia'],
        ['\$1.732.350', '−\$899.990'],
      ],
      compare: ['−\$207.650  (−\$859.990 vs. base)', 'dic 2026', 'dic 2026', '\$40.000  (sin diferencia)', '19 %', '\$1.732.350'],
      explanation: [
        'En diciembre de 2026 se registra un gasto único de \$899.990 por el notebook.',
        'El saldo al cierre de diciembre queda en −\$207.650: es el mes de quiebre. Sigue bajo \$0 hasta marzo de 2027.',
        'En abril termina el crédito y el saldo vuelve a \$172.350; cierra octubre de 2027 en \$1.732.350.',
      ],
    ),
    'prepago': (
      name: 'Prepago del crédito',
      decisions: ['Adelanto de deuda: Crédito de consumo, \$440.000 en nov 2026 (reducir plazo)'],
      closings: [212340, 252340, 292340, 552340, 812340, 1072340, 1332340, 1592340, 1852340, 2112340, 2372340, 2632340],
      minIndex: 0,
      breakIndex: null,
      detail: [
        ['\$212.340', '−\$440.000'],
        ['No ocurre', 'sin diferencia'],
        ['\$40.000', 'sin diferencia'],
        ['19 %', 'sin diferencia'],
        ['\$2.632.340', 'sin diferencia'],
      ],
      compare: ['\$212.340  (−\$440.000 vs. base)', 'nov 2026', 'No ocurre', '\$40.000  (sin diferencia)', '19 %', '\$2.632.340'],
      explanation: [
        'En noviembre de 2026 se adelantan \$440.000 al crédito de consumo. Se asumió la modalidad "reducir plazo": se extinguen las cuotas de febrero y marzo de 2027.',
        'El saldo al cierre de noviembre baja a \$212.340.',
        'Desde febrero ya no hay cuota del crédito: el saldo sube \$260.000 al mes y cierra octubre de 2027 igual que la base, en \$2.632.340.',
      ],
    ),
  };

  @override
  Future<Session> session() async => const Session(name: 'Camila Rojas', initials: 'CR', planLabel: 'Plan Individual · Activa');

  @override
  Future<Summary> summary() async => const Summary(
        asOf: 'octubre de 2026',
        finalLabel: 'Saldo al cierre de octubre de 2027',
        finalClosing: 2632340,
        heroSentence: 'Sube \$40.000 al mes hasta marzo, mientras pagas el crédito, y \$260.000 al mes desde abril.',
        indicators: [
          Indicator(
            label: 'Saldo mínimo proyectado',
            value: '\$652.340',
            detail: 'en noviembre de 2026',
            explanation: 'El saldo al cierre más bajo entre los próximos 12 meses: cuánto queda en tu cuenta el mes más ajustado.',
          ),
          Indicator(
            label: 'Mes de quiebre',
            value: 'No ocurre',
            detail: 'en los próximos 12 meses',
            explanation: 'Primer mes en que el saldo al cierre quedaría bajo \$0. Si ningún mes baja de \$0, no ocurre.',
          ),
          Indicator(
            label: 'Margen mensual disponible',
            value: '\$40.000',
            detail: 'noviembre de 2026',
            explanation: 'Lo que queda del mes: ingresos \$1.150.000 − gastos \$330.000 − aporte al hogar \$560.000 − cuotas \$220.000.',
          ),
          Indicator(
            label: 'Carga de deuda sobre ingreso',
            value: '19 %',
            detail: 'noviembre de 2026',
            explanation: 'Parte de tu ingreso que se va en cuotas: \$220.000 de \$1.150.000.',
          ),
        ],
        months: _months,
        explanation: [
          'Tu saldo de octubre (\$612.340) más ingresos de \$1.150.000 al mes.',
          'Cada mes salen \$330.000 en gastos personales, \$560.000 de aporte al hogar y \$220.000 de cuota del crédito hasta marzo de 2027.',
          'En abril termina el crédito: desde ese mes el saldo sube \$260.000 al mes.',
        ],
        debts: [_credit],
        debtHealth: DebtHealth(duePaid: 7, due: 7, debt: _credit, pendingAmount: 1100000, freeFrom: 'abril 2027'),
        householdShares: [
          Share('Arriendo', 357500),
          Share('Supermercado', 160000),
          Share('Gastos comunes del edificio', 42500),
          Share('Total', 560000),
        ],
      );

  @override
  Future<Registry> registry() async => const Registry(
        openingLabel: 'Saldo inicial de octubre 2026',
        opening: 612340,
        openingOrigin: DataOrigin.providerTest,
        incomes: [Entry(name: 'Sueldo', kind: 'Recurrente', amount: 1150000, origin: DataOrigin.providerTest)],
        expenses: [
          Entry(name: 'Plan de salud', kind: 'Fijo', amount: 62000, origin: DataOrigin.providerTest),
          Entry(name: 'Transporte', kind: 'Fijo', amount: 40000),
          Entry(name: 'Gimnasio', kind: 'Fijo', amount: 28000),
          Entry(name: 'Comida fuera de casa', kind: 'Variable (estimado)', amount: 120000),
          Entry(name: 'Ropa y otros', kind: 'Variable (estimado)', amount: 80000),
        ],
        debts: [_credit],
      );

  @override
  Future<BankData> banks() async => const BankData(
        accounts: [
          BankAccount(bank: 'Banco de Chile', type: 'Cuenta corriente', number: '•••• 4821', available: 612340, origin: DataOrigin.providerTest),
        ],
        totals: [MonthTotals('10-2026', 1150000, 364290), MonthTotals('09-2026', 1150000, 1093120)],
        movements: [
          Movement(date: '14-10-2026', description: 'Carga tarjeta transporte', amount: -20000, inRegistry: false, origin: DataOrigin.providerTest),
          Movement(date: '11-10-2026', description: 'Suscripción streaming', amount: -7990, inRegistry: false, origin: DataOrigin.providerTest),
          Movement(date: '08-10-2026', description: 'Supermercado', amount: -54300, inRegistry: false, origin: DataOrigin.providerTest),
          Movement(date: '06-10-2026', description: 'Isapre plan de salud', amount: -62000, inRegistry: true, origin: DataOrigin.providerTest),
          Movement(date: '06-10-2026', description: 'Remuneración Empresa Andes SpA', amount: 1150000, inRegistry: true, origin: DataOrigin.providerTest),
          Movement(date: '03-10-2026', description: 'Pago crédito de consumo', amount: -220000, inRegistry: true, origin: DataOrigin.providerTest),
        ],
      );

  @override
  Future<List<ProjectionMonth>> projection() async => _months;

  @override
  Future<List<ScenarioSummary>> scenarios() async => [
        for (final e in _scenarios.entries)
          ScenarioSummary(id: e.key, name: e.value.name, decisionCount: e.value.decisions.length, minBalance: e.value.closings[e.value.minIndex]),
      ];

  @override
  Future<ScenarioDetail> scenario(String id) async {
    final s = _scenarios[id];
    if (s == null) throw StateError('Escenario no encontrado');
    const labels = ['Saldo mínimo proyectado', 'Mes de quiebre', 'Margen mensual (nov)', 'Carga de deuda / ingreso', 'Saldo al cierre oct 2027'];
    const keys = ['min', 'break', 'margin', 'load', 'final'];
    const base = ['\$652.340', 'No ocurre', '\$40.000', '19 %', '\$2.632.340'];
    return ScenarioDetail(
      id: id,
      name: s.name,
      decisions: s.decisions,
      indicators: [
        for (var i = 0; i < labels.length; i++)
          IndicatorComparison(label: labels[i], explanation: _ix[keys[i]]!, values: [base[i], ...s.detail[i]]),
      ],
      closings: s.closings,
      baseClosings: _base,
      minIndex: s.minIndex,
      explanation: s.explanation,
    );
  }

  @override
  Future<Comparison> compare(List<String> scenarioIds) async {
    final picked = [for (final id in scenarioIds) if (_scenarios[id] != null) _scenarios[id]!];
    const labels = ['Saldo mínimo proyectado', 'Mes del saldo mínimo', 'Mes de quiebre', 'Margen mensual (nov)', 'Carga de deuda sobre ingreso', 'Saldo al cierre de oct 2027'];
    const keys = ['min', 'minMonth', 'break', 'margin', 'load', 'final'];
    return Comparison(
      columns: ['Base', for (final s in picked) s.name],
      rows: [
        for (var i = 0; i < labels.length; i++)
          IndicatorComparison(label: labels[i], explanation: _ix[keys[i]]!, values: [_baseCompare[i], for (final s in picked) s.compare[i]]),
      ],
      series: [_base, for (final s in picked) s.closings],
      breakMarks: [null, for (final s in picked) s.breakIndex],
    );
  }

  @override
  Future<Household> household() async => const Household(
        name: 'Hogar Rojas Pérez',
        monthLabel: 'noviembre de 2026',
        members: [
          HouseholdMember('Camila', 'Administra', me: true),
          HouseholdMember('Diego', 'Miembro'),
          HouseholdMember('tomas@ejemplo.cl', 'Invitación pendiente', pending: true),
        ],
        memberNames: ['Camila', 'Diego'],
        expenses: [
          CommonExpense(name: 'Arriendo', amount: 650000, rule: 'Camila 55 % · Diego 45 %', parts: [357500, 292500], author: 'Camila'),
          CommonExpense(name: 'Supermercado', amount: 320000, rule: 'Partes iguales (2)', parts: [160000, 160000], author: 'Diego'),
          CommonExpense(name: 'Gastos comunes del edificio', amount: 85000, rule: 'Partes iguales (2)', parts: [42500, 42500], author: 'Camila'),
          CommonExpense(name: 'Internet', amount: 38000, rule: 'Asignado a Diego', parts: [0, 38000], author: 'Diego'),
        ],
        contributions: [Share('Camila', 560000), Share('Diego', 533000)],
        history: [Share('jun', 1041000), Share('jul', 1058000), Share('ago', 1066000), Share('sep', 1079000), Share('oct', 1093000), Share('nov', 1093000)],
        myContribution: 560000,
        total: 1093000,
      );

  @override
  Future<Subscription> subscription() async => const Subscription(
        currentPlanId: 'individual',
        planName: 'Individual',
        state: 'Activa',
        period: '15-10-2026 al 15-11-2026',
        offers: [
          PlanOffer(id: 'gratuito', name: 'Gratuito', description: 'Registro, proyección, hasta 2 escenarios guardados y comparación de 1 escenario frente a la base.', price: '\$0', period: 'sin plazo'),
          PlanOffer(id: 'individual', name: 'Individual', description: 'Escenarios ilimitados, comparación múltiple, prepagos e historial completo.', price: 'Precio por definir', period: 'por período, renovación manual'),
          PlanOffer(id: 'familiar', name: 'Familiar', description: 'Todo lo del plan Individual, más el hogar con espacio común y perfiles privados.', price: 'Precio por definir', period: 'por período, renovación manual'),
        ],
      );

  @override
  Future<List<DeviceSession>> deviceSessions() async => const [
        DeviceSession('Chrome · macOS', 'esta sesión', current: true),
        DeviceSession('App Android', 'hace 2 días'),
      ];

  @override
  Future<List<DemoProfile>> demoProfiles() async => const [
        DemoProfile(
          id: 'estudiante',
          name: 'Estudiante',
          opening: 180000,
          income: 420000,
          expenses: 380000,
          debt: 0,
          indicators: [
            Indicator(label: 'Saldo mínimo', value: '\$220.000', detail: 'nov 2026', explanation: 'El saldo al cierre más bajo de los próximos 12 meses.'),
            Indicator(label: 'Mes de quiebre', value: 'No ocurre', detail: '12 meses', explanation: 'Primer mes en que el saldo al cierre quedaría bajo \$0.'),
          ],
          closings: [220000, 260000, 300000, 340000, 380000, 420000, 460000, 500000, 540000, 580000, 620000, 660000],
        ),
        DemoProfile(
          id: 'familia',
          name: 'Familia',
          opening: 612340,
          income: 1150000,
          expenses: 890000,
          debt: 220000,
          indicators: [
            Indicator(label: 'Saldo mínimo', value: '\$652.340', detail: 'nov 2026', explanation: 'El saldo al cierre más bajo de los próximos 12 meses.'),
            Indicator(label: 'Mes de quiebre', value: 'No ocurre', detail: '12 meses', explanation: 'Primer mes en que el saldo al cierre quedaría bajo \$0.'),
          ],
          closings: _base,
        ),
        DemoProfile(
          id: 'profesional',
          name: 'Profesional con deudas',
          opening: 950000,
          income: 2100000,
          expenses: 1450000,
          debt: 780000,
          indicators: [
            Indicator(label: 'Saldo mínimo', value: '−\$610.000', detail: 'oct 2027', explanation: 'El saldo al cierre más bajo de los próximos 12 meses.'),
            Indicator(label: 'Mes de quiebre', value: 'jun 2027', detail: 'primer mes bajo \$0', explanation: 'Primer mes en que el saldo al cierre quedaría bajo \$0.'),
          ],
          closings: [820000, 690000, 560000, 430000, 300000, 170000, 40000, -90000, -220000, -350000, -480000, -610000],
        ),
      ];
}

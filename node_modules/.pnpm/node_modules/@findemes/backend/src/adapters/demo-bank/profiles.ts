/**
 * Curated demo profiles for validation sessions and the thesis defense. Amounts are plausible
 * Chilean figures in integer CLP; the team can adjust them freely. Employer and landlord names
 * are fictional.
 */

export interface RecurringItem {
  readonly description: string;
  /** Signed integer CLP: positive for income, negative for a charge. */
  readonly amount: number;
  /** Clamped to the last day of shorter months. */
  readonly dayOfMonth: number;
}

export interface VariableItem {
  readonly description: string;
  /** Range of each charge, positive integer CLP (charged as negative). */
  readonly minAmount: number;
  readonly maxAmount: number;
  readonly timesPerMonth: readonly [min: number, max: number];
}

export interface DemoAccount {
  readonly externalId: string;
  readonly name: string;
  readonly type: 'checking_account' | 'sight_account';
  /** Balance at the start of the generated history. */
  readonly openingBalance: number;
  readonly recurring: readonly RecurringItem[];
  readonly variable: readonly VariableItem[];
}

export interface DemoProfile {
  readonly id: string;
  readonly label: string;
  readonly accounts: readonly DemoAccount[];
}

export const DEMO_PROFILES: readonly DemoProfile[] = [
  {
    id: 'estudiante',
    label: 'Estudiante con trabajo part-time',
    accounts: [
      {
        externalId: 'demo-estudiante-cuenta-vista',
        name: 'Cuenta Vista',
        type: 'sight_account',
        openingBalance: 85_000,
        recurring: [
          { description: 'Remuneración Cafetería Los Aromos SpA', amount: 380_000, dayOfMonth: 10 },
          { description: 'Transferencia a Arriendo Pieza', amount: -200_000, dayOfMonth: 5 },
          { description: 'PAC Entel Plan Móvil', amount: -12_990, dayOfMonth: 15 },
          { description: 'Spotify', amount: -3_990, dayOfMonth: 20 },
        ],
        variable: [
          { description: 'Recarga Tarjeta bip!', minAmount: 5_000, maxAmount: 10_000, timesPerMonth: [3, 5] },
          { description: 'Compra Supermercado Unimarc', minAmount: 6_000, maxAmount: 18_000, timesPerMonth: [4, 6] },
          { description: 'Compra Comida Rápida', minAmount: 4_000, maxAmount: 9_000, timesPerMonth: [2, 4] },
        ],
      },
    ],
  },
  {
    id: 'familia',
    label: 'Familia con un hijo en el colegio',
    accounts: [
      {
        externalId: 'demo-familia-cuenta-corriente',
        name: 'Cuenta Corriente',
        type: 'checking_account',
        openingBalance: 420_000,
        recurring: [
          { description: 'Remuneración Empresa Andes SpA', amount: 1_250_000, dayOfMonth: 30 },
          { description: 'Transferencia a Inmobiliaria Los Robles', amount: -520_000, dayOfMonth: 5 },
          { description: 'Pago Crédito de Consumo', amount: -145_000, dayOfMonth: 15 },
          { description: 'Mensualidad Colegio San Esteban', amount: -95_000, dayOfMonth: 10 },
          { description: 'PAC Enel Distribución', amount: -38_000, dayOfMonth: 18 },
          { description: 'PAC Aguas Andinas', amount: -18_500, dayOfMonth: 18 },
          { description: 'Metrogas', amount: -25_000, dayOfMonth: 20 },
          { description: 'PAC Internet Hogar', amount: -24_990, dayOfMonth: 12 },
        ],
        variable: [
          { description: 'Compra Supermercado Líder', minAmount: 35_000, maxAmount: 70_000, timesPerMonth: [3, 5] },
          { description: 'Farmacia Cruz Verde', minAmount: 8_000, maxAmount: 30_000, timesPerMonth: [0, 2] },
          { description: 'Recarga Tarjeta bip!', minAmount: 10_000, maxAmount: 20_000, timesPerMonth: [2, 3] },
        ],
      },
    ],
  },
  {
    id: 'profesional-con-deudas',
    label: 'Profesional con dividendo y crédito automotriz',
    accounts: [
      {
        externalId: 'demo-profesional-cuenta-corriente',
        name: 'Cuenta Corriente',
        type: 'checking_account',
        openingBalance: 650_000,
        recurring: [
          { description: 'Remuneración Consultora Pacífico Ltda.', amount: 2_150_000, dayOfMonth: 28 },
          { description: 'Dividendo Crédito Hipotecario', amount: -690_000, dayOfMonth: 5 },
          { description: 'Cuota Crédito Automotriz', amount: -289_900, dayOfMonth: 10 },
          { description: 'SmartFit Plan Black', amount: -29_990, dayOfMonth: 3 },
          { description: 'Netflix.com', amount: -10_990, dayOfMonth: 14 },
          { description: 'PAC Enel Distribución', amount: -45_000, dayOfMonth: 18 },
        ],
        variable: [
          { description: 'Pago Tarjeta de Crédito', minAmount: 250_000, maxAmount: 450_000, timesPerMonth: [1, 1] },
          { description: 'Compra Supermercado Jumbo', minAmount: 50_000, maxAmount: 90_000, timesPerMonth: [3, 4] },
          { description: 'Copec Combustible', minAmount: 30_000, maxAmount: 50_000, timesPerMonth: [2, 4] },
          { description: 'Restaurante', minAmount: 15_000, maxAmount: 35_000, timesPerMonth: [2, 4] },
        ],
      },
    ],
  },
];

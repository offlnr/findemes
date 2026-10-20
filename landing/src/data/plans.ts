// Planes (Tabla 13 del informe). La tabla de escritorio y las tarjetas móviles salen de aquí.

export type PlanId = 'gratuito' | 'individual' | 'familiar';

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly price: string;
  readonly period: string;
  readonly cta: string;
}

/** Valor de una característica: `true`/`false` se muestran como casilla marcada o vacía. */
export type FeatureValue = string | { readonly included: boolean; readonly text: string };

export interface Feature {
  readonly label: string;
  /** Texto más corto para las tarjetas móviles. */
  readonly shortLabel?: string;
  readonly values: Readonly<Record<PlanId, FeatureValue>>;
  /** Texto propio de las tarjetas, cuando difiere del de la tabla. */
  readonly cardValues?: Partial<Readonly<Record<PlanId, string>>>;
}

export const plans: readonly Plan[] = [
  { id: 'gratuito', name: 'Gratuito', price: '$0', period: 'sin plazo', cta: 'Crear cuenta gratis' },
  { id: 'individual', name: 'Individual', price: 'Por definir', period: 'por período, renovación manual', cta: 'Elegir Individual' },
  { id: 'familiar', name: 'Familiar', price: 'Por definir', period: 'por período, renovación manual', cta: 'Elegir Familiar' },
];

const yes = (text: string): FeatureValue => ({ included: true, text });
const no = (text: string): FeatureValue => ({ included: false, text });

export const features: readonly Feature[] = [
  {
    label: 'Conexión con tu banco (Fintoc)',
    shortLabel: 'Conexión con tu banco',
    values: { gratuito: yes('Incluida'), individual: yes('Incluida'), familiar: yes('Incluida') },
  },
  {
    label: 'Registro y proyección mensual',
    values: { gratuito: yes('Incluido'), individual: yes('Incluido'), familiar: yes('Incluido') },
  },
  {
    label: 'Escenarios guardados',
    values: { gratuito: 'Hasta 2', individual: 'Sin límite', familiar: 'Sin límite' },
  },
  {
    label: 'Comparación con tu situación base',
    values: { gratuito: '1 escenario a la vez', individual: 'Varios a la vez', familiar: 'Varios a la vez' },
  },
  {
    label: 'Historial de meses',
    values: { gratuito: 'Mes en curso', individual: 'Completo', familiar: 'Completo' },
  },
  {
    label: 'Simulación de prepagos de deuda',
    shortLabel: 'Simulación de prepagos',
    values: { gratuito: no('No incluida'), individual: yes('Incluida'), familiar: yes('Incluida') },
  },
  {
    label: 'Hogar con espacio común y perfiles privados',
    shortLabel: 'Hogar',
    values: { gratuito: no('No incluido'), individual: no('No incluido'), familiar: yes('Incluido') },
    cardValues: { familiar: 'Espacio común y perfiles privados' },
  },
];

export const featureText = (v: FeatureValue): string => (typeof v === 'string' ? v : v.text);

import { createMvpCatalog, simulate, type DecisionInput, type DecisionIssue, type SimulationResult } from '../../../core/index.ts';
import { loadFinancialState } from '../../registry/application/registry-service.ts';
import type { CommitmentSource, RegistryRepository } from '../../registry/ports/registry-ports.ts';
import type { Actor } from '../../shared/actor.ts';
import type { IdGenerator, WriteContext } from '../../shared/ports.ts';
import type { PlanCapabilities, PlanReader } from '../../subscription/ports/subscription-ports.ts';
import type { Scenario, ScenarioId } from '../domain/scenario.ts';
import type { ScenarioRepository } from '../ports/scenario-ports.ts';

export const MAX_DECISIONS_PER_SCENARIO = 20;
export const SCENARIO_NAME_MAX_LENGTH = 80;

export interface ScenarioInput {
  readonly name: string;
  readonly decisions: readonly DecisionInput[];
}

/** Why a scenario cannot be saved or simulated. Messages are neutral Spanish for the user. */
export type ScenarioRefusal =
  | { readonly reason: 'not_found' }
  | { readonly reason: 'opening_balance_required' }
  | { readonly reason: 'invalid_input'; readonly message: string }
  | { readonly reason: 'invalid_decisions'; readonly issues: readonly { readonly decisionIndex: number; readonly issues: readonly DecisionIssue[] }[] }
  /** Tabla 13: the plan in force does not include this capability or this many scenarios. */
  | { readonly reason: 'plan_limit'; readonly message: string };

export type ScenarioWrite = { readonly ok: true; readonly id: string } | ({ readonly ok: false } & ScenarioRefusal);

export interface ScenarioView {
  readonly scenario: Scenario;
  readonly horizonMonths: number;
  readonly result: SimulationResult;
}

export interface ComparisonView {
  readonly horizonMonths: number;
  readonly base: SimulationResult['base'];
  /** In the order requested: never ranked by convenience (HU09, rule 4). */
  readonly scenarios: readonly { readonly scenario: Scenario; readonly result: SimulationResult }[];
}

const catalog = createMvpCatalog();
const PREPAYMENT_KIND = 'debt_prepayment';

/**
 * Scenarios (HU06, HU07, HU08, HU09, HU11). A scenario keeps only its name and decisions; the
 * base is the registry read at simulation time, so a scenario can never alter it (rule 3).
 */
export class ScenarioService {
  private readonly scenarios: ScenarioRepository;
  private readonly registry: RegistryRepository;
  private readonly plans: PlanReader;
  private readonly ids: IdGenerator;
  private readonly commitments: CommitmentSource | null;

  constructor(deps: { scenarios: ScenarioRepository; registry: RegistryRepository; plans: PlanReader; ids: IdGenerator; commitments?: CommitmentSource }) {
    this.scenarios = deps.scenarios;
    this.registry = deps.registry;
    this.plans = deps.plans;
    this.ids = deps.ids;
    this.commitments = deps.commitments ?? null;
  }

  async list(actor: Actor): Promise<{ readonly scenarios: readonly Scenario[]; readonly plan: PlanCapabilities }> {
    const [scenarios, plan] = await Promise.all([this.scenarios.listForActor(actor), this.plans.capabilitiesFor(actor)]);
    return { scenarios, plan };
  }

  async create(context: WriteContext, input: ScenarioInput): Promise<ScenarioWrite> {
    const refusal = await this.validate(context.actor, input);
    if (refusal !== null) return { ok: false, ...refusal };
    const id = this.ids.newId();
    const created = await this.scenarios.createIfUnderLimit(context, { id: id as ScenarioId, name: input.name.trim(), base: { kind: 'personal' }, decisions: input.decisions });
    if (created === 'limit_reached') {
      const plan = await this.plans.capabilitiesFor(context.actor);
      return {
        ok: false,
        reason: 'plan_limit',
        message: `El plan ${plan.name} permite guardar hasta ${String(plan.maxSavedScenarios ?? 0)} escenarios. Elimina uno o cambia de plan para guardar otro.`,
      };
    }
    return { ok: true, id };
  }

  /** HU11: rename, change decisions. The base state and other scenarios are untouched. */
  async update(context: WriteContext, id: string, input: ScenarioInput): Promise<ScenarioWrite> {
    if ((await this.scenarios.findForActor(context.actor, id as ScenarioId)) === null) return { ok: false, reason: 'not_found' };
    const refusal = await this.validate(context.actor, input);
    if (refusal !== null) return { ok: false, ...refusal };
    const updated = await this.scenarios.updateForActor(context, { id: id as ScenarioId, name: input.name.trim(), base: { kind: 'personal' }, decisions: input.decisions });
    return updated ? { ok: true, id } : { ok: false, reason: 'not_found' };
  }

  delete(context: WriteContext, id: string): Promise<boolean> {
    return this.scenarios.deleteForActor(context, id as ScenarioId);
  }

  /** HU08: the scenario's indicators, its variation against the base and the explanation (HU10). */
  async view(actor: Actor, id: string, horizonMonths: number): Promise<{ ok: true; view: ScenarioView } | ({ ok: false } & ScenarioRefusal)> {
    const scenario = await this.scenarios.findForActor(actor, id as ScenarioId);
    if (scenario === null) return { ok: false, reason: 'not_found' };
    const simulated = await this.simulate(actor, scenario.decisions, horizonMonths);
    return simulated.ok ? { ok: true, view: { scenario, horizonMonths, result: simulated.result } } : { ok: false, ...simulated.refusal };
  }

  /**
   * HU09: indicators of the selected scenarios side by side with the base, in the order given.
   * The free plan compares one scenario against the base (Tabla 13).
   */
  async compare(actor: Actor, ids: readonly string[], horizonMonths: number): Promise<{ ok: true; view: ComparisonView } | ({ ok: false } & ScenarioRefusal)> {
    const plan = await this.plans.capabilitiesFor(actor);
    if (ids.length > plan.maxComparedScenarios) {
      return {
        ok: false,
        reason: 'plan_limit',
        message:
          plan.maxComparedScenarios === 1
            ? `El plan ${plan.name} compara un escenario frente a la base.`
            : `El plan ${plan.name} compara hasta ${String(plan.maxComparedScenarios)} escenarios a la vez.`,
      };
    }
    const rows: { scenario: Scenario; result: SimulationResult }[] = [];
    let base: SimulationResult['base'] | null = null;
    for (const id of ids) {
      const scenario = await this.scenarios.findForActor(actor, id as ScenarioId);
      if (scenario === null) return { ok: false, reason: 'not_found' };
      const simulated = await this.simulate(actor, scenario.decisions, horizonMonths);
      if (!simulated.ok) return { ok: false, ...simulated.refusal };
      base = simulated.result.base;
      rows.push({ scenario, result: simulated.result });
    }
    if (base === null) {
      const projection = await this.simulate(actor, [], horizonMonths);
      if (!projection.ok) return { ok: false, ...projection.refusal };
      base = projection.result.base;
    }
    return { ok: true, view: { horizonMonths, base, scenarios: rows } };
  }

  private async simulate(
    actor: Actor,
    decisions: readonly DecisionInput[],
    horizonMonths: number,
  ): Promise<{ ok: true; result: SimulationResult } | { ok: false; refusal: ScenarioRefusal }> {
    const state = await loadFinancialState(this.registry, this.commitments, actor);
    if (state === null) return { ok: false, refusal: { reason: 'opening_balance_required' } };
    const outcome = simulate({ state, decisions, horizonMonths }, catalog);
    // Saved decisions can stop fitting the base (e.g. the debt they prepay was deleted).
    return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, refusal: { reason: 'invalid_decisions', issues: outcome.issues } };
  }

  /** Name, plan capabilities and the engine's own validation against the current base. */
  private async validate(actor: Actor, input: ScenarioInput): Promise<ScenarioRefusal | null> {
    const name = input.name.trim();
    if (name.length < 1 || name.length > SCENARIO_NAME_MAX_LENGTH) {
      return { reason: 'invalid_input', message: `Ingresa un nombre de hasta ${String(SCENARIO_NAME_MAX_LENGTH)} caracteres.` };
    }
    if (input.decisions.length > MAX_DECISIONS_PER_SCENARIO) {
      return { reason: 'invalid_input', message: `Un escenario admite hasta ${String(MAX_DECISIONS_PER_SCENARIO)} decisiones.` };
    }
    if (input.decisions.some((decision) => decision.kind === PREPAYMENT_KIND)) {
      const plan = await this.plans.capabilitiesFor(actor);
      if (!plan.userPrepayments) {
        return { reason: 'plan_limit', message: `La simulación de prepagos de deuda no está incluida en el plan ${plan.name}.` };
      }
    }
    const simulated = await this.simulate(actor, input.decisions, 12);
    return simulated.ok ? null : simulated.refusal;
  }
}

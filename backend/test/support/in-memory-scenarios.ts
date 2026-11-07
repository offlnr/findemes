// In-memory doubles of ScenarioRepository and PlanReader with the database's rules: scenarios
// are visible only to their owner and creation respects the plan limit of Tabla 13.
import type { ScenarioRepository } from '../../src/modules/scenarios/ports/scenario-ports.ts';
import type { Scenario } from '../../src/modules/scenarios/domain/scenario.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import type { PlanCapabilities, PlanReader } from '../../src/modules/subscription/ports/subscription-ports.ts';

export const FREE_PLAN: PlanCapabilities = { code: 'free', name: 'Gratuito', maxSavedScenarios: 2, maxComparedScenarios: 1, userPrepayments: false, householdSpace: false };
export const PAID_PLAN: PlanCapabilities = { code: 'paid', name: 'Pagado', maxSavedScenarios: null, maxComparedScenarios: 5, userPrepayments: true, householdSpace: false };

export function createInMemoryScenarios() {
  const rows = new Map<string, Scenario>();
  const plans = new Map<string, PlanCapabilities>();
  const audit: { actorId: string; action: string; targetId: string }[] = [];

  const planReader: PlanReader = { capabilitiesFor: (actor) => Promise.resolve(plans.get(actor.userId) ?? FREE_PLAN) };

  const repository: ScenarioRepository = {
    listForActor: (actor) => Promise.resolve([...rows.values()].filter((s) => s.ownerId === actor.userId)),
    findForActor: (actor, id) => {
      const row = rows.get(id);
      return Promise.resolve(row?.ownerId === actor.userId ? row : null);
    },
    createIfUnderLimit: async (context, draft) => {
      const plan = await planReader.capabilitiesFor(context.actor);
      const count = [...rows.values()].filter((s) => s.ownerId === context.actor.userId).length;
      if (plan.maxSavedScenarios !== null && count >= plan.maxSavedScenarios) return 'limit_reached';
      rows.set(draft.id, { ...draft, ownerId: context.actor.userId });
      audit.push({ actorId: context.actor.userId, action: 'scenario.created', targetId: draft.id });
      return 'created';
    },
    updateForActor: (context, draft) => {
      const row = rows.get(draft.id);
      if (row?.ownerId !== context.actor.userId) return Promise.resolve(false);
      rows.set(draft.id, { ...draft, ownerId: row.ownerId });
      audit.push({ actorId: context.actor.userId, action: 'scenario.updated', targetId: draft.id });
      return Promise.resolve(true);
    },
    deleteForActor: (context, id) => {
      if (rows.get(id)?.ownerId !== context.actor.userId) return Promise.resolve(false);
      rows.delete(id);
      audit.push({ actorId: context.actor.userId, action: 'scenario.deleted', targetId: id });
      return Promise.resolve(true);
    },
  };

  return { repository, planReader, audit, setPlan: (userId: UserId, plan: PlanCapabilities) => plans.set(userId, plan) };
}

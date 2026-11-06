import type { Expense, Schedule } from '../../../core/index.ts';
import type { CommitmentSource } from '../../registry/ports/registry-ports.ts';
import type { Actor, UserId } from '../../shared/actor.ts';
import type { Clock, IdGenerator, WriteContext } from '../../shared/ports.ts';
import type { PlanReader } from '../../subscription/ports/subscription-ports.ts';
import {
  contributionsOf,
  INVITATION_VALIDITY_MS,
  labelIssue,
  sharedExpenseIssues,
  splitExpense,
  type ContributionRule,
  type HouseholdIssue,
  type HouseholdSnapshot,
} from '../domain/household.ts';
import type { HouseholdRepository, InvitationPreview } from '../ports/household-ports.ts';

export interface SharedExpenseInput {
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
  /** HU14; partes iguales when omitted (decision of 20-10-2026). */
  readonly rule?: ContributionRule;
}

/** Why a household action is refused. Messages are neutral Spanish for the user. */
export type HouseholdRefusal =
  | { readonly reason: 'not_found' }
  | { readonly reason: 'invalid'; readonly issues: readonly HouseholdIssue[] }
  | { readonly reason: 'already_member' }
  | { readonly reason: 'forbidden'; readonly message: string }
  /** Tabla 13: creating a household needs a plan with the shared space. */
  | { readonly reason: 'plan_limit'; readonly message: string }
  /** HU20: no member has a plan in force with the shared space; it is read-only. */
  | { readonly reason: 'read_only'; readonly message: string }
  | { readonly reason: 'invalid_invitation' };

export type HouseholdResult<T> = ({ readonly ok: true } & T) | ({ readonly ok: false } & HouseholdRefusal);

/** What one member sees of the household: shared data and their own contribution, nothing individual. */
export interface HouseholdView {
  readonly household: HouseholdSnapshot;
  readonly myRole: 'admin' | 'member';
  readonly myUserId: UserId;
  /** HU15: the actor's monthly part of each shared expense, by expense id. */
  readonly myShares: ReadonlyMap<string, number>;
  /** Every member's part of each expense: shared data (HU13), not their individual finances. */
  readonly shares: ReadonlyMap<string, ReadonlyMap<UserId, number>>;
}

export interface HouseholdDeps {
  readonly households: HouseholdRepository;
  readonly plans: PlanReader;
  readonly secrets: { opaqueToken(): string; sha256(secret: string): Uint8Array };
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Public URL of the web app, used in invitation links. */
  readonly appBaseUrl: string;
}

const READ_ONLY_MESSAGE =
  'El espacio del hogar está en modo de solo lectura porque ningún integrante tiene un plan Familiar vigente. Al renovar se restablece el acceso completo.';
const ADMIN_ONLY = 'Solo el administrador del hogar puede hacer esto.';
const refuse = <T>(refusal: HouseholdRefusal): HouseholdResult<T> => ({ ok: false, ...refusal });

/**
 * Household space (HU12-HU16, HU20, HU31). The shared space holds only shared data; the member's
 * contribution flows into their individual projection (HU15), and nothing individual flows back.
 */
export class HouseholdService implements CommitmentSource {
  private readonly deps: HouseholdDeps;

  constructor(deps: HouseholdDeps) {
    this.deps = deps;
  }

  async view(actor: Actor): Promise<HouseholdView | null> {
    const household = await this.deps.households.findForActor(actor);
    if (household === null) return null;
    const me = household.members.find((member) => member.userId === actor.userId);
    if (me === undefined) return null;
    const shares = new Map(household.expenses.map((expense) => [expense.id, splitExpense(expense, household.members)]));
    const myShares = new Map([...shares].map(([id, parts]) => [id, parts.get(actor.userId) ?? 0]));
    return { household, myRole: me.role, myUserId: actor.userId, myShares, shares };
  }

  /** HU15: the actor's contributions as fixed expenses of their own projection. */
  async commitmentsFor(actor: Actor): Promise<readonly Expense[]> {
    const household = await this.deps.households.findForActor(actor);
    return household === null ? [] : contributionsOf(household, actor.userId);
  }

  /** HU12: requires a plan with the shared space (Tabla 13, family plan). */
  async create(context: WriteContext, input: { readonly name: string; readonly displayName: string }): Promise<HouseholdResult<{ id: string }>> {
    const issues = [labelIssue(input.name, 'name'), labelIssue(input.displayName, 'displayName')].filter((issue) => issue !== null);
    if (issues.length > 0) return refuse({ reason: 'invalid', issues });
    const plan = await this.deps.plans.capabilitiesFor(context.actor);
    if (!plan.householdSpace) {
      return refuse({ reason: 'plan_limit', message: `El espacio del hogar no está incluido en el plan ${plan.name}. Está disponible en el plan Familiar.` });
    }
    const created = await this.deps.households.create(context, input.name.trim(), input.displayName.trim());
    return created === 'already_member' ? refuse({ reason: 'already_member' }) : { ok: true, id: created };
  }

  /** HU12, HU31: a single-use link valid for 7 days; only its hash is stored. */
  async invite(context: WriteContext): Promise<HouseholdResult<{ url: string; expiresAt: Date }>> {
    const view = await this.view(context.actor);
    if (view === null) return refuse({ reason: 'not_found' });
    if (view.myRole !== 'admin') return refuse({ reason: 'forbidden', message: ADMIN_ONLY });
    if (!view.household.spaceActive) return refuse({ reason: 'read_only', message: READ_ONLY_MESSAGE });
    const token = this.deps.secrets.opaqueToken();
    const expiresAt = new Date(this.deps.clock.now().getTime() + INVITATION_VALIDITY_MS);
    const created = await this.deps.households.createInvitation(context, view.household.id, this.deps.secrets.sha256(token), expiresAt);
    if (!created) return refuse({ reason: 'forbidden', message: ADMIN_ONLY });
    return { ok: true, url: `${this.deps.appBaseUrl}/#/invitacion?token=${token}`, expiresAt };
  }

  /** HU31: what the invited person sees before accepting. */
  preview(token: string): Promise<InvitationPreview | null> {
    return this.deps.households.previewInvitation(this.deps.secrets.sha256(token));
  }

  /** HU12, HU31: explicit acceptance with the token of the link. */
  async accept(context: WriteContext, input: { readonly token: string; readonly displayName: string }): Promise<HouseholdResult<{ id: string }>> {
    const issue = labelIssue(input.displayName, 'displayName');
    if (issue !== null) return refuse({ reason: 'invalid', issues: [issue] });
    const joined = await this.deps.households.acceptInvitation(context, this.deps.secrets.sha256(input.token), input.displayName.trim());
    if (joined === 'already_member') return refuse({ reason: 'already_member' });
    if (joined === 'invalid') return refuse({ reason: 'invalid_invitation' });
    return { ok: true, id: joined };
  }

  /** HU12: the admin removes a member. Leaving is always possible, even read-only (HU20). */
  async removeMember(context: WriteContext, userId: string): Promise<HouseholdResult<object>> {
    const view = await this.view(context.actor);
    if (view === null) return refuse({ reason: 'not_found' });
    const leaving = userId === context.actor.userId;
    if (!leaving && view.myRole !== 'admin') return refuse({ reason: 'forbidden', message: ADMIN_ONLY });
    if (!view.household.members.some((member) => member.userId === userId)) return refuse({ reason: 'not_found' });
    const removed = await this.deps.households.removeMember(context, view.household.id, userId as UserId);
    return removed ? { ok: true } : refuse({ reason: 'not_found' });
  }

  /** HU13, HU14: any member registers a shared expense while the space is active. */
  async addExpense(context: WriteContext, input: SharedExpenseInput): Promise<HouseholdResult<{ id: string }>> {
    const view = await this.writable(context.actor);
    if (!view.ok) return view;
    const rule = input.rule ?? { mode: 'equal' };
    if (view.myRole !== 'admin' && rule.mode !== 'equal') return refuse({ reason: 'forbidden', message: 'Solo el administrador del hogar configura las reglas de aporte.' });
    const issues = sharedExpenseIssues({ ...input, rule }, view.household.members);
    if (issues.length > 0) return refuse({ reason: 'invalid', issues });
    const id = this.deps.ids.newId();
    await this.deps.households.addExpense(context, view.household.id, { id, label: input.label.trim(), amount: input.amount, schedule: input.schedule, rule });
    return { ok: true, id };
  }

  /**
   * HU13, HU14: the author edits their expense and the admin edits any. Changing the split rule
   * is an admin decision (the database enforces the same).
   */
  async updateExpense(context: WriteContext, id: string, input: SharedExpenseInput): Promise<HouseholdResult<{ id: string }>> {
    const view = await this.writable(context.actor);
    if (!view.ok) return view;
    const current = view.household.expenses.find((expense) => expense.id === id);
    if (current === undefined) return refuse({ reason: 'not_found' });
    const isAdmin = view.myRole === 'admin';
    if (!isAdmin && current.createdBy !== context.actor.userId) return refuse({ reason: 'forbidden', message: 'Solo quien registró el gasto o el administrador pueden modificarlo.' });
    const rule = input.rule ?? current.rule;
    if (!isAdmin && JSON.stringify(rule) !== JSON.stringify(current.rule)) return refuse({ reason: 'forbidden', message: 'Solo el administrador del hogar configura las reglas de aporte.' });
    const issues = sharedExpenseIssues({ ...input, rule }, view.household.members);
    if (issues.length > 0) return refuse({ reason: 'invalid', issues });
    const updated = await this.deps.households.updateExpense(context, view.household.id, { id, label: input.label.trim(), amount: input.amount, schedule: input.schedule, rule });
    return updated ? { ok: true, id } : refuse({ reason: 'not_found' });
  }

  async deleteExpense(context: WriteContext, id: string): Promise<HouseholdResult<object>> {
    const view = await this.writable(context.actor);
    if (!view.ok) return view;
    const current = view.household.expenses.find((expense) => expense.id === id);
    if (current === undefined) return refuse({ reason: 'not_found' });
    if (view.myRole !== 'admin' && current.createdBy !== context.actor.userId) {
      return refuse({ reason: 'forbidden', message: 'Solo quien registró el gasto o el administrador pueden eliminarlo.' });
    }
    return (await this.deps.households.deleteExpense(context, view.household.id, id)) ? { ok: true } : refuse({ reason: 'not_found' });
  }

  private async writable(actor: Actor): Promise<HouseholdResult<HouseholdView>> {
    const view = await this.view(actor);
    if (view === null) return refuse({ reason: 'not_found' });
    if (!view.household.spaceActive) return refuse({ reason: 'read_only', message: READ_ONLY_MESSAGE });
    return { ok: true, ...view };
  }
}

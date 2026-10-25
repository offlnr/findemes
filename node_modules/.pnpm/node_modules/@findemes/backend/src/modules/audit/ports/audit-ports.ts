export interface AuditEntry {
  readonly occurredAt: Date;
  /** User or administrator who performed the action; `null` for system actions. */
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
}

/**
 * Append-only, hash-chained audit trail (RNF10, HU25). There is deliberately no update or delete:
 * the database role used by the services cannot modify past entries either.
 */
export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
}

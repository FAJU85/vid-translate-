/**
 * Audit brick: a log of who did what to sensitive data (admin sign-ins and changes, people
 * downloading or deleting their data), kept a year, readable on the /admin page.
 * This file is the brick's only public interface.
 */
export { AUDIT_SCHEMA, audit, recentAudit, sweepAudit, type AuditEntry } from './store';
export { handleAuditAdmin } from './handlers';

export type Finding = { severity: 'error' | 'warning'; code: string; eventId: string; message: string };
export function validateTrace(input: unknown): { ok: boolean; errors: string[]; ids?: Set<string> };
export function auditTrace(trace: { events: Array<{ id: string; type: string; time: string; content: string; references?: string[] }> }): { valid: boolean; errors: string[]; findings: Finding[] };

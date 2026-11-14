// ─── Purchase kinds ───
// The glossary's Individual Purchase and Team Licence. Browser-safe, so the
// trigger data contract can share it with refunds.server.ts.

export const PURCHASE_KINDS = ["individual_purchase", "team_licence"] as const;

export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

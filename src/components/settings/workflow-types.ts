export interface StatusRow {
  id: string;
  name: string;
  color: string;
  position: number;
  kind: "normal" | "won" | "lost";
  is_initial: boolean;
}
export interface TransitionRow {
  from_status_id: string;
  to_status_id: string;
  role_id: string | null;
}
export interface ActionRow {
  id: string;
  status_id: string;
  type: "assign" | "notify" | "create_task" | "webhook";
  config: Record<string, unknown>;
  position: number;
  enabled: boolean;
}
export interface RoleOpt {
  id: string;
  name: string;
  is_admin: boolean;
}
export interface MemberOpt {
  id: string;
  name: string;
}

export const KIND_LABEL = { normal: "Normal", won: "Final gagné", lost: "Final perdu" } as const;

export interface FlagDefinition {
  key: string;
  name: string;
  description: string | null;
  defaultValue: boolean;
  isGlobal: boolean;
  _count?: { overrides: number };
}

export interface FlagOverride {
  flagKey: string;
  tenantId: string;
  value: boolean;
  setById: string | null;
  setAt: string;
  flag: { key: string; name: string; defaultValue: boolean };
}

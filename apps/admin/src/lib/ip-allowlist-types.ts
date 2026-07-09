// #948 (Feature 4) — GET /platform/ip-allowlist satır tipi.
export interface IpAllowlistRule {
  id: string;
  cidr: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface HealthSnapshot {
  collectedAt: string;
  deployment: {
    gitSha: string | null;
    imageTag: string | null;
    buildTime: string | null;
    deployedAt: string;
    nodeEnv: string;
  };
  database: {
    connections: { active: number; idle: number; idleInTransaction: number; total: number };
    sizeBytes: number;
    sizePretty: string;
    slowQueryCountLast5m: number | null;
  };
  tenants: {
    active: number;
    trial: number;
    suspended: number;
    churned: number;
    total: number;
  };
  users: { totalActive: number; lockedUsers: number };
  sessions: { activeRefreshTokens: number };
  activity: {
    auditLogsLast24h: number;
    activeFraudAlerts: number;
    commissionsPendingReview: number;
  };
  storage: { iolLotsCount: number; patientPhotosCount: number };
}

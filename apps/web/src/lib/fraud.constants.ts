// E6 Fraud Detection — frontend sabitleri.

export const FRAUD_RULE_KEYS = [
  'night_operations',
  'stock_consume_without_surgery',
  'multi_ip_login',
  'frequent_patient_appointment',
] as const;
export type FraudRuleKey = (typeof FRAUD_RULE_KEYS)[number];

export const FRAUD_SEVERITIES = ['low', 'medium', 'high'] as const;
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

export const FRAUD_ALERT_STATUSES = ['new', 'reviewing', 'resolved', 'false_positive'] as const;
export type FraudAlertStatus = (typeof FRAUD_ALERT_STATUSES)[number];

// Bölüm 24 — durum = tint + ince kenar + metin (light+dark parity token'lardan).
export const SEVERITY_BADGE: Record<FraudSeverity, string> = {
  low: 'border border-info-border bg-info-bg text-info-foreground',
  medium: 'border border-warning-border bg-warning-bg text-warning-foreground',
  high: 'border border-critical-border bg-critical-bg text-critical-foreground',
};

export const STATUS_BADGE: Record<FraudAlertStatus, string> = {
  new: 'border border-critical-border bg-critical-bg text-critical-foreground',
  reviewing: 'border border-warning-border bg-warning-bg text-warning-foreground',
  resolved: 'border border-success-border bg-success-bg text-success-foreground',
  false_positive: 'bg-muted text-muted-foreground',
};

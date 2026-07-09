import { z } from 'zod';

// E6 Fraud Detection — Zod şemaları.

export const FRAUD_RULE_KEYS = [
  'night_operations',
  'stock_consume_without_surgery',
  'multi_ip_login',
  'frequent_patient_appointment',
] as const;
export const fraudRuleKeySchema = z.enum(FRAUD_RULE_KEYS);

export const FRAUD_SEVERITIES = ['low', 'medium', 'high'] as const;
export const fraudSeveritySchema = z.enum(FRAUD_SEVERITIES);

export const FRAUD_ALERT_STATUSES = ['new', 'reviewing', 'resolved', 'false_positive'] as const;
export const fraudAlertStatusSchema = z.enum(FRAUD_ALERT_STATUSES);

export const fraudAlertListQuerySchema = z.object({
  status: fraudAlertStatusSchema.optional(),
  severity: fraudSeveritySchema.optional(),
  ruleKey: fraudRuleKeySchema.optional(),
  actorUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const fraudAlertUpdateStatusSchema = z.object({
  id: z.string().uuid(),
  status: fraudAlertStatusSchema,
  reviewNote: z.string().trim().max(1000).optional(),
});

export const fraudRuleToggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export const fraudIdSchema = z.object({ id: z.string().uuid() });

export type FraudAlertListQuery = z.infer<typeof fraudAlertListQuerySchema>;
export type FraudAlertUpdateStatusInput = z.infer<typeof fraudAlertUpdateStatusSchema>;
export type FraudRuleToggleInput = z.infer<typeof fraudRuleToggleSchema>;

import { z } from 'zod';
import {
  DECISIONS,
  JEV_PROVIDERS,
  LOW_CONFIDENCE_POLICIES,
  REASON_CODES,
  REVIEWER_ID_PATTERN,
} from './enums.js';

export const ReviewerIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(REVIEWER_ID_PATTERN, 'Must be a GitHub login or team:slug');

export const CandidateSignalSchema = z
  .object({
    codeowners_hit: z.boolean().default(false),
    path_history: z.boolean().default(false),
    label_hint: z.boolean().default(false),
    component_map: z.boolean().default(false),
    team_mapped: z.boolean().default(false),
    monorepo_project: z.boolean().default(false),
    monorepo_projects: z.array(z.string().max(128)).max(16).default([]),
    available: z.boolean().nullable().default(null),
    open_review_requests: z.number().int().min(0).max(10_000).nullable().default(null),
  })
  .strict();

export type CandidateSignals = Omit<
  z.infer<typeof CandidateSignalSchema>,
  'monorepo_project' | 'monorepo_projects'
> & {
  monorepo_project?: boolean;
  monorepo_projects?: string[];
};

export const ReviewerCandidateSchema = z
  .object({
    id: ReviewerIdSchema,
    kind: z.enum(['user', 'team']),
    display_name: z.string().max(128).optional(),
    signals: CandidateSignalSchema.default({}),
  })
  .strict();

export type ReviewerCandidate = Omit<
  z.infer<typeof ReviewerCandidateSchema>,
  'signals'
> & {
  signals: CandidateSignals;
};

export const NavigatorDecisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    suggested_reviewers: z.array(ReviewerIdSchema).max(16),
    ranked_reviewers: z.array(ReviewerIdSchema).max(16).default([]),
    confidence: z.number().min(0).max(1),
    reason_codes: z.array(z.enum(REASON_CODES)).min(1).max(16),
    summary: z.string().max(500),
    provisional: z.boolean(),
    provider: z.enum(JEV_PROVIDERS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.suggested_reviewers).size !== value.suggested_reviewers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'suggested_reviewers must be unique',
        path: ['suggested_reviewers'],
      });
    }
    if (value.decision === 'RECOMMEND_REVIEWERS' && value.suggested_reviewers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RECOMMEND_REVIEWERS requires at least one suggested reviewer',
        path: ['suggested_reviewers'],
      });
    }
    if (value.decision !== 'RECOMMEND_REVIEWERS' && value.suggested_reviewers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.decision} must not include suggested_reviewers`,
        path: ['suggested_reviewers'],
      });
    }
  });

export type NavigatorDecision = z.infer<typeof NavigatorDecisionSchema>;

export const NavigatorConfigSchema = z
  .object({
    allowlist: z.array(ReviewerIdSchema).max(128).default([]),
    exclude_author: z.boolean().default(true),
    max_reviewers: z.number().int().min(1).max(16).default(3),
    component_map: z
      .record(z.string().max(128), z.array(ReviewerIdSchema).max(16))
      .default({}),
    label_team_map: z
      .record(z.string().max(64), z.array(ReviewerIdSchema).max(16))
      .default({}),
    project_reviewer_map: z
      .record(z.string().max(128), z.array(ReviewerIdSchema).max(16))
      .default({}),
    required_reviewers: z
      .array(
        z
          .object({
            paths: z.array(z.string().min(1).max(256)).max(32).default([]),
            any_of: z.array(ReviewerIdSchema).min(1).max(32),
            min: z.number().int().min(1).max(32),
          })
          .strict()
          .superRefine((rule, ctx) => {
            if (rule.min > rule.any_of.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'min cannot exceed any_of length',
                path: ['min'],
              });
            }
          }),
      )
      .max(64)
      .default([]),
    codeowners_path: z.string().max(256).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).optional(),
    jev_provider: z.enum(JEV_PROVIDERS).optional(),
    jev_model: z.string().max(256).optional(),
    jev_endpoint: z.string().max(2048).optional(),
  })
  .strict()
  .default({});

export type NavigatorConfig = z.infer<typeof NavigatorConfigSchema>;

export const JeConfigSchema = z
  .object({
    jev_provider: z.enum(JEV_PROVIDERS).optional(),
    jev_model: z.string().max(256).optional(),
    jev_endpoint: z.string().max(2048).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).optional(),
  })
  .strict()
  .passthrough()
  .default({});

export type JeConfig = z.infer<typeof JeConfigSchema>;

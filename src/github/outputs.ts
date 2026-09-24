import type { NavigatorDecision } from '../schemas/navigator.js';
import type { PolicyOutcome } from '../decision/policy.js';
import type { AssignStatus } from '../executors/reviewers.js';
import type { AvailabilityStatus } from '../collectors/availability.js';
import type { LoadMetrics } from '../collectors/load.js';

export interface ActionOutputWriter {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

export function writeDecisionOutputs(
  writer: ActionOutputWriter,
  decision: NavigatorDecision,
  extras: {
    affectedPaths: string[];
    assignStatus: AssignStatus;
    availabilityStatus: AvailabilityStatus;
    loadMetrics: LoadMetrics;
    needsReview: boolean;
  },
): void {
  writer.setOutput('decision', decision.decision);
  writer.setOutput('suggested_reviewers', JSON.stringify(decision.suggested_reviewers));
  writer.setOutput('ranked_reviewers', JSON.stringify(decision.ranked_reviewers));
  writer.setOutput('confidence', String(decision.confidence));
  writer.setOutput('reason_codes', JSON.stringify(decision.reason_codes));
  writer.setOutput('summary', decision.summary);
  writer.setOutput('provisional', String(decision.provisional));
  writer.setOutput('needs_review', String(extras.needsReview));
  writer.setOutput('affected_paths', JSON.stringify(extras.affectedPaths));
  writer.setOutput('jev_provider', decision.provider);
  writer.setOutput('assign_status', extras.assignStatus);
  writer.setOutput('availability_status', extras.availabilityStatus);
  writer.setOutput('load_metrics', JSON.stringify(extras.loadMetrics));
}

export function applyPolicyToAction(
  writer: ActionOutputWriter,
  outcome: PolicyOutcome,
  extras: {
    affectedPaths: string[];
    assignStatus: AssignStatus;
    availabilityStatus: AvailabilityStatus;
    loadMetrics: LoadMetrics;
    dryRun: boolean;
  },
): void {
  writeDecisionOutputs(writer, outcome.decision, {
    affectedPaths: extras.affectedPaths,
    assignStatus: extras.assignStatus,
    availabilityStatus: extras.availabilityStatus,
    loadMetrics: extras.loadMetrics,
    needsReview: outcome.status === 'request-review',
  });

  if (outcome.status === 'fail') {
    if (extras.dryRun) {
      writer.warning(`[dry_run] would fail: ${outcome.message}`);
      return;
    }
    writer.setFailed(outcome.message);
    return;
  }
  if (outcome.status === 'warn') {
    writer.warning(outcome.message);
  }
  if (outcome.status === 'request-review') {
    writer.warning('Reviewer selection requires human review');
  }
  if (outcome.status === 'no-op') {
    writer.info(outcome.message);
  }
}

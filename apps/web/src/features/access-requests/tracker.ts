import type { RequestDto, RequestStatus } from "@ari/api-client";
import type { RequestStepId, StatusKind } from "@ari/design-system";
import type { MessageKey } from "@ari/i18n";

export interface TrackerView {
  current: RequestStepId;
  status?: StatusKind;
  bannerKey: MessageKey;
  /** description key for the current stage, requests.tracker.stage.<stage>.<state> */
  descKey?: MessageKey;
  needsAction: boolean;
}

/** Maps the canonical request-state enum (C-01) to the 8-step stepper. Pure and tested. */
export function trackerView(status: RequestStatus, closeReason?: RequestDto["closeReason"]): TrackerView {
  switch (status) {
    case "draft": return { current: "cart", bannerKey: "requests.tracker.status.draft", descKey: "requests.tracker.stage.cart.current", needsAction: false };
    case "submitted": return { current: "submission", bannerKey: "requests.tracker.status.submitted", descKey: "requests.tracker.stage.submission.current", needsAction: false };
    case "precheck": return { current: "precheck", bannerKey: "requests.tracker.status.precheck", descKey: "requests.tracker.stage.precheck.current", needsAction: false };
    case "needs_info": return { current: "precheck", status: "waiting-you", bannerKey: "requests.tracker.status.needsInfo", descKey: "requests.tracker.stage.precheck.waitingYou", needsAction: true };
    case "committee_review": return { current: "committee", bannerKey: "requests.tracker.status.committee", descKey: "requests.tracker.stage.committee.current", needsAction: false };
    case "appeal_review": return { current: "committee", bannerKey: "requests.tracker.status.committee", descKey: "requests.tracker.stage.committee.current", needsAction: false };
    case "rejected": return { current: "committee", status: "rejected", bannerKey: "requests.tracker.status.rejected", descKey: "requests.tracker.stage.committee.rejected", needsAction: false };
    case "approved": return { current: "coordination", bannerKey: "requests.tracker.status.approved", descKey: "requests.tracker.stage.coordination.current", needsAction: false };
    case "center_coordination": return { current: "coordination", bannerKey: "requests.tracker.status.approved", descKey: "requests.tracker.stage.coordination.current", needsAction: false };
    case "agreements": return { current: "agreements", bannerKey: "requests.tracker.status.agreement", descKey: "requests.tracker.stage.agreements.current", needsAction: false };
    case "delivery": return { current: "delivery", bannerKey: "requests.tracker.status.delivery", descKey: "requests.tracker.stage.delivery.current", needsAction: false };
    case "closed": return closeReason === "delivered"
      ? { current: "closed", bannerKey: "requests.tracker.status.delivered", descKey: "requests.tracker.stage.closed.done", needsAction: false }
      : { current: "closed", bannerKey: "requests.tracker.status.closed", descKey: "requests.tracker.stage.closed.done", needsAction: false };
  }
}

/** API step keys that feed each stepper stage (for dates and public notes). */
export const STAGE_STEP: Record<RequestStepId, string | null> = {
  cart: null, submission: "submitted", precheck: "precheck", committee: "committee_review",
  coordination: "center_coordination", agreements: "mta_dta", delivery: "delivery", closed: "closed",
};

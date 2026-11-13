import { describe, expect, it } from "vitest";
import { REQUEST_STEP_IDS } from "@ari/design-system";
import { trackerView } from "./tracker";

const STATUSES = ["draft", "submitted", "precheck", "needs_info", "committee_review", "approved", "rejected", "center_coordination", "agreements", "delivery", "delivered", "withdrawn", "closed"] as const;

describe("trackerView", () => {
  it("maps every canonical status to one of the 8 steps", () => {
    for (const s of STATUSES) expect(REQUEST_STEP_IDS).toContain(trackerView(s).current);
  });
  it("flags needs_info as waiting on the applicant", () => {
    const v = trackerView("needs_info");
    expect(v.needsAction).toBe(true);
    expect(v.status).toBe("waiting-you");
  });
  it("shows rejection at the committee step", () => {
    expect(trackerView("rejected")).toMatchObject({ current: "committee", status: "rejected" });
  });
  it("delivered ends at closed", () => expect(trackerView("delivered").current).toBe("closed"));
});

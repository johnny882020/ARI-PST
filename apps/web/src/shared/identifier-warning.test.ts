import { describe, expect, it } from "vitest";
import { identifierKind, identifierMessageKey, looksIdentifying } from "./identifier-warning";

// Synthetic values only. The cases follow packages/domain/src/identifier-guard.ts (G1..G5).
describe("identifier guard (client mirror of the server rules)", () => {
  it("flags a 9-digit run as an ID number", () => {
    expect(identifierKind("id 123456789 here")).toBe("idNumber");
    expect(identifierKind("Patient ID 123456789 phone 050-1234567")).toBe("idNumber");
  });
  it("flags phone numbers", () => {
    expect(identifierKind("call 050-1234567")).toBe("phone");
    expect(identifierKind("call +972 50 123 4567")).toBe("phone");
    expect(identifierKind("03-1234567")).toBe("phone");
  });
  it("flags e-mail addresses", () => {
    expect(identifierKind("write to a.b@example.test")).toBe("email");
  });
  it("flags exact dates, in day-first and ISO form", () => {
    expect(identifierKind("born 03/04/2015")).toBe("date");
    expect(identifierKind("on 3.4.15")).toBe("date");
    expect(identifierKind("on 2015-04-03")).toBe("date");
  });
  it("flags long digit runs", () => {
    expect(identifierKind("file 12345678")).toBe("digits");
    expect(identifierKind("record 1234567")).toBe("digits");
  });
  it("sees through other digit scripts and hidden marks", () => {
    expect(identifierKind("\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669")).toBe("idNumber");
    expect(identifierKind("1234\u200b56789")).toBe("idNumber");
    expect(identifierKind("\uff11\uff12\uff13\uff14\uff15\uff16\uff17")).toBe("digits");
  });
  it("passes ordinary research text", () => {
    for (const ok of ["Outcome of low-grade glioma in 120 samples", "Cohort 2015 to 2020, about 250000 reads per sample", "Collected 2021-03 (month only)", "IRB ref HEL-SYN-900", ""]) {
      expect(looksIdentifying(ok)).toBe(false);
    }
    expect(looksIdentifying(undefined)).toBe(false);
  });
  it("maps each rule to its own message", () => {
    expect(identifierMessageKey("id 123456789")).toBe("form.error.identifier.idNumber");
    expect(identifierMessageKey("050-1234567")).toBe("form.error.identifier.phone");
    expect(identifierMessageKey("a@example.test")).toBe("form.error.identifier.email");
    expect(identifierMessageKey("03/04/2015")).toBe("form.error.identifier.date");
    expect(identifierMessageKey("1234567")).toBe("form.error.identifier.digits");
    expect(identifierMessageKey("clean text")).toBeUndefined();
  });
});

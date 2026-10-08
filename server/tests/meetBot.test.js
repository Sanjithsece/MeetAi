import { describe, expect, it } from "vitest";
import { browserCandidates, getJoinButtonSelectors, isJoinActionLabel } from "../src/services/automation/meetBot.js";

describe("Google Meet join detection", () => {
  it("recognizes the current Google Meet action labels", () => {
    expect(isJoinActionLabel("Join now")).toBe(true);
    expect(isJoinActionLabel("Ask to join")).toBe(true);
    expect(isJoinActionLabel("Continue")).toBe(true);
    expect(isJoinActionLabel("Leave call")).toBe(false);
  });

  it("does not mistake non-joining buttons for the join action", () => {
    expect(isJoinActionLabel("Other ways to join")).toBe(false);
    expect(isJoinActionLabel("Joining info")).toBe(false);
    expect(isJoinActionLabel("Present now")).toBe(false);
    expect(isJoinActionLabel("Continue without microphone and camera")).toBe(true);
    expect(isJoinActionLabel("Join anyway")).toBe(true);
  });

  it("joins alongside the user's own session but never takes it over", () => {
    expect(isJoinActionLabel("Join here too")).toBe(true);
    // "Switch here" would move the user's own call into the bot window.
    expect(isJoinActionLabel("Switch here")).toBe(false);
  });

  it("falls back Chrome -> Edge -> bundled Chromium", () => {
    expect(browserCandidates("chrome")).toEqual(["chrome", "msedge", "chromium"]);
    expect(browserCandidates("msedge")).toEqual(["msedge", "chrome", "chromium"]);
  });

  it("includes both text and aria-label selectors for modern Meet buttons", () => {
    const selectors = getJoinButtonSelectors();
    expect(selectors.some((selector) => selector.toLowerCase().includes("join"))).toBe(true);
    expect(selectors.some((selector) => selector.toLowerCase().includes("continue"))).toBe(true);
  });
});

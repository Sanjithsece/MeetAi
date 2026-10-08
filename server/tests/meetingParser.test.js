import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  extractMeetingUrl,
  extractParticipants,
  extractSchedule,
  parseMeetingFromMessage
} from "../src/services/gmail/meetingParser.js";

describe("extractMeetingUrl", () => {
  it("finds a Google Meet link", () => {
    expect(extractMeetingUrl("Join here: https://meet.google.com/abc-defg-hij thanks")).toBe(
      "https://meet.google.com/abc-defg-hij"
    );
  });

  it("finds a Zoom link", () => {
    expect(extractMeetingUrl("https://us02web.zoom.us/j/123456789")).toBe("https://us02web.zoom.us/j/123456789");
  });

  it("strips trailing punctuation", () => {
    expect(extractMeetingUrl("Link (https://meet.google.com/abc-defg-hij).")).toBe(
      "https://meet.google.com/abc-defg-hij"
    );
  });

  it("returns null when there is no meeting link", () => {
    expect(extractMeetingUrl("Lunch at 1pm?")).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("removes the calendar invitation prefix and time suffix", () => {
    expect(cleanTitle("Invitation: Sprint Review @ Mon Aug 24, 2026 10am - 11am")).toBe("Sprint Review");
  });

  it("leaves a plain subject alone", () => {
    expect(cleanTitle("Weekly sync")).toBe("Weekly sync");
  });
});

describe("extractSchedule", () => {
  it("reads a Google Calendar When: line", () => {
    const schedule = extractSchedule("When: Mon Aug 24, 2026 10:00am - 11:00am (IST)");
    expect(schedule?.startTime.getFullYear()).toBe(2026);
    expect(schedule?.startTime.getMonth()).toBe(7);
    expect(schedule?.startTime.getDate()).toBe(24);
    expect(schedule?.startTime.getHours()).toBe(10);
    expect(schedule?.endTime?.getHours()).toBe(11);
  });

  it("reads a day-first date", () => {
    const schedule = extractSchedule("When: 24 August 2026 2:30pm - 3:00pm");
    expect(schedule?.startTime.getHours()).toBe(14);
    expect(schedule?.startTime.getMinutes()).toBe(30);
  });

  it("returns null when there is no date", () => {
    expect(extractSchedule("Let us meet sometime soon")).toBeNull();
  });
});

describe("extractParticipants", () => {
  it("collects addresses and marks the sender as organizer", () => {
    const participants = extractParticipants(
      { from: "Ann <ann@example.com>", to: "bob@example.com, cara@example.com" },
      "Guests: dan@example.com"
    );
    const emails = participants.map((participant) => participant.email);
    expect(emails).toContain("ann@example.com");
    expect(emails).toContain("dan@example.com");
    expect(participants.find((participant) => participant.email === "ann@example.com")?.role).toBe("ORGANIZER");
  });
});

describe("parseMeetingFromMessage", () => {
  const body = [
    "You have been invited to the following event.",
    "Sprint Review",
    "When: Mon Aug 24, 2026 10:00am - 11:00am (IST)",
    "Joining info: https://meet.google.com/abc-defg-hij",
    "Guests: bob@example.com"
  ].join("\n");

  it("builds a meeting draft from a calendar invitation", () => {
    const draft = parseMeetingFromMessage({
      headers: { subject: "Invitation: Sprint Review @ Mon Aug 24", from: "Ann <ann@example.com>" },
      body,
      internalDate: String(Date.UTC(2026, 7, 20)),
      messageId: "msg-1"
    });

    expect(draft).not.toBeNull();
    expect(draft.title).toBe("Sprint Review");
    expect(draft.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(draft.source).toBe("GMAIL");
    expect(draft.sourceMessageId).toBe("msg-1");
    expect(draft.startTime.getDate()).toBe(24);
    expect(draft.participants.map((participant) => participant.email)).toContain("bob@example.com");
  });

  it("returns null for a message with no meeting link", () => {
    const draft = parseMeetingFromMessage({
      headers: { subject: "Your invoice" },
      body: "Please find the invoice attached.",
      messageId: "msg-2"
    });
    expect(draft).toBeNull();
  });

  it("falls back to the message date when no schedule is present", () => {
    const received = Date.UTC(2026, 7, 20, 9, 0);
    const draft = parseMeetingFromMessage({
      headers: { subject: "Quick sync" },
      body: "https://meet.google.com/abc-defg-hij",
      internalDate: String(received),
      messageId: "msg-3"
    });
    expect(draft.startTime.getTime()).toBe(received);
  });
});

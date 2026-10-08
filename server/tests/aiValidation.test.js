import { describe, expect, it } from "vitest";
import { extractJson, normalizeAnalysis, parseAnalysis } from "../src/services/ai/validation.js";

const VALID = {
  summary: "The team reviewed the backend API and agreed on the launch date.",
  importantTopics: ["Backend API", "Launch date"],
  decisions: ["Launch on 30 August"],
  actionItems: [{ task: "Complete backend API", person: "Sanjith", deadline: "Friday", priority: "high" }],
  deadlines: [{ label: "Backend API", date: "Friday", person: "Sanjith" }],
  peopleResponsible: ["Sanjith"],
  sentiment: "positive",
  priority: "high"
};

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson(JSON.stringify(VALID))?.summary).toBe(VALID.summary);
  });

  it("pulls JSON out of a fenced code block", () => {
    const raw = "Here you go:\n```json\n" + JSON.stringify(VALID) + "\n```\nHope that helps.";
    expect(extractJson(raw)?.priority).toBe("high");
  });

  it("pulls JSON out of surrounding prose", () => {
    const raw = `Sure! ${JSON.stringify(VALID)} Let me know if you need more.`;
    expect(extractJson(raw)?.decisions).toEqual(["Launch on 30 August"]);
  });

  it("handles nested braces and braces inside strings", () => {
    const payload = { summary: "We discussed the {roadmap} object", importantTopics: [], decisions: [] };
    expect(extractJson(`noise ${JSON.stringify(payload)} noise`)?.summary).toBe(payload.summary);
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJson("I could not analyse that transcript.")).toBeNull();
  });
});

describe("normalizeAnalysis", () => {
  it("converts a valid model response into the storage shape", () => {
    const result = normalizeAnalysis(VALID);
    expect(result.ok).toBe(true);
    expect(result.value.priority).toBe("HIGH");
    expect(result.value.sentiment).toBe("POSITIVE");
    expect(result.value.actionItems[0]).toEqual({
      task: "Complete backend API",
      person: "Sanjith",
      deadline: "Friday",
      priority: "HIGH"
    });
  });

  it("fills in missing optional fields", () => {
    const result = normalizeAnalysis({ summary: "Short meeting." });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      importantTopics: [],
      decisions: [],
      actionItems: [],
      sentiment: "NEUTRAL",
      priority: "MEDIUM"
    });
  });

  it("accepts deadlines given as plain strings", () => {
    const result = normalizeAnalysis({ summary: "x", deadlines: ["Ship by Friday"] });
    expect(result.value.deadlines).toEqual([{ label: "Ship by Friday", date: "", person: "" }]);
  });

  it("drops action items with no task text", () => {
    const result = normalizeAnalysis({ summary: "x", actionItems: [{ task: "   " }, { task: "Real task" }] });
    expect(result.value.actionItems).toHaveLength(1);
  });

  it("strips placeholder text the model writes instead of leaving a field blank", () => {
    const result = normalizeAnalysis({
      summary: "Short meeting.",
      importantTopics: ["N/A", "Real topic"],
      actionItems: [{ task: "Ship it", person: "unknown", deadline: "empty string", priority: "medium" }],
      deadlines: [{ label: "none", date: "N/A", person: "" }],
      peopleResponsible: ["none", "Priya"]
    });

    expect(result.value.importantTopics).toEqual(["Real topic"]);
    expect(result.value.actionItems[0]).toEqual({ task: "Ship it", person: "", deadline: "", priority: "MEDIUM" });
    expect(result.value.deadlines).toEqual([]);
    expect(result.value.peopleResponsible).toEqual(["Priya"]);
  });

  it("rejects a response with no summary", () => {
    const result = normalizeAnalysis({ importantTopics: ["a"] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("summary");
  });

  it("never stores an unknown priority/sentiment - it is normalised instead of failing the analysis", () => {
    const result = normalizeAnalysis({ summary: "x", priority: "urgent-ish", sentiment: "ecstatic" });
    expect(result.ok).toBe(true);
    expect(result.value.priority).toBe("MEDIUM");
    expect(result.value.sentiment).toBe("NEUTRAL");
  });

  it("accepts the empty action-item priority llama3 produced in the live E2E run", () => {
    const result = normalizeAnalysis({
      summary: "Sprint planning",
      actionItems: [{ task: "Create the database schema", person: "Rahul", deadline: "October 15", priority: "" }]
    });
    expect(result.ok).toBe(true);
    expect(result.value.actionItems[0]).toEqual({ task: "Create the database schema", person: "Rahul", deadline: "October 15", priority: "MEDIUM" });
  });
});

describe("parseAnalysis", () => {
  it("parses and validates in one step", () => {
    const result = parseAnalysis("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(result.ok).toBe(true);
    expect(result.value.summary).toBe(VALID.summary);
  });

  it("reports unparsable output rather than throwing", () => {
    const result = parseAnalysis("The transcript was too short to analyse.");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No JSON object/);
  });
});

describe("analysis normalisation details", () => {
  it("derives a short summary from the summary when the model leaves it blank", () => {
    const result = normalizeAnalysis({ summary: "The team chose MongoDB. Rahul owns the schema.", shortSummary: "" });
    expect(result.value.shortSummary).toBe("The team chose MongoDB.");
  });

  it("keeps a short summary the model did provide", () => {
    const result = normalizeAnalysis({ summary: "Long text here.", shortSummary: "Chose MongoDB" });
    expect(result.value.shortSummary).toBe("Chose MongoDB");
  });
});

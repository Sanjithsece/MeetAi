/** Keys the model must return - kept in one place so prompt and validator agree. */
export const AI_OUTPUT_SHAPE = `{
  "title": "short descriptive meeting title (max 10 words)",
  "shortSummary": "one or two sentences",
  "summary": "detailed paragraph(s) covering what was discussed and what came out of it",
  "keyPoints": ["important point that was raised"],
  "importantTopics": ["short topic label"],
  "decisions": ["decision that was actually agreed"],
  "actionItems": [
    { "task": "what must be done", "person": "who owns it", "deadline": "as stated in the meeting", "priority": "low|medium|high|critical" }
  ],
  "deadlines": [ { "label": "what is due", "date": "as stated", "person": "owner" } ],
  "questions": ["open question that was raised but not answered"],
  "peopleResponsible": ["name"],
  "followUps": ["recommended next step"],
  "sentiment": "positive|neutral|negative|mixed",
  "meetingStatus": "productive|blocked|informational|inconclusive",
  "priority": "low|medium|high|critical"
}`;

export const SYSTEM_PROMPT = `You are MeetAI, a meeting analyst running locally on the user's own computer.
You read a raw meeting transcript and return structured meeting intelligence.
Rules you must follow:
- Reply with a single JSON object and nothing else. No markdown fences, no commentary.
- Use only information present in the transcript. Never invent people, dates or decisions.
- When a value is not stated in the transcript, use "" for text and [] for lists.
- Never write placeholder text such as "empty string", "N/A", "unknown" or "none" as a value.
- Action items: include EVERY commitment. Whenever any person says they will do something, is asked to do something, or "owns" something, that is a separate action item with that person as owner.
- Always fill "title", "shortSummary" and "summary" when the transcript has any content.
- Keep every string plain text.`;

export function buildAnalysisPrompt({ title, startTime, participants = [], transcript, partial = false }) {
  const attendees = participants
    .map((participant) => participant.name || participant.email)
    .filter(Boolean)
    .join(", ");

  return `Meeting title: ${title || "Untitled meeting"}
Meeting date: ${startTime ? new Date(startTime).toISOString() : "unknown"}
Known participants: ${attendees || "unknown"}
${partial ? "\nThe meeting was long, so below are notes extracted from each consecutive part of the transcript, in order.\n" : ""}
Return exactly this JSON shape, using "" for any text value the transcript does not state:
${AI_OUTPUT_SHAPE}

${partial ? "Notes from the meeting parts" : "Transcript"}:
"""
${transcript}
"""`;
}

/** Map step for long transcripts: dense plain-text notes per chunk. */
export const CHUNK_SYSTEM_PROMPT = `You condense one part of a longer meeting transcript into factual notes.
Write plain text bullet points only. Keep names, numbers, dates, decisions, action items (with owner and deadline) and open questions exactly as stated. Never invent anything.`;

export function buildChunkPrompt({ title, index, total, text }) {
  return `Meeting: ${title || "Untitled meeting"} - part ${index} of ${total}

Transcript part:
"""
${text}
"""

Notes:`;
}

export function buildRepairPrompt(rawOutput, validationMessage) {
  return `Your previous reply could not be parsed as the required JSON object.
Parser error: ${validationMessage}

Previous reply:
"""
${String(rawOutput).slice(0, 6000)}
"""

Return the same information as a single valid JSON object matching this shape, with no other text.
Use "" for any text value the transcript does not state - never the words "empty string" or "N/A":
${AI_OUTPUT_SHAPE}`;
}

/** RAG answer prompt - the model may only use the retrieved context. */
export const RAG_SYSTEM_PROMPT = `You are MeetAI, answering questions about the user's own past meetings.
Answer ONLY from the numbered context passages. If the answer is not in the context, say you could not find it in the saved meetings.
Cite the passages you used like [1], [2]. Be concise and plain.`;

export function buildRagPrompt(question, passages) {
  const context = passages
    .map((passage, index) => `[${index + 1}] (${passage.meetingTitle ?? "meeting"}${passage.date ? `, ${passage.date}` : ""} - ${passage.sourceType})\n${passage.text}`)
    .join("\n\n");
  return `Context passages:
${context || "(no passages found)"}

Question: ${question}

Answer:`;
}

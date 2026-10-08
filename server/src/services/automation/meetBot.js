import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { env } from "../../config/env.js";
import { ensureStorageDirectories } from "../../config/paths.js";
import { logger } from "../../utils/logger.js";

/**
 * Google Meet automation on top of a *persistent local browser profile*.
 *
 * MeetAI never asks for, stores or types a Google password. You sign in once
 * yourself in the browser window MeetAI opens (`connectGoogleAccount`), Chromium
 * keeps the session in BROWSER_PROFILE_DIR, and every later join reuses it.
 */

/** meetingId -> live browser session. */
const sessions = new Map();

export function isJoined(meetingId) {
  return sessions.has(String(meetingId));
}

export function activeSessions() {
  return [...sessions.keys()];
}

/**
 * Browser order: the configured channel first, then installed Chrome, then
 * Edge (present on every Windows 10/11 PC), then Playwright's own Chromium.
 * Using an installed browser means no extra download on a student laptop.
 */
export function browserCandidates(preferred = env.meeting.browserChannel) {
  const order = [preferred, "chrome", "msedge", "chromium"];
  return [...new Set(order.filter(Boolean))];
}

async function launchContext({ headless = env.meeting.headless } = {}) {
  ensureStorageDirectories();
  const options = {
    headless,
    viewport: null,
    // The bot never needs your microphone or camera (FFmpeg records the meeting),
    // so camera/mic access is not granted and every permission prompt is denied:
    // Meet joins with both OFF.
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--deny-permission-prompts"],
    permissions: [],
    ignoreDefaultArgs: ["--enable-automation"]
  };

  const failures = [];
  for (const channel of browserCandidates()) {
    try {
      const context = await chromium.launchPersistentContext(env.paths.browserProfile, {
        ...options,
        ...(channel === "chromium" ? {} : { channel })
      });
      context.meetaiBrowser = channel;
      return context;
    } catch (error) {
      const firstLine = error.message.split("\n")[0];
      failures.push(`${channel}: ${firstLine}`);
      logger.debug("Browser channel unavailable, trying the next one", { channel, error: firstLine });
      // A locked profile fails the same way for every channel - stop early.
      if (/ProcessSingleton|profile.*in use|user data directory is already in use/i.test(error.message)) break;
    }
  }
  throw new Error(
    `No browser could be launched with the MeetAI profile. Install Google Chrome or Microsoft Edge, or run "npx playwright install chromium". Close any other MeetAI browser window using ${env.paths.browserProfile}. Details: ${failures.join(" | ")}`
  );
}

/**
 * Opens the persistent profile on the Google account page so the user can sign
 * in by hand. The window stays open until they close it.
 */
/** Installed Chrome (preferred) or Edge executable on this machine, or null. */
export function findInstalledBrowser() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe")
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge"];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

/**
 * Opens the MeetAI profile on Google's sign-in page so the user can sign in by
 * hand. This is a NORMAL Chrome window (not automation-controlled): Google
 * refuses sign-in inside automated browsers ("This browser may not be secure").
 * The window stays open until the user closes it; the session is then reused
 * by every automated join.
 */
export async function connectGoogleAccount() {
  if (sessions.size) {
    throw new Error("A meeting is using the MeetAI browser profile right now. Stop it first, then connect.");
  }
  ensureStorageDirectories();
  const executable = findInstalledBrowser();

  if (executable) {
    const child = spawn(
      executable,
      [
        `--user-data-dir=${env.paths.browserProfile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "https://accounts.google.com/signin/v2/identifier?continue=https%3A%2F%2Fmeet.google.com%2F"
      ],
      { detached: true, stdio: "ignore", windowsHide: false }
    );
    child.unref();
    logger.info("Browser opened for Google sign-in", { browser: path.basename(executable), profile: env.paths.browserProfile });
    return {
      message:
        "A Chrome window opened with the MeetAI profile. Sign in to Google there (you type your password on Google's page - MeetAI never sees it), then close that window.",
      profileDir: env.paths.browserProfile,
      async waitForClose() {
        await new Promise((resolve) => child.on("exit", resolve));
      }
    };
  }

  // No Chrome/Edge installed: fall back to Playwright's bundled browser.
  const context = await launchContext({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  logger.info("Browser launched for Google sign-in", { profile: env.paths.browserProfile });
  return {
    message:
      "A browser window opened with your local MeetAI profile. Sign in to Google there, then close the window - the session is reused for every future meeting.",
    profileDir: env.paths.browserProfile,
    async waitForClose() {
      await new Promise((resolve) => context.on("close", resolve));
    }
  };
}

/** True when the browser context holds a signed-in Google session. */
async function hasGoogleSession(context) {
  const cookies = await context.cookies("https://google.com").catch(() => []);
  return cookies.some((cookie) => GOOGLE_SESSION_COOKIES.includes(cookie.name) && (cookie.value ?? "").length > 10);
}

/** Cookies Google sets only for a signed-in session. */
const GOOGLE_SESSION_COOKIES = ["SID", "__Secure-1PSID", "__Secure-3PSID"];

/**
 * True when the persistent profile already holds a Google session.
 *
 * Checked with the session cookies rather than the landing URL: a signed-out
 * profile is redirected to a marketing page whose URL says nothing useful.
 */
export async function browserProfileStatus() {
  // Chromium locks the profile directory: never open a second context on it
  // while a meeting is live.
  if (sessions.size) {
    return {
      available: true,
      signedIn: true,
      inMeeting: true,
      profileDir: env.paths.browserProfile,
      message: "A meeting is in progress with the MeetAI browser profile"
    };
  }
  let context = null;
  try {
    context = await launchContext({ headless: true });
    const page = await context.newPage();
    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: 30000 });

    const cookies = await context.cookies("https://google.com");
    const hasSession = cookies.some(
      (cookie) => GOOGLE_SESSION_COOKIES.includes(cookie.name) && (cookie.value ?? "").length > 10
    );
    const onAccountPage = new URL(page.url()).hostname === "myaccount.google.com";
    const signedIn = hasSession && onAccountPage;

    return {
      available: true,
      signedIn,
      browser: context.meetaiBrowser,
      profileDir: env.paths.browserProfile,
      message: signedIn
        ? "Local browser profile has an active Google session"
        : "Local browser profile exists but is not signed in to Google. Use Connect browser session."
    };
  } catch (error) {
    return {
      available: false,
      signedIn: false,
      profileDir: env.paths.browserProfile,
      message: `Playwright could not open the local browser profile: ${error.message}`
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * Waits up to `timeout` ms for the element to become visible.
 * NOTE: Playwright's `locator.isVisible({ timeout })` ignores the timeout and
 * returns immediately - which is why joins used to fail on Meet's slow SPA.
 */
async function waitVisible(locator, timeout) {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function clickIfVisible(page, selector, timeout = 3000) {
  const element = page.locator(selector).first();
  if (await waitVisible(element, timeout)) {
    await element.click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * True only for the buttons that actually enter a call ("Join now",
 * "Ask to join", "Join meeting", "Continue", "Join anyway"...). Labels such as
 * "Other ways to join" or "Joining info" must not match.
 */
export function isJoinActionLabel(label = "") {
  if (!label) return false;
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  if (/other ways|joining info|join by phone|use companion|present/.test(normalized)) return false;
  // "Switch here" is deliberately excluded: it would move the user's OWN
  // session (same Google account) into the bot window. "Join here too" is fine.
  if (/switch here/.test(normalized)) return false;
  return /^(join( now| meeting| call| anyway| here too)?|ask to join|continue( without (microphone|camera|microphone and camera))?)\b/.test(normalized);
}

export function getJoinButtonSelectors() {
  return [
    'button:has-text("Join now")',
    'button:has-text("Join here too")',
    'button:has-text("Ask to join")',
    'button:has-text("Join meeting")',
    'button:has-text("Continue")',
    'button[aria-label*="join" i]',
    'button[aria-label*="ask to join" i]',
    'button[aria-label*="continue" i]',
    '[role="button"][aria-label*="join" i]',
    '[role="button"][aria-label*="ask to join" i]',
    '[role="button"][aria-label*="continue" i]'
  ];
}

const CONTINUE_WITHOUT_DEVICES =
  'button:has-text("Continue without microphone and camera"), button:has-text("Continue without microphone"), button:has-text("Continue without camera"), [role="button"]:has-text("Continue without microphone")';

/** Clicks Meet's "Continue without microphone and camera" prompt when it is shown. */
async function dismissDeviceDialog(page) {
  const button = page.locator(CONTINUE_WITHOUT_DEVICES).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);
    return true;
  }
  return false;
}

/** Meet's tips and nags ("Sign in with your Google account - Got it", "Dismiss"...). */
const OVERLAY_BUTTONS =
  'button:has-text("Got it"), button:has-text("Dismiss"), button:has-text("No thanks"), [role="button"]:has-text("Got it"), [role="button"][aria-label="Close" i]';

/** Clears everything that can cover the join button before clicking it. */
async function dismissOverlays(page) {
  let dismissed = await dismissDeviceDialog(page);
  for (let index = 0; index < 3; index += 1) {
    const button = page.locator(OVERLAY_BUTTONS).first();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);
    dismissed = true;
  }
  return dismissed;
}

const GUEST_NAME_FIELD = 'input[aria-label*="name" i], input[placeholder*="name" i], input[type="text"]:visible';

/**
 * Types the display name on the guest screen. `fill()` alone is not always seen
 * by Meet's framework, so it falls back to real keystrokes. Returns the field
 * (so Enter can submit it) or null when no name is asked.
 */
async function fillGuestName(page, displayName) {
  const field = page.locator(GUEST_NAME_FIELD).first();
  if (!(await waitVisible(field, 1500))) return null;
  const current = await field.inputValue().catch(() => "");
  if (current.trim()) return field;
  await field.click({ timeout: 3000 }).catch(() => undefined);
  await field.fill(displayName).catch(() => undefined);
  if (!(await field.inputValue().catch(() => "")).trim()) {
    await field.pressSequentially(displayName, { delay: 40 }).catch(() => undefined);
  }
  await field.dispatchEvent("input").catch(() => undefined);
  logger.info("Guest name entered", { name: displayName });
  return field;
}

/** Waits for the join button to become enabled, then clicks it (with fallbacks). */
async function clickJoinControl(page, fallbackControl, nameField) {
  const deadline = Date.now() + 15000;
  let control = (await findJoinControl(page)) ?? fallbackControl;
  while (Date.now() < deadline && !(await control.isEnabled().catch(() => false))) {
    await dismissOverlays(page);
    await page.waitForTimeout(500).catch(() => undefined);
    control = (await findJoinControl(page)) ?? control;
  }

  try {
    await control.click({ timeout: 5000 });
    return;
  } catch (error) {
    logger.warn("Join click blocked, retrying past overlays", { error: firstLine(error.message) });
  }
  await dismissOverlays(page);
  await page.keyboard.press("Escape").catch(() => undefined);
  const forced = await control
    .click({ timeout: 5000, force: true })
    .then(() => true)
    .catch(() => false);
  if (forced) return;
  // Last resort: Enter in the name field submits the guest form.
  if (nameField && (await nameField.press("Enter").then(() => true).catch(() => false))) return;
  throw new JoinError("The Join button never became clickable (Meet kept it disabled or covered)", { retryable: true });
}

/** Playwright errors carry ANSI colours and a multi-line call log - keep the first clean line. */
export function firstLine(message = "") {
  return String(message)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")[0]
    .trim();
}

/** One pass over the page: the first visible join control, or null. */
async function findJoinControl(page) {
  for (const selector of getJoinButtonSelectors()) {
    const element = page.locator(selector).first();
    if (await element.isVisible().catch(() => false)) {
      const text = `${(await element.textContent().catch(() => "")) ?? ""} ${(await element.getAttribute("aria-label").catch(() => "")) ?? ""}`;
      if (!/other ways|joining info|companion|present|continue without/i.test(text)) return element;
    }
  }

  const candidates = page.locator("button, [role='button']");
  const count = await candidates.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const text = ((await candidate.textContent().catch(() => "")) ?? "").trim();
    const ariaLabel = ((await candidate.getAttribute("aria-label").catch(() => "")) ?? "").trim();
    if (!isJoinActionLabel(text) && !isJoinActionLabel(ariaLabel)) continue;
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

const MIC_OFF = "button[aria-label*=\"Turn off microphone\" i], [role=\"button\"][aria-label*=\"Turn off microphone\" i]";
const CAM_OFF = "button[aria-label*=\"Turn off camera\" i], [role=\"button\"][aria-label*=\"Turn off camera\" i]";
const LEAVE_CALL = "button[aria-label*=\"Leave call\" i], [role=\"button\"][aria-label*=\"Leave call\" i]";
const NAME_FIELD = "input[aria-label*=\"name\" i], input[placeholder*=\"name\" i]";
const ENDED_TEXT = "text=/left the meeting|Return to home screen|You were removed|call ended|meeting has ended|You've been removed/i";
/** Pages where waiting longer cannot help - fail fast with the reason. */
const BLOCKED_TEXT = /You can't join this (video )?call|Check your meeting code|Meeting code (has )?expired|Invalid video call name|not allowed to join|denied your request|No one responded to your request/i;
/** Meet's waiting room after "Ask to join". */
const LOBBY_TEXT = /Asking to be let in|Asking to join|You'll join the call when someone lets you in|Please wait until a meeting host|waiting for the host|Waiting for others to join/i;

const JOIN_WAIT_MS = Number(process.env.MEETING_JOIN_WAIT_SECONDS ?? 60) * 1000;
const LOBBY_MAX_MS = Number(process.env.MEETING_LOBBY_MAX_MINUTES ?? 15) * 60_000;

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
}

/**
 * Polls until the join control renders (Meet's pre-join screen appears several
 * seconds after DOMContentLoaded), a blocking message appears, or time runs out.
 */
async function waitForJoinControl(page, timeoutMs = JOIN_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return { control: null, reason: "The browser window was closed" };
    if (/accounts\.google\.com/.test(page.url())) {
      return { control: null, reason: "Google asked to sign in. Use Settings → Connect browser session to sign in once" };
    }
    // With mic/camera blocked Meet may ask first - answer "continue without".
    await dismissDeviceDialog(page);
    const control = await findJoinControl(page);
    if (control) return { control };
    const text = await bodyText(page);
    const blocked = text.match(BLOCKED_TEXT);
    if (blocked) return { control: null, reason: `Google Meet says: "${blocked[0]}"` };
    if (await page.locator(LEAVE_CALL).first().isVisible().catch(() => false)) return { control: null, alreadyInCall: true };
    await page.waitForTimeout(750);
  }
  return { control: null, reason: `No Join button appeared within ${Math.round(timeoutMs / 1000)} s` };
}

/** After clicking: in the call, in the waiting room, or unknown (still loading). */
async function waitForJoinOutcome(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator(LEAVE_CALL).first().isVisible().catch(() => false)) return "in-call";
    const text = await bodyText(page);
    if (BLOCKED_TEXT.test(text)) return "blocked";
    if (LOBBY_TEXT.test(text)) return "waiting-room";
    await page.waitForTimeout(750);
  }
  return "unknown";
}

/** A join failure; `retryable` tells the pipeline whether another attempt can help. */
export class JoinError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = "JoinError";
    this.retryable = retryable;
  }
}

/**
 * Saves a screenshot and Meet's on-screen text to logs/ (local only) so a refused
 * join can be diagnosed, and returns a short description for the error message.
 */
async function captureDiagnostics(page, key, prefix) {
  const shot = path.join(env.paths.logs, `${prefix}-${key}.png`);
  await page.screenshot({ path: shot }).catch(() => undefined);
  const buttons = await visibleButtonLabels(page);
  const text = (await bodyText(page)).replace(/\s+/g, " ").trim().slice(0, 300);
  logger.warn("Meet page at join failure", { meetingId: key, url: page.url().split("?")[0], buttons, text });
  return `Visible buttons: ${buttons.join(" | ") || "none"}. Screenshot: logs/${path.basename(shot)}.`;
}

/** Labels of the visible buttons - included in join errors so failures are diagnosable. */
async function visibleButtonLabels(page) {
  return page
    .locator("button, [role='button']")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.offsetParent !== null)
        .map((node) => (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 12)
    )
    .catch(() => []);
}

/**
 * Opens the meeting URL in the authenticated profile and joins.
 * Returns a session handle; the caller drives recording separately.
 */
export async function joinMeeting({ meetingId, meetingUrl, displayName = env.meeting.displayName }) {
  const key = String(meetingId);
  if (sessions.has(key)) return sessions.get(key).info;
  if (!meetingUrl) throw new Error("This meeting has no meeting URL to join");

  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  logger.info("Browser launched", { meetingId: key, profile: env.paths.browserProfile });

  try {
    await page.goto(meetingUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

    // Wait for the pre-join screen to actually render (several seconds on Meet).
    const ready = await waitForJoinControl(page);

    if (!ready.alreadyInCall) {
      if (!ready.control) {
        const detail = await captureDiagnostics(page, key, "join-failure");
        if (/Google Meet says/.test(ready.reason ?? "") && !(await hasGoogleSession(context))) {
          throw new JoinError(
            `Could not join the meeting: ${ready.reason} - the MeetAI browser is NOT signed in to Google and this meeting only admits invited or signed-in people. Open Settings → Connect browser session, sign in with the Google account that should join, close that window, then press Join & record again. ${detail}`,
            { retryable: false }
          );
        }
        throw new JoinError(
          `Could not join the meeting: ${ready.reason}. ${detail}`,
          // Signing in needs the user; everything else (meeting not open yet,
          // slow network, blocked for now) is worth another attempt later.
          { retryable: !/sign in/i.test(ready.reason ?? "") }
        );
      }

      await dismissOverlays(page);

      // Signed-out (guest) screen: "What's your name?" - Join stays disabled until a name is typed.
      const typedName = await fillGuestName(page, displayName);

      // Mute microphone and camera before entering (no-ops when the browser has no access).
      await clickIfVisible(page, MIC_OFF, 2000);
      await clickIfVisible(page, CAM_OFF, 1000);

      await dismissOverlays(page);
      await clickJoinControl(page, ready.control, typedName);
    }

    const outcome = ready.alreadyInCall ? "in-call" : await waitForJoinOutcome(page);
    if (outcome === "blocked") {
      const text = await bodyText(page);
      const detail = await captureDiagnostics(page, key, "join-blocked");
      if (!(await hasGoogleSession(context))) {
        // Retrying cannot help: restricted meetings refuse signed-out guests.
        throw new JoinError(
          `Google Meet refused the join: "${text.match(BLOCKED_TEXT)?.[0] ?? "blocked"}" - the MeetAI browser is NOT signed in to Google and this meeting only admits invited or signed-in people. Open Settings → Connect browser session, sign in with the Google account that should join, close that window, then press Join & record again. ${detail}`,
          { retryable: false }
        );
      }
      throw new JoinError(`Google Meet refused the join: "${text.match(BLOCKED_TEXT)?.[0] ?? "blocked"}". ${detail}`, { retryable: true });
    }

    const info = { meetingId: key, meetingUrl, joinedAt: new Date(), browser: context.meetaiBrowser, state: outcome };
    sessions.set(key, { context, page, info, joinedAt: Date.now(), everInCall: outcome === "in-call", misses: 0 });
    logger.info(outcome === "waiting-room" ? "Waiting to be admitted to the meeting" : "Meeting joined", { meetingId: key, state: outcome });
    return info;
  } catch (error) {
    await context.close().catch(() => undefined);
    logger.error("Meeting join failed", { meetingId: key, error: error.message });
    throw error;
  }
}

/**
 * After "Ask to join": waits until the host admits the bot (Leave call appears),
 * the request is refused, or `timeoutMs` passes. Returns "in-call" | "blocked" |
 * "timeout" | "closed".
 */
export async function waitForAdmission(meetingId, { timeoutMs = LOBBY_MAX_MS, intervalMs = 3000, shouldStop = () => false } = {}) {
  const session = sessions.get(String(meetingId));
  if (!session) return "closed";
  const { page } = session;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) return "closed";
    if (page.isClosed()) return "closed";
    if (await page.locator(LEAVE_CALL).first().isVisible().catch(() => false)) {
      session.everInCall = true;
      session.info.state = "in-call";
      return "in-call";
    }
    const text = await bodyText(page);
    if (BLOCKED_TEXT.test(text)) {
      await captureDiagnostics(page, String(meetingId), "join-blocked");
      return "blocked";
    }
    await page.waitForTimeout(intervalMs).catch(() => undefined);
  }
  return "timeout";
}

/**
 * Heuristic end-of-meeting detection: Meet redirects to a post-call page, or the
 * call controls disappear once the call is over.
 */
export async function hasMeetingEnded(meetingId) {
  const session = sessions.get(String(meetingId));
  if (!session) return true;
  const { page } = session;
  if (page.isClosed()) return true;

  try {
    if (page.url().includes("meet.google.com/landing")) return true;
    const ended = await page.locator(ENDED_TEXT).first().isVisible().catch(() => false);
    if (ended) return true;

    if (await page.locator(LEAVE_CALL).first().isVisible().catch(() => false)) {
      session.everInCall = true;
      session.misses = 0;
      return false;
    }

    const text = await bodyText(page);
    if (BLOCKED_TEXT.test(text)) return true;

    // Still in the waiting room: keep waiting (up to MEETING_LOBBY_MAX_MINUTES).
    if (!session.everInCall && LOBBY_TEXT.test(text)) {
      return Date.now() - session.joinedAt > LOBBY_MAX_MS;
    }

    // No call controls: allow a grace period while Meet loads, and require two
    // consecutive misses once in the call, so a re-render never stops a recording.
    if (!session.everInCall) return Date.now() - session.joinedAt > 2 * 60_000;
    session.misses += 1;
    return session.misses >= 2;
  } catch {
    return true;
  }
}

export async function leaveMeeting(meetingId) {
  const key = String(meetingId);
  const session = sessions.get(key);
  if (!session) return null;

  try {
    if (!session.page.isClosed()) {
      await clickIfVisible(session.page, LEAVE_CALL, 3000);
    }
  } catch {
    // Leaving is best-effort; the context is closed either way.
  }

  await session.context.close().catch(() => undefined);
  sessions.delete(key);
  logger.info("Meeting session closed", { meetingId: key });
  return { meetingId: key, leftAt: new Date() };
}

export async function leaveAllMeetings() {
  for (const key of [...sessions.keys()]) {
    await leaveMeeting(key);
  }
}

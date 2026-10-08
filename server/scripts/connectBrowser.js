/**
 * Opens the persistent MeetAI browser profile so you can sign in to Google once.
 *
 * MeetAI never asks for your password - you type it into Google's own page in
 * this window. Chromium stores the session under BROWSER_PROFILE_DIR and every
 * later automated join reuses it.
 *
 *   npm run connect:browser
 */
import { connectGoogleAccount } from "../src/services/automation/meetBot.js";

const session = await connectGoogleAccount();
console.log(`\n${session.message}`);
console.log(`Profile directory: ${session.profileDir}\n`);
await session.waitForClose();
console.log("Browser closed. The signed-in session is stored locally.");
process.exit(0);

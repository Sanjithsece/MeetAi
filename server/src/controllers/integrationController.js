import { env } from "../config/env.js";
import { connectGoogleAccount, browserProfileStatus } from "../services/automation/meetBot.js";
import { syncMeetingsFromGmail } from "../services/gmail/gmailService.js";
import { buildAuthUrl, clearToken, exchangeCode, gmailStatus } from "../services/gmail/oauthClient.js";
import { notionStatus } from "../services/notion/notionService.js";
import { logger } from "../utils/logger.js";
import { ApiError } from "../utils/apiError.js";
import { success } from "../utils/apiResponse.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export const integrationController = {
  /**
   * Returns the Google consent URL. MeetAI never handles the password - the
   * user signs in on Google's own page and only the resulting token is stored
   * locally.
   */
  async gmailConnect(_req, res, next) {
    try {
      success(res, { authUrl: buildAuthUrl() }, "Open this URL to authorise Gmail access");
    } catch (error) {
      next(new ApiError(400, error.message));
    }
  },

  /** OAuth redirect target - responds with a small local HTML page. */
  async gmailCallback(req, res) {
    const { code, error: oauthError } = req.query;
    const page = (title, body) =>
      `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">` +
      `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>` +
      `<p><a href="${escapeHtml(env.clientUrl)}/settings">Back to MeetAI settings</a></p></body>`;

    if (oauthError || !code) {
      res.status(400).send(page("Gmail connection failed", `Google returned: ${oauthError ?? "no authorisation code"}`));
      return;
    }

    try {
      await exchangeCode(String(code));
      res.send(page("Gmail connected", "MeetAI can now read meeting invitations from your Gmail. You can close this tab."));
    } catch (error) {
      logger.error("Gmail OAuth exchange failed", { error: error.message });
      res.status(400).send(page("Gmail connection failed", error.message));
    }
  },

  async gmailStatus(_req, res, next) {
    try {
      success(res, await gmailStatus());
    } catch (error) {
      next(error);
    }
  },

  async gmailDisconnect(_req, res, next) {
    try {
      await clearToken();
      success(res, { connected: false }, "Gmail disconnected");
    } catch (error) {
      next(error);
    }
  },

  async gmailSync(_req, res, next) {
    try {
      success(res, await syncMeetingsFromGmail(), "Gmail sync finished");
    } catch (error) {
      next(new ApiError(400, error.message));
    }
  },

  async notionStatus(_req, res, next) {
    try {
      success(res, await notionStatus());
    } catch (error) {
      next(error);
    }
  },

  /**
   * Opens the persistent Playwright profile so the user can sign in to Google
   * once. Returns immediately; the browser window stays open for them.
   */
  async browserConnect(_req, res, next) {
    try {
      const session = await connectGoogleAccount();
      success(res, { message: session.message, profileDir: session.profileDir }, "Browser opened");
    } catch (error) {
      next(new ApiError(400, `Playwright could not start a browser: ${error.message}`));
    }
  },

  async browserStatus(_req, res, next) {
    try {
      success(res, await browserProfileStatus());
    } catch (error) {
      next(error);
    }
  }
};

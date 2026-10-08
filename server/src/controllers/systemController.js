import { env } from "../config/env.js";
import { listWindowsCaptureDevices } from "../services/media/ffmpeg.js";
import { getSettings, updateSettings } from "../services/settingsService.js";
import { getSystemStatus } from "../services/status/systemStatus.js";
import { success } from "../utils/apiResponse.js";

export const systemController = {
  async status(req, res, next) {
    try {
      success(res, await getSystemStatus({ includeBrowser: req.query.browser === "true", owner: req.user._id }));
    } catch (error) {
      next(error);
    }
  },

  async settings(_req, res, next) {
    try {
      success(res, {
        ...(await getSettings()),
        authEnabled: env.auth.enabled,
        recorderMaxMinutes: env.recorder.maxMinutes
      });
    } catch (error) {
      next(error);
    }
  },

  async updateSettings(req, res, next) {
    try {
      success(res, await updateSettings(req.body), "Settings updated");
    } catch (error) {
      next(error);
    }
  },

  /** Helper for the Settings page: which audio devices FFmpeg can capture. */
  async audioDevices(_req, res, next) {
    try {
      success(res, await listWindowsCaptureDevices());
    } catch (error) {
      next(error);
    }
  }
};

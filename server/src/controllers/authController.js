import * as authService from "../services/authService.js";
import { success } from "../utils/apiResponse.js";

export const authController = {
  async register(req, res, next) {
    try {
      success(res, await authService.register(req.body), "Registered successfully", 201);
    } catch (error) {
      next(error);
    }
  },
  async login(req, res, next) {
    try {
      success(res, await authService.login(req.body), "Logged in successfully");
    } catch (error) {
      next(error);
    }
  },
  async refresh(req, res, next) {
    try {
      success(res, await authService.refresh(req.body.refreshToken), "Token refreshed");
    } catch (error) {
      next(error);
    }
  },
  async me(req, res) {
    success(res, req.user, "Current user");
  },
  async logout(req, res, next) {
    try {
      await authService.logout(req.user.id);
      success(res, null, "Logged out");
    } catch (error) {
      next(error);
    }
  }
};

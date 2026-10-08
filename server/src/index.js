import net from "node:net";
import { createApp } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { ensureStorageDirectories } from "./config/paths.js";
import { getLocalUser } from "./services/localUserService.js";
import { shutdownPipeline } from "./services/pipeline/meetingPipeline.js";
import { startScheduler, stopScheduler } from "./services/scheduler/meetingScheduler.js";
import { logger } from "./utils/logger.js";

function getAvailablePort(startPort, host) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(getAvailablePort(startPort + 1, host));
        return;
      }

      reject(error);
    });

    tester.once("listening", () => {
      const address = tester.address();
      const port = typeof address === "object" ? address.port : startPort;
      tester.close(() => resolve(port));
    });

    tester.listen(startPort, host);
  });
}

async function bootstrap() {
  ensureStorageDirectories();
  await connectDatabase();

  if (!env.auth.enabled) {
    await getLocalUser();
  }

  if (!env.auth.enabled && !["127.0.0.1", "localhost", "::1"].includes(env.host)) {
    logger.warn(`HOST=${env.host} exposes the API to your network while AUTH_ENABLED=false (no login). Use HOST=127.0.0.1 unless you enable auth.`);
  }

  const availablePort = await getAvailablePort(env.port, env.host);
  if (availablePort !== env.port) {
    logger.warn(
      `Port ${env.port} is busy, using ${availablePort} instead. "npm run dev" points Vite at it automatically; if you started the API on its own, set VITE_API_PROXY_TARGET=http://localhost:${availablePort}.`
    );
  }
  env.port = availablePort;

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info(`MeetAI API running on http://${env.host === "127.0.0.1" ? "localhost" : env.host}:${env.port}/api/v1`, {
      mode: env.auth.enabled ? "multi-user" : "local-single-user",
      aiProvider: env.ai.provider,
      recordings: env.paths.recordings
    });
  });

  startScheduler();

  /** Finalise in-flight MP4s and close browser sessions before exiting. */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${signal})`);
    stopScheduler();
    await shutdownPipeline().catch((error) => logger.error("Shutdown cleanup failed", { error: error.message }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", { error: error.message, stack: error.stack });
  process.exit(1);
});

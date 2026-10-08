import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongodbUri, {
    autoIndex: env.nodeEnv !== "production"
  });
  logger.info("MongoDB connected");
}

mongoose.connection.on("error", (error) => {
  logger.error("MongoDB connection error", { error: error.message });
});

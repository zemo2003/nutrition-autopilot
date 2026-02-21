import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import cors from "cors";
import express from "express";
import { v1Router } from "./routes/v1.js";

function bootstrapEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(here, "../../../.env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    loadEnv({ path: envPath, override: false });
    return;
  }
}

bootstrapEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/v1", v1Router);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`nutrition-autopilot API listening on :${port}`);
});

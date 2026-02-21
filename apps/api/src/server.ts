import "dotenv/config";
import cors from "cors";
import express from "express";
import { v1Router } from "./routes/v1.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/v1", v1Router);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`nutrition-autopilot API listening on :${port}`);
});

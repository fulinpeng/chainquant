import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as fs from "node:fs";
import * as path from "node:path";

function loadLocalEnv() {
  // Load in order: `.env.production` then `.env` (later file does not override existing env).
  const envFiles = [".env.production", ".env"];
  for (const fileName of envFiles) {
    const envPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!key) continue;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadLocalEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const defaultOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ];

  const corsOrigins = (process.env.CORS_ORIGINS ?? "").trim();
  const origins = corsOrigins
    ? corsOrigins.split(",").map((o) => o.trim()).filter(Boolean)
    : defaultOrigins;

    // Enable CORS
  app.enableCors({
    origin: origins,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  });
  await app.listen(3001);
}

bootstrap();

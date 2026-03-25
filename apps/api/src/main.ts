import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

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

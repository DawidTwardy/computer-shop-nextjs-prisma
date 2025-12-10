// prisma.config.ts
import "dotenv/config"; // Dodane, ponieważ seed.ts używa zmiennych środowiskowych
import { defineConfig, env } from "@prisma/config"; // Poprawny pakiet

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
import { defineConfig } from "@prisma/config";

// WAŻNE: Wpisz URL połączenia bezpośrednio, aby uniknąć problemów z ładowaniem .env przez Prisma CLI.
// To jest URL odczytany z Twojego docker-compose.yml:
const DATABASE_URL = "postgresql://user_dt:mysecretpassword@localhost:5432/postgres";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: DATABASE_URL,
  },
});
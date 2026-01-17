import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16),
  RENDERER_URL: z.string().default("http://renderer:3002"),
});

export const env = EnvSchema.parse(process.env);

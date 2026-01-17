import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3002),
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16),
  OUTPUT_ROOT: z.string().default("/srv/www")
});

export const env = EnvSchema.parse(process.env);

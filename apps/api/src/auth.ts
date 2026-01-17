import { FastifyRequest, FastifyReply } from "fastify";
import { env } from "./env.js";

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers["x-admin-token"]; // string | string[] | undefined
  if (!token || (Array.isArray(token) ? token[0] : token) !== env.ADMIN_TOKEN) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { env } from "./env.js";
import { requireAdmin } from "./auth.js";
import { seed } from "./seed.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(sensible);

app.get("/health", async () => ({ ok: true }));

// --- Static admin pages (served from files) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_DIR = path.join(__dirname, "admin");

async function sendAdminPage(reply: any, file: string) {
  const p = path.join(ADMIN_DIR, file);
  const html = await readFile(p, "utf8");
  reply.type("text/html; charset=utf-8");
  return reply.send(html);
}

app.get("/admin", async (_req, reply) => sendAdminPage(reply, "admin.html"));
app.get("/admin/links", async (_req, reply) => sendAdminPage(reply, "links.html"));
app.get("/admin/themes", async (_req, reply) => sendAdminPage(reply, "themes.html"));
app.get("/admin/analytics", async (_req, reply) => sendAdminPage(reply, "analytics.html"));
app.get("/admin/autopost", async (_req, reply) => sendAdminPage(reply, "autopost.html"));
app.get("/admin/design-import", async (_req, reply) => sendAdminPage(reply, "design-import.html"));

// --- API helpers ---
const IdSchema = z.string().uuid();

// Run seed on boot (templates, system presets)
await seed(prisma);

// --- Domains ---
app.get("/domains", { preHandler: requireAdmin }, async () => {
  const domains = await prisma.domain.findMany({ orderBy: { createdAt: "desc" } });
  return { domains };
});

app.post("/domains/bulk-import", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    domains: z.array(z.string().min(3)).min(1),
    defaults: z
      .object({
        status: z.enum(["draft", "active", "archived"]).optional(),
      })
      .optional(),
  });
  const body = Body.parse(req.body);
  const created: any[] = [];

  for (const raw of body.domains) {
    const domainName = raw.trim().toLowerCase();
    if (!domainName) continue;
    const existing = await prisma.domain.findUnique({ where: { domainName } });
    if (existing) continue;
    const d = await prisma.domain.create({
      data: {
        domainName,
        status: body.defaults?.status ?? "draft",
      },
    });
    created.push(d);
  }

  return { createdCount: created.length, created };
});

// --- Templates ---
app.get("/templates", { preHandler: requireAdmin }, async () => {
  const templates = await prisma.template.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
  return { templates };
});

// --- Themes ---
app.get("/themes", { preHandler: requireAdmin }, async () => {
  const themes = await prisma.themePreset.findMany({ orderBy: { createdAt: "desc" } });
  return { themes };
});

app.post("/themes", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    name: z.string().min(1),
    json: z.record(z.any()),
    isSystem: z.boolean().optional(),
  });
  const body = Body.parse(req.body);
  const theme = await prisma.themePreset.create({
    data: { name: body.name, json: body.json as any, isSystem: body.isSystem ?? false },
  });
  return { theme };
});

app.patch("/themes/:id", { preHandler: requireAdmin }, async (req) => {
  const themeId = IdSchema.parse((req.params as any).id);
  const Body = z.object({ name: z.string().min(1).optional(), json: z.record(z.any()).optional() });
  const body = Body.parse(req.body);
  const theme = await prisma.themePreset.update({
    where: { id: themeId },
    data: { ...(body.name ? { name: body.name } : {}), ...(body.json ? { json: body.json as any } : {}) },
  });
  return { theme };
});

// --- Component style presets ---
app.get("/component-style-presets", { preHandler: requireAdmin }, async () => {
  const presets = await prisma.componentStylePreset.findMany({ orderBy: { createdAt: "desc" } });
  return { presets };
});

app.post("/component-style-presets", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    name: z.string().min(1),
    json: z.record(z.any()),
    isSystem: z.boolean().optional(),
  });
  const body = Body.parse(req.body);
  const preset = await prisma.componentStylePreset.create({
    data: { name: body.name, json: body.json as any, isSystem: body.isSystem ?? false },
  });
  return { preset };
});

app.patch("/component-style-presets/:id", { preHandler: requireAdmin }, async (req) => {
  const presetId = IdSchema.parse((req.params as any).id);
  const Body = z.object({ name: z.string().min(1).optional(), json: z.record(z.any()).optional() });
  const body = Body.parse(req.body);
  const preset = await prisma.componentStylePreset.update({
    where: { id: presetId },
    data: { ...(body.name ? { name: body.name } : {}), ...(body.json ? { json: body.json as any } : {}) },
  });
  return { preset };
});

// --- Assign theme/component style to a site ---
app.patch("/sites/:id/style", { preHandler: requireAdmin }, async (req) => {
  const siteId = IdSchema.parse((req.params as any).id);
  const Body = z.object({
    themePresetId: IdSchema.optional().nullable(),
    componentStylePresetId: IdSchema.optional().nullable(),
  });
  const body = Body.parse(req.body);

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw app.httpErrors.notFound("Site not found");

  const updated = await prisma.site.update({
    where: { id: siteId },
    data: {
      ...(body.themePresetId !== undefined ? { themePresetId: body.themePresetId } : {}),
      ...(body.componentStylePresetId !== undefined ? { componentStylePresetId: body.componentStylePresetId } : {}),
    },
  });
  return { site: updated };
});

// --- Design import (manual) ---
app.post("/design-import/manual", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    themeName: z.string().min(1),
    themeJson: z.record(z.any()),
    presetName: z.string().min(1),
    presetJson: z.record(z.any()),
  });
  const body = Body.parse(req.body);

  const theme = await prisma.themePreset.create({ data: { name: body.themeName, json: body.themeJson as any } });
  const preset = await prisma.componentStylePreset.create({ data: { name: body.presetName, json: body.presetJson as any } });

  const job = await prisma.designImportJob.create({
    data: {
      inputType: "manual",
      mode: "theme",
      inputJson: { themeName: body.themeName, presetName: body.presetName },
      status: "success",
      resultJson: { themePresetId: theme.id, componentStylePresetId: preset.id },
      logs: "manual import",
    },
  });
  return { ok: true, jobId: job.id, themePresetId: theme.id, componentStylePresetId: preset.id };
});

// --- Analytics profiles ---
app.get("/analytics/profiles", { preHandler: requireAdmin }, async () => {
  const profiles = await prisma.analyticsProfile.findMany({ orderBy: { createdAt: "desc" } });
  return { profiles };
});

app.post("/analytics/profiles", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    name: z.string().min(1),
    scriptsJson: z.record(z.any()),
    verificationJson: z.record(z.any()).optional(),
    isSystem: z.boolean().optional(),
  });
  const body = Body.parse(req.body);
  const profile = await prisma.analyticsProfile.create({
    data: {
      name: body.name,
      scriptsJson: body.scriptsJson as any,
      verificationJson: body.verificationJson ? (body.verificationJson as any) : undefined,
      isSystem: body.isSystem ?? false,
    },
  });
  return { profile };
});

app.patch("/analytics/profiles/:id", { preHandler: requireAdmin }, async (req) => {
  const id = IdSchema.parse((req.params as any).id);
  const Body = z.object({
    name: z.string().min(1).optional(),
    scriptsJson: z.record(z.any()).optional(),
    verificationJson: z.record(z.any()).optional(),
  });
  const body = Body.parse(req.body);
  const profile = await prisma.analyticsProfile.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.scriptsJson ? { scriptsJson: body.scriptsJson as any } : {}),
      ...(body.verificationJson ? { verificationJson: body.verificationJson as any } : {}),
    },
  });
  return { profile };
});

app.post("/sites/:id/analytics/assign", { preHandler: requireAdmin }, async (req) => {
  const siteId = IdSchema.parse((req.params as any).id);
  const Body = z.object({ analyticsProfileId: IdSchema.nullable() });
  const body = Body.parse(req.body);
  const site = await prisma.site.update({ where: { id: siteId }, data: { analyticsProfileId: body.analyticsProfileId } });
  return { site };
});

// --- Autoposting ---
app.get("/autopost/schedules", { preHandler: requireAdmin }, async (req) => {
  const Query = z.object({ siteId: IdSchema.optional() });
  const q = Query.parse(req.query);
  const where = q.siteId ? { siteId: q.siteId } : {};
  const schedules = await prisma.autopostSchedule.findMany({ where, orderBy: { createdAt: "desc" }, include: { site: { include: { domain: true } } } });
  return { schedules };
});

app.post("/autopost/schedules", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    siteId: IdSchema,
    section: z.enum(["blog", "news"]),
    cadenceType: z.enum(["every_n_days", "weekly", "cron"]),
    cadenceJson: z.record(z.any()),
    requireApproval: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  });
  const body = Body.parse(req.body);
  const now = new Date();
  const nextRunAt = computeNextRunAt(now, body.cadenceType, body.cadenceJson);
  const schedule = await prisma.autopostSchedule.create({
    data: {
      siteId: body.siteId,
      section: body.section as any,
      cadenceType: body.cadenceType as any,
      cadenceJson: body.cadenceJson as any,
      requireApproval: body.requireApproval ?? false,
      isEnabled: body.isEnabled ?? true,
      nextRunAt,
    },
  });
  return { schedule };
});

app.patch("/autopost/schedules/:id", { preHandler: requireAdmin }, async (req) => {
  const id = IdSchema.parse((req.params as any).id);
  const Body = z.object({
    requireApproval: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    cadenceType: z.enum(["every_n_days", "weekly", "cron"]).optional(),
    cadenceJson: z.record(z.any()).optional(),
  });
  const body = Body.parse(req.body);
  const existing = await prisma.autopostSchedule.findUnique({ where: { id } });
  if (!existing) throw app.httpErrors.notFound("Schedule not found");
  const nextRunAt = (body.cadenceType || body.cadenceJson) ? computeNextRunAt(new Date(), body.cadenceType ?? (existing.cadenceType as any), body.cadenceJson ?? (existing.cadenceJson as any)) : undefined;
  const schedule = await prisma.autopostSchedule.update({
    where: { id },
    data: {
      ...(body.requireApproval !== undefined ? { requireApproval: body.requireApproval } : {}),
      ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
      ...(body.cadenceType ? { cadenceType: body.cadenceType as any } : {}),
      ...(body.cadenceJson ? { cadenceJson: body.cadenceJson as any } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
    },
  });
  return { schedule };
});

app.post("/autopost/schedules/:id/run-now", { preHandler: requireAdmin }, async (req) => {
  const id = IdSchema.parse((req.params as any).id);
  const result = await runAutopostSchedule(id);
  return result;
});

app.get("/autopost/runs", { preHandler: requireAdmin }, async (req) => {
  const Query = z.object({ scheduleId: IdSchema.optional(), siteId: IdSchema.optional() });
  const q = Query.parse(req.query);
  const where: any = {};
  if (q.scheduleId) where.scheduleId = q.scheduleId;
  if (q.siteId) where.schedule = { siteId: q.siteId };
  const runs = await prisma.autopostRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { schedule: { include: { site: { include: { domain: true } } } } },
  });
  return { runs };
});

// --- Sites ---
app.get("/sites", { preHandler: requireAdmin }, async () => {
  const sites = await prisma.site.findMany({
    include: { domain: true, template: true, themePreset: true, componentStylePreset: true, analyticsProfile: true },
    orderBy: { createdAt: "desc" },
  });
  return { sites };
});

app.post("/sites", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    domainId: IdSchema,
    templateKey: z.string().min(3),
    theme: z.string().min(1),
    language: z.string().default("ru"),
  });
  const body = Body.parse(req.body);

  const domain = await prisma.domain.findUnique({ where: { id: body.domainId } });
  if (!domain) throw app.httpErrors.notFound("Domain not found");

  const template = await prisma.template.findUnique({ where: { key: body.templateKey } });
  if (!template) throw app.httpErrors.notFound("Template not found");

  const existing = await prisma.site.findUnique({ where: { domainId: domain.id } });
  if (existing) throw app.httpErrors.badRequest("Site already exists for this domain");

  const site = await prisma.site.create({
    data: {
      domainId: domain.id,
      templateId: template.id,
      theme: body.theme,
      language: body.language,
      status: "draft",
    },
    include: { domain: true, template: true },
  });

  // Create initial pages based on template routes
  const def = template.definitionJson as any;
  const routes: Array<{ route: string; pageType: string; required?: boolean }> = def?.routes ?? [
    { route: "/", pageType: "home", required: true },
    { route: "/contacts", pageType: "contacts", required: true },
  ];

  for (const r of routes) {
    if (r.route.includes(":slug")) continue; // v0.4: no dynamic pages
    const page = await prisma.page.create({
      data: {
        siteId: site.id,
        route: r.route,
        pageType: r.pageType,
        status: "draft",
      },
    });

    // Minimal starter content
    const isHome = r.pageType === "home";
    const isContacts = r.pageType === "contacts";
    const contentJson = {
      page: { route: r.route, pageType: r.pageType, lang: body.language },
      blocks: [
        {
          id: "hero",
          type: "hero",
          enabled: true,
          data: {
            h1: body.theme,
            subheading: "Generated starter page. Edit with AI later.",
            primaryCta: { label: "Learn more", href: "{{slot:HERO_CTA}}" },
            secondaryCta: { label: "Contacts", href: "/contacts" },
          },
        },
        {
          id: "faq",
          type: "faq",
          enabled: isHome,
          data: { items: [{ q: "What is this?", a: "A fast SSG site generated by Landing Factory." }] },
        },
        {
          id: "contacts",
          type: "contacts",
          enabled: isContacts,
          data: {
            title: "Contacts",
            company: body.theme,
            email: "hello@example.com",
            phone: "+1 (000) 000-0000",
            address: "Your address",
            hours: "Mon-Fri 10:00-18:00",
          },
        },
        {
          id: "footer_links",
          type: "footer_links",
          enabled: true,
          data: {
            items: [
              { label: "Primary link", href: "{{slot:FOOTER}}" },
            ],
          },
        },
      ],
      slots: { links: { HERO_CTA: { resolved: false }, FOOTER: { resolved: false } } },
    };

    await prisma.pageVersion.create({
      data: {
        pageId: page.id,
        versionNumber: 1,
        isPublished: false,
        contentJson,
        seoJson: { title: body.theme, description: body.theme },
        schemaJson: [],
      },
    });
  }

  return { site };
});

app.post("/sites/:id/publish", { preHandler: requireAdmin }, async (req) => {
  const siteId = IdSchema.parse((req.params as any).id);

  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { domain: true } });
  if (!site) throw app.httpErrors.notFound("Site not found");

  // Mark latest versions as published
  const pages = await prisma.page.findMany({ where: { siteId: site.id } });
  for (const p of pages) {
    const latest = await prisma.pageVersion.findFirst({ where: { pageId: p.id }, orderBy: { versionNumber: "desc" } });
    if (!latest) continue;
    await prisma.pageVersion.update({ where: { id: latest.id }, data: { isPublished: true } });
    await prisma.page.update({ where: { id: p.id }, data: { status: "published" } });
  }

  const lastBuild = await prisma.build.findFirst({ where: { siteId: site.id }, orderBy: { buildNumber: "desc" } });
  const nextBuildNumber = (lastBuild?.buildNumber ?? 0) + 1;

  const build = await prisma.build.create({
    data: {
      siteId: site.id,
      buildNumber: nextBuildNumber,
      status: "queued",
      artifactPath: "",
    },
  });

  // Ask renderer to build
  const r = await fetch(`${env.RENDERER_URL}/render/site/${site.id}`, {
    method: "POST",
    // Renderer is protected by the same admin token.
    headers: { "content-type": "application/json", "x-admin-token": env.ADMIN_TOKEN },
    body: JSON.stringify({ buildId: build.id }),
  });
  if (!r.ok) {
    const t = await r.text();
    await prisma.build.update({ where: { id: build.id }, data: { status: "failed", logs: t } });
    throw app.httpErrors.badRequest(`Renderer error: ${t}`);
  }
  const out: any = await r.json();

  await prisma.build.update({
    where: { id: build.id },
    data: { status: "published", artifactPath: out.artifactPath, publishedAt: new Date() },
  });
  await prisma.site.update({ where: { id: site.id }, data: { status: "published" } });

  return { buildId: build.id, artifactPath: out.artifactPath };
});

// --- Links: Library ---
app.get("/links/library", { preHandler: requireAdmin }, async () => {
  const links = await prisma.linkLibrary.findMany({ orderBy: { createdAt: "desc" } });
  return { links };
});

app.post("/links/library", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    name: z.string().min(1),
    targetUrl: z.string().url(),
    linkKind: z.enum(["anchor", "url_display", "button", "mention"]),
  });
  const body = Body.parse(req.body);
  const link = await prisma.linkLibrary.create({ data: body });
  return { link };
});

// --- Links: Assignments ---
app.get("/links/assignments", { preHandler: requireAdmin }, async (req) => {
  const Query = z.object({ siteId: IdSchema.optional() });
  const q = Query.parse(req.query);
  const where = q.siteId ? { siteId: q.siteId } : {};
  const assignments = await prisma.linkAssignment.findMany({
    where,
    include: { site: { include: { domain: true } }, linkLibrary: true, anchorSet: true },
    orderBy: { createdAt: "desc" },
  });
  return { assignments };
});

app.post("/links/assignments", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    siteId: IdSchema,
    placement: z.string().min(1),
    linkLibraryId: IdSchema,
    displayTextOverride: z.string().optional(),
  });
  const body = Body.parse(req.body);
  const a = await prisma.linkAssignment.create({
    data: {
      siteId: body.siteId,
      placement: body.placement,
      linkLibraryId: body.linkLibraryId,
      displayTextOverride: body.displayTextOverride,
      isEnabled: true,
    },
  });
  return { assignment: a };
});

// --- Bulk operations for links (v0.4) ---
app.post("/links/bulk/preview", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    mode: z.enum(["library_url_replace", "assignment_text_replace"]),
    find: z.string().min(1),
    replace: z.string(),
  });
  const body = Body.parse(req.body);

  if (body.mode === "library_url_replace") {
    const affected = await prisma.linkLibrary.findMany({ where: { targetUrl: { contains: body.find } } });
    const preview = affected.map((l) => ({ id: l.id, before: l.targetUrl, after: l.targetUrl.replaceAll(body.find, body.replace) }));
    return { count: preview.length, preview };
  }

  const affected = await prisma.linkAssignment.findMany({ where: { displayTextOverride: { contains: body.find } } });
  const preview = affected.map((a) => ({ id: a.id, before: a.displayTextOverride ?? "", after: (a.displayTextOverride ?? "").replaceAll(body.find, body.replace) }));
  return { count: preview.length, preview };
});

app.post("/links/bulk/apply", { preHandler: requireAdmin }, async (req) => {
  const Body = z.object({
    mode: z.enum(["library_url_replace", "assignment_text_replace"]),
    find: z.string().min(1),
    replace: z.string(),
  });
  const body = Body.parse(req.body);

  const op = await prisma.bulkOperation.create({
    data: {
      type: `links.${body.mode}`,
      status: "running",
      inputJson: body,
      diffPreviewJson: {},
      resultJson: {},
    },
  });

  if (body.mode === "library_url_replace") {
    const links = await prisma.linkLibrary.findMany({ where: { targetUrl: { contains: body.find } } });
    const before = links.map((l) => ({ id: l.id, targetUrl: l.targetUrl }));
    for (const l of links) {
      await prisma.linkLibrary.update({ where: { id: l.id }, data: { targetUrl: l.targetUrl.replaceAll(body.find, body.replace) } });
    }
    await prisma.bulkOperation.update({
      where: { id: op.id },
      data: { status: "success", resultJson: { updated: links.length }, diffPreviewJson: { before } },
    });
    return { operationId: op.id, updated: links.length };
  }

  const assigns = await prisma.linkAssignment.findMany({ where: { displayTextOverride: { contains: body.find } } });
  const before = assigns.map((a) => ({ id: a.id, displayTextOverride: a.displayTextOverride }));
  for (const a of assigns) {
    await prisma.linkAssignment.update({
      where: { id: a.id },
      data: { displayTextOverride: (a.displayTextOverride ?? "").replaceAll(body.find, body.replace) },
    });
  }
  await prisma.bulkOperation.update({
    where: { id: op.id },
    data: { status: "success", resultJson: { updated: assigns.length }, diffPreviewJson: { before } },
  });
  return { operationId: op.id, updated: assigns.length };
});

app.post("/links/bulk/undo-last", { preHandler: requireAdmin }, async () => {
  const last = await prisma.bulkOperation.findFirst({
    where: { type: { startsWith: "links." }, status: "success" },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return { ok: false, message: "No operations" };

  const before: any = (last.diffPreviewJson as any)?.before ?? [];

  if (last.type === "links.library_url_replace") {
    for (const b of before) {
      await prisma.linkLibrary.update({ where: { id: b.id }, data: { targetUrl: b.targetUrl } });
    }
  } else if (last.type === "links.assignment_text_replace") {
    for (const b of before) {
      await prisma.linkAssignment.update({ where: { id: b.id }, data: { displayTextOverride: b.displayTextOverride } });
    }
  }

  await prisma.bulkOperation.update({ where: { id: last.id }, data: { status: "failed" } });
  return { ok: true, undoneOperationId: last.id };
});

// ---- Autopost helpers ----
function computeNextRunAt(now: Date, cadenceType: "every_n_days" | "weekly" | "cron", cadenceJson: any): Date {
  const d = new Date(now.getTime());
  if (cadenceType === "every_n_days") {
    const n = Number(cadenceJson?.n ?? 7);
    d.setDate(d.getDate() + Math.max(1, n));
    return d;
  }
  if (cadenceType === "weekly") {
    // cadenceJson: { dow: 1..7 (Mon=1), hour:0-23, minute:0-59 }
    const dow = Number(cadenceJson?.dow ?? 1);
    const hour = Number(cadenceJson?.hour ?? 10);
    const minute = Number(cadenceJson?.minute ?? 0);
    const currentDow = ((d.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
    let addDays = dow - currentDow;
    if (addDays <= 0) addDays += 7;
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, minute, 0, 0);
    return d;
  }
  // cron: v1 simple support: cadenceJson: { minutes: number }
  const minutes = Number(cadenceJson?.minutes ?? 60);
  d.setMinutes(d.getMinutes() + Math.max(5, minutes));
  return d;
}

async function ensureIndexPage(siteId: string, route: string, pageType: any, title: string): Promise<string> {
  const existing = await prisma.page.findUnique({ where: { siteId_route: { siteId, route } } });
  if (existing) return existing.id;
  const page = await prisma.page.create({ data: { siteId, route, pageType, status: "draft" } });
  await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      versionNumber: 1,
      isPublished: false,
      contentJson: {
        page: { route, pageType, lang: "ru" },
        blocks: [
          { id: "hero", type: "hero", enabled: true, data: { h1: title, subheading: "", primaryCta: { label: "Home", href: "/" } } },
          { id: "content", type: "content", enabled: true, data: { html: "<p class=\"small\">No posts yet.</p>" } }
        ],
        slots: { links: { HERO_CTA: { resolved: false }, FOOTER: { resolved: false } } }
      },
      seoJson: { title, description: title },
      schemaJson: [],
    }
  });
  return page.id;
}

async function runAutopostSchedule(scheduleId: string): Promise<any> {
  const schedule = await prisma.autopostSchedule.findUnique({ where: { id: scheduleId }, include: { site: { include: { domain: true } } } });
  if (!schedule) throw app.httpErrors.notFound("Schedule not found");
  if (!schedule.isEnabled) return { ok: false, message: "Schedule disabled" };

  const run = await prisma.autopostRun.create({ data: { scheduleId: schedule.id, status: "running" } });
  try {
    const siteId = schedule.siteId;
    const section = schedule.section === "news" ? "news" : "blog";
    const base = `/${section}`;

    // Create a new post page
    const slug = `${section}-${Date.now()}`;
    const route = `${base}/${slug}`;
    const title = `${section.toUpperCase()} update: ${new Date().toISOString().slice(0,10)}`;
    const bodyHtml = `<h2>${title}</h2><p class=\"small\">Auto-generated post placeholder. Replace with AI generation in v1.1.</p>`;

    const postPage = await prisma.page.create({ data: { siteId, route, pageType: section === "blog" ? "blog_post" : "news_item", status: "draft", slug } });
    await prisma.pageVersion.create({
      data: {
        pageId: postPage.id,
        versionNumber: 1,
        isPublished: !schedule.requireApproval,
        contentJson: {
          page: { route, pageType: postPage.pageType, lang: schedule.site.language ?? "ru" },
          blocks: [
            { id: "hero", type: "hero", enabled: true, data: { h1: title, subheading: schedule.site.theme, primaryCta: { label: "Back", href: base } } },
            { id: "content", type: "content", enabled: true, data: { html: bodyHtml } },
            { id: "footer_links", type: "footer_links", enabled: true, data: { items: [{ label: "Primary", href: "{{slot:FOOTER}}" }] } }
          ],
          slots: { links: { HERO_CTA: { resolved: false }, FOOTER: { resolved: false } } }
        },
        seoJson: { title, description: `${title}` },
        schemaJson: [],
      }
    });

    // Ensure index page and update listing
    const indexPageId = await ensureIndexPage(siteId, base, section === "blog" ? "blog_index" : "news_index", section === "blog" ? "Blog" : "News");
    const indexLatest = await prisma.pageVersion.findFirst({ where: { pageId: indexPageId }, orderBy: { versionNumber: "desc" } });
    const vnum = (indexLatest?.versionNumber ?? 0) + 1;
    const allPosts = await prisma.page.findMany({ where: { siteId, route: { startsWith: `${base}/` } }, orderBy: { createdAt: "desc" }, take: 30 });
    const listHtml = `<ul>` + allPosts.map(p => `<li><a href=\"${p.route}\">${p.slug ?? p.route}</a></li>`).join("") + `</ul>`;
    await prisma.pageVersion.create({
      data: {
        pageId: indexPageId,
        versionNumber: vnum,
        isPublished: !schedule.requireApproval,
        contentJson: {
          page: { route: base, pageType: section === "blog" ? "blog_index" : "news_index", lang: schedule.site.language ?? "ru" },
          blocks: [
            { id: "hero", type: "hero", enabled: true, data: { h1: section === "blog" ? "Blog" : "News", subheading: schedule.site.theme, primaryCta: { label: "Home", href: "/" } } },
            { id: "content", type: "content", enabled: true, data: { html: listHtml } },
            { id: "footer_links", type: "footer_links", enabled: true, data: { items: [{ label: "Primary", href: "{{slot:FOOTER}}" }] } }
          ],
          slots: { links: { HERO_CTA: { resolved: false }, FOOTER: { resolved: false } } }
        },
        seoJson: { title: section === "blog" ? "Blog" : "News", description: schedule.site.theme },
        schemaJson: [],
      }
    });

    const nextRunAt = computeNextRunAt(new Date(), schedule.cadenceType as any, schedule.cadenceJson as any);
    await prisma.autopostSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), nextRunAt } });

    // If auto-publish, run publish flow
    let published: any = null;
    if (!schedule.requireApproval) {
      published = await internalPublishSite(siteId);
    }

    await prisma.autopostRun.update({ where: { id: run.id }, data: { status: "success", resultJson: { postRoute: route, published }, finishedAt: new Date(), createdPageId: postPage.id } });
    return { ok: true, postRoute: route, published };
  } catch (e: any) {
    await prisma.autopostRun.update({ where: { id: run.id }, data: { status: "failed", logs: String(e?.message ?? e), finishedAt: new Date() } });
    throw e;
  }
}

async function internalPublishSite(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { domain: true } });
  if (!site) throw app.httpErrors.notFound("Site not found");

  const pages = await prisma.page.findMany({ where: { siteId: site.id } });
  for (const p of pages) {
    const latest = await prisma.pageVersion.findFirst({ where: { pageId: p.id }, orderBy: { versionNumber: "desc" } });
    if (!latest) continue;
    await prisma.pageVersion.update({ where: { id: latest.id }, data: { isPublished: true } });
    await prisma.page.update({ where: { id: p.id }, data: { status: "published" } });
  }

  const lastBuild = await prisma.build.findFirst({ where: { siteId: site.id }, orderBy: { buildNumber: "desc" } });
  const nextBuildNumber = (lastBuild?.buildNumber ?? 0) + 1;
  const build = await prisma.build.create({ data: { siteId: site.id, buildNumber: nextBuildNumber, status: "queued", artifactPath: "" } });

  const r = await fetch(`${env.RENDERER_URL}/render/site/${site.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": env.ADMIN_TOKEN },
    body: JSON.stringify({ buildId: build.id }),
  });
  if (!r.ok) {
    const t = await r.text();
    await prisma.build.update({ where: { id: build.id }, data: { status: "failed", logs: t } });
    throw app.httpErrors.badRequest(`Renderer error: ${t}`);
  }
  const out: any = await r.json();
  await prisma.build.update({ where: { id: build.id }, data: { status: "published", artifactPath: out.artifactPath, publishedAt: new Date() } });
  await prisma.site.update({ where: { id: site.id }, data: { status: "published" } });
  return { buildId: build.id, artifactPath: out.artifactPath };
}

// Background autopost loop (lightweight; can be moved to worker service later)
setInterval(async () => {
  try {
    const now = new Date();
    const due = await prisma.autopostSchedule.findMany({ where: { isEnabled: true, nextRunAt: { lte: now } }, take: 5 });
    for (const s of due) {
      await runAutopostSchedule(s.id);
    }
  } catch (e) {
    app.log.error(e);
  }
}, 60_000);

// --- Start ---
app.listen({ port: env.PORT, host: "0.0.0.0" });

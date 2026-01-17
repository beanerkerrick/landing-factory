import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

function requireAdmin(tokenHeader: unknown) {
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  return typeof token === "string" && token === env.ADMIN_TOKEN;
}

function radiusTokenToPx(v: unknown, fallbackPx: string): string {
  if (typeof v !== "string" || !v) return fallbackPx;
  // If already looks like CSS length, keep.
  if (/^\d+(px|rem|em|%)$/.test(v)) return v;
  // Token mapping (Tailwind-like)
  const map: Record<string, string> = {
    sm: "8px",
    md: "12px",
    lg: "14px",
    xl: "16px",
    "2xl": "20px",
  };
  return map[v] ?? fallbackPx;
}

function cssFromTheme(themeJson: any, componentPreset: any): string {
  const c = themeJson?.colors ?? {};
  const radius = themeJson?.radius ?? {};
  const buttons = themeJson?.buttons ?? {};
  const primaryStyle = componentPreset?.hero?.cta_style ?? buttons.primary_style ?? "solid";
  const useGradient = primaryStyle === "gradient";
  const primaryBg = useGradient ? "linear-gradient(90deg, var(--text), var(--muted))" : "var(--text)";
  const rCard = radiusTokenToPx(radius.card, "16px");
  const rBtn = radiusTokenToPx(radius.button, "12px");
  return `:root{--bg:${c.bg ?? "#ffffff"};--surface:${c.surface ?? "#f8fafc"};--text:${c.text ?? "#0f172a"};--muted:${c.muted_text ?? "#475569"};--border:${c.border ?? "#e2e8f0"};--r-card:${rCard};--r-btn:${rBtn};}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial; background:var(--bg); color:var(--text);} 
.container{max-width:980px;margin:0 auto;padding:24px;} 
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);padding:20px;} 
a{color:inherit} 
.btn{display:inline-block;padding:12px 16px;border-radius:var(--r-btn);border:1px solid var(--border);text-decoration:none;margin-right:10px} 
.btn.primary{background:${primaryBg};color:var(--bg);border-color:var(--text)}
.small{color:var(--muted);font-size:14px}`;
}

function htmlPage(params: { title: string; description?: string; body: string; css: string; headExtras?: string; bodyEndExtras?: string; }) {
  const { title, description, body, css, headExtras, bodyEndExtras } = params;
  const desc = description ?? "";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${desc ? `<meta name="description" content="${escapeHtml(desc)}" />` : ""}
  ${headExtras ?? ""}
  <style>${css}</style>
</head>
<body>
${body}
${bodyEndExtras ?? ""}
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function routeToFile(route: string): { dir: string; file: string } {
  // route: "/" => /index.html, "/contacts" => /contacts/index.html
  if (route === "/") return { dir: "", file: "index.html" };
  const clean = route.replace(/^\//, "").replace(/\/$/, "");
  return { dir: clean, file: "index.html" };
}

function renderBlocks(blocks: any[]): string {
  return renderBlocksWithSlots(blocks, {});
}

function renderBlocksWithSlots(blocks: any[], slotUrls: Record<string, string>): string {
  const parts: string[] = [];
  const hero = blocks.find(b => b.type === "hero" && b.enabled !== false);
  if (hero) {
    const h1 = hero.data?.h1 ?? "";
    const sub = hero.data?.subheading ?? "";
    const cta1 = hero.data?.primaryCta;
    const cta2 = hero.data?.secondaryCta;
    const href1 = typeof cta1?.href === 'string' ? resolveSlotHref(cta1.href, slotUrls) : undefined;
    const href2 = typeof cta2?.href === 'string' ? resolveSlotHref(cta2.href, slotUrls) : undefined;
    parts.push(`<div class="container"><div class="card">
      <h1>${escapeHtml(h1)}</h1>
      <p class="small">${escapeHtml(sub)}</p>
      <div>
        ${cta1 && href1 ? `<a class="btn primary" href="${escapeHtml(href1)}">${escapeHtml(cta1.label)}</a>` : ""}
        ${cta2 && href2 ? `<a class="btn" href="${escapeHtml(href2)}">${escapeHtml(cta2.label)}</a>` : ""}
      </div>
    </div></div>`);
  }

  const content = blocks.find(b => b.type === "content" && b.enabled !== false);
  if (content) {
    const html = content.data?.html ?? "";
    parts.push(`<div class="container"><div class="card">${html}</div></div>`);
  }

  const contacts = blocks.find(b => b.type === "contacts" && b.enabled !== false);
  if (contacts) {
    const title = contacts.data?.title ?? "Contacts";
    const lines: string[] = [];
    for (const k of ["company", "phone", "email", "address", "hours"] ) {
      const v = contacts.data?.[k];
      if (typeof v === "string" && v.trim()) {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        lines.push(`<div><b>${escapeHtml(label)}:</b> ${escapeHtml(v)}</div>`);
      }
    }
    parts.push(`<div class="container"><div class="card"><h2>${escapeHtml(title)}</h2>${lines.join("") || `<p class="small">No details provided.</p>`}</div></div>`);
  }

  const faq = blocks.find(b => b.type === "faq" && b.enabled !== false);
  if (faq) {
    const items = Array.isArray(faq.data?.items) ? faq.data.items : [];
    if (items.length) {
      const list = items.map((it: any) => {
        const q = it.q ?? "";
        const a = it.a ?? "";
        return `<details style="margin:10px 0"><summary><b>${escapeHtml(q)}</b></summary><div class="small" style="margin-top:6px">${escapeHtml(a)}</div></details>`;
      }).join("");
      parts.push(`<div class="container"><div class="card"><h2>FAQ</h2>${list}</div></div>`);
    }
  }

  // footer
  const footerLinks = blocks.find(b => b.type === "footer_links" && b.enabled !== false);
  if (footerLinks) {
    const items = footerLinks.data?.items;
    if (Array.isArray(items) && items.length) {
      const list = items.map((it: any) => `<li><a href="${escapeHtml(resolveSlotHref(it.href ?? '#', slotUrls))}">${escapeHtml(it.label ?? it.href ?? '')}</a></li>`).join('');
      parts.push(`<div class="container"><div class="card"><h3>Resources</h3><ul>${list}</ul></div></div>`);
    }
  }
  parts.push(`<div class="container"><p class="small">Generated by Landing Factory (SSG v0.5)</p></div>`);

  return parts.join("\n");
}

function resolveSlotHref(href: string, slotUrls: Record<string, string>): string {
  const m = href.match(/^\{\{slot:([A-Z0-9_\-]+)\}\}$/);
  if (!m) return href;
  const key = m[1];
  return slotUrls[key] ?? "#";
}

app.get("/health", async () => ({ ok: true }));

app.post("/render/site/:siteId", async (req, reply) => {
  const token = req.headers["x-admin-token"];
  if (!requireAdmin(token)) return reply.code(401).send({ error: "Unauthorized" });

  const Params = z.object({ siteId: z.string().uuid() });
  const Body = z.object({ buildId: z.string().uuid() });
  const { siteId } = Params.parse(req.params);
  const { buildId } = Body.parse(req.body);

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      domain: true,
      themePreset: true,
      componentStylePreset: true,
      analyticsProfile: true,
      links: { include: { linkLibrary: true, anchorSet: true } },
      pages: { include: { versions: true } }
    }
  });
  if (!site) return reply.code(404).send({ error: "Site not found" });

  const outDir = path.join(env.OUTPUT_ROOT, site.domain.domainName);
  await fs.mkdir(outDir, { recursive: true });

  const themeJson = site.themePreset?.json ?? null;
  const css = cssFromTheme(themeJson, site.componentStylePreset?.json);

  // Analytics scripts insertion (optional)
  const scripts = (site.analyticsProfile?.scriptsJson as any) ?? {};
  const headScripts = Array.isArray(scripts.head) ? scripts.head.join("\n") : "";
  const bodyEndScripts = Array.isArray(scripts.body_end) ? scripts.body_end.join("\n") : "";
  const headExtras = headScripts ? `\n<!-- analytics:head -->\n${headScripts}\n` : "";
  const bodyEndExtras = bodyEndScripts ? `\n<!-- analytics:body_end -->\n${bodyEndScripts}\n` : "";

  // Resolve link slots (e.g., {{slot:HERO_CTA}}) from enabled link assignments.
  // v0.3 rule: for each placement, pick the first enabled assignment.
  const slotUrls: Record<string, string> = {};
  for (const a of site.links ?? []) {
    if (!a.isEnabled) continue;
    if (slotUrls[a.placement]) continue;
    slotUrls[a.placement] = a.linkLibrary?.targetUrl ?? "#";
  }

  const routes: string[] = [];

  for (const page of site.pages) {
    const published = page.versions.find(v => v.isPublished) ?? page.versions.sort((a,b)=>b.versionNumber-a.versionNumber)[0];
    if (!published) continue;

    const content = published.contentJson as any;
    const seo = (published.seoJson as any) ?? {};

    const fileInfo = routeToFile(page.route);
    const pageDir = path.join(outDir, fileInfo.dir);
    await fs.mkdir(pageDir, { recursive: true });

    const body = renderBlocksWithSlots(content.blocks ?? [], slotUrls);
    const html = htmlPage({
      title: seo.title ?? `Site ${site.domain.domainName}`,
      description: seo.description,
      css,
      body,
      headExtras,
      bodyEndExtras,
    });

    await fs.writeFile(path.join(pageDir, fileInfo.file), html, "utf-8");
    routes.push(page.route === "/" ? "" : page.route);
  }

  // robots.txt & sitemap.xml
  const robots = `User-agent: *\nAllow: /\nSitemap: https://${site.domain.domainName}/sitemap.xml\n`;
  await fs.writeFile(path.join(outDir, "robots.txt"), robots, "utf-8");

  const urls = routes.map(r => `  <url><loc>https://${site.domain.domainName}${r}</loc></url>`).join("\n");
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  await fs.writeFile(path.join(outDir, "sitemap.xml"), sitemap, "utf-8");

  await prisma.build.update({ where: { id: buildId }, data: { status: "ready", finishedAt: new Date(), sitemapPath: path.join(outDir, "sitemap.xml"), robotsPath: path.join(outDir, "robots.txt") } });

  return reply.send({ ok: true, artifactPath: outDir, outDir, pages: routes.length });
});

async function main() {
  await prisma.$connect();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

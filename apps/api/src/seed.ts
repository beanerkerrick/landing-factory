import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export async function seed(prisma: PrismaClient) {
  const root = path.resolve(process.cwd(), "../..", "..", "..");
  const templatePath = path.resolve(root, "packages", "templates", "corp-premium-v1", "template.json");

  const tpl = readJson(templatePath);

  const existing = await prisma.template.findUnique({ where: { key: tpl.key } });
  if (!existing) {
    await prisma.template.create({
      data: {
        key: tpl.key,
        name: tpl.name,
        siteType: tpl.siteType,
        version: tpl.version,
        definitionJson: tpl,
        defaultSeoRulesJson: tpl.seoRules ?? undefined,
        defaultPromptJson: tpl.aiPromptPreset ?? undefined,
        isActive: true,
      },
    });
  }

  const themeName = "Premium Neutral";
  const themeExists = await prisma.themePreset.findFirst({ where: { name: themeName, isSystem: true } });
  if (!themeExists) {
    await prisma.themePreset.create({
      data: {
        name: themeName,
        isSystem: true,
        json: {
          name: themeName,
          mode: "light",
          palette: { primary: "slate", accent: "indigo", success: "emerald", warning: "amber", danger: "rose" },
          colors: { bg: "#ffffff", surface: "#f8fafc", text: "#0f172a", muted_text: "#475569", border: "#e2e8f0" },
          radius: { card: "xl", button: "lg", input: "lg" },
          shadow: { card: "soft", button: "soft" },
          typography: { font_family: "inter", heading_scale: "modern", base_size: "md", line_height: "comfortable" },
          buttons: { primary_style: "solid", secondary_style: "outline", cta_emphasis: "high" },
          layout: { container_width: "lg", section_spacing: "comfortable" },
          media_style: { image_radius: "xl", use_gradients: true, icon_set: "lucide" }
        }
      }
    });
  }

  const presetName = "Default Component Style";
  const presetExists = await prisma.componentStylePreset.findFirst({ where: { name: presetName, isSystem: true } });
  if (!presetExists) {
    await prisma.componentStylePreset.create({
      data: {
        name: presetName,
        isSystem: true,
        json: {
          hero: { layout: "split", title_weight: "bold", cta_style: "solid", background_style: "soft_gradient" },
          cards: { radius: "xl", shadow: "soft", hover_effect: "lift" },
          faq: { style: "accordion", icon: "plus" },
          testimonials: { layout: "grid", avatar_style: "circle" }
        }
      }
    });
  }

  const analyticsName = "Default Analytics (empty)";
  const analyticsExists = await prisma.analyticsProfile.findFirst({ where: { name: analyticsName, isSystem: true } });
  if (!analyticsExists) {
    await prisma.analyticsProfile.create({
      data: {
        name: analyticsName,
        isSystem: true,
        scriptsJson: { head: [], body_end: [] },
        verificationJson: {},
      }
    });
  }
}

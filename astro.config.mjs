// @ts-check
import { defineConfig } from "astro/config";

// D2（DECISIONS.md）2026-09-16 复议：目录式 URL（平台支持目录路由与真 404）。
// 2026-09-17：迁到 Cloudflare Pages（根路径 https://dachitech.pages.dev/）。
// Cloudflare 构建会注入 CF_PAGES=1；其余环境仍按 GitHub Pages 子路径 /dachitech/ 构建，迁移期间两边都可用。
// 绑定自定义域名后，在 Cloudflare 项目环境变量里设 SITE_URL。
const onCloudflare = Boolean(process.env.CF_PAGES);

export default defineConfig({
  site: process.env.SITE_URL ?? (onCloudflare ? "https://dachitech.pages.dev" : "https://gummybun999.github.io"),
  base: onCloudflare ? "/" : "/dachitech/",
  output: "static",
  build: { format: "directory" },
  trailingSlash: "always",
  compressHTML: true,
});

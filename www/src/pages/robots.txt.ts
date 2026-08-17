import type { APIRoute } from "astro";

const getRobotsTxt = (sitemapURL: URL) =>
  `User-agent: *\nAllow: /\n\nSitemap: ${sitemapURL.href}\n`;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL("sitemap-index.xml", site);
  return new Response(getRobotsTxt(sitemapURL), {
    headers: { "Content-Type": "text/plain" },
  });
};

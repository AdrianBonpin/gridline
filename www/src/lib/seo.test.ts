import { describe, it, expect } from "vitest";
import {
  buildSoftwareApplicationJsonLd,
  buildFaqJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildBreadcrumbJsonLd,
  buildTitle,
  buildProductJsonLd,
} from "./seo";

describe("seo builders", () => {
  it("buildSoftwareApplicationJsonLd returns valid schema", () => {
    const ld = buildSoftwareApplicationJsonLd({
      name: "Gridline",
      url: "https://getgridline.app/",
      description: "Open-source database GUI",
      image: "https://getgridline.app/og.png",
      operatingSystem: "macOS, Windows, Linux",
      applicationCategory: "DeveloperApplication",
      offersPrice: 0,
      offersCurrency: "USD",
      downloadUrl: "https://github.com/AdrianBonpin/gridline/releases",
    });
    expect(ld["@type"]).toBe("SoftwareApplication");
    expect(ld.name).toBe("Gridline");
    expect((ld.offers as { price: number }).price).toBe(0);
  });

  it("buildFaqJsonLd maps questions to mainEntity", () => {
    const ld = buildFaqJsonLd([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
    expect(ld["@type"]).toBe("FAQPage");
    const main = ld.mainEntity as { name: string }[];
    expect(main).toHaveLength(2);
    expect(main[0].name).toBe("Q1");
  });

  it("buildOrganizationJsonLd includes sameAs", () => {
    const ld = buildOrganizationJsonLd({
      name: "Gridline",
      url: "https://getgridline.app/",
      logo: "https://getgridline.app/gridline-icon.svg",
      sameAs: ["https://github.com/AdrianBonpin/gridline"],
    });
    expect(ld["@type"]).toBe("Organization");
    expect(ld.sameAs).toContain("https://github.com/AdrianBonpin/gridline");
  });

  it("buildWebSiteJsonLd includes SearchAction", () => {
    const ld = buildWebSiteJsonLd({
      name: "Gridline",
      url: "https://getgridline.app/",
      searchUrl: "https://getgridline.app/?q={search_term_string}",
    });
    expect(ld["@type"]).toBe("WebSite");
    expect(ld.potentialAction).toBeDefined();
  });

  it("buildBreadcrumbJsonLd builds itemListElement", () => {
    const ld = buildBreadcrumbJsonLd([
      { name: "Home", url: "https://getgridline.app/" },
      { name: "Changelog", url: "https://getgridline.app/changelog" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect((ld.itemListElement as unknown[]).length).toBe(2);
  });

  it("buildTitle appends the brand", () => {
    expect(buildTitle("PostgreSQL GUI")).toBe("PostgreSQL GUI | Gridline");
  });

  it("buildProductJsonLd returns valid Product schema", () => {
    const ld = buildProductJsonLd({
      name: "Gridline",
      url: "https://getgridline.app/",
      description: "Open-source database GUI",
      image: "https://getgridline.app/og.png",
      offersPrice: 0,
      offersCurrency: "USD",
    });
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Gridline");
    expect((ld.offers as { price: number }).price).toBe(0);
  });
});

export interface JsonLd {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
}

export function buildSoftwareApplicationJsonLd(opts: {
  name: string;
  url: string;
  description: string;
  image: string;
  operatingSystem: string;
  applicationCategory: string;
  offersPrice: number;
  offersCurrency: string;
  downloadUrl: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name,
    url: opts.url,
    description: opts.description,
    image: opts.image,
    operatingSystem: opts.operatingSystem,
    applicationCategory: opts.applicationCategory,
    offers: {
      "@type": "Offer",
      price: opts.offersPrice,
      priceCurrency: opts.offersCurrency,
    },
    downloadUrl: opts.downloadUrl,
  };
}

export function buildFaqJsonLd(
  questions: { question: string; answer: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}

export function buildOrganizationJsonLd(opts: {
  name: string;
  url: string;
  logo: string;
  sameAs: string[];
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: opts.name,
    url: opts.url,
    logo: opts.logo,
    sameAs: opts.sameAs,
  };
}

export function buildWebSiteJsonLd(opts: {
  name: string;
  url: string;
  searchUrl?: string;
}): JsonLd {
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: opts.name,
    url: opts.url,
  };
  if (opts.searchUrl) {
    ld.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: opts.searchUrl,
      },
      "query-input": "required name=search_term_string",
    };
  }
  return ld;
}

export function buildBreadcrumbJsonLd(
  items: { name: string; url: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildTitle(primary: string, brand = "Gridline"): string {
  return `${primary} | ${brand}`;
}

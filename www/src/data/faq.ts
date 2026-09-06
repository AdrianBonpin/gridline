export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "Is Gridline really free for commercial use?",
    answer:
      "Yes. Gridline is Apache 2.0. You can use it for personal, commercial, or internal work without paying or signing up.",
  },
  {
    question: "Which databases are supported?",
    answer:
      "PostgreSQL and SQLite are fully supported today (browsing, querying, editing, backups, and the visual tools). MySQL and Redis connections are in active development.",
  },
  {
    question: "How is this different from TablePlus, Beekeeper Studio, or DB Pro?",
    answer:
      "No paywalled features, no tab or connection limits, and DB-to-DB sync without intermediate files. We also expose deeper PostgreSQL objects like sequences, enums, extensions, roles, and grants.",
  },
  {
    question: "Do you store my database credentials?",
    answer:
      "No. Passwords live in your operating system keychain (macOS Keychain, Linux Secret Service, or Windows Credential Manager), never in Gridline's local SQLite database.",
  },
  {
    question: "How do you make money?",
    answer:
      "Gridline is free and isn't built around a paywall. If it saves you time, you can buy a coffee at ko-fi.com/adrianbonpin. It's entirely optional and never gates a feature. Otherwise, issues, docs, and contributions all help.",
  },
  {
    question: "Can I contribute or self-host?",
    answer:
      "Gridline is a desktop app, not a SaaS, so there's nothing to self-host. The repo is open for contributions: code, docs, translations, and issue reports are all welcome.",
  },
];

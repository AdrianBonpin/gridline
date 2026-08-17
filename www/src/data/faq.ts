export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "Is Gridline really free for commercial use?",
    answer:
      "Yes. Gridline is released under the Apache 2.0 license. You can use it for personal, commercial, or internal company work without paying or signing up.",
  },
  {
    question: "Which databases are supported?",
    answer:
      "PostgreSQL and SQLite are fully supported today, including browsing, querying, editing, backups, and visual tools. MySQL and Redis connections are in active development.",
  },
  {
    question: "How is this different from TablePlus, Beekeeper Studio, or DB Pro?",
    answer:
      "No paywalled features, no tab or connection limits, and DB-to-DB sync without intermediate files. We also expose deeper PostgreSQL objects like sequences, enums, extensions, roles, and grants.",
  },
  {
    question: "Do you store my database credentials?",
    answer:
      "Passwords are stored in your operating system keychain — macOS Keychain, Linux Secret Service, or Windows Credential Manager — never in Gridline's local SQLite database.",
  },
  {
    question: "Can I self-host or contribute?",
    answer:
      "Gridline is a desktop app, not a SaaS, so there's nothing to self-host. The repo is open for contributions: code, docs, translations, and issue reports are all welcome.",
  },
];

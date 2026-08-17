export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: "0.7.10",
    date: "2026-08-17",
    highlights: ["Latest release — see the GitHub releases page for details."],
  },
];

import type { DbType } from "./types";

export type ProviderId = "postgresql" | "mysql" | "sqlite" | "redis" | "supabase" | "neon";

export interface ProviderTab {
  id: ProviderId;
  label: string;
  /** The db_type persisted for a connection made via this tab. Supabase/Neon
   *  are managed PostgreSQL, so they persist as `postgresql`. */
  dbType: DbType;
  /** True for managed-PostgreSQL presets (Supabase/NeonDB). */
  isManagedPreset: boolean;
}

export const PROVIDER_TABS: ProviderTab[] = [
  { id: "postgresql", label: "PostgreSQL", dbType: "postgresql", isManagedPreset: false },
  { id: "mysql", label: "MySQL", dbType: "mysql", isManagedPreset: false },
  { id: "sqlite", label: "SQLite", dbType: "sqlite", isManagedPreset: false },
  { id: "redis", label: "Redis", dbType: "redis", isManagedPreset: false },
  { id: "supabase", label: "Supabase", dbType: "postgresql", isManagedPreset: true },
  { id: "neon", label: "NeonDB", dbType: "postgresql", isManagedPreset: true },
];

export function getProviderById(id: string): ProviderTab | undefined {
  return PROVIDER_TABS.find((p) => p.id === id);
}

export interface SetupGuideStep {
  title: string;
  detail: string;
}

export interface SetupGuide {
  /** Short tagline shown on the provider card. */
  blurb: string;
  sslRequired: boolean;
  steps: SetupGuideStep[];
}

/** Static, researched setup instructions. No network calls at runtime.
 *  Content reviewed against the official docs (fetched 2026-08-04, see spec §9). */
export const SETUP_GUIDES: Record<"supabase" | "neon", SetupGuide> = {
  supabase: {
    blurb: "Managed PostgreSQL with a pooled connection string.",
    sslRequired: true,
    steps: [
      {
        title: "Open the Supabase Dashboard",
        detail: "Open your project → click the Connect button at the top of the page.",
      },
      {
        title: "Copy a Postgres connection string",
        detail:
          "Direct: postgresql://postgres:[YOUR-PASSWORD]@db.[project-ref].supabase.co:5432/postgres " +
          "(needs IPv6, or the IPv4 add-on). For IPv4-only networks use the shared pooler session mode: " +
          "postgres://postgres.[project-ref]:[YOUR-PASSWORD]@aws-[REGION].pooler.supabase.com:5432/postgres.",
      },
      {
        title: "Paste it into Gridline's Connection URI",
        detail: "It auto-detects as PostgreSQL; the Supabase tab highlights. Save stores the password in your OS keychain.",
      },
      {
        title: "Enable SSL",
        detail: "Supabase requires SSL — under SSH / SSL set the mode to Require (or Verify Full with the project root cert).",
      },
    ],
  },
  neon: {
    blurb: "Serverless Postgres with pooled or direct endpoints.",
    sslRequired: true,
    steps: [
      {
        title: "Open the Neon Console",
        detail: "On your Project Dashboard, click Connect to open the 'Connect to your database' modal.",
      },
      {
        title: "Pick branch, compute, database, role",
        detail: "A connection string is built for you. The default is the pooled endpoint (host ends in -pooler…neon.tech).",
      },
      {
        title: "Copy the connection string",
        detail:
          "postgresql://[role]:[password]@ep-[compute-id]-pooler.[region].aws.neon.tech/[dbname]?sslmode=require " +
          "— port 5432 for both pooled and direct. If your client can't parse user:pass@host, fill Host/Port/User/Password manually.",
      },
      {
        title: "Paste it into Gridline's Connection URI",
        detail: "Auto-detects as PostgreSQL; the NeonDB tab highlights. Save stores the password in your OS keychain.",
      },
      {
        title: "Enable SSL",
        detail: "Neon requires SSL/TLS (strings ship with sslmode=require) — confirm SSH / SSL → mode Require.",
      },
    ],
  },
};
import type { DbType } from "../../lib/types";
import type { Environment } from "./EnvironmentSelect";
import type { SslMode } from "../../lib/connectionString";

export interface ConnectionFormData {
  name: string;
  environment: Environment;
  folder_id: string | null;
  tag_ids: string[];
  connection_string: string;
  db_type: DbType;
  host: string;
  port: number | null;
  username: string | null;
  password: string | null;
  database: string | null;
  use_keychain: boolean;
  // SSH tunnel fields (non-secret flat fields are optional; SshFields writes
  // the key path under ssh_private_key, which submit handlers map to
  // ssh_private_key_path on ConnectionInput)
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_method?: "password" | "key" | null;
  ssh_private_key?: string | null;
  ssh_password: string | null;
  ssh_passphrase?: string | null;
  // SSL/TLS fields. These must live on the form data (and survive into the
  // submit payload) or the SSH/SSL tab's selections are silently dropped — the
  // backend then connects with TLS disabled, which managed providers (Neon,
  // Supabase, PlanetScale) reject with "connection is insecure".
  // `null` = unset, which the backend treats as TLS disabled.
  ssl_mode?: SslMode | null;
  ssl_ca_path?: string | null;
  ssl_cert_path?: string | null;
  ssl_key_path?: string | null;
}

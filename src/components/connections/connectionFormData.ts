import type { DbType } from "../../lib/types";
import type { Environment } from "./EnvironmentSelect";

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
}

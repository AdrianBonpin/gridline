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
  ssh_password: string | null;
}

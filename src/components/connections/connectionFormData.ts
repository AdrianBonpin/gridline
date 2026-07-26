import type { DbType } from "../../lib/types";

export interface ConnectionFormData {
  name: string;
  environment: string | null;
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
}
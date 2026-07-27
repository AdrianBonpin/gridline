use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub database: Option<String>,
    pub folder_id: Option<String>,
    pub keychain_ref: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_auth_method: Option<String>,
    pub ssh_private_key_path: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub tag_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInput {
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub folder_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_auth_method: Option<String>,
    pub ssh_private_key_path: Option<String>,
    pub ssh_passphrase: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_input_roundtrip_with_all_fields() {
        let input = ConnectionInput {
            name: "Test DB".to_string(),
            db_type: "PostgreSQL".to_string(),
            host: "db.example.com".to_string(),
            port: Some(5432),
            username: Some("admin".to_string()),
            folder_id: Some("folder1".to_string()),
            tag_ids: vec!["tag1".to_string(), "tag2".to_string()],
            password: Some("secret123".to_string()),
            database: Some("mydb".to_string()),
            ssh_host: Some("jumphost.example.com".to_string()),
            ssh_port: Some(2222),
            ssh_user: Some("tunnel".to_string()),
            ssh_auth_method: Some("Key".to_string()),
            ssh_private_key_path: Some("/path/to/key".to_string()),
            ssh_passphrase: Some("passphrase".to_string()),
            ssl_mode: Some("require".to_string()),
            ssl_ca_path: Some("/path/to/ca".to_string()),
            ssl_cert_path: Some("/path/to/cert".to_string()),
            ssl_key_path: Some("/path/to/key".to_string()),
        };

        let json = serde_json::to_string(&input).unwrap();
        let deserialized: ConnectionInput = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "Test DB");
        assert_eq!(deserialized.db_type, "PostgreSQL");
        assert_eq!(deserialized.host, "db.example.com");
        assert_eq!(deserialized.port, Some(5432));
        assert_eq!(deserialized.username, Some("admin".to_string()));
        assert_eq!(deserialized.folder_id, Some("folder1".to_string()));
        assert_eq!(deserialized.tag_ids, vec!["tag1".to_string(), "tag2".to_string()]);
        assert_eq!(deserialized.password, Some("secret123".to_string()));
        assert_eq!(deserialized.database, Some("mydb".to_string()));
        assert_eq!(deserialized.ssh_host, Some("jumphost.example.com".to_string()));
        assert_eq!(deserialized.ssh_port, Some(2222));
        assert_eq!(deserialized.ssh_user, Some("tunnel".to_string()));
        assert_eq!(deserialized.ssh_auth_method, Some("Key".to_string()));
        assert_eq!(deserialized.ssh_private_key_path, Some("/path/to/key".to_string()));
        assert_eq!(deserialized.ssh_passphrase, Some("passphrase".to_string()));
        assert_eq!(deserialized.ssl_mode, Some("require".to_string()));
        assert_eq!(deserialized.ssl_ca_path, Some("/path/to/ca".to_string()));
        assert_eq!(deserialized.ssl_cert_path, Some("/path/to/cert".to_string()));
        assert_eq!(deserialized.ssl_key_path, Some("/path/to/key".to_string()));
    }

    #[test]
    fn connection_persisted_does_not_include_password() {
        let conn = Connection {
            id: "test-id".to_string(),
            name: "Test".to_string(),
            db_type: "PostgreSQL".to_string(),
            host: "localhost".to_string(),
            port: Some(5432),
            username: Some("user".to_string()),
            folder_id: Some("folder".to_string()),
            keychain_ref: Some("keychain-ref".to_string()),
            tag_ids: vec![],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            database: Some("mydb".to_string()),
            ssh_host: Some("ssh-host".to_string()),
            ssh_port: Some(2222),
            ssh_user: Some("ssh-user".to_string()),
            ssh_auth_method: Some("Key".to_string()),
            ssh_private_key_path: Some("/path/to/key".to_string()),
            ssl_mode: Some("require".to_string()),
            ssl_ca_path: Some("/path/to/ca".to_string()),
            ssl_cert_path: Some("/path/to/cert".to_string()),
            ssl_key_path: Some("/path/to/key".to_string()),
        };

        let json = serde_json::to_string(&conn).unwrap();
        assert!(!json.contains("password"), "Connection JSON should not contain password field");
    }
}
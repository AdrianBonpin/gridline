use crate::models::{Connection, ConnectionInput};
use crate::store::Store;
use std::sync::Mutex;

const VALID_DB_TYPES: [&str; 4] = ["postgresql", "mysql", "sqlite", "redis"];

fn validate(input: &ConnectionInput) -> Result<(), String> {
    if input.name.is_empty() || input.name.chars().count() > 100 {
        return Err("name is required and must be 100 chars or fewer".into());
    }
    if !VALID_DB_TYPES.contains(&input.db_type.as_str()) {
        return Err(format!(
            "db_type must be one of: {}",
            VALID_DB_TYPES.join(", ")
        ));
    }
    if input.host.is_empty() || input.host.chars().count() > 255 {
        return Err("host is required and must be 255 chars or fewer".into());
    }
    if input.db_type != "sqlite" {
        match input.port {
            Some(p) if (1..=65535).contains(&p) => {}
            _ => {
                return Err(
                    "port must be an integer between 1 and 65535 for this db_type".into(),
                )
            }
        }
    }
    if let Some(u) = &input.username {
        if u.chars().count() > 100 {
            return Err("username must be 100 chars or fewer".into());
        }
    }
    Ok(())
}

pub fn get_connections_inner(state: &Mutex<Store>) -> Result<Vec<Connection>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_connections()
}

pub fn create_connection_inner(
    state: &Mutex<Store>,
    input: ConnectionInput,
) -> Result<Connection, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.create_connection(input)
}

pub fn delete_connection_inner(state: &Mutex<Store>, id: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.delete_connection(id)
}

#[tauri::command]
pub fn get_connections(state: tauri::State<crate::DbState>) -> Result<Vec<Connection>, String> {
    get_connections_inner(&state.0)
}

#[tauri::command]
pub fn create_connection(
    state: tauri::State<crate::DbState>,
    input: ConnectionInput,
) -> Result<Connection, String> {
    create_connection_inner(&state.0, input)
}

#[tauri::command]
pub fn delete_connection(state: tauri::State<crate::DbState>, id: String) -> Result<(), String> {
    delete_connection_inner(&state.0, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ConnectionInput;
    use crate::store::Store;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn get_connections_returns_list() {
        let st = state();
        let result = get_connections_inner(&st);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn create_connection_command_returns_connection() {
        let st = state();
        let input = ConnectionInput {
            name: "Prod".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            tag_ids: vec![],
        };
        let result = create_connection_inner(&st, input.clone()).unwrap();
        assert_eq!(result.name, "Prod");
        assert_eq!(get_connections_inner(&st).unwrap().len(), 1);
    }

    #[test]
    fn create_connection_rejects_invalid_db_type() {
        let st = state();
        let input = ConnectionInput {
            name: "X".into(),
            db_type: "mongodb".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            tag_ids: vec![],
        };
        assert!(create_connection_inner(&st, input).is_err());
    }

    #[test]
    fn delete_connection_command_removes_it() {
        let st = state();
        let input = ConnectionInput {
            name: "X".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            tag_ids: vec![],
        };
        let conn = create_connection_inner(&st, input).unwrap();
        delete_connection_inner(&st, &conn.id).unwrap();
        assert_eq!(get_connections_inner(&st).unwrap().len(), 0);
    }
}
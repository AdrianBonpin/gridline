use crate::models::{Tag, TagInput};
use crate::store::Store;
use std::sync::Mutex;

fn validate(input: &TagInput) -> Result<(), String> {
    if input.name.is_empty() || input.name.chars().count() > 50 {
        return Err("name is required and must be 50 chars or fewer".into());
    }
    Ok(())
}

pub fn get_tags_inner(state: &Mutex<Store>) -> Result<Vec<Tag>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_tags()
}

pub fn create_tag_inner(state: &Mutex<Store>, input: TagInput) -> Result<Tag, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.create_tag(input)
}

pub fn delete_tag_inner(state: &Mutex<Store>, id: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.delete_tag(id)
}

pub fn update_tag_inner(
    state: &Mutex<Store>,
    id: String,
    input: TagInput,
) -> Result<Tag, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.update_tag(&id, input)
}

#[tauri::command]
pub fn get_tags(state: tauri::State<crate::AppState>) -> Result<Vec<Tag>, String> {
    get_tags_inner(&state.db_store)
}

#[tauri::command]
pub fn create_tag(state: tauri::State<crate::AppState>, input: TagInput) -> Result<Tag, String> {
    create_tag_inner(&state.db_store, input)
}

#[tauri::command]
pub fn delete_tag(state: tauri::State<crate::AppState>, id: String) -> Result<(), String> {
    delete_tag_inner(&state.db_store, &id)
}

#[tauri::command]
pub fn update_tag(
    state: tauri::State<crate::AppState>,
    id: String,
    input: TagInput,
) -> Result<Tag, String> {
    update_tag_inner(&state.db_store, id, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use crate::models::TagInput;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn create_tag_command_works() {
        let st = state();
        let tag = create_tag_inner(&st, TagInput { name: "prod".into(), color: "#ef4444".into() }).unwrap();
        assert_eq!(get_tags_inner(&st).unwrap().len(), 1);
        assert_eq!(tag.name, "prod");
    }

    #[test]
    fn create_tag_rejects_long_name() {
        let st = state();
        let result = create_tag_inner(&st, TagInput { name: "x".repeat(51), color: "#fff".into() });
        assert!(result.is_err());
    }
}
use crate::models::{Folder, FolderInput};
use crate::store::Store;
use std::sync::Mutex;

fn validate(input: &FolderInput) -> Result<(), String> {
    if input.name.is_empty() || input.name.chars().count() > 100 {
        return Err("name is required and must be 100 chars or fewer".into());
    }
    Ok(())
}

pub fn get_folders_inner(state: &Mutex<Store>) -> Result<Vec<Folder>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_folders()
}

pub fn create_folder_inner(
    state: &Mutex<Store>,
    input: FolderInput,
) -> Result<Folder, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.create_folder(input)
}

pub fn delete_folder_inner(state: &Mutex<Store>, id: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.delete_folder(id)
}

pub fn add_folder_tags_inner(
    state: &Mutex<Store>,
    folder_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.add_folder_tags(&folder_id, &tag_ids)
}

pub fn update_folder_inner(
    state: &Mutex<Store>,
    id: String,
    input: FolderInput,
) -> Result<Folder, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.update_folder(&id, input)
}

#[tauri::command]
pub fn get_folders(state: tauri::State<crate::AppState>) -> Result<Vec<Folder>, String> {
    get_folders_inner(&state.db_store)
}

#[tauri::command]
pub fn create_folder(
    state: tauri::State<crate::AppState>,
    input: FolderInput,
) -> Result<Folder, String> {
    create_folder_inner(&state.db_store, input)
}

#[tauri::command]
pub fn delete_folder(state: tauri::State<crate::AppState>, id: String) -> Result<(), String> {
    delete_folder_inner(&state.db_store, &id)
}

#[tauri::command]
pub fn add_folder_tags(
    state: tauri::State<crate::AppState>,
    folder_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    add_folder_tags_inner(&state.db_store, folder_id, tag_ids)
}

#[tauri::command]
pub fn update_folder(
    state: tauri::State<crate::AppState>,
    id: String,
    input: FolderInput,
) -> Result<Folder, String> {
    update_folder_inner(&state.db_store, id, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FolderInput;
    use crate::store::Store;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn create_folder_command_works() {
        let st = state();
        let folder =
            create_folder_inner(&st, FolderInput { tag_ids: None,
                name: "Work".into(),
                parent_id: None,
            })
            .unwrap();
        assert_eq!(get_folders_inner(&st).unwrap().len(), 1);
        assert_eq!(folder.name, "Work");
    }

    #[test]
    fn create_folder_rejects_empty_name() {
        let st = state();
        let result = create_folder_inner(
            &st,
            FolderInput { tag_ids: None,
                name: "".into(),
                parent_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn delete_folder_command_works() {
        let st = state();
        let folder =
            create_folder_inner(&st, FolderInput { tag_ids: None,
                name: "Work".into(),
                parent_id: None,
            })
            .unwrap();
        delete_folder_inner(&st, &folder.id).unwrap();
        assert_eq!(get_folders_inner(&st).unwrap().len(), 0);
    }
}
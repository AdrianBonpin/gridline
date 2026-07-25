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

#[tauri::command]
pub fn get_folders(state: tauri::State<crate::DbState>) -> Result<Vec<Folder>, String> {
    get_folders_inner(&state.0)
}

#[tauri::command]
pub fn create_folder(
    state: tauri::State<crate::DbState>,
    input: FolderInput,
) -> Result<Folder, String> {
    create_folder_inner(&state.0, input)
}

#[tauri::command]
pub fn delete_folder(state: tauri::State<crate::DbState>, id: String) -> Result<(), String> {
    delete_folder_inner(&state.0, &id)
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
            create_folder_inner(&st, FolderInput {
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
            FolderInput {
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
            create_folder_inner(&st, FolderInput {
                name: "Work".into(),
                parent_id: None,
            })
            .unwrap();
        delete_folder_inner(&st, &folder.id).unwrap();
        assert_eq!(get_folders_inner(&st).unwrap().len(), 0);
    }
}
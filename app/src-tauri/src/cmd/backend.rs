use serde_json::Value;

#[tauri::command]
pub fn project_graph_backend_registry_path() -> String {
    backend_registry_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn project_graph_backend_targets() -> Vec<Value> {
    let path = backend_registry_path();
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let content = content.trim_start_matches('\u{feff}');
    let Ok(value) = serde_json::from_str::<Value>(content) else {
        return Vec::new();
    };
    if let Some(targets) = value.get("targets").and_then(Value::as_array) {
        return targets.clone();
    }
    if value.is_object() {
        return vec![value];
    }
    Vec::new()
}

fn backend_registry_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("PROJECT_GRAPH_BACKEND_REGISTRY") {
        if !path.trim().is_empty() {
            return std::path::PathBuf::from(path);
        }
    }
    std::env::temp_dir().join("project-graph-backends.json")
}

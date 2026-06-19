use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStartOptions {
    port: Option<u16>,
    data_dir: Option<String>,
    auth_user: Option<String>,
    auth_password: Option<String>,
    no_auth: Option<bool>,
    skip_build: Option<bool>,
    local_only: Option<bool>,
    log_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStartResult {
    ok: bool,
    pid: u32,
    script: String,
    log_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStopOptions {
    port: Option<u16>,
    port_start: Option<u16>,
    port_end: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStopResult {
    ok: bool,
    script: String,
    port_start: u16,
    port_end: u16,
}

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

#[tauri::command]
pub fn project_graph_backend_start(
    app: tauri::AppHandle,
    options: Option<BackendStartOptions>,
) -> Result<BackendStartResult, String> {
    let options = options.unwrap_or(BackendStartOptions {
        port: None,
        data_dir: None,
        auth_user: None,
        auth_password: None,
        no_auth: Some(false),
        skip_build: None,
        local_only: Some(false),
        log_path: None,
    });
    let script = backend_start_script(&app)?;
    let resource_backed = is_backend_runtime_script(&script);
    let data_dir = match options.data_dir.as_deref() {
        Some(value) if !value.trim().is_empty() => Some(value.to_string()),
        _ if resource_backed => Some(
            app.path()
                .app_data_dir()
                .map_err(|error| {
                    format!("Failed to resolve Project Graph app data directory: {error}")
                })?
                .join("backend-data")
                .to_string_lossy()
                .to_string(),
        ),
        _ => None,
    };
    let log_path = options
        .log_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_backend_log_path);
    let mut command = Command::new(powershell_executable());
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script);
    if let Some(port) = options.port {
        command.arg("-Port").arg(port.to_string());
    }
    if let Some(data_dir) = data_dir.as_deref() {
        command.arg("-DataDir").arg(data_dir);
    }
    if let Some(auth_user) = options.auth_user.as_deref() {
        if !auth_user.trim().is_empty() {
            command.arg("-AuthUser").arg(auth_user);
        }
    }
    if let Some(auth_password) = options.auth_password.as_deref() {
        if !auth_password.is_empty() {
            command.arg("-AuthPassword").arg(auth_password);
        }
    }
    if options.no_auth.unwrap_or(false) {
        command.arg("-NoAuth");
    }
    if options.skip_build.unwrap_or(resource_backed) {
        command.arg("-SkipBuild");
    }
    if options.local_only.unwrap_or(false) {
        command.arg("-LocalOnly");
    }
    command.arg("-LogPath").arg(&log_path);
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start Project Graph backend: {error}"))?;
    Ok(BackendStartResult {
        ok: true,
        pid: child.id(),
        script: script.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn project_graph_backend_stop(
    app: tauri::AppHandle,
    options: Option<BackendStopOptions>,
) -> Result<BackendStopResult, String> {
    let options = options.unwrap_or(BackendStopOptions {
        port: None,
        port_start: None,
        port_end: None,
    });
    let script = backend_script(&app, "stop-web.ps1")?;
    let port_start = options.port.or(options.port_start).unwrap_or(37820);
    let port_end = options.port.or(options.port_end).unwrap_or(37920);
    let output = Command::new(powershell_executable())
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script)
        .arg("-PortStart")
        .arg(port_start.to_string())
        .arg("-PortEnd")
        .arg(port_end.to_string())
        .output()
        .map_err(|error| format!("Failed to stop Project Graph backend: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Failed to stop Project Graph backend: {}{}",
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(BackendStopResult {
        ok: true,
        script: script.to_string_lossy().to_string(),
        port_start,
        port_end,
    })
}

fn backend_registry_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("PROJECT_GRAPH_BACKEND_REGISTRY") {
        if !path.trim().is_empty() {
            return std::path::PathBuf::from(path);
        }
    }
    std::env::temp_dir().join("project-graph-backends.json")
}

fn backend_start_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    backend_script(app, "start-web.ps1")
}

fn backend_script(app: &tauri::AppHandle, script_name: &str) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("PROJECT_GRAPH_BACKEND_START_SCRIPT") {
        let candidate = PathBuf::from(path);
        if script_name == "start-web.ps1" && candidate.is_file() {
            return Ok(candidate);
        }
        if let Some(parent) = candidate.parent() {
            let sibling = parent.join(script_name);
            if sibling.is_file() {
                return Ok(sibling);
            }
        }
    }
    let mut roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    for root in roots {
        if let Some(script) = find_script_from(&root, script_name) {
            return Ok(script);
        }
    }
    Err(format!(
        "Project Graph backend script {script_name} was not found. Set PROJECT_GRAPH_BACKEND_START_SCRIPT or run scripts/start-web.ps1 manually."
    ))
}

fn find_script_from(root: &Path, script_name: &str) -> Option<PathBuf> {
    for ancestor in root.ancestors() {
        let resource_candidate = ancestor
            .join("backend-runtime")
            .join("scripts")
            .join(script_name);
        if resource_candidate.is_file() {
            return Some(resource_candidate);
        }
        let candidate = ancestor.join("scripts").join(script_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn is_backend_runtime_script(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("backend-runtime")
    })
}

fn powershell_executable() -> &'static str {
    if cfg!(windows) {
        "powershell.exe"
    } else {
        "pwsh"
    }
}

fn default_backend_log_path() -> PathBuf {
    std::env::temp_dir().join("project-graph-backend-start.log")
}

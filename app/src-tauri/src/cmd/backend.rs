use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::Manager;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

#[derive(Debug, Deserialize)]
struct BackendAuthFile {
    user: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthConfig {
    exists: bool,
    user: String,
    password: String,
    data_dir: String,
    auth_path: String,
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
pub fn project_graph_backend_auth_config(
    app: tauri::AppHandle,
) -> Result<BackendAuthConfig, String> {
    let script = backend_start_script(&app)?;
    let data_dir = resolve_backend_data_dir(&app, &script, None, true)?;
    let auth_path = data_dir.join("auth.json");
    if !auth_path.is_file() {
        return Ok(BackendAuthConfig {
            exists: false,
            user: "pg".to_string(),
            password: String::new(),
            data_dir: data_dir.to_string_lossy().to_string(),
            auth_path: auth_path.to_string_lossy().to_string(),
        });
    }

    let content = std::fs::read_to_string(&auth_path).map_err(|error| {
        format!(
            "Failed to read Project Graph backend auth config at {}: {error}",
            auth_path.to_string_lossy()
        )
    })?;
    let config: BackendAuthFile = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| {
            format!(
                "Failed to parse Project Graph backend auth config at {}: {error}",
                auth_path.to_string_lossy()
            )
        })?;
    let user = config
        .user
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "pg".to_string());
    let password = config.password.unwrap_or_default();
    if password.is_empty() {
        return Err(format!(
            "Project Graph backend auth config at {} is missing a password.",
            auth_path.to_string_lossy()
        ));
    }
    Ok(BackendAuthConfig {
        exists: true,
        user,
        password,
        data_dir: data_dir.to_string_lossy().to_string(),
        auth_path: auth_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn project_graph_backend_start(
    app: tauri::AppHandle,
    options: Option<BackendStartOptions>,
) -> Result<BackendStartResult, String> {
    let options = options.unwrap_or_else(default_backend_start_options);
    let script = backend_start_script(&app)?;
    let resource_backed = is_backend_runtime_script(&script);
    let data_dir = resolve_backend_start_data_dir(&app, &script, options.data_dir.as_deref())?;
    let log_path = options
        .log_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_backend_log_path);
    let mut command = Command::new(powershell_executable());
    hide_command_window(&mut command);
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
    let mut command = Command::new(powershell_executable());
    hide_command_window(&mut command);
    let output = command
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

fn default_backend_start_options() -> BackendStartOptions {
    BackendStartOptions {
        port: None,
        data_dir: None,
        auth_user: None,
        auth_password: None,
        no_auth: Some(false),
        skip_build: None,
        local_only: Some(false),
        log_path: None,
    }
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

fn resolve_backend_start_data_dir(
    app: &tauri::AppHandle,
    script: &Path,
    explicit_data_dir: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(value) = explicit_data_dir {
        if !value.trim().is_empty() {
            return Ok(Some(value.to_string()));
        }
    }
    if is_backend_runtime_script(script) {
        return Ok(Some(
            app_backend_data_dir(app)?.to_string_lossy().to_string(),
        ));
    }
    Ok(None)
}

fn resolve_backend_data_dir(
    app: &tauri::AppHandle,
    script: &Path,
    explicit_data_dir: Option<&str>,
    honor_runtime_metadata: bool,
) -> Result<PathBuf, String> {
    if let Some(value) = explicit_data_dir {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    if is_backend_runtime_script(script) {
        return app_backend_data_dir(app);
    }
    let root = backend_runtime_root(script)?;
    if honor_runtime_metadata {
        if let Some(data_dir) = read_backend_runtime_data_dir(&root)? {
            return Ok(data_dir);
        }
    }
    Ok(root.join("server").join("data"))
}

fn app_backend_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve Project Graph app data directory: {error}"))?
        .join("backend-data"))
}

fn backend_runtime_root(script: &Path) -> Result<PathBuf, String> {
    let scripts_dir = script.parent().ok_or_else(|| {
        format!(
            "Project Graph backend script has no parent directory: {}",
            script.to_string_lossy()
        )
    })?;
    scripts_dir.parent().map(Path::to_path_buf).ok_or_else(|| {
        format!(
            "Project Graph backend script has no runtime root: {}",
            script.to_string_lossy()
        )
    })
}

fn read_backend_runtime_data_dir(root: &Path) -> Result<Option<PathBuf>, String> {
    let runtime_path = root.join("server").join("web-runtime.json");
    if !runtime_path.is_file() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&runtime_path).map_err(|error| {
        format!(
            "Failed to read Project Graph backend runtime metadata at {}: {error}",
            runtime_path.to_string_lossy()
        )
    })?;
    let value: Value =
        serde_json::from_str(content.trim_start_matches('\u{feff}')).map_err(|error| {
            format!(
                "Failed to parse Project Graph backend runtime metadata at {}: {error}",
                runtime_path.to_string_lossy()
            )
        })?;
    Ok(value
        .get("dataDir")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from))
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

fn hide_command_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

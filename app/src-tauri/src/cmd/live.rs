use rand::{distr::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct LiveBridgeState {
    session: Mutex<Option<LiveSession>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub id: String,
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub registry_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveRpcRequest {
    id: String,
    token: String,
    method: String,
    params: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveUiRequest {
    id: String,
    method: String,
    params: Value,
}

#[tauri::command]
pub fn project_graph_live_start(
    app: AppHandle,
    state: State<LiveBridgeState>,
    port: Option<u16>,
    token: Option<String>,
) -> Result<LiveSession, String> {
    if let Some(session) = state.session.lock().map_err(|e| e.to_string())?.clone() {
        return Ok(session);
    }

    let listener =
        TcpListener::bind(("127.0.0.1", port.unwrap_or(0))).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = token.unwrap_or_else(generate_token);
    let registry_path = std::env::temp_dir()
        .join("project-graph-live-session.json")
        .to_string_lossy()
        .to_string();
    let session = LiveSession {
        id: format!("project-graph-{}", std::process::id()),
        port,
        token: token.clone(),
        pid: std::process::id(),
        registry_path: registry_path.clone(),
    };

    std::fs::write(
        &registry_path,
        serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    *state.session.lock().map_err(|e| e.to_string())? = Some(session.clone());

    let pending = state.pending.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    let pending = pending.clone();
                    let token = token.clone();
                    std::thread::spawn(move || handle_stream(stream, app, pending, token));
                }
                Err(error) => eprintln!("[project-graph-live] accept failed: {error}"),
            }
        }
    });

    Ok(session)
}

#[tauri::command]
pub fn project_graph_live_response(
    state: State<LiveBridgeState>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let tx = state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(tx) = tx {
        tx.send(response).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn handle_stream(
    mut stream: TcpStream,
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
    token: String,
) {
    let mut body = String::new();
    if let Err(error) = stream.read_to_string(&mut body) {
        write_response(
            &mut stream,
            json!({ "ok": false, "error": error.to_string() }),
        );
        return;
    }

    let request = match serde_json::from_str::<LiveRpcRequest>(&body) {
        Ok(request) => request,
        Err(error) => {
            write_response(
                &mut stream,
                json!({ "ok": false, "error": error.to_string() }),
            );
            return;
        }
    };

    if request.token != token {
        write_response(
            &mut stream,
            json!({ "id": request.id, "ok": false, "error": "invalid live session token" }),
        );
        return;
    }

    let (tx, rx) = mpsc::channel();
    if let Ok(mut guard) = pending.lock() {
        guard.insert(request.id.clone(), tx);
    } else {
        write_response(
            &mut stream,
            json!({ "id": request.id, "ok": false, "error": "live bridge state is poisoned" }),
        );
        return;
    }

    let request_id = request.id.clone();
    let emit_result = app.emit(
        "project-graph-live-request",
        LiveUiRequest {
            id: request.id,
            method: request.method,
            params: request.params,
        },
    );

    if let Err(error) = emit_result {
        let _ = pending.lock().map(|mut guard| guard.remove(&request_id));
        write_response(
            &mut stream,
            json!({ "id": request_id, "ok": false, "error": error.to_string() }),
        );
        return;
    }

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(response) => write_response(&mut stream, response),
        Err(error) => {
            let _ = pending.lock().map(|mut guard| guard.remove(&request_id));
            write_response(
                &mut stream,
                json!({ "id": request_id, "ok": false, "error": error.to_string() }),
            );
        }
    }
}

fn write_response(stream: &mut TcpStream, response: Value) {
    if let Ok(data) = serde_json::to_vec(&response) {
        let _ = stream.write_all(&data);
        let _ = stream.flush();
    }
}

fn generate_token() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

//! A client's desktop app, opened by double-clicking its mark on the HUD:
//! brought forward when it already has a window, started otherwise. Only the
//! apps the clients' descriptors name can be opened, and only from a HUD.
use agent_hud_hud::presentation::mark;
use serde::Serialize;
use tauri::WebviewWindow;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
use linux as target;
#[cfg(target_os = "macos")]
use macos as target;
#[cfg(target_os = "windows")]
use windows as target;

/// What a HUD may open: the marks whose client has a desktop app installed
/// here, and how long the system waits for a second click.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApps {
    double_click_ms: u32,
    marks: Vec<String>,
}

/// Each client's first installed app, by the mark the HUD draws the client as.
fn installed() -> Vec<(String, &'static str)> {
    agent_hud_runtime::packaged_apps()
        .filter_map(|(agent, ids)| {
            let id = ids.iter().copied().find(|id| target::installed(id))?;
            Some((mark(agent), id))
        })
        .collect()
}

fn listed() -> DesktopApps {
    DesktopApps {
        double_click_ms: target::double_click_ms(),
        marks: installed().into_iter().map(|(key, _)| key).collect(),
    }
}

fn open(key: &str) -> Result<(), String> {
    let (_, id) = installed()
        .into_iter()
        .find(|(found, _)| found == key)
        .ok_or("No desktop app is installed for this agent")?;
    target::open(id)
}

/// Settings, Statistics, a product's pages and the HUD picture an agent asks
/// for never open another app.
fn from_hud(window: &WebviewWindow) -> Result<(), String> {
    if window.label().starts_with("hud-") && window.label() != "hud-picture" {
        Ok(())
    } else {
        Err("Only a HUD opens a client's desktop app".into())
    }
}

#[tauri::command]
pub async fn hud_desktop_apps(window: WebviewWindow) -> Result<DesktopApps, String> {
    from_hud(&window)?;
    tauri::async_runtime::spawn_blocking(listed)
        .await
        .map_err(|_| "Desktop app worker failed".to_owned())
}

/// Brings forward, or starts, the desktop app of the client drawn as `key`.
#[tauri::command]
pub async fn hud_open_desktop_app(window: WebviewWindow, key: String) -> Result<(), String> {
    from_hud(&window)?;
    tauri::async_runtime::spawn_blocking(move || open(&key))
        .await
        .map_err(|_| "Desktop app worker failed".to_owned())?
}

// CyberDash — native shell entry point (Tauri v2).
//
// This prototype is intentionally thin: it hosts the existing React/Vite
// frontend in a native GNOME window and lets the OS drive the colour scheme.
// The window's `theme` is left unset in tauri.conf.json, so Tauri follows the
// desktop's Light/Dark preference; the frontend listens for theme changes via
// the @tauri-apps/api `onThemeChanged` event (see src/theme.js) and restyles
// itself live.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running the CyberDash shell");
}

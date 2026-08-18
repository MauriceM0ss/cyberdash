// CyberDash — native shell entry point (Tauri v2).
//
// This prototype is intentionally thin: it hosts the existing React/Vite
// frontend in a native GNOME window and lets the OS drive the colour scheme.
// The window's `theme` is left unset in tauri.conf.json, so Tauri follows the
// desktop's Light/Dark preference; the frontend listens for theme changes via
// the @tauri-apps/api `onThemeChanged` event (see src/theme.js) and restyles
// itself live.

use tauri::webview::NewWindowResponse;
use tauri::WebviewWindowBuilder;
use tauri_plugin_opener::OpenerExt;

// Schemes we're willing to hand to the desktop's default handler. Requests come
// from whatever is loaded in the shell — including feed content inside an
// embedded app — so this stays a strict allow-list rather than a deny-list.
const EXTERNAL_SCHEMES: [&str; 2] = ["http", "https"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The window is declared in tauri.conf.json with `"create": false`
            // so we can build it here instead: `on_new_window` can only be
            // attached at build time, and Tauri's automatic config-window
            // creation gives us no hook to attach it.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("no `main` window declared in tauri.conf.json")
                .clone();

            let handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Nothing inside the shell should ever spawn a second window.
                // A WebKitGTK webview with no handler here silently drops the
                // request instead, which is why `target="_blank"` links and
                // `window.open` (a YouTube item in CyberNewsHub, say) appeared
                // to do nothing at all in the .deb. Send them to the desktop's
                // browser and deny the window.
                .on_new_window(move |url, _features| {
                    if EXTERNAL_SCHEMES.contains(&url.scheme()) {
                        if let Err(e) = handle.opener().open_url(url.as_str(), None::<&str>) {
                            eprintln!("[cyberdash] could not open {url} externally: {e}");
                        }
                    } else {
                        eprintln!("[cyberdash] refused to open {url} — scheme not allowed");
                    }
                    NewWindowResponse::Deny
                })
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the CyberDash shell");
}

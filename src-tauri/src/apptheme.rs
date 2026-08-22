// ─────────────────────────────────────────────────────────────────────────
//  Theme bridge — pushes the shell's theme into the embedded apps.
//
//  Every app in the family implements the same five themes and stores its
//  choice under its own localStorage key, so the shell doesn't set the theme
//  itself: it posts a `cyberdash:theme` message and each app decides what to do
//  with it (see the listener in each app's base template). That keeps the list
//  of valid themes where it belongs — in the app — rather than in a table here
//  that would rot the moment an app gained a sixth.
//
//  Why this needs Rust at all: in the .deb an app is a native child webview,
//  not a frame, so the shell has no window handle to postMessage to. Evaluating
//  the postMessage inside the webview gets to the very same listener the
//  browser build reaches directly, so the apps only implement one path.
//
//  The push is sent on every page load rather than only when the theme changes,
//  which is what makes a cold start correct: an app that was launched — or
//  reloaded, or recovered after being down — picks up the current theme without
//  the shell having to guess when its document became ready.
// ─────────────────────────────────────────────────────────────────────────

use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Webviews whose label starts with this are embedded apps (see nativeStage.js).
const APP_PREFIX: &str = "app__";

/// The theme the shell is currently showing, as last reported by the frontend.
#[derive(Default)]
pub struct CurrentTheme(pub Mutex<Option<String>>);

// A theme id is interpolated into JavaScript below, so it may only ever be a
// plain identifier. This is the whole defence: no quotes, no escapes, nothing
// that can leave the string it lands in.
fn is_safe_id(theme: &str) -> bool {
    !theme.is_empty()
        && theme.len() <= 32
        && theme.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn push_to<R: Runtime>(app: &AppHandle<R>, label: &str, theme: &str) {
    let Some(webview) = app.webviews().get(label).cloned() else {
        return;
    };
    let script = format!(
        "window.postMessage({{ type: 'cyberdash:theme', theme: '{theme}' }}, '*')"
    );
    if let Err(e) = webview.eval(&script) {
        eprintln!("[cyberdash] could not send the theme to {label}: {e}");
    }
}

/// Remember the shell's theme and send it to every app currently open.
#[tauri::command]
pub fn theme_broadcast<R: Runtime>(app: AppHandle<R>, theme: String) -> Result<(), String> {
    if !is_safe_id(&theme) {
        return Err(format!("`{theme}` is not a usable theme id"));
    }

    if let Some(state) = app.try_state::<CurrentTheme>() {
        if let Ok(mut current) = state.0.lock() {
            *current = Some(theme.clone());
        }
    }

    for label in app.webviews().keys() {
        if label.starts_with(APP_PREFIX) {
            push_to(&app, label, &theme);
        }
    }
    Ok(())
}

/// Send the remembered theme to one app that has just finished loading.
pub fn push_on_load<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if !label.starts_with(APP_PREFIX) {
        return;
    }
    let Some(state) = app.try_state::<CurrentTheme>() else {
        return;
    };
    let theme = state.0.lock().ok().and_then(|t| t.clone());
    let Some(theme) = theme else {
        return; // the shell hasn't reported a theme yet; the app keeps its own
    };
    push_to(app, label, &theme);
}

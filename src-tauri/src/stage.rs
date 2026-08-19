// ─────────────────────────────────────────────────────────────────────────
//  Native stage — GTK plumbing for the multi-webview embedding mode.
//
//  The shell embeds each app as a native child webview so that the app is a
//  TOP-LEVEL document rather than a cross-origin <iframe>. That distinction is
//  not cosmetic on WebKitGTK: a cross-origin frame's localStorage is
//  memory-only there, so an app embedded by iframe silently forgets every
//  preference it stores the moment the window closes (see TAURI.md).
//
//  Tauri can create the child webviews, but on Linux it cannot place them.
//  Every webview it builds is packed into the window's default GtkBox with
//  expand+fill, so N webviews split the window N ways and `setPosition` /
//  `setSize` are no-ops — wry only honours those when the parent happens to be
//  a GtkFixed, which Tauri never gives it.
//
//  So we install one ourselves. On the first placement the window's webview is
//  lifted out of that GtkBox into a GtkLayout of our own, and every webview
//  created afterwards is adopted into it as it appears. A GtkLayout child gets
//  exactly the geometry it asks for, which is what the commands below hand it.
//  The frontend keeps driving the layout — it measures the stage slot in the DOM
//  and calls `stage_place` (see src/nativeStage.js); this module only carries
//  out what it asks for.
//
//  GtkLayout rather than the more obvious GtkFixed: a GtkFixed asks for the
//  union of its children as its own minimum size, so sizing the shell webview to
//  the window raises the window's minimum, which enlarges the window, which
//  resizes the shell — the window grows without bound. GtkLayout positions
//  children the same way but always asks for nothing.
//
//  Everything here runs inside `with_webview`, whose closure Tauri dispatches to
//  the GTK main thread — the only thread on which any of these calls are legal.
// ─────────────────────────────────────────────────────────────────────────

use gtk::prelude::*;
use tauri::{AppHandle, Manager, Runtime};

/// The webview holding the CyberDash shell itself — the chrome the apps are
/// placed over. It is created from tauri.conf.json's window, so it carries that
/// window's label.
pub const SHELL_LABEL: &str = "main";

/// Find the GtkLayout the stage is built on, creating it on first use.
///
/// `widget` is any webview in the window. Either it has already been adopted
/// (its parent *is* the stage), or it is still sitting in the window's default
/// GtkBox, in which case the stage is that box's GtkLayout child — added here
/// the first time round.
fn stage_of(widget: &gtk::Widget) -> Option<gtk::Layout> {
    let parent = widget.parent()?;

    if let Ok(stage) = parent.clone().downcast::<gtk::Layout>() {
        return Some(stage);
    }

    let vbox = parent.downcast::<gtk::Box>().ok()?;
    let stage = vbox
        .children()
        .into_iter()
        .find_map(|child| child.downcast::<gtk::Layout>().ok())
        .unwrap_or_else(|| {
            let stage = gtk::Layout::new(gtk::Adjustment::NONE, gtk::Adjustment::NONE);
            vbox.pack_start(&stage, true, true, 0);
            stage.show();
            stage
        });

    // Move the webview across. Our own clone keeps it alive across the removal.
    vbox.remove(widget);
    stage.put(widget, 0, 0);
    Some(stage)
}

/// Position a webview over the window, in logical pixels, and show it.
///
/// Children of the stage are drawn in the order they were added, so the app
/// webviews — created after the shell — always draw over it. That is why the
/// frontend hides the active app whenever an HTML layer of its own (Home, the
/// About panel, an offline notice) has to show through.
#[tauri::command]
pub fn stage_place<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("no webview labelled `{label}`"))?;

    let label = label.clone();
    webview
        .with_webview(move |platform| {
            let widget: gtk::Widget = platform.inner().upcast();
            if let Some(stage) = stage_of(&widget) {
                widget.set_size_request(width, height);
                stage.move_(&widget, x, y);
                widget.show();
                debug_geometry(&widget, &label, x, y, width, height);
            }
        })
        .map_err(|e| e.to_string())
}

/// Take a webview off the stage without destroying it. A hidden GTK widget
/// keeps its document — and everything the app has in memory — intact.
#[tauri::command]
pub fn stage_hide<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let Some(webview) = app.webviews().get(&label).cloned() else {
        return Ok(()); // already gone; nothing to hide
    };

    webview
        .with_webview(move |platform| {
            let widget: gtk::Widget = platform.inner().upcast();
            widget.hide();
            if std::env::var_os("CYBERDASH_STAGE_DEBUG").is_some() {
                eprintln!("[stage] {label}: hidden");
            }
        })
        .map_err(|e| e.to_string())
}

/// Put the shell webview on the stage and keep it filling the stage from then
/// on. Called once at startup; this is also what installs the stage itself.
///
/// The size is taken from the stage container's own allocation rather than from
/// the window, because on GTK the two are not the same number: with client-side
/// decorations `inner_size()` counts the invisible resize border around the
/// window, so trusting it made the shell ~52px wider and taller than the space
/// it had. Everything anchored to an edge then hung off screen — the dock on
/// either side it can be docked to, and the right-hand end of the top bar — and
/// the stage rect the frontend measured was too big too, which cropped the
/// bottom off whichever app was showing. The container's allocation is the
/// content area by definition, so there is nothing to correct for.
pub fn install_shell<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.webviews().get(SHELL_LABEL).cloned() else {
        eprintln!("[cyberdash] no `{SHELL_LABEL}` webview to build the stage on");
        return;
    };

    let result = shell.with_webview(|platform| {
        let widget: gtk::Widget = platform.inner().upcast();
        let Some(stage) = stage_of(&widget) else {
            eprintln!("[cyberdash] could not install the stage container");
            return;
        };

        // Re-fill on every reallocation, which covers window resizes without
        // needing to listen for them separately.
        //
        // Except while a newly created webview is still sitting in the GtkBox
        // next to the stage: the two split the window until the first
        // `stage_place` adopts it, and sizing the shell to that half-window only
        // to undo it a moment later is a visible lurch every time an app is
        // opened for the first time.
        let shell = widget.clone();
        stage.connect_size_allocate(move |stage, allocation| {
            if sharing_the_box(stage) {
                return;
            }
            fill(&shell, allocation.width(), allocation.height());
        });

        let allocation = stage.allocation();
        fill(&widget, allocation.width(), allocation.height());
    });

    if let Err(e) = result {
        eprintln!("[cyberdash] could not reach the shell webview: {e}");
    }
}

/// Whether the stage is currently sharing the window's GtkBox with a webview
/// that hasn't been adopted yet, and so has been allocated less than the window.
fn sharing_the_box(stage: &gtk::Layout) -> bool {
    stage
        .parent()
        .and_then(|parent| parent.downcast::<gtk::Box>().ok())
        .is_some_and(|vbox| vbox.children().len() > 1)
}

/// Size the shell to the stage, skipping the call when it already matches — a
/// size request inside a size-allocate handler schedules another layout pass,
/// so re-asking for the size we already have would keep GTK busy for nothing.
fn fill(shell: &gtk::Widget, width: i32, height: i32) {
    let (current_w, current_h) = shell.size_request();
    if (current_w, current_h) == (width, height) {
        return;
    }
    shell.set_size_request(width, height);
    debug_geometry(shell, SHELL_LABEL, 0, 0, width, height);
}

/// Set `CYBERDASH_STAGE_DEBUG=1` to have every placement report back what GTK
/// actually allocated, once the layout has settled. Worth reaching for when a
/// webview lands in the wrong place: it separates "we asked for the wrong rect"
/// from "we asked correctly and GTK did something else".
fn debug_geometry(widget: &gtk::Widget, label: &str, x: i32, y: i32, width: i32, height: i32) {
    if std::env::var_os("CYBERDASH_STAGE_DEBUG").is_none() {
        return;
    }
    let widget = widget.clone();
    let label = label.to_string();
    // Long enough for GTK to have finished the layout pass — on an idle callback
    // you catch the webview mid-allocation and read a meaningless 1x1.
    gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(400), move || {
        let alloc = widget.allocation();
        eprintln!(
            "[stage] {label}: asked x={x} y={y} {width}x{height}              — got x={} y={} {}x{}",
            alloc.x(),
            alloc.y(),
            alloc.width(),
            alloc.height(),
        );
    });
}

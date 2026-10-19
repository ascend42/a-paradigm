//! #gnomon-wrapper app (spec §11.1; M1.13). Step 2: the window, the origin lock
//! and the IPC-disabled page. The kernel child and the verified hand-off are
//! wired in by the following steps.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};

use gnomon_wrapper::nav::{navigation_allowed, Phase};
use gnomon_wrapper::surface::{IPC_DISABLED_SCRIPT, SURFACE_SCRIPT};
use tauri::webview::NewWindowResponse;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let phase = Arc::new(Mutex::new(Phase::Status));
    let nav_phase = phase.clone();
    tauri::Builder::default()
        .invoke_system(IPC_DISABLED_SCRIPT)
        .setup(move |app| {
            let p = nav_phase.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Gnomon")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 400.0)
                .initialization_script(SURFACE_SCRIPT)
                .devtools(cfg!(debug_assertions))
                .on_navigation(move |url| navigation_allowed(url.as_str(), *p.lock().unwrap()))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("gnomon-wrapper: the app did not start");
}

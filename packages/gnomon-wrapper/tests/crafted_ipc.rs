//! #gnomon-wrapper: crafted IPC messages are refused (Aegis C3 (a), G-GUI-12 "page
//! content reaches a Tauri command"). Built on Tauri's own mock runtime with THIS
//! app's tauri.conf.json (capabilities: [], withGlobalTauri: false) and THIS
//! app's invoke_system stub, so the ACL under test is the shipped one:
//!   - a message without the per-run invoke key gets NO response (Tauri drops it
//!     before routing) — and no script the page sees carries that key;
//!   - with the right key (what a page could only have if the key leaked), every
//!     command a page might try is refused, from the kernel origin and from the
//!     app's own status-page origin alike: core plugins (app, window, webview,
//!     event, path), and an unknown command.
//! The live half inside a real WKWebView is probe P08.
use std::sync::mpsc;
use std::time::Duration;

use gnomon_wrapper::surface::{IPC_DISABLED_SCRIPT, SURFACE_SCRIPT};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
use tauri::test::{mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn app_window() -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder().invoke_system(IPC_DISABLED_SCRIPT).build(tauri::generate_context!()).expect("mock app");
    let w = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into())).initialization_script(SURFACE_SCRIPT).build().expect("mock window");
    (app, w)
}

/// Send one crafted message; None = no response at all (dropped), Some(Ok/Err) = the answer.
fn send(w: &WebviewWindow<MockRuntime>, cmd: &str, url: &str, key: &str) -> Option<Result<(), String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    let req = InvokeRequest { cmd: cmd.into(), callback: CallbackFn(0), error: CallbackFn(1), url: url.parse().unwrap(), body: InvokeBody::default(), headers: Default::default(), invoke_key: key.into() };
    let wv: &tauri::Webview<MockRuntime> = w.as_ref();
    wv.clone().on_message(
        req,
        Box::new(move |_w, _c, resp, _cb, _err| {
            let _ = tx.send(match resp {
                InvokeResponse::Ok(_) => Ok(()),
                InvokeResponse::Err(e) => Err(e.0.to_string()),
            });
        }),
    );
    rx.recv_timeout(Duration::from_millis(500)).ok()
}

const PAGE_TRIES: [&str; 8] = [
    "plugin:app|version",
    "plugin:app|app_show",
    "plugin:window|close",
    "plugin:webview|create_webview_window",
    "plugin:event|emit",
    "plugin:path|resolve_directory",
    "plugin:menu|new",
    "gnomon_anything",
];

#[test]
fn falsifier_a_message_without_the_invoke_key_is_dropped_before_routing() {
    let (_app, w) = app_window();
    for cmd in PAGE_TRIES {
        assert_eq!(send(&w, cmd, "http://127.0.0.1:4321/", "a-guessed-key"), None, "{cmd} must get no response without the key");
        assert_eq!(send(&w, cmd, "http://127.0.0.1:4321/", ""), None, "{cmd}");
    }
}

#[test]
fn falsifier_even_with_the_key_every_command_is_refused_from_both_origins() {
    let (_app, w) = app_window();
    for url in ["http://127.0.0.1:4321/", "tauri://localhost/index.html"] {
        for cmd in PAGE_TRIES {
            match send(&w, cmd, url, INVOKE_KEY) {
                Some(Err(_)) => {}
                other => panic!("{cmd} from {url} must be refused, got {other:?}"),
            }
        }
    }
}

#[test]
fn no_page_visible_script_of_ours_carries_the_invoke_key() {
    // the key reaches page JS only through the invoke system script; ours is the keyless stub
    for s in [IPC_DISABLED_SCRIPT, SURFACE_SCRIPT, include_str!("../static/status.js")] {
        assert!(!s.contains(INVOKE_KEY) && !s.contains("__INVOKE_KEY__") && !s.contains("__TEMPLATE_invoke_key__"));
    }
}

//! #gnomon-wrapper structural falsifiers for "page content reaches a Tauri command"
//! and "devtools in a release build" (G-GUI-12; P08 rows). The live half (a page
//! calling `__TAURI_INTERNALS__.invoke` / `webkit.messageHandlers.ipc` inside the
//! running app) is probe P08's, founder-run.
use serde_json::Value;

const CONF: &str = include_str!("../tauri.conf.json");
const CARGO: &str = include_str!("../Cargo.toml");
const MAIN: &str = include_str!("../src/main.rs");

#[test]
fn no_commands_no_handler_no_capabilities_no_global_tauri() {
    let c: Value = serde_json::from_str(CONF).unwrap();
    assert_eq!(c["app"]["withGlobalTauri"], Value::Bool(false));
    assert_eq!(c["app"]["security"]["capabilities"], serde_json::json!([]));
    assert_eq!(c["app"]["security"]["freezePrototype"], Value::Bool(true));
    for forbidden in ["#[tauri::command]", "generate_handler!", ".invoke_handler(", ".plugin(", "remote", "dangerous"] {
        assert!(!MAIN.contains(forbidden), "main.rs must not contain {forbidden}");
    }
    assert!(MAIN.contains(".invoke_system(IPC_DISABLED_SCRIPT)"));
    assert!(!std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities")).exists(), "no capabilities/ directory");
    let generated = concat!(env!("CARGO_MANIFEST_DIR"), "/gen/schemas/capabilities.json");
    if let Ok(t) = std::fs::read_to_string(generated) {
        assert_eq!(serde_json::from_str::<Value>(&t).unwrap(), serde_json::json!({}), "the generated capability set is empty");
    }
}

#[test]
fn no_devtools_feature_and_devtools_only_in_debug() {
    let tauri_line = CARGO.lines().find(|l| l.starts_with("tauri = ")).unwrap();
    assert!(tauri_line.contains("version = \"="), "tauri is pinned exact: {tauri_line}");
    assert!(!tauri_line.contains("devtools"), "{tauri_line}");
    assert!(MAIN.contains(".devtools(cfg!(debug_assertions))"));
}

#[test]
fn the_only_remote_url_is_the_loopback_kernel() {
    // every navigation goes through the origin lock; every new window is denied
    assert!(MAIN.contains(".on_navigation(") && MAIN.contains("navigation_allowed("));
    assert!(MAIN.contains(".on_new_window(|_, _| NewWindowResponse::Deny)"));
    assert!(!MAIN.contains("https://"));
}

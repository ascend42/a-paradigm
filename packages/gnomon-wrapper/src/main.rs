//! #gnomon-wrapper app: Gnomon.app (spec §11.1; M1.13, P8-D56). Double-click and
//! it runs:
//!   1. one window on the bundled status page ("starting the kernel");
//!   2. the kernel child `node --disable-sigusr1 <dist>/cli/gnomon.js up --wrapper` (kernel.rs:
//!      clean env, node from the local config pin or the build record), its
//!      stderr appended to ~/Library/Logs/Gnomon/kernel.log (0600);
//!   3. on the channel's `up`, a `launch` request; on the grant, the native
//!      preflight (loopback.rs: bundle pin, the wrapper's own hello + serverSig,
//!      served bytes) and ONLY THEN the move to `Kernel{port}` and the
//!      navigation to `http://127.0.0.1:<port>/#launch=<token>&k=<spki>`;
//!   4. any refusal (an unprovisioned home names `gnomon identity init`, a
//!      forged serverSig, a bundle mismatch, a kernel already running) leaves
//!      the window on the status page with the error — nothing else renders.
//! Closing the window HIDES it (the kernel and its sessions keep running);
//! clicking the Dock icon shows it again. Quit (Cmd-Q) sends `quit` to the
//! kernel, waits up to 10 s, then kills it. A second launch of the app is
//! focused by LaunchServices (one instance per bundle id). The token is
//! never logged: only `LaunchGrant::url()` holds it, and only `navigate` sees that.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use gnomon_wrapper::bundle::PIN;
use gnomon_wrapper::contract::{parse_line, ChannelLine};
use gnomon_wrapper::kernel::{check_trust_root, child_command, BUILD_GNOMON_PKG};
use gnomon_wrapper::loopback::preflight;
use gnomon_wrapper::nav::{navigation_allowed, Phase, APP_ORIGIN};
use gnomon_wrapper::surface::{IPC_DISABLED_SCRIPT, SURFACE_SCRIPT};
use serde_json::json;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct Shared {
    phase: Mutex<Phase>,
    status: Mutex<serde_json::Value>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    quitting: AtomicBool,
    log: Mutex<Option<fs::File>>,
}

impl Shared {
    fn log(&self, line: &str) {
        if let Some(f) = self.log.lock().unwrap().as_mut() {
            let _ = writeln!(f, "[wrapper] {line}");
        }
    }
}

fn user_home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

/// ~/Library/Logs/Gnomon/kernel.log (dir 0700, file 0600, append): the child's stderr + the wrapper's own lines.
fn open_log() -> Option<fs::File> {
    let dir = user_home().join("Library/Logs/Gnomon");
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).ok()?;
    OpenOptions::new().create(true).append(true).mode(0o600).open(dir.join("kernel.log")).ok()
}

/// Put the window on the status page with `state` (and `detail`); never renders anything else.
fn show_status(app: &AppHandle, sh: &Shared, state: &str, detail: &str, error: bool) {
    let s = json!({ "state": state, "detail": detail, "error": error });
    *sh.status.lock().unwrap() = s.clone();
    sh.log(&format!("status: {state}"));
    let Some(w) = app.get_webview_window("main") else { return };
    let on_status = w.url().map(|u| navigation_allowed(u.as_str(), Phase::Status)).unwrap_or(false);
    *sh.phase.lock().unwrap() = Phase::Status;
    if on_status {
        let _ = w.eval(format!("window.gnomonStatusPending={s};window.gnomonStatus&&window.gnomonStatus({s});"));
    } else if let Ok(u) = Url::parse(&format!("{APP_ORIGIN}/index.html")) {
        let _ = w.navigate(u); // on_page_load replays the pending status
    }
}

fn send(sh: &Shared, cmd: &str) {
    if let Some(s) = sh.stdin.lock().unwrap().as_mut() {
        let _ = s.write_all(format!("{cmd}\n").as_bytes());
        let _ = s.flush();
    }
}

fn refusal_text(reason: &str, message: &str, next: &[String]) -> (String, String) {
    let head = match reason {
        "unprovisioned" => "Gnomon is not set up on this Mac yet".to_string(),
        "daemon-running" => "a Gnomon kernel is already running on this home".to_string(),
        "dev-home" => "this home is a DEV-ONLY home".to_string(),
        r => format!("the kernel did not start ({r})"),
    };
    let mut detail = message.to_string();
    for n in next {
        detail.push_str(&format!("\n\nnext: {n}"));
    }
    if reason == "unprovisioned" {
        detail.push_str(&format!("\n\nIn Terminal:\n  node {BUILD_GNOMON_PKG}/dist/cli/gnomon.js identity init\nthen open Gnomon again."));
    }
    (head, detail)
}

fn start_kernel(app: AppHandle, sh: Arc<Shared>) {
    // Aegis C1: node and the kernel tree are re-hashed against the build's pins before EVERY spawn
    let t = match check_trust_root() {
        Ok(t) => t,
        Err(e) => return show_status(&app, &sh, "Gnomon.app was built against a different node or kernel", &e, true),
    };
    let (node, js) = (t.node.clone(), t.gnomon_js.clone());
    sh.log(&format!("node {} (recorded {} via {}; sha256 equals the build pin); kernel {} (tree equals the build pin)", node.display(), t.node_recorded.display(), t.node_source, js.display()));
    let env: Vec<(String, String)> = std::env::vars().collect();
    let stderr = sh.log.lock().unwrap().as_ref().and_then(|f| f.try_clone().ok()).map(Stdio::from).unwrap_or_else(Stdio::null);
    let mut child = match child_command(&node, &js, None, &env, stderr).spawn() {
        Ok(c) => c,
        Err(e) => return show_status(&app, &sh, "the kernel did not start", &format!("{}: {e}", node.display()), true),
    };
    let out = child.stdout.take().expect("piped stdout");
    *sh.stdin.lock().unwrap() = child.stdin.take();
    *sh.child.lock().unwrap() = Some(child);
    for line in BufReader::new(out).lines().map_while(Result::ok) {
        match parse_line(&line) {
            Ok(ChannelLine::Up) => {
                show_status(&app, &sh, "verifying the kernel", "", false);
                send(&sh, "launch");
            }
            Ok(ChannelLine::Launch(g)) => match preflight(g.port, &g.kernel_public_key, &g.bundle_hash, PIN) {
                Ok(()) => {
                    sh.log(&format!("preflight ok on port {}: hello serverSig verified against the channel key; channel bundleHash equals the compiled pin; the served files re-hash to it", g.port));
                    *sh.phase.lock().unwrap() = Phase::Kernel { port: g.port };
                    if let (Some(w), Ok(u)) = (app.get_webview_window("main"), Url::parse(&g.url())) {
                        let _ = w.navigate(u);
                    }
                }
                Err(e) => show_status(&app, &sh, "Gnomon refused to open the page", &e.to_string(), true),
            },
            Ok(ChannelLine::LaunchFailed { message }) => show_status(&app, &sh, "the kernel could not open its GUI endpoint", &message, true),
            Ok(ChannelLine::Refused { reason, message, next }) => {
                let (h, d) = refusal_text(&reason, &message, &next);
                show_status(&app, &sh, &h, &d, true);
            }
            Ok(ChannelLine::Down { reason }) => {
                if !sh.quitting.load(Ordering::SeqCst) {
                    show_status(&app, &sh, "the kernel stopped", &format!("reason: {reason}\n\nQuit and reopen Gnomon to start it again."), true);
                }
            }
            Err(why) => sh.log(&format!("ignored a channel line: {why}")),
        }
    }
    // stdout closed: the child is gone
    let status = sh.child.lock().unwrap().as_mut().and_then(|c| c.wait().ok());
    if !sh.quitting.load(Ordering::SeqCst) && *sh.phase.lock().unwrap() != Phase::Status {
        show_status(&app, &sh, "the kernel exited", &format!("{status:?}\n\nSee ~/Library/Logs/Gnomon/kernel.log; quit and reopen Gnomon to start it again."), true);
    }
}

/// Cmd-Q: `quit` on the channel, close stdin (EOF also quits), wait up to 10 s, then kill.
fn stop_kernel(sh: &Shared) {
    if sh.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    send(sh, "quit");
    drop(sh.stdin.lock().unwrap().take());
    if let Some(mut c) = sh.child.lock().unwrap().take() {
        let end = Instant::now() + Duration::from_secs(10);
        while Instant::now() < end {
            if let Ok(Some(_)) = c.try_wait() {
                sh.log("kernel stopped");
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = c.kill();
        let _ = c.wait();
        sh.log("kernel killed after 10 s");
    }
}

fn main() {
    let sh = Arc::new(Shared { phase: Mutex::new(Phase::Status), status: Mutex::new(json!({ "state": "starting the kernel" })), stdin: Mutex::new(None), child: Mutex::new(None), quitting: AtomicBool::new(false), log: Mutex::new(open_log()) });
    let setup_sh = sh.clone();
    let app = tauri::Builder::default()
        .invoke_system(IPC_DISABLED_SCRIPT)
        .setup(move |app| {
            let nav_sh = setup_sh.clone();
            let load_sh = setup_sh.clone();
            let close_sh = setup_sh.clone();
            let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Gnomon")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 400.0)
                .initialization_script(SURFACE_SCRIPT)
                .devtools(cfg!(debug_assertions))
                .on_navigation(move |url| {
                    let ok = navigation_allowed(url.as_str(), *nav_sh.phase.lock().unwrap());
                    if !ok {
                        nav_sh.log(&format!("blocked a navigation to {}://{}", url.scheme(), url.host_str().unwrap_or("")));
                    }
                    ok
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_page_load(move |wv, p| {
                    if p.event() == PageLoadEvent::Finished && navigation_allowed(p.url().as_str(), Phase::Status) {
                        let s = load_sh.status.lock().unwrap().clone();
                        let _ = wv.eval(format!("window.gnomonStatusPending={s};window.gnomonStatus&&window.gnomonStatus({s});"));
                    }
                })
                .build()?;
            // closing the window hides it: the kernel and every session keep running (§11.1, G-GUI-05)
            let hide = w.clone();
            w.on_window_event(move |e| {
                if let WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    let _ = hide.hide();
                    close_sh.log("window closed: hidden, kernel kept running");
                }
            });
            let h = app.handle().clone();
            let ksh = setup_sh.clone();
            std::thread::spawn(move || start_kernel(h, ksh));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("gnomon-wrapper: the app did not start");
    let run_sh = sh.clone();
    app.run(move |app, e| match e {
        RunEvent::Reopen { .. } => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_kernel(&run_sh),
        _ => {}
    });
}


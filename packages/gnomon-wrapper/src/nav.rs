//! #gnomon-wrapper origin lock (spec §11.1, §11.2 rules 3 and 10; P08 "`on_navigation`
//! blocks other origins"). The window is in exactly one phase at a time and the
//! NATIVE side moves it; page content cannot change it:
//!   - `Status`: only the app's own bundled status page (no network, no token);
//!   - `Kernel{port}`: only `http://127.0.0.1:<port>` — the one origin the browser
//!     also uses, so the kernel's rule-3 lock has one origin to check.
//! Anything else (another port, `localhost`, a userinfo trick, another scheme,
//! a `tauri://` page while the kernel page is up) is refused.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Status,
    Kernel { port: u16 },
}

/// The origin the app's bundled assets are served from on this OS.
#[cfg(target_os = "windows")]
pub const APP_ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(target_os = "windows"))]
pub const APP_ORIGIN: &str = "tauri://localhost";

/// The one kernel origin for `port`.
pub fn kernel_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// `url` is exactly `origin`, or `origin` followed by `/`, `?` or `#`.
fn same_origin(url: &str, origin: &str) -> bool {
    match url.strip_prefix(origin) {
        Some(rest) => rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#'),
        None => false,
    }
}

/// May the main frame navigate to `url` in `phase`?
pub fn navigation_allowed(url: &str, phase: Phase) -> bool {
    match phase {
        Phase::Status => same_origin(url, APP_ORIGIN),
        Phase::Kernel { port } => port != 0 && same_origin(url, &kernel_origin(port)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_phase_allows_only_its_origin() {
        let p = Phase::Kernel { port: 4321 };
        assert!(navigation_allowed("http://127.0.0.1:4321/", p));
        assert!(navigation_allowed("http://127.0.0.1:4321/#launch=x&k=y", p));
        assert!(navigation_allowed("http://127.0.0.1:4321", p));
        for bad in [
            "http://127.0.0.1:43210/",
            "http://127.0.0.1:432/",
            "http://localhost:4321/",
            "https://127.0.0.1:4321/",
            "http://127.0.0.1:4321@evil.example/",
            "http://127.0.0.1:4321.evil.example/",
            "http://[::1]:4321/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "file:///etc/passwd",
            "about:blank",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!navigation_allowed(bad, p), "{bad} must be refused");
        }
        assert!(!navigation_allowed("http://127.0.0.1:0/", Phase::Kernel { port: 0 }));
    }

    #[test]
    fn status_phase_allows_only_the_bundled_page() {
        assert!(navigation_allowed(&format!("{APP_ORIGIN}/index.html"), Phase::Status));
        assert!(!navigation_allowed("http://127.0.0.1:4321/", Phase::Status));
        assert!(!navigation_allowed(&format!("{APP_ORIGIN}.evil/"), Phase::Status));
        assert!(!navigation_allowed("https://example.com/", Phase::Status));
    }
}

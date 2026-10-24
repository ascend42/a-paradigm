//! #gnomon-wrapper page-side scripts (spec §11.1 "IPC disabled for page content";
//! P08 "`__TAURI_INTERNALS__` invokes and `webkit.messageHandlers.ipc` denied";
//! T-2026-10-18-018 N1 "the page needs a wrapper surface path").
//!
//! IPC: Tauri's default invoke system script (ipc-protocol.js) is the only
//! page-visible holder of the per-run invoke key. `Builder::invoke_system`
//! replaces it with [`IPC_DISABLED_SCRIPT`], which embeds NO key and makes
//! `postMessage` throw; with no key in the page, a raw
//! `webkit.messageHandlers.ipc.postMessage` or `ipc://` request fails Tauri's
//! key check before any routing. Behind that: no `#[tauri::command]`, no
//! invoke handler, no capability files (`capabilities: []`), `withGlobalTauri:
//! false`, and the kernel page is a remote origin to Tauri's ACL. Four layers;
//! none of them is a permission the page could ask for.
//!
//! Surface: [`SURFACE_SCRIPT`] runs at document start in the main frame, before
//! any page script, and defines a non-writable, non-configurable
//! `window.gnomonSurface = 'wrapper'` only on a `http://127.0.0.1:<port>` page.
//! A plain browser cannot produce it: under the kernel's CSP (`script-src
//! 'self'`, no inline, no eval) the only scripts in the page are the pinned
//! bundle's, and the bundle never defines it. The GUI reads it once
//! (`hostSurface()`) to send `hello.client.surface: 'wrapper'` and to drop the
//! extension-risk badge. It is display-only, never a security input (the
//! kernel treats `hello.surface` as self-declared, §11.2 rule 2).

/// Replaces Tauri's invoke system: no invoke key, `postMessage` refuses.
pub const IPC_DISABLED_SCRIPT: &str = r#"
Object.defineProperty(window.__TAURI_INTERNALS__, 'postMessage', {
  value: function () { throw new Error('gnomon-wrapper: IPC is disabled for page content'); },
  writable: false,
  configurable: false
});
"#;

/// Marks the kernel page as hosted by the wrapper (display only).
pub const SURFACE_SCRIPT: &str = r#"
(function () {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(location.origin)) return;
  Object.defineProperty(window, 'gnomonSurface', { value: 'wrapper', writable: false, configurable: false, enumerable: false });
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ipc_stub_carries_no_invoke_key_and_refuses() {
        assert!(!IPC_DISABLED_SCRIPT.contains("__INVOKE_KEY__"));
        assert!(!IPC_DISABLED_SCRIPT.to_lowercase().contains("invoke-key"));
        assert!(IPC_DISABLED_SCRIPT.contains("throw new Error"));
        assert!(IPC_DISABLED_SCRIPT.contains("configurable: false"));
    }

    #[test]
    fn the_surface_marker_is_scoped_to_the_loopback_origin_and_frozen() {
        assert!(SURFACE_SCRIPT.contains(r"^http:\/\/127\.0\.0\.1:[0-9]{1,5}$"));
        assert!(SURFACE_SCRIPT.contains("writable: false, configurable: false"));
        assert!(!SURFACE_SCRIPT.contains("localhost"));
    }
}

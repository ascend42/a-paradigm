//! #gnomon-wrapper core (spec §11.1, §11.2 rules 1a–3 and 10, §16 GUI shell row,
//! §18; M1.13, P8-D56). Everything here is pure and unit-tested without a
//! window: the origin lock, the page-side scripts, the launch channel, the
//! serverSig check, the bundle pin, the loopback preflight and the kernel child
//! command. `main.rs` wires them into the Tauri app.
//!
//! Never logs a token or a key: [`contract::LaunchGrant`]'s `Debug` redacts both.
//! Windows (WebView2, the named-pipe channel, `WDA_EXCLUDEFROMCAPTURE`) is the
//! parity phase; the seams are `nav::APP_ORIGIN` and `kernel::child_command`.

pub mod bundle;
pub mod contract;
pub mod kernel;
pub mod logfile;
pub mod loopback;
pub mod nav;
pub mod surface;
pub mod tree;
pub mod verify;

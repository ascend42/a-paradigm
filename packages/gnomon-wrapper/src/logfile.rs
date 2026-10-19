//! #gnomon-wrapper log file (Aegis low, round 2): `<home>/Library/Logs/Gnomon/kernel.log`.
//!   - the directory must be a real directory (never a symlink) and is forced to 0700,
//!     also when it already existed;
//!   - the file is opened O_APPEND | O_CREAT | O_NOFOLLOW (a planted symlink fails the
//!     open), then fchmod 0600 on the open fd and an fstat check on the SAME fd: a
//!     regular file, owner-only, owned by the home's owner.
//! Any failure means no log (the app runs without one), never a log in the wrong place.
use std::fs::{self, File, OpenOptions, Permissions};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

#[cfg(target_os = "macos")]
const O_NOFOLLOW: i32 = 0x0100;
#[cfg(target_os = "linux")]
const O_NOFOLLOW: i32 = 0o400000;

pub fn open_log_in(home: &Path) -> Result<File, String> {
    let dir = home.join("Library/Logs/Gnomon");
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).map_err(|e| format!("log dir: {e}"))?;
    let dm = fs::symlink_metadata(&dir).map_err(|e| format!("log dir: {e}"))?;
    if dm.file_type().is_symlink() || !dm.is_dir() {
        return Err("the log dir is not a plain directory".into());
    }
    let owner = fs::metadata(home).map_err(|e| format!("home: {e}"))?.uid();
    if dm.uid() != owner {
        return Err("the log dir belongs to another user".into());
    }
    fs::set_permissions(&dir, Permissions::from_mode(0o700)).map_err(|e| format!("log dir chmod: {e}"))?;
    let f = OpenOptions::new().create(true).append(true).mode(0o600).custom_flags(O_NOFOLLOW).open(dir.join("kernel.log")).map_err(|e| format!("log open: {e}"))?;
    f.set_permissions(Permissions::from_mode(0o600)).map_err(|e| format!("log fchmod: {e}"))?;
    let m = f.metadata().map_err(|e| format!("log fstat: {e}"))?;
    if !m.is_file() || m.mode() & 0o077 != 0 || m.uid() != owner {
        return Err("the log file is not an owner-only regular file".into());
    }
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gw-log-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_fresh_log_is_owner_only() {
        let h = home("fresh");
        let f = open_log_in(&h).unwrap();
        assert_eq!(f.metadata().unwrap().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(h.join("Library/Logs/Gnomon")).unwrap().mode() & 0o777, 0o700);
        fs::remove_dir_all(&h).unwrap();
    }

    #[test]
    fn falsifier_a_preexisting_loose_dir_and_file_are_tightened() {
        let h = home("loose");
        let dir = h.join("Library/Logs/Gnomon");
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, Permissions::from_mode(0o755)).unwrap();
        fs::write(dir.join("kernel.log"), b"old\n").unwrap();
        fs::set_permissions(dir.join("kernel.log"), Permissions::from_mode(0o644)).unwrap();
        let f = open_log_in(&h).unwrap();
        assert_eq!(f.metadata().unwrap().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&dir).unwrap().mode() & 0o777, 0o700);
        fs::remove_dir_all(&h).unwrap();
    }

    #[test]
    fn falsifier_a_planted_symlink_is_refused() {
        let h = home("link");
        let dir = h.join("Library/Logs/Gnomon");
        fs::create_dir_all(&dir).unwrap();
        let target = h.join("elsewhere");
        fs::write(&target, b"").unwrap();
        std::os::unix::fs::symlink(&target, dir.join("kernel.log")).unwrap();
        assert!(open_log_in(&h).is_err());
        // a symlinked log DIR is refused too
        let h2 = home("linkdir");
        fs::create_dir_all(h2.join("Library/Logs")).unwrap();
        fs::create_dir_all(h2.join("real")).unwrap();
        std::os::unix::fs::symlink(h2.join("real"), h2.join("Library/Logs/Gnomon")).unwrap();
        assert!(open_log_in(&h2).is_err());
        fs::remove_dir_all(&h).unwrap();
        fs::remove_dir_all(&h2).unwrap();
    }
}

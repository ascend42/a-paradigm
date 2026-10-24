//! #gnomon-wrapper static code-signing check (T-2026-10-21-029, Aegis M2 review high 1). Immediately before the
//! kernel spawn, a bundle build verifies the bundled node with the Security framework (SecStaticCodeCheckValidity,
//! all architectures, strict) against the designated requirement compiled into this binary: in a Developer ID
//! release, Apple anchor + Developer ID leaf + our team OU + identifier `gnomon.node` (layout::node_requirement).
//! This is ON TOP of the sha256 pin: the hash proves the bytes are the ones the release staged, the signature check
//! proves what is on disk at spawn time still carries our team's valid signature, so a same-user swap between the
//! hash and the exec must also forge a team signature. Residual (spec §18.1): the window between this check and
//! posix_spawn's own read of the path remains; it relies on macOS App Management protection of the installed app.
//! Raw FFI (no new crate): CoreFoundation + Security, both system frameworks.
use std::path::Path;

/// Verify `path` is validly signed (strict, all architectures) and satisfies `requirement`.
#[cfg(target_os = "macos")]
pub fn verify_static_code(path: &Path, requirement: &str) -> Result<(), String> {
    use std::os::raw::{c_long, c_void};
    use std::os::unix::ffi::OsStrExt;
    type Ref = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: Ref);
        fn CFURLCreateFromFileSystemRepresentation(alloc: Ref, buf: *const u8, len: c_long, is_dir: u8) -> Ref;
        fn CFStringCreateWithBytes(alloc: Ref, bytes: *const u8, len: c_long, encoding: u32, external: u8) -> Ref;
    }
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecStaticCodeCreateWithPath(path: Ref, flags: u32, code: *mut Ref) -> i32;
        fn SecRequirementCreateWithString(text: Ref, flags: u32, req: *mut Ref) -> i32;
        fn SecStaticCodeCheckValidity(code: Ref, flags: u32, req: Ref) -> i32;
    }
    const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
    const CHECK_ALL_ARCHITECTURES: u32 = 1 << 0;
    const STRICT_VALIDATE: u32 = 1 << 4;
    struct Owned(Ref);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }
    if requirement.is_empty() {
        return Err("no code requirement is compiled into this app".into());
    }
    let bytes = path.as_os_str().as_bytes();
    // SAFETY: every pointer passed is valid for the call; every created CF object is released by Owned.
    unsafe {
        let url = Owned(CFURLCreateFromFileSystemRepresentation(std::ptr::null(), bytes.as_ptr(), bytes.len() as c_long, 0));
        let text = Owned(CFStringCreateWithBytes(std::ptr::null(), requirement.as_ptr(), requirement.len() as c_long, UTF8, 0));
        if url.0.is_null() || text.0.is_null() {
            return Err("could not build the code-signing query".into());
        }
        let mut req: Ref = std::ptr::null();
        let s = SecRequirementCreateWithString(text.0, 0, &mut req);
        let req = Owned(req);
        if s != 0 {
            return Err(format!("the compiled code requirement does not parse (OSStatus {s})"));
        }
        let mut code: Ref = std::ptr::null();
        let s = SecStaticCodeCreateWithPath(url.0, 0, &mut code);
        let code = Owned(code);
        if s != 0 {
            return Err(format!("{} has no readable code signature (OSStatus {s})", path.display()));
        }
        let s = SecStaticCodeCheckValidity(code.0, CHECK_ALL_ARCHITECTURES | STRICT_VALIDATE, req.0);
        if s != 0 {
            return Err(format!("{} is not validly signed by Gnomon's team for this identifier (OSStatus {s})", path.display()));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn verify_static_code(path: &Path, _requirement: &str) -> Result<(), String> {
    Err(format!("{}: code-signature checks are macOS-only (the Windows wrapper is the parity phase)", path.display()))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn an_apple_binary_meets_anchor_apple_but_not_our_team() {
        assert!(verify_static_code(Path::new("/bin/ls"), "anchor apple").is_ok());
        let e = verify_static_code(Path::new("/bin/ls"), &crate::layout::node_requirement("developer-id").unwrap()).unwrap_err();
        assert!(e.contains("not validly signed"), "{e}");
    }

    #[test]
    fn falsifier_unsigned_unparseable_or_empty_is_refused() {
        let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gw-cs-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("plain"), b"not code").unwrap();
        assert!(verify_static_code(&d.join("plain"), "anchor apple").is_err());
        assert!(verify_static_code(Path::new("/bin/ls"), "this is not a requirement").unwrap_err().contains("does not parse"));
        assert!(verify_static_code(Path::new("/bin/ls"), "").is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }
}

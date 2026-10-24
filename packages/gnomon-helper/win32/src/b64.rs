//! Standard base64 (RFC 4648 §4, with padding), the helper wire's encoding for keys, messages and signatures. Strict
//! decode: the alphabet only, padding only at the end, length a multiple of 4.

const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(b: &[u8]) -> String {
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

pub fn decode(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.len() % 4 != 0 {
        return None;
    }
    let val = |c: u8| -> Option<u32> { A.iter().position(|&x| x == c).map(|p| p as u32) };
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (k, q) in b.chunks(4).enumerate() {
        let last = k == b.len() / 4 - 1;
        let pad = q.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && !last) || q[..4 - pad].contains(&b'=') {
            return None;
        }
        let mut n = 0u32;
        for (i, &c) in q.iter().enumerate() {
            n |= if c == b'=' { 0 } else { val(c)? } << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{decode, encode};
    #[test]
    fn round_trips_and_is_strict() {
        for v in [&b""[..], b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar", &[0, 255, 128, 7]] {
            assert_eq!(decode(&encode(v)).unwrap(), v);
        }
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(encode(b"fo"), "Zm8=");
        for bad in ["Zm8", "Zm=8", "Zm9v!mFy", "Zg==Zg==", "Z==="] {
            assert!(decode(bad).is_none(), "{bad}");
        }
    }
}

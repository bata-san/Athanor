//! Developer quick tools exposed in the command palette. Pure text-in / text-out functions.

use base64::{
    alphabet,
    engine::{general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD, URL_SAFE_NO_PAD}, DecodePaddingMode},
    Engine as _,
};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// Ports commonly used by dev servers; the app probes these on 127.0.0.1.
pub const COMMON_DEV_PORTS: &[u16] = &[
    1313, 1420, 3000, 3001, 3333, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5500, 6006, 7000, 8000, 8080, 8081, 8787, 8888, 9000, 9229,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tool {
    JsonPretty,
    JsonMinify,
    Base64Encode,
    Base64Decode,
    UrlEncode,
    UrlDecode,
    Jwt,
    Timestamp,
    Uuid,
    Sha256,
    Color,
}

impl Tool {
    pub const ALL: &'static [Tool] = &[
        Tool::JsonPretty, Tool::JsonMinify, Tool::Base64Encode, Tool::Base64Decode, Tool::UrlEncode,
        Tool::UrlDecode, Tool::Jwt, Tool::Timestamp, Tool::Uuid, Tool::Sha256, Tool::Color,
    ];
}

pub fn run(tool: Tool, input: &str) -> Result<String, String> {
    let input_trim = input.trim();
    match tool {
        Tool::JsonPretty => json_pretty(input_trim),
        Tool::JsonMinify => json_minify(input_trim),
        Tool::Base64Encode => Ok(STANDARD.encode(input.as_bytes())),
        Tool::Base64Decode => base64_decode(input_trim),
        Tool::UrlEncode => Ok(utf8_percent_encode(input, NON_ALPHANUMERIC).to_string()),
        Tool::UrlDecode => percent_decode_str(input_trim).decode_utf8().map(|s| s.into_owned()).map_err(|e| e.to_string()),
        Tool::Jwt => jwt_decode(input_trim),
        Tool::Timestamp => timestamp(input_trim),
        Tool::Uuid => Ok(uuid::Uuid::new_v4().to_string()),
        Tool::Sha256 => Ok(hex(&Sha256::digest(input.as_bytes()))),
        Tool::Color => color(input_trim),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn json_pretty(s: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

pub fn json_minify(s: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &alphabet::STANDARD,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);
const LENIENT_URL: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// Accepts standard or URL-safe alphabet, with or without padding.
fn base64_decode(s: &str) -> Result<String, String> {
    let cleaned: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = LENIENT.decode(&cleaned).or_else(|_| LENIENT_URL.decode(&cleaned)).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "decoded bytes are not valid UTF-8".to_string())
}

/// Decode a JWT without verifying the signature and report expiry relative to `now`.
pub fn jwt_decode(token: &str) -> Result<String, String> {
    let token = token.strip_prefix("Bearer ").unwrap_or(token).trim();
    let mut parts = token.split('.');
    let (h, p) = (parts.next().ok_or("empty token")?, parts.next().ok_or("not a JWT: missing payload")?);
    let sig = parts.next().ok_or("not a JWT: missing signature")?;
    let dec = |part: &str| -> Result<serde_json::Value, String> {
        let bytes = URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    };
    let header = dec(h)?;
    let payload = dec(p)?;
    let mut out = serde_json::json!({ "header": header, "payload": payload, "signature": sig });
    for claim in ["exp", "iat", "nbf"] {
        if let Some(ts) = payload.get(claim).and_then(|v| v.as_i64()) {
            if let Ok(dt) = OffsetDateTime::from_unix_timestamp(ts) {
                out[format!("{claim}_iso")] = dt.format(&Rfc3339).unwrap_or_default().into();
            }
        }
    }
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

/// Unix seconds/millis <-> RFC 3339. Empty input means "now".
pub fn timestamp(s: &str) -> Result<String, String> {
    if s.is_empty() {
        let now = OffsetDateTime::now_utc();
        return Ok(format!("{}\n{}", now.unix_timestamp(), now.format(&Rfc3339).map_err(|e| e.to_string())?));
    }
    if let Ok(n) = s.parse::<i64>() {
        // 13+ digits => milliseconds. Floor, do not truncate: -1500 ms is -2 s, not -1 s.
        let secs = if s.trim_start_matches('-').len() >= 13 { n.div_euclid(1000) } else { n };
        let dt = OffsetDateTime::from_unix_timestamp(secs).map_err(|e| e.to_string())?;
        return dt.format(&Rfc3339).map_err(|e| e.to_string());
    }
    let dt = OffsetDateTime::parse(s, &Rfc3339).map_err(|e| e.to_string())?;
    Ok(format!("{} (s)\n{} (ms)", dt.unix_timestamp(), dt.unix_timestamp() * 1000 + i64::from(dt.millisecond())))
}

/// `#rgb`, `#rrggbb`, `rgb(r,g,b)` -> hex, rgb and hsl.
pub fn color(s: &str) -> Result<String, String> {
    let (r, g, b) = parse_color(s)?;
    let (h, sat, l) = rgb_to_hsl(r, g, b);
    Ok(format!("#{r:02x}{g:02x}{b:02x}\nrgb({r}, {g}, {b})\nhsl({}, {}%, {}%)", h.round(), (sat * 100.0).round(), (l * 100.0).round()))
}

fn parse_color(s: &str) -> Result<(u8, u8, u8), String> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        let full: String = match hex.len() {
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_string(),
            _ => return Err("expected #rgb or #rrggbb".into()),
        };
        let v = u32::from_str_radix(&full, 16).map_err(|e| e.to_string())?;
        return Ok(((v >> 16) as u8, (v >> 8) as u8, v as u8));
    }
    let inner = s.strip_prefix("rgb(").and_then(|x| x.strip_suffix(')')).ok_or("expected #hex or rgb(r,g,b)")?;
    let n: Vec<u8> = inner.split([',', ' ']).filter(|x| !x.is_empty()).map(|x| x.parse::<u8>().map_err(|e| e.to_string())).collect::<Result<_, _>>()?;
    match n.as_slice() {
        [r, g, b] => Ok((*r, *g, *b)),
        _ => Err("rgb() needs three components".into()),
    }
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (r, g, b) = (f64::from(r) / 255.0, f64::from(g) / 255.0, f64::from(b) / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if (max - r).abs() < f64::EPSILON {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_tools() {
        assert_eq!(json_minify("{ \"a\": [1, 2] }").unwrap(), "{\"a\":[1,2]}");
        assert!(json_pretty("{\"a\":1}").unwrap().contains("\n  \"a\": 1"));
        assert!(json_pretty("{oops").is_err());
    }

    #[test]
    fn base64_and_url() {
        assert_eq!(run(Tool::Base64Encode, "hello").unwrap(), "aGVsbG8=");
        assert_eq!(run(Tool::Base64Decode, "aGVsbG8=").unwrap(), "hello");
        assert_eq!(run(Tool::Base64Decode, "aGVsbG8").unwrap(), "hello", "padding optional");
        assert_eq!(run(Tool::UrlEncode, "a b&c").unwrap(), "a%20b%26c");
        assert_eq!(run(Tool::UrlDecode, "a%20b%26c").unwrap(), "a b&c");
    }

    #[test]
    fn jwt() {
        // {"alg":"HS256","typ":"JWT"}.{"sub":"1","exp":1700000000}
        let t = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzAwMDAwMDAwfQ.sig";
        let out = jwt_decode(t).unwrap();
        assert!(out.contains("\"alg\": \"HS256\""));
        assert!(out.contains("2023-11-14T22:13:20Z"));
        assert!(jwt_decode("abc").is_err());
    }

    #[test]
    fn timestamps() {
        assert_eq!(timestamp("0").unwrap(), "1970-01-01T00:00:00Z");
        assert_eq!(timestamp("1700000000000").unwrap(), "2023-11-14T22:13:20Z");
        assert!(timestamp("2023-11-14T22:13:20Z").unwrap().starts_with("1700000000 (s)"));
        assert!(timestamp("garbage").is_err());
        assert!(timestamp("").unwrap().contains('T'));
    }

    #[test]
    fn negative_millisecond_timestamps_floor() {
        // -1700000000500 ms is half a second *before* -1700000000 s, so it must land on the
        // second below it. Truncating towards zero would report ...:40 instead.
        assert_eq!(timestamp("-1700000000500").unwrap(), "1916-02-18T01:46:39Z");
        assert_eq!(timestamp("-1700000000000").unwrap(), "1916-02-18T01:46:40Z");
        assert_eq!(timestamp("-999").unwrap(), "1969-12-31T23:43:21Z", "a plain negative seconds value is unchanged");
    }

    #[test]
    fn hashes_and_uuid() {
        assert_eq!(run(Tool::Sha256, "abc").unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(run(Tool::Uuid, "").unwrap().len(), 36);
    }

    #[test]
    fn colors() {
        assert_eq!(color("#f00").unwrap(), "#ff0000\nrgb(255, 0, 0)\nhsl(0, 100%, 50%)");
        assert!(color("rgb(0, 128, 255)").unwrap().starts_with("#0080ff"));
        assert!(color("#12").is_err());
    }
}

//! "Translate page": the page script (`translate.js`) lists the text units of the page, this module translates them
//! in batches and hands the results back to be written into the same text nodes.
//!
//! A unit is one block of running text. When inline elements split it (`a <b>b</b> c`) its pieces are sent together
//! as `<0>a</0> <1>b</1> <2>c</2>` so the sentence is translated as a sentence and the pieces still land in their own
//! nodes; if the markers do not come back intact the pieces are translated one by one instead.

use serde::Deserialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

pub const PAGE_SCRIPT: &str = include_str!("translate.js");

#[derive(Debug, Clone, Deserialize)]
pub struct Part {
    pub t: String,
    #[serde(default)]
    pub l: bool,
    #[serde(default)]
    pub r: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Unit {
    pub id: usize,
    pub parts: Vec<Part>,
}

const SEPARATOR: &str = "\n[[#]]\n";
/// Characters sent in one request; the service is happiest below about five thousand.
const BATCH_CHARS: usize = 4200;
const WORKERS: usize = 4;

/// What is sent for one unit.
pub fn unit_text(parts: &[Part]) -> String {
    if let [only] = parts {
        return only.t.clone();
    }
    let mut out = String::new();
    for (i, part) in parts.iter().enumerate() {
        if part.l && !out.ends_with(' ') && !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&format!("<{i}>{}</{i}>", part.t));
        if part.r {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

/// Take a translated unit apart again; `None` when a marker went missing or moved out of order.
pub fn parse_unit(translated: &str, n: usize) -> Option<Vec<String>> {
    if n == 1 {
        let text = strip_markers(translated);
        return Some(vec![text.trim().to_string()]);
    }
    let mut out = Vec::with_capacity(n);
    let mut rest = translated;
    for i in 0..n {
        let open = rest.find(&format!("<{i}>"))?;
        let after = &rest[open + format!("<{i}>").len()..];
        let close = after.find(&format!("</{i}>"))?;
        out.push(after[..close].trim().to_string());
        rest = &after[close + format!("</{i}>").len()..];
    }
    Some(out)
}

fn strip_markers(text: &str) -> String {
    // A single piece should come back without markers; drop any the service added anyway.
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            let mut closed = false;
            for d in chars.by_ref() {
                if d == '>' {
                    closed = true;
                    break;
                }
                tag.push(d);
                if tag.len() > 4 {
                    break;
                }
            }
            let name = tag.trim_start_matches('/');
            if closed && !name.is_empty() && name.chars().all(|d| d.is_ascii_digit()) {
                continue;
            }
            out.push('<');
            out.push_str(&tag);
            if closed {
                out.push('>');
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn request(text: &str, target: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(25))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36")
        .build();
    let response = agent
        .post("https://translate.googleapis.com/translate_a/single")
        .query("client", "gtx")
        .query("sl", "auto")
        .query("tl", target)
        .query("dt", "t")
        .send_form(&[("q", text)])
        .map_err(|e| e.to_string())?;
    let body = response.into_string().map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let sentences = value
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or_else(|| "unexpected answer from the translation service".to_string())?;
    Ok(sentences
        .iter()
        .filter_map(|s| s.get(0).and_then(|t| t.as_str()))
        .collect())
}

/// Split one long run of text at sentence ends so each request stays small.
fn chunks(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for sentence in text.split_inclusive(['.', '!', '?', '。', '！', '？', '\n']) {
        if !current.is_empty() && current.chars().count() + sentence.chars().count() > max {
            out.push(std::mem::take(&mut current));
        }
        current.push_str(sentence);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn translate_text(text: &str, target: &str) -> Result<String, String> {
    if text.chars().count() <= BATCH_CHARS {
        return request(text, target);
    }
    let mut out = String::new();
    for piece in chunks(text, BATCH_CHARS) {
        out.push_str(&request(&piece, target)?);
    }
    Ok(out)
}

/// One unit on its own, with the per-piece fallback.
fn translate_unit(unit: &Unit, target: &str) -> Result<Vec<String>, String> {
    let n = unit.parts.len();
    if n > 1 {
        if let Some(parts) = parse_unit(&translate_text(&unit_text(&unit.parts), target)?, n) {
            if parts.iter().all(|p| !p.is_empty()) {
                return Ok(parts);
            }
        }
    }
    unit.parts
        .iter()
        .map(|p| translate_text(&p.t, target))
        .collect()
}

/// A group of units sent as one request, falling back to one request per unit when the answer does not line up.
fn translate_batch(units: &[&Unit], target: &str) -> Result<Vec<(usize, Vec<String>)>, String> {
    let sent: Vec<String> = units.iter().map(|u| unit_text(&u.parts)).collect();
    if units.len() > 1 {
        let answer = request(&sent.join(SEPARATOR), target)?;
        let pieces: Vec<&str> = split_answer(&answer);
        if pieces.len() == units.len() {
            let mut out = Vec::with_capacity(units.len());
            let mut ok = true;
            for (unit, piece) in units.iter().zip(pieces) {
                match parse_unit(piece, unit.parts.len()) {
                    Some(parts) if parts.iter().all(|p| !p.is_empty()) => {
                        out.push((unit.id, parts))
                    }
                    _ => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                return Ok(out);
            }
        }
    }
    units
        .iter()
        .map(|u| translate_unit(u, target).map(|parts| (u.id, parts)))
        .collect()
}

fn split_answer(answer: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut from, mut search) = (0usize, 0usize);
    while let Some(rel) = answer[search..].find("[[") {
        let start = search + rel;
        let Some(end_rel) = answer[start + 2..].find("]]") else {
            break;
        };
        let end = start + 2 + end_rel;
        if answer[start + 2..end].trim() == "#" {
            out.push(answer[from..start].trim());
            from = end + 2;
            search = from;
        } else {
            // Some other double bracket in the text: not our marker.
            search = start + 2;
        }
    }
    out.push(answer[from..].trim());
    out
}

/// Translate every unit into `target`, handing finished batches to `done` as they arrive (so the page fills in
/// while the rest is still on its way). Returns the number of batches that failed.
pub fn translate_all<F>(units: &[Unit], target: &str, done: F) -> (usize, Option<String>)
where
    F: Fn(Vec<(usize, Vec<String>)>) + Sync,
{
    let mut batches: Vec<Vec<&Unit>> = Vec::new();
    let mut current: Vec<&Unit> = Vec::new();
    let mut size = 0usize;
    for unit in units {
        let len = unit_text(&unit.parts).chars().count() + SEPARATOR.len();
        if !current.is_empty() && size + len > BATCH_CHARS {
            batches.push(std::mem::take(&mut current));
            size = 0;
        }
        size += len;
        current.push(unit);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    let next = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    let first_error = parking_lot::Mutex::new(None::<String>);
    std::thread::scope(|scope| {
        for _ in 0..WORKERS.min(batches.len().max(1)) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some(batch) = batches.get(i) else { break };
                match translate_batch(batch, target) {
                    Ok(results) => done(results),
                    Err(error) => {
                        failed.fetch_add(1, Ordering::SeqCst);
                        first_error.lock().get_or_insert(error);
                    }
                }
            });
        }
    });
    (failed.load(Ordering::SeqCst), first_error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(t: &str, l: bool, r: bool) -> Part {
        Part { t: t.into(), l, r }
    }

    #[test]
    fn a_single_piece_is_sent_as_it_is() {
        assert_eq!(unit_text(&[part("Hello", false, false)]), "Hello");
    }

    #[test]
    fn split_pieces_are_marked_and_keep_their_spaces() {
        let parts = [
            part("Hello", false, true),
            part("world", false, false),
            part("!", false, false),
        ];
        assert_eq!(unit_text(&parts), "<0>Hello</0> <1>world</1><2>!</2>");
    }

    #[test]
    fn markers_come_apart_again() {
        let parsed = parse_unit("<0> こんにちは </0><1>世界</1><2>!</2>", 3).unwrap();
        assert_eq!(parsed, vec!["こんにちは", "世界", "!"]);
    }

    #[test]
    fn a_lost_marker_is_noticed() {
        assert!(parse_unit("<0>a</0>b", 2).is_none());
        assert!(parse_unit("<1>b</1><0>a</0>", 2).is_none());
    }

    #[test]
    fn markers_a_single_piece_picked_up_are_dropped() {
        assert_eq!(
            parse_unit("<0>こんにちは</0>", 1).unwrap(),
            vec!["こんにちは"]
        );
        assert_eq!(
            parse_unit("a < b and c > d", 1).unwrap(),
            vec!["a < b and c > d"]
        );
    }

    #[test]
    fn the_answer_is_cut_at_our_separator_only() {
        assert_eq!(split_answer("a\n[[#]]\nb\n[[ # ]]\nc"), vec!["a", "b", "c"]);
        assert_eq!(split_answer("a [[1]] b"), vec!["a [[1]] b"]);
    }

    #[test]
    fn long_text_is_cut_at_sentence_ends() {
        let text = "One. Two. Three. Four.";
        let parts = chunks(text, 10);
        assert!(parts.len() > 1);
        assert_eq!(parts.concat(), text);
    }
}

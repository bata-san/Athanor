//! Validation of user-authored filter text ("My filters").

use adblock::lists::{parse_filter, FilterFormat, FilterParseError, ParseOptions, RuleTypes};
use serde::Serialize;

/// Largest accepted "My filters" text.
pub const MAX_USER_FILTER_BYTES: usize = 512 * 1024;

/// A rejected line of user filter text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LineIssue {
    /// 1-based line number.
    pub line: usize,
    /// Why the line was rejected.
    pub message: String,
}

fn is_comment(line: &str) -> bool {
    line.starts_with('!') || line.starts_with("[Adblock") || line.starts_with("[uBlock")
}

/// Check every non-blank, non-comment line with the same parser the engine uses. Lines that parse
/// are fine; lines the engine would silently drop are reported so the user can fix them.
pub fn validate(text: &str) -> Vec<LineIssue> {
    if text.len() > MAX_USER_FILTER_BYTES {
        return vec![LineIssue {
            line: 0,
            message: format!("filters are larger than the {} KiB limit", MAX_USER_FILTER_BYTES / 1024),
        }];
    }
    let opts = ParseOptions {
        format: FilterFormat::Standard,
        rule_types: RuleTypes::All,
        ..ParseOptions::default()
    };
    let mut issues = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || is_comment(line) {
            continue;
        }
        match parse_filter(line, false, opts) {
            Ok(_) => {}
            Err(FilterParseError::Empty) => {}
            Err(e) => issues.push(LineIssue { line: index + 1, message: e.to_string() }),
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_network_cosmetic_and_comments() {
        let text = "! my rules\n\n||ads.example.com^$third-party\nexample.com##.banner\n@@||ok.example.com^\n";
        assert!(validate(text).is_empty(), "{:?}", validate(text));
    }

    #[test]
    fn reports_bad_lines_with_numbers() {
        let issues = validate("||good.example^\n##\nexample.com##.ok\n||bad.example^$nonsense-option\n");
        let lines: Vec<usize> = issues.iter().map(|i| i.line).collect();
        assert_eq!(lines, vec![2, 4], "{issues:?}");
    }

    #[test]
    fn rejects_oversized_text() {
        let big = "a".repeat(MAX_USER_FILTER_BYTES + 1);
        let issues = validate(&big);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].line, 0);
    }
}

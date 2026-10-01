use crate::BookmarkNode;

pub(crate) const MAX_URL_BYTES: usize = 2048;
pub(crate) const MAX_TITLE_CHARS: usize = 300;

pub(crate) fn is_web_url(url: &str) -> bool {
    url.get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || url
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}

pub(crate) fn accepted_url(url: &str) -> bool {
    !url.is_empty() && url.len() <= MAX_URL_BYTES && is_web_url(url)
}

pub(crate) fn truncate_title(title: &str) -> String {
    title.chars().take(MAX_TITLE_CHARS).collect()
}

pub(crate) fn link(title: &str, url: &str) -> Option<BookmarkNode> {
    if !accepted_url(url) {
        return None;
    }
    let title = if title.trim().is_empty() { url } else { title };
    Some(BookmarkNode::Link {
        title: truncate_title(title),
        url: url.to_owned(),
    })
}

pub(crate) fn history_title(title: Option<String>, url: &str) -> String {
    let title = title.unwrap_or_default();
    truncate_title(if title.trim().is_empty() { url } else { &title })
}

pub(crate) fn prune_empty_folders(nodes: Vec<BookmarkNode>) -> Vec<BookmarkNode> {
    nodes
        .into_iter()
        .filter_map(|node| match node {
            BookmarkNode::Folder { name, children } if !children.is_empty() => {
                Some(BookmarkNode::Folder { name, children })
            }
            BookmarkNode::Folder { .. } => None,
            link @ BookmarkNode::Link { .. } => Some(link),
        })
        .collect()
}

/// Folders nested deeper than this are not real bookmark trees; parsers stop descending.
pub(crate) const MAX_FOLDER_DEPTH: usize = 64;
/// Largest bookmarks file read into memory.
pub(crate) const MAX_IMPORT_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::{history_title, link, MAX_TITLE_CHARS};
    use crate::BookmarkNode;

    #[test]
    fn applies_shared_url_and_title_limits() {
        let at_limit = format!("https://{}", "x".repeat(2040));
        let too_long = format!("https://{}", "x".repeat(2041));
        assert!(link("", &at_limit).is_some());
        assert!(link("title", &too_long).is_none());
        assert!(link("title", "").is_none());
        assert!(link("title", "javascript:alert(1)").is_none());
        assert!(link("title", "HTTPS://example.test").is_some());

        let long_title = "😀".repeat(MAX_TITLE_CHARS + 1);
        let Some(BookmarkNode::Link { title, .. }) = link(&long_title, "https://example.test")
        else {
            panic!("expected accepted web link")
        };
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(
            history_title(Some(long_title), "https://example.test")
                .chars()
                .count(),
            MAX_TITLE_CHARS
        );
        assert_eq!(
            history_title(Some("  ".to_owned()), "https://fallback.test"),
            "https://fallback.test"
        );
    }
}

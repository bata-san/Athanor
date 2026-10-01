use crate::sqlite::open_snapshot;
use crate::util::{history_title, link, prune_empty_folders, truncate_title};
use crate::{BookmarkNode, HistoryEntry, ImportError, Result};
use rusqlite::params;
use serde_json::Value;
use std::fs;
use std::path::Path;

pub(crate) fn read_bookmarks(dir: &Path) -> Result<Vec<BookmarkNode>> {
    let path = dir.join("Bookmarks");
    if fs::metadata(&path)?.len() > crate::util::MAX_IMPORT_FILE_BYTES {
        return Err(ImportError::Other(
            "Chromium bookmarks file is too large".to_owned(),
        ));
    }
    let data = fs::read(path)?;
    let document: Value = serde_json::from_slice(&data)?;
    let roots = document
        .get("roots")
        .and_then(Value::as_object)
        .ok_or_else(|| ImportError::Other("Chromium bookmarks have no roots object".to_owned()))?;

    let mut result = Vec::new();
    for (key, fallback_name) in [
        ("bookmark_bar", "Bookmarks bar"),
        ("other", "Other bookmarks"),
        ("synced", "Mobile bookmarks"),
    ] {
        let Some(root) = roots.get(key) else {
            continue;
        };
        let Some(children) = root.get("children").and_then(Value::as_array) else {
            continue;
        };
        let parsed = parse_nodes(children);
        if !parsed.is_empty() {
            let name = root
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .unwrap_or(fallback_name)
                .to_owned();
            result.push(BookmarkNode::Folder {
                name: truncate_title(&name),
                children: parsed,
            });
        }
    }
    Ok(result)
}

fn parse_nodes(values: &[Value]) -> Vec<BookmarkNode> {
    let mut result = Vec::new();
    for value in values {
        match value.get("type").and_then(Value::as_str) {
            Some("url") => {
                let url = value.get("url").and_then(Value::as_str).unwrap_or("");
                let title = value.get("name").and_then(Value::as_str).unwrap_or("");
                if let Some(node) = link(title, url) {
                    result.push(node);
                }
            }
            Some("folder") => {
                let Some(children) = value.get("children").and_then(Value::as_array) else {
                    continue;
                };
                let children = prune_empty_folders(parse_nodes(children));
                if !children.is_empty() {
                    result.push(BookmarkNode::Folder {
                        name: value
                            .get("name")
                            .and_then(Value::as_str)
                            .map(truncate_title)
                            .unwrap_or_default(),
                        children,
                    });
                }
            }
            _ => {}
        }
    }
    result
}

pub(crate) fn read_history(dir: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let snapshot = open_snapshot(&dir.join("History"))?;
    let limit = limit.clamp(1, 200_000) as i64;
    let mut statement = snapshot.connection.prepare(
        "SELECT url, title, visit_count, last_visit_time
         FROM urls
         WHERE hidden = 0
         ORDER BY last_visit_time DESC
         LIMIT ?1",
    )?;
    let mut rows = statement.query(params![limit])?;
    let mut history = Vec::new();
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        if !crate::util::accepted_url(&url) {
            continue;
        }
        let title: Option<String> = row.get(1)?;
        let visits: i64 = row.get(2)?;
        let last_visit_time: i64 = row.get(3)?;
        history.push(HistoryEntry {
            title: history_title(title, &url),
            url,
            visits: u32::try_from(visits).unwrap_or(if visits < 0 { 0 } else { u32::MAX }),
            last_visit_ms: last_visit_time
                .checked_div(1_000)
                .unwrap_or_default()
                .saturating_sub(11_644_473_600_000),
        });
    }
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::{read_bookmarks, read_history};
    use crate::sqlite::open_immutable;
    use crate::{BookmarkNode, HistoryEntry};
    use rusqlite::{params, Connection};
    use std::fs;

    fn history_db(path: &std::path::Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE urls (
                    id INTEGER PRIMARY KEY,
                    url TEXT NOT NULL,
                    title TEXT,
                    visit_count INTEGER NOT NULL,
                    typed_count INTEGER NOT NULL DEFAULT 0,
                    last_visit_time INTEGER NOT NULL,
                    hidden INTEGER NOT NULL DEFAULT 0
                );",
            )
            .unwrap();
        let chrome_epoch = 11_644_473_600_000_i64 * 1_000;
        for (url, title, visits, last_visit, hidden) in [
            ("https://old.test", "Old", 2, chrome_epoch + 3_000_000, 0),
            ("http://new.test", "", 7, chrome_epoch + 9_000_000, 0),
            (
                "file:///private",
                "Hidden scheme",
                9,
                chrome_epoch + 2_000_000,
                0,
            ),
            (
                "https://hidden.test",
                "Hidden",
                8,
                chrome_epoch + 30_000_000,
                1,
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO urls(url,title,visit_count,last_visit_time,hidden) VALUES(?1,?2,?3,?4,?5)",
                    params![url, title, visits, last_visit, hidden],
                )
                .unwrap();
        }
    }

    #[test]
    fn parses_roots_prunes_empty_folders_and_filters_urls() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(
            temp.path().join("Bookmarks"),
            r#"{
              "roots": {
                "bookmark_bar": {"name":"Bookmarks bar","children":[
                  {"type":"url","name":"Example","url":"https://example.test"},
                  {"type":"folder","name":"Empty","children":[]},
                  {"type":"folder","name":"Nested","children":[
                    {"type":"url","name":"Bad","url":"javascript:alert(1)"},
                    {"type":"url","name":"","url":"http://nested.test"}
                  ]}
                ]},
                "other": {"name":"Other bookmarks","children":[]},
                "synced": {"name":"Mobile bookmarks","children":[
                  {"type":"url","name":"Mobile","url":"https://mobile.test"}
                ]}
              }
            }"#,
        )
        .unwrap();

        assert_eq!(
            read_bookmarks(temp.path()).unwrap(),
            vec![
                BookmarkNode::Folder {
                    name: "Bookmarks bar".to_owned(),
                    children: vec![
                        BookmarkNode::Link {
                            title: "Example".to_owned(),
                            url: "https://example.test".to_owned(),
                        },
                        BookmarkNode::Folder {
                            name: "Nested".to_owned(),
                            children: vec![BookmarkNode::Link {
                                title: "http://nested.test".to_owned(),
                                url: "http://nested.test".to_owned(),
                            }],
                        },
                    ],
                },
                BookmarkNode::Folder {
                    name: "Mobile bookmarks".to_owned(),
                    children: vec![BookmarkNode::Link {
                        title: "Mobile".to_owned(),
                        url: "https://mobile.test".to_owned(),
                    }],
                },
            ]
        );
    }

    #[test]
    fn reads_history_newest_first_and_clamps_zero_limit() {
        let temp = tempfile::tempdir().unwrap();
        history_db(&temp.path().join("History"));
        assert_eq!(
            read_history(temp.path(), 200_000).unwrap(),
            vec![
                HistoryEntry {
                    url: "http://new.test".to_owned(),
                    title: "http://new.test".to_owned(),
                    visits: 7,
                    last_visit_ms: 9_000,
                },
                HistoryEntry {
                    url: "https://old.test".to_owned(),
                    title: "Old".to_owned(),
                    visits: 2,
                    last_visit_ms: 3_000,
                },
            ]
        );
        assert_eq!(read_history(temp.path(), 0).unwrap().len(), 1);
        assert_eq!(read_history(temp.path(), 1).unwrap().len(), 1);
    }

    #[test]
    fn opens_an_existing_database_through_the_immutable_uri_helper() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("History.sqlite");
        history_db(&path);
        let connection = open_immutable(&path).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM urls", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 4);
    }
}

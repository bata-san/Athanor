use crate::sqlite::open_snapshot;
use crate::util::{accepted_url, history_title, link, truncate_title};
use crate::{BookmarkNode, HistoryEntry, Result};
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub(crate) fn read_bookmarks(dir: &Path) -> Result<Vec<BookmarkNode>> {
    let snapshot = open_snapshot(&dir.join("places.sqlite"))?;
    let mut statement = snapshot.connection.prepare(
        "SELECT b.id, b.type, b.fk, b.parent, b.position, b.title, p.url, p.title
         FROM moz_bookmarks AS b
         LEFT JOIN moz_places AS p ON p.id = b.fk
         WHERE b.parent IS NOT NULL
         ORDER BY b.parent, b.position, b.id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(BookmarkRow {
            id: row.get(0)?,
            kind: row.get(1)?,
            parent: row.get(3)?,
            title: row.get(5)?,
            url: row.get(6)?,
            place_title: row.get(7)?,
        })
    })?;

    let mut children_by_parent: HashMap<i64, Vec<BookmarkRow>> = HashMap::new();
    for row in rows {
        let row = row?;
        children_by_parent.entry(row.parent).or_default().push(row);
    }

    let mut result = Vec::new();
    for (id, name) in [
        (2_i64, "Bookmarks menu"),
        (3, "Bookmarks toolbar"),
        (5, "Other bookmarks"),
        (6, "Mobile bookmarks"),
    ] {
        let children = build_children(id, &children_by_parent, &mut HashSet::new());
        if !children.is_empty() {
            result.push(BookmarkNode::Folder {
                name: name.to_owned(),
                children,
            });
        }
    }
    Ok(result)
}

struct BookmarkRow {
    id: i64,
    kind: i64,
    parent: i64,
    title: Option<String>,
    url: Option<String>,
    place_title: Option<String>,
}

fn build_children(
    parent: i64,
    children_by_parent: &HashMap<i64, Vec<BookmarkRow>>,
    ancestors: &mut HashSet<i64>,
) -> Vec<BookmarkNode> {
    if !ancestors.insert(parent) {
        return Vec::new();
    }
    let mut result = Vec::new();
    if let Some(rows) = children_by_parent.get(&parent) {
        for row in rows {
            match row.kind {
                1 => {
                    let Some(url) = row.url.as_deref() else {
                        continue;
                    };
                    let title = row
                        .title
                        .as_deref()
                        .filter(|title| !title.trim().is_empty())
                        .or(row.place_title.as_deref())
                        .unwrap_or("");
                    if let Some(node) = link(title, url) {
                        result.push(node);
                    }
                }
                2 => {
                    let children = build_children(row.id, children_by_parent, ancestors);
                    if !children.is_empty() {
                        result.push(BookmarkNode::Folder {
                            name: truncate_title(row.title.as_deref().unwrap_or("")),
                            children,
                        });
                    }
                }
                _ => {}
            }
        }
    }
    ancestors.remove(&parent);
    result
}

pub(crate) fn read_history(dir: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let snapshot = open_snapshot(&dir.join("places.sqlite"))?;
    let limit = limit.clamp(1, 200_000) as i64;
    let mut statement = snapshot.connection.prepare(
        "SELECT url, title, visit_count, last_visit_date
         FROM moz_places
         WHERE visit_count > 0 AND hidden = 0 AND last_visit_date IS NOT NULL
         ORDER BY last_visit_date DESC
         LIMIT ?1",
    )?;
    let mut rows = statement.query(params![limit])?;
    let mut history = Vec::new();
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        if !accepted_url(&url) {
            continue;
        }
        let title: Option<String> = row.get(1)?;
        let visits: i64 = row.get(2)?;
        let last_visit_date: i64 = row.get(3)?;
        let title = history_title(title, &url);
        history.push(HistoryEntry {
            url,
            title,
            visits: u32::try_from(visits).unwrap_or(if visits < 0 { 0 } else { u32::MAX }),
            last_visit_ms: last_visit_date / 1_000,
        });
    }
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::{read_bookmarks, read_history};
    use crate::{BookmarkNode, HistoryEntry};
    use rusqlite::{params, Connection};

    fn places_db(path: &std::path::Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE moz_places (
                    id INTEGER PRIMARY KEY,
                    url TEXT NOT NULL,
                    title TEXT,
                    visit_count INTEGER NOT NULL DEFAULT 0,
                    hidden INTEGER NOT NULL DEFAULT 0,
                    last_visit_date INTEGER
                );
                CREATE TABLE moz_bookmarks (
                    id INTEGER PRIMARY KEY,
                    type INTEGER NOT NULL,
                    fk INTEGER,
                    parent INTEGER,
                    position INTEGER NOT NULL,
                    title TEXT
                );",
            )
            .unwrap();
        for (id, url, title, visits, hidden, last_visit) in [
            (
                10,
                "https://old.test",
                Some("Old"),
                2,
                0,
                Some(3_000_000_i64),
            ),
            (11, "http://new.test", Some(""), 7, 0, Some(9_000_000_i64)),
            (
                12,
                "file:///private",
                Some("Private"),
                3,
                0,
                Some(2_000_000_i64),
            ),
            (
                13,
                "https://hidden.test",
                Some("Hidden"),
                8,
                1,
                Some(15_000_000_i64),
            ),
            (
                14,
                "https://unvisited.test",
                Some("Unvisited"),
                0,
                0,
                Some(20_000_000_i64),
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO moz_places(id,url,title,visit_count,hidden,last_visit_date) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![id, url, title, visits, hidden, last_visit],
                )
                .unwrap();
        }
        for (id, kind, fk, parent, position, title) in [
            (2, 2, None, Some(1), 0, Some("database menu")),
            (3, 2, None, Some(1), 1, Some("database toolbar")),
            (4, 2, None, Some(1), 2, Some("tags")),
            (5, 2, None, Some(1), 3, Some("database unfiled")),
            (6, 2, None, Some(1), 4, Some("database mobile")),
            (20, 1, Some(10), Some(2), 0, Some("Old bookmark")),
            (21, 2, None, Some(2), 1, Some("Empty folder")),
            (22, 1, Some(11), Some(21), 0, Some("Nested link")),
            (23, 3, None, Some(2), 2, Some("separator")),
            (24, 1, Some(12), Some(3), 0, Some("Bad scheme")),
            (25, 1, Some(11), Some(6), 0, Some("Mobile link")),
        ] {
            connection
                .execute(
                    "INSERT INTO moz_bookmarks(id,type,fk,parent,position,title) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![id, kind, fk, parent, position, title],
                )
                .unwrap();
        }
    }

    #[test]
    fn reads_firefox_bookmark_roots_and_prunes_empty_or_filtered_nodes() {
        let temp = tempfile::tempdir().unwrap();
        places_db(&temp.path().join("places.sqlite"));
        assert_eq!(
            read_bookmarks(temp.path()).unwrap(),
            vec![
                BookmarkNode::Folder {
                    name: "Bookmarks menu".to_owned(),
                    children: vec![
                        BookmarkNode::Link {
                            title: "Old bookmark".to_owned(),
                            url: "https://old.test".to_owned(),
                        },
                        BookmarkNode::Folder {
                            name: "Empty folder".to_owned(),
                            children: vec![BookmarkNode::Link {
                                title: "Nested link".to_owned(),
                                url: "http://new.test".to_owned(),
                            }],
                        },
                    ],
                },
                BookmarkNode::Folder {
                    name: "Mobile bookmarks".to_owned(),
                    children: vec![BookmarkNode::Link {
                        title: "Mobile link".to_owned(),
                        url: "http://new.test".to_owned(),
                    }],
                },
            ]
        );
    }

    #[test]
    fn reads_firefox_history_in_microseconds_and_filters_hidden_and_unvisited() {
        let temp = tempfile::tempdir().unwrap();
        places_db(&temp.path().join("places.sqlite"));
        assert_eq!(
            read_history(temp.path(), 50).unwrap(),
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
        assert_eq!(read_history(temp.path(), 1).unwrap().len(), 1);
    }
}

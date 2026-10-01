use crate::util::{link, prune_empty_folders, truncate_title};
use crate::BookmarkNode;

#[derive(Debug)]
enum Token {
    Start {
        name: String,
        attrs: Vec<(String, String)>,
    },
    End(String),
    Text(String),
}

/// Parse a Netscape-format bookmark export into a forest of folders and links.
pub fn parse_bookmarks_html(text: &str) -> Vec<BookmarkNode> {
    let tokens = tokenize(text);
    let start = tokens
        .iter()
        .position(|token| matches!(token, Token::Start { name, .. } if name == "dl"))
        .unwrap_or(0);
    let mut index = start;
    if matches!(tokens.get(index), Some(Token::Start { name, .. }) if name == "dl") {
        index += 1;
    }
    let nodes = parse_list(&tokens, &mut index);
    prune_empty_folders(nodes)
}

fn parse_list(tokens: &[Token], index: &mut usize) -> Vec<BookmarkNode> {
    let mut result = Vec::new();
    let mut pending_folder: Option<String> = None;
    while let Some(token) = tokens.get(*index) {
        match token {
            Token::End(name) if name == "dl" => {
                *index += 1;
                break;
            }
            Token::Start { name, .. } if name == "dl" => {
                *index += 1;
                let children = parse_list(tokens, index);
                if let Some(folder_name) = pending_folder.take() {
                    if !children.is_empty() {
                        result.push(BookmarkNode::Folder {
                            name: truncate_title(&folder_name),
                            children,
                        });
                    }
                } else {
                    result.extend(children);
                }
            }
            Token::Start { name, .. } if name == "h3" => {
                *index += 1;
                let title = collect_element_text(tokens, index, "h3");
                pending_folder = Some(decode_entities(title.trim()));
            }
            Token::Start { name, attrs } if name == "a" => {
                let href = attrs
                    .iter()
                    .find(|(name, _)| name == "href")
                    .map(|(_, value)| decode_entities(value.trim()));
                *index += 1;
                let title = decode_entities(&collect_element_text(tokens, index, "a"));
                if let Some(href) = href {
                    if let Some(node) = link(title.trim(), href.trim()) {
                        result.push(node);
                    }
                }
            }
            _ => *index += 1,
        }
    }
    prune_empty_folders(result)
}

fn collect_element_text(tokens: &[Token], index: &mut usize, element: &str) -> String {
    let mut text = String::new();
    let mut depth = 1_usize;
    while let Some(token) = tokens.get(*index) {
        match token {
            Token::Start { name, .. } if name == element => depth += 1,
            Token::End(name) if name == element => {
                depth -= 1;
                *index += 1;
                if depth == 0 {
                    break;
                }
                continue;
            }
            Token::Text(value) => text.push_str(value),
            _ => {}
        }
        *index += 1;
    }
    text
}

fn tokenize(text: &str) -> Vec<Token> {
    let bytes = text.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'<' {
            let end = text[index..]
                .find('<')
                .map(|offset| index + offset)
                .unwrap_or(bytes.len());
            tokens.push(Token::Text(text[index..end].to_owned()));
            index = end;
            continue;
        }
        if text[index..].starts_with("<!--") {
            if let Some(end) = text[index + 4..].find("-->") {
                index += 4 + end + 3;
            } else {
                break;
            }
            continue;
        }

        let Some((end, closed)) = find_tag_end(text, index + 1) else {
            tokens.push(Token::Text("<".to_owned()));
            index += 1;
            continue;
        };
        let body = &text[index + 1..end];
        if body.starts_with('!') || body.starts_with('?') {
            index = if closed { end + 1 } else { end };
            continue;
        }
        if let Some(token) = parse_tag(body) {
            tokens.push(token);
        } else {
            tokens.push(Token::Text("<".to_owned()));
            tokens.push(Token::Text(body.to_owned()));
            if closed {
                tokens.push(Token::Text(">".to_owned()));
            }
        }
        index = if closed { end + 1 } else { end };
    }
    tokens
}

fn find_tag_end(text: &str, mut index: usize) -> Option<(usize, bool)> {
    let bytes = text.as_bytes();
    let mut quote = None;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(expected) = quote {
            if byte == expected {
                quote = None;
            }
        } else if byte == b'\'' || byte == b'"' {
            quote = Some(byte);
        } else if byte == b'>' {
            return Some((index, true));
        }
        index += 1;
    }
    (!text.is_empty()).then_some((bytes.len(), false))
}

fn parse_tag(body: &str) -> Option<Token> {
    let bytes = body.as_bytes();
    let mut index = 0;
    while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
        index += 1;
    }
    let closing = bytes.get(index) == Some(&b'/');
    if closing {
        index += 1;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
    }
    let name_start = index;
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b':'))
    {
        index += 1;
    }
    if index == name_start {
        return None;
    }
    let name = body[name_start..index].to_ascii_lowercase();
    if closing {
        return Some(Token::End(name));
    }

    let mut attrs = Vec::new();
    while index < bytes.len() {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace)
            || bytes.get(index) == Some(&b'/')
        {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let attribute_start = index;
        while bytes
            .get(index)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(*byte, b'=' | b'/' | b'>'))
        {
            index += 1;
        }
        if index == attribute_start {
            index += 1;
            continue;
        }
        let attribute_name = body[attribute_start..index].to_ascii_lowercase();
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let mut value = String::new();
        if bytes.get(index) == Some(&b'=') {
            index += 1;
            while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
                index += 1;
            }
            if let Some(quote @ (b'\'' | b'"')) = bytes.get(index).copied() {
                index += 1;
                let value_start = index;
                while bytes.get(index).is_some_and(|byte| *byte != quote) {
                    index += 1;
                }
                value = body[value_start..index].to_owned();
                if bytes.get(index) == Some(&quote) {
                    index += 1;
                }
            } else {
                let value_start = index;
                while bytes
                    .get(index)
                    .is_some_and(|byte| !byte.is_ascii_whitespace() && *byte != b'>')
                {
                    index += 1;
                }
                value = body[value_start..index].to_owned();
            }
        }
        attrs.push((attribute_name, value));
    }
    Some(Token::Start { name, attrs })
}

fn decode_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if rest.starts_with('&') {
            if let Some(end_offset) = rest.find(';') {
                let entity = &rest[1..end_offset];
                if let Some(decoded) = decode_entity(entity) {
                    output.push(decoded);
                    index += end_offset + 1;
                    continue;
                }
            }
        }
        let Some(character) = rest.chars().next() else {
            break;
        };
        output.push(character);
        index += character.len_utf8();
    }
    output
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_bookmarks_html;
    use crate::BookmarkNode;

    #[test]
    fn parses_nested_folders_entities_case_and_attributes() {
        let html = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1>
            <hTmL><BoDy><dL><p>
              <dT><h3 ADD_DATE="1">Work &amp; <b>Research</b></h3>
              <dL><p>
                <DT><A ADD_DATE='2' HREF='https://example.test/?a=1&amp;b=2'>A &lt; B &#39; &#x27; &#34; &#62;</A>
                <dt><h3>Nested &#x1F600;</h3><dl>
                  <dt><a href="http://nested.test">Nested &quot;link&quot;</a>
                </dl>
                <DT><A HREF="javascript:alert(1)">Filtered</A>
              </dL>
              <DT><H3>Empty folder</H3><DL></DL>
            </dL></BoDy></hTmL>"#;
        assert_eq!(
            parse_bookmarks_html(html),
            vec![BookmarkNode::Folder {
                name: "Work & Research".to_owned(),
                children: vec![
                    BookmarkNode::Link {
                        title: "A < B ' ' \" >".to_owned(),
                        url: "https://example.test/?a=1&b=2".to_owned(),
                    },
                    BookmarkNode::Folder {
                        name: "Nested 😀".to_owned(),
                        children: vec![BookmarkNode::Link {
                            title: "Nested \"link\"".to_owned(),
                            url: "http://nested.test".to_owned(),
                        }],
                    },
                ],
            }]
        );
    }

    #[test]
    fn keeps_a_single_top_level_folder_and_recovers_truncated_markup() {
        let html = "<DL><DT><H3>Only</H3><DL><DT><A HREF=http://ok.test>Fine</A><DT><A HREF='https://cut.test'>cut";
        assert_eq!(
            parse_bookmarks_html(html),
            vec![BookmarkNode::Folder {
                name: "Only".to_owned(),
                children: vec![
                    BookmarkNode::Link {
                        title: "Fine".to_owned(),
                        url: "http://ok.test".to_owned(),
                    },
                    BookmarkNode::Link {
                        title: "cut".to_owned(),
                        url: "https://cut.test".to_owned(),
                    },
                ],
            }]
        );
        assert!(parse_bookmarks_html("<DL><DT><H3>unfinished</DL><A href=\"http").is_empty());
        assert!(!parse_bookmarks_html("<DT><A HREF='https://unterminated.test'>Title").is_empty());
        assert!(!parse_bookmarks_html("<DT><A HREF='https://unfinished.test").is_empty());
        assert!(parse_bookmarks_html("<> << 7&& broken <H3").is_empty());
    }
}

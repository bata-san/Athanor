//! Detect local dev servers by probing well-known ports on loopback.

use crate::state::DevServer;
use athanor_core::devtools::COMMON_DEV_PORTS;
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

async fn probe(port: u16) -> Option<DevServer> {
    let mut stream = timeout(Duration::from_millis(120), TcpStream::connect(("127.0.0.1", port))).await.ok()?.ok()?;
    let title = fetch_title(&mut stream).await;
    Some(DevServer { port, url: format!("http://localhost:{port}/"), title })
}

async fn fetch_title(stream: &mut TcpStream) -> Option<String> {
    let req = b"GET / HTTP/1.0\r\nHost: localhost\r\nAccept: text/html\r\nConnection: close\r\n\r\n";
    timeout(Duration::from_millis(200), stream.write_all(req)).await.ok()?.ok()?;
    let mut buf = vec![0u8; 16 * 1024];
    let mut n = 0;
    // read until we have the title or run out of time/space
    let _ = timeout(Duration::from_millis(250), async {
        while n < buf.len() {
            match stream.read(&mut buf[n..]).await {
                Ok(0) | Err(_) => break,
                Ok(k) => n += k,
            }
            if find_title(&buf[..n]).is_some() {
                break;
            }
        }
    })
    .await;
    find_title(&buf[..n])
}

fn find_title(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let lower = text.to_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let end = lower[open_end..].find("</title>")? + open_end;
    let title = text[open_end..end].trim().to_string();
    (!title.is_empty()).then_some(title)
}

pub async fn scan() -> Vec<DevServer> {
    let mut set = tokio::task::JoinSet::new();
    for &p in COMMON_DEV_PORTS {
        set.spawn(probe(p));
    }
    let mut out = vec![];
    while let Some(r) = set.join_next().await {
        if let Ok(Some(s)) = r {
            out.push(s);
        }
    }
    out.sort_by_key(|s| s.port);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_parsing() {
        assert_eq!(find_title(b"HTTP/1.0 200\r\n\r\n<html><TITLE> Vite + React </TITLE>").as_deref(), Some("Vite + React"));
        assert_eq!(find_title(b"<html><head></head>"), None);
        assert_eq!(find_title(b"<title></title>"), None);
    }

    #[tokio::test]
    async fn finds_a_listening_server() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut s, _)) = listener.accept().await {
                let mut b = [0u8; 256];
                let _ = s.read(&mut b).await;
                let _ = s.write_all(b"HTTP/1.0 200 OK\r\n\r\n<title>Hello dev</title>").await;
            }
        });
        let s = probe(port).await.expect("server found");
        assert_eq!(s.title.as_deref(), Some("Hello dev"));
        assert!(probe(1).await.is_none());
    }
}

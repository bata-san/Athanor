//! User-selected password CSV imports, encrypted at rest using the current Windows user's DPAPI key.
//! Password values never cross IPC into the shell and are filled only for an exact HTTP(S) origin.
use crate::browser::Browser;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

static VAULT_LOCK: Mutex<()> = Mutex::new(());
const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

#[derive(Serialize, Deserialize)]
struct Credential {
    id: String,
    origin: String,
    username: String,
    password: String,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordInfo {
    pub id: String,
    pub origin: String,
    pub username: String,
}
#[derive(Default, Serialize)]
pub struct PasswordImport {
    pub imported: usize,
    pub updated: usize,
    pub skipped: usize,
}

fn origin(input: &str) -> Option<String> {
    let parsed = url::Url::parse(input).ok()?;
    (matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some())
        .then(|| parsed.origin().ascii_serialization())
}

fn protect(input: &[u8], decrypt: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let blob = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "Password data is too large")?,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if decrypt {
            CryptUnprotectData(
                &blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &blob,
                windows::core::PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            if decrypt {
                "Saved passwords could not be unlocked by this Windows account"
            } else {
                "Windows could not encrypt the passwords"
            }
        })?;
        let bytes = Zeroizing::new(
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec(),
        );
        std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize).zeroize();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}

fn load(browser: &Browser) -> Result<Vec<Credential>, String> {
    let path = browser.paths.file("passwords.dpapi");
    if !path.exists() {
        return Ok(vec![]);
    }
    let bytes = std::fs::read(path).map_err(|_| "Saved passwords could not be read")?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("Saved password data is too large".into());
    }
    let plaintext = protect(&bytes, true)?;
    serde_json::from_slice(&plaintext).map_err(|_| "Saved password data is damaged".into())
}

fn save(browser: &Browser, entries: &[Credential]) -> Result<(), String> {
    let plaintext =
        Zeroizing::new(serde_json::to_vec(entries).map_err(|_| "Passwords could not be saved")?);
    let encrypted = protect(&plaintext, false)?;
    if encrypted.len() as u64 > MAX_FILE {
        return Err(
            "Saved password data exceeds 16 MB. Remove some entries before importing more.".into(),
        );
    }
    // Reuse the atomic replacement discipline of the other stores; the temporary file is encrypted too.
    let target = browser.paths.file("passwords.dpapi");
    let staging = browser.paths.file("passwords.dpapi.tmp");
    std::fs::write(&staging, &*encrypted)
        .map_err(|_| "Encrypted passwords could not be written")?;
    std::fs::rename(staging, target).map_err(|_| "Encrypted passwords could not be saved".into())
}

pub fn list(browser: &Browser) -> Result<Vec<PasswordInfo>, String> {
    let _guard = VAULT_LOCK.lock();
    Ok(load(browser)?
        .iter()
        .map(|entry| PasswordInfo {
            id: entry.id.clone(),
            origin: entry.origin.clone(),
            username: entry.username.clone(),
        })
        .collect())
}

fn parse_csv(text: &str) -> Result<(Vec<Credential>, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let headers = reader
        .headers()
        .map_err(|_| "This file is not a password CSV")?
        .clone();
    let column = |name: &str| {
        headers
            .iter()
            .position(|header| header.trim().eq_ignore_ascii_case(name))
    };
    let (url, username, password) = (
        column("url").or_else(|| column("origin")),
        column("username"),
        column("password"),
    );
    let (Some(url), Some(username), Some(password)) = (url, username, password) else {
        return Err("Choose a password CSV exported by Chrome, Edge or Firefox (url, username, password columns)".into());
    };
    let mut entries = vec![];
    let mut skipped = 0;
    for row in reader.records() {
        let row = row.map_err(|_| {
            "The CSV contains an invalid row. Export it again from the original browser."
        })?;
        if entries.len() + skipped >= MAX_ENTRIES {
            return Err("The CSV has more than 20,000 entries".into());
        }
        let site = row.get(url).and_then(origin);
        let user = row.get(username).unwrap_or("");
        let pass = row.get(password).unwrap_or("");
        if site.is_none() || pass.is_empty() || pass.len() > 16_384 || user.len() > 4096 {
            skipped += 1;
            continue;
        }
        entries.push(Credential {
            id: athanor_core::new_id(),
            origin: site.unwrap(),
            username: user.to_owned(),
            password: pass.to_owned(),
        });
    }
    Ok((entries, skipped))
}

pub fn import(browser: &Browser, path: &Path) -> Result<PasswordImport, String> {
    let meta = std::fs::metadata(path).map_err(|_| "The selected CSV could not be read")?;
    if !meta.is_file() || meta.len() > MAX_FILE {
        return Err("Choose a password CSV smaller than 16 MB".into());
    }
    let text = Zeroizing::new(
        std::fs::read_to_string(path).map_err(|_| "Export the passwords as a UTF-8 CSV")?,
    );
    let (incoming, skipped) = parse_csv(&text)?;
    let _guard = VAULT_LOCK.lock();
    let mut entries = load(browser)?;
    let mut positions: std::collections::HashMap<_, _> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| ((entry.origin.clone(), entry.username.clone()), index))
        .collect();
    let mut report = PasswordImport {
        skipped,
        ..Default::default()
    };
    for entry in incoming {
        let key = (entry.origin.clone(), entry.username.clone());
        if let Some(index) = positions.get(&key) {
            let old = &mut entries[*index];
            old.password.zeroize();
            old.password = entry.password.clone();
            report.updated += 1;
        } else {
            positions.insert(key, entries.len());
            entries.push(entry);
            report.imported += 1;
        }
    }
    if entries.len() > MAX_ENTRIES {
        return Err("Saved passwords are limited to 20,000 entries".into());
    }
    save(browser, &entries)?;
    Ok(report)
}

pub fn remove(browser: &Browser, id: &str) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock();
    let mut entries = load(browser)?;
    entries.retain(|entry| entry.id != id);
    save(browser, &entries)
}

pub fn fill_script(
    browser: &Browser,
    id: &str,
    current_url: &str,
) -> Result<Zeroizing<String>, String> {
    let site = origin(current_url).ok_or("Open the matching sign-in page first")?;
    let _guard = VAULT_LOCK.lock();
    let entries = load(browser)?;
    let entry = entries
        .iter()
        .find(|entry| entry.id == id && entry.origin == site)
        .ok_or("This password belongs to a different site. Open its sign-in page first.")?;
    let data = Zeroizing::new(serde_json::to_string(&serde_json::json!({ "origin": site, "username": entry.username, "password": entry.password })).map_err(|_| "Password could not be filled")?);
    Ok(Zeroizing::new(format!(
        r#"(()=>{{const saved={data};if(location.origin!==saved.origin)return 'wrong-site';const visible=e=>!e.disabled&&!e.readOnly&&e.getClientRects().length>0;const password=[...document.querySelectorAll('input[type=password]')].find(e=>visible(e)&&e.autocomplete!=='new-password');if(!password)return 'no-form';const form=password.form||document;const fields=[...form.querySelectorAll('input')];const user=fields.find(e=>visible(e)&&(e.autocomplete==='username'||e.type==='email'))||fields.find(e=>visible(e)&&e.type==='text');const put=(field,value)=>{{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{{bubbles:true}}));field.dispatchEvent(new Event('change',{{bubbles:true}}))}};if(user)put(user,saved.username);put(password,saved.password);saved.password='';password.focus();return 'filled';}})()"#,
        data = *data
    )))
}

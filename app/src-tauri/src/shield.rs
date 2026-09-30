//! Shield glue: assembles the extra filter lists (extension-provided lists + the user's "My filters")
//! and feeds them to the blocking engine, which swaps in the rebuilt engine atomically.

use crate::{browser::Paths, ext_host::ExtHost, filter::Filter};
use athanor_adblock::user::{self, LineIssue};
use parking_lot::Mutex;
use std::{fs, sync::Arc};

const USER_LIST_ID: &str = "user-filters";

pub struct Shield {
    paths: Paths,
    user: Mutex<String>,
}

impl Shield {
    pub fn new(paths: Paths) -> Arc<Self> {
        let text = fs::read_to_string(paths.file("user-filters.txt")).unwrap_or_default();
        Arc::new(Self {
            paths,
            user: Mutex::new(text),
        })
    }

    pub fn user_filters(&self) -> String {
        self.user.lock().clone()
    }

    /// Validate and store the user's filters. Oversized text is rejected outright; otherwise the text is
    /// saved even if some lines are invalid (the engine ignores those), and the invalid lines are returned.
    pub fn set_user_filters(&self, text: String) -> Result<Vec<LineIssue>, String> {
        let issues = user::validate(&text);
        if issues.iter().any(|i| i.line == 0) {
            return Err(issues
                .into_iter()
                .next()
                .map(|i| i.message)
                .unwrap_or_default());
        }
        fs::write(self.paths.file("user-filters.txt"), &text).map_err(|e| e.to_string())?;
        *self.user.lock() = text;
        Ok(issues)
    }

    /// Recompile the engine with the current extension lists and user filters. Returns rejected list errors.
    pub fn apply(&self, filter: &Filter, ext: &ExtHost) -> Vec<String> {
        let mut lists = ext.filter_list_texts();
        let user = self.user.lock().clone();
        if !user.trim().is_empty() {
            lists.push((USER_LIST_ID.to_string(), user));
        }
        let errors = filter.set_extra_lists(lists);
        for e in &errors {
            log::warn!("shield: {e}");
        }
        errors
    }
}

//! Download history for this browser session. Transfers remain owned by the engine.
use athanor_core::engine::EngineEvent;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub tab: String,
    pub id: u32,
    pub name: String,
    pub path: String,
    pub state: String,
    pub received: u64,
    pub total: u64,
    pub error: Option<String>,
    pub can_resume: bool,
}

#[derive(Default)]
pub struct Downloads(Vec<Download>);

impl Downloads {
    pub fn update(&mut self, event: &EngineEvent) {
        if let EngineEvent::Download {
            tab,
            id,
            name,
            path,
            state,
            received,
            total,
            error,
            can_resume,
        } = event
        {
            let record = Download {
                tab: tab.clone(),
                id: *id,
                name: name.clone(),
                path: path.clone(),
                state: state.clone(),
                received: *received,
                total: *total,
                error: error.clone(),
                can_resume: *can_resume,
            };
            if let Some(old) = self.0.iter_mut().find(|d| d.id == *id) {
                *old = record;
            } else {
                self.0.insert(0, record);
            }
            let mut finished = 0;
            self.0.retain(|d| {
                if matches!(d.state.as_str(), "started" | "progress" | "paused") || d.can_resume {
                    return true;
                }
                finished += 1;
                finished <= 100
            });
        }
    }
    pub fn list(&self) -> Vec<Download> {
        self.0.clone()
    }
    pub fn get(&self, id: u32) -> Option<&Download> {
        self.0.iter().find(|d| d.id == id)
    }
    pub fn busy(&self, tab: &str) -> bool {
        self.0.iter().any(|d| {
            d.tab == tab
                && (matches!(d.state.as_str(), "started" | "progress" | "paused")
                    || d.state == "failed" && d.can_resume)
        })
    }
}

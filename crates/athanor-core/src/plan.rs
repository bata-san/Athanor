//! Which webviews must exist, where they sit, which is visible and which one takes focus.
//! [`plan`] is pure: it reads the [`Workspace`] plus the controller's mirror of reality
//! ([`ViewState`]) and returns the minimal [`Plan`], advancing the view state as it goes so
//! a second call with no input change returns an empty plan. The caller applies a plan in
//! the listed order - discard, create, place, show, hide, focus - and create precedes hide.
//!
//! The rules: internal `athanor://` pages never own a webview; archived, closed and
//! internally navigated tabs lose theirs, and an archived tab is never a desired pane (it has
//! no renderer, so planning one would discard and re-create it forever); a split is laid out by
//! `Node::rects` with [`SPLIT_GAP`] between panes; an open overlay hides everything and closing
//! it restores the same webviews; viewport emulation shrinks and centres its pane; a one-shot
//! `want_live` gets a hidden webview and is consumed either way; the one-shot `focus_next` is
//! answered only if the active tab is visible.

use crate::{layout::Rect, model::Id, urlutil, Workspace};
use std::collections::{HashMap, HashSet};

/// Gap between split panes, in CSS px. Shared with the shell's divider hit-testing.
pub const SPLIT_GAP: f64 = 4.0;

/// A webview the controller believes the engine currently owns.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Live {
    /// Whether the engine currently has this webview on screen.
    pub visible: bool,
    /// The rect the webview was last created/placed at.
    pub rect: Rect,
}

/// Everything the planner needs to know about the engine side of the world.
///
/// This is the controller's mirror of reality: which tabs own a renderer, where it sits and
/// whether it is on screen, plus the shell's requests about bounds, overlays, viewport
/// emulation and focus. It is the only state [`plan`] mutates.
#[derive(Clone, Debug, PartialEq)]
pub struct ViewState {
    /// Content rectangle reported by the shell, in CSS px.
    pub bounds: Rect,
    /// A shell overlay (settings, panels, ...) is covering the webviews.
    pub overlay: bool,
    /// Tabs the engine currently owns a webview for.
    pub live: HashMap<Id, Live>,
    /// Tabs that must get a (hidden) webview even though they are not on screen.
    pub want_live: HashSet<Id>,
    /// Viewport emulation per tab, as `(width, height)`.
    pub emulation: HashMap<Id, (f64, f64)>,
    /// One-shot request to focus the active tab after the plan is applied.
    pub focus_next: bool,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            // Not a zero rect: the first plan runs before the shell has reported a size and
            // a zero-sized webview may refuse to start at all.
            bounds: Rect::new(0.0, 0.0, 1.0, 1.0),
            overlay: false,
            live: HashMap::new(),
            want_live: HashSet::new(),
            emulation: HashMap::new(),
            focus_next: false,
        }
    }
}

/// A webview to create, with the URL it starts on and whether it starts visible.
#[derive(Clone, Debug, PartialEq)]
pub struct Create {
    pub id: Id,
    pub url: String,
    pub rect: Rect,
    pub visible: bool,
}

/// The engine operations needed to turn the live webviews into the desired ones.
///
/// Apply in field order; the sets are disjoint except that an id may appear in `create`
/// and later in `place`/`show` on a subsequent plan.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plan {
    /// Free the renderer but keep the tab entry (archive, close, internal navigation).
    pub discard: Vec<Id>,
    /// Create a webview.
    pub create: Vec<Create>,
    /// Move an existing webview.
    pub place: Vec<(Id, Rect)>,
    /// Make an existing webview visible.
    pub show: Vec<Id>,
    /// Hide an existing webview.
    pub hide: Vec<Id>,
    /// Give keyboard focus to this webview.
    pub focus: Option<Id>,
}

impl Plan {
    /// True when the engine does not have to do anything at all.
    pub fn is_empty(&self) -> bool {
        self.discard.is_empty()
            && self.create.is_empty()
            && self.place.is_empty()
            && self.show.is_empty()
            && self.hide.is_empty()
            && self.focus.is_none()
    }
}

/// The panes that should be on screen right now, with their rects.
///
/// Empty while an overlay covers the content area, when there is no active tab, when the
/// active tab is an internal page or has been archived, or when the active tab is not part of
/// the current split.
pub fn desired_panes(ws: &Workspace, view: &ViewState) -> Vec<(Id, Rect)> {
    if view.overlay {
        return vec![];
    }
    let Some(active) = ws.active_tab.as_deref() else {
        return vec![];
    };
    let mut panes: Vec<(Id, Rect)> = match &ws.split {
        Some(s) if s.root.contains(active) => s.root.rects(view.bounds, SPLIT_GAP),
        // An archived tab has no renderer, so it is not a pane either.
        _ => match ws.tab(active) {
            Some(t) if !t.archived && !urlutil::is_internal(&t.url) => {
                vec![(t.id.clone(), view.bounds)]
            }
            _ => vec![],
        },
    };
    // Internal pages are drawn by the shell and archived tabs hold no webview, so a split pane
    // holding one shows nothing.
    panes.retain(|(id, _)| {
        ws.tab(id)
            .is_some_and(|t| !t.archived && !urlutil::is_internal(&t.url))
    });
    for (id, rect) in &mut panes {
        if let Some(&(w, h)) = view.emulation.get(id) {
            // Emulated viewports never grow past their pane, and are centred horizontally.
            let (nw, nh) = (w.min(rect.w), h.min(rect.h));
            *rect = Rect::new(rect.x + (rect.w - nw) / 2.0, rect.y, nw, nh);
        }
    }
    panes
}

/// Diff the desired panes against the live webviews and update [`view`] to match.
///
/// Idempotent: calling it again without changing `ws` or `view` returns an empty [`Plan`].
/// The returned plan is a *diff* - the caller applies it, and mutating `view` here only
/// records what the engine has been asked to do, so a failed create simply leaves the tab
/// without a live entry and the next plan retries it.
#[must_use = "the plan has to be applied to the engine"]
pub fn plan(ws: &Workspace, view: &mut ViewState) -> Plan {
    let mut plan = Plan::default();
    let panes = desired_panes(ws, view);
    let visible: HashSet<&Id> = panes.iter().map(|(id, _)| id).collect();

    // Tabs that no longer deserve a renderer: gone, archived, or navigated to an internal page.
    let stale: Vec<Id> = view
        .live
        .keys()
        .filter(|id| {
            ws.tab(id)
                .is_none_or(|t| t.archived || urlutil::is_internal(&t.url))
        })
        .cloned()
        .collect();
    for id in stale {
        view.live.remove(&id);
        view.want_live.remove(&id);
        plan.discard.push(id);
    }

    for (id, rect) in &panes {
        match view.live.get_mut(id) {
            None => {
                let url = ws.tab(id).map(|t| t.url.clone()).unwrap_or_default();
                plan.create.push(Create {
                    id: id.clone(),
                    url,
                    rect: *rect,
                    visible: true,
                });
                view.live.insert(
                    id.clone(),
                    Live {
                        visible: true,
                        rect: *rect,
                    },
                );
            }
            Some(l) => {
                if l.rect != *rect {
                    plan.place.push((id.clone(), *rect));
                    l.rect = *rect;
                }
                if !l.visible {
                    plan.show.push(id.clone());
                    l.visible = true;
                }
            }
        }
    }
    // Background tabs that asked for a webview (audio, preloading) get a hidden one. The request
    // is one-shot: it is consumed whether or not it could be honoured, so a tab that already owns
    // a webview clears it too and the set cannot grow without bound.
    let pending: Vec<Id> = view.want_live.iter().cloned().collect();
    for id in pending {
        if !view.live.contains_key(&id) {
            if let Some(t) = ws
                .tab(&id)
                .filter(|t| !t.archived && !urlutil::is_internal(&t.url))
            {
                let rect = view.bounds;
                plan.create.push(Create {
                    id: id.clone(),
                    url: t.url.clone(),
                    rect,
                    visible: false,
                });
                view.live.insert(
                    id.clone(),
                    Live {
                        visible: false,
                        rect,
                    },
                );
            }
        }
        view.want_live.remove(&id);
    }
    for (id, l) in view.live.iter_mut() {
        if !visible.contains(id) && l.visible {
            plan.hide.push(id.clone());
            l.visible = false;
        }
    }
    if view.focus_next {
        view.focus_next = false;
        plan.focus = ws.active_tab.clone().filter(|a| visible.contains(a));
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{layout::Dir, model::OpenOptions, urlutil::NEW_TAB_URL};

    // ---------- helpers ----------

    fn area() -> Rect {
        Rect::new(0.0, 0.0, 1000.0, 600.0)
    }

    fn view() -> ViewState {
        ViewState {
            bounds: area(),
            ..Default::default()
        }
    }

    /// Workspace with a single active tab.
    fn ws(url: &str) -> (Workspace, Id) {
        let mut w = Workspace::default();
        let id = w.open_tab(url, OpenOptions::default(), 1);
        (w, id)
    }

    /// A background tab: never a pane, never focused.
    fn bg(w: &mut Workspace, url: &str) -> Id {
        w.open_tab(
            url,
            OpenOptions {
                background: true,
                ..Default::default()
            },
            1,
        )
    }

    /// A foreground tab; the workspace's active tab becomes this one.
    fn next(w: &mut Workspace, url: &str) -> Id {
        w.open_tab(url, OpenOptions::default(), 2)
    }

    /// One reconciliation pass, as the controller would do.
    fn run(ws: &Workspace, view: &mut ViewState) -> Plan {
        plan(ws, view)
    }

    fn assert_close(a: Rect, b: Rect) {
        let close = (a.x - b.x).abs() < 1e-9
            && (a.y - b.y).abs() < 1e-9
            && (a.w - b.w).abs() < 1e-9
            && (a.h - b.h).abs() < 1e-9;
        assert!(close, "rect {a:?} != {b:?}");
    }

    fn sorted(v: &[Id]) -> Vec<Id> {
        let mut v = v.to_vec();
        v.sort();
        v
    }

    fn ids(v: &[Id]) -> Vec<&str> {
        v.iter().map(String::as_str).collect()
    }

    /// Ids of everything the plan creates, sorted.
    fn created(p: &Plan) -> Vec<&str> {
        let mut v: Vec<&str> = p.create.iter().map(|c| c.id.as_str()).collect();
        v.sort_unstable();
        v
    }

    fn only(p: &Plan) -> &Create {
        assert_eq!(
            p.create.len(),
            1,
            "expected one create, got {:?}",
            created(p)
        );
        &p.create[0]
    }

    fn create_of<'a>(p: &'a Plan, id: &str) -> &'a Create {
        p.create
            .iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("no create for {id}, got {:?}", created(p)))
    }

    fn assert_place(p: &Plan, want: &[(Id, Rect)], msg: &str) {
        assert_eq!(
            p.place.len(),
            want.len(),
            "{msg}: place entries {:?}",
            p.place
        );
        for (got, (id, r)) in p.place.iter().zip(want) {
            assert_eq!(&got.0, id, "{msg}");
            assert_close(got.1, *r);
        }
    }

    fn set_archived(w: &mut Workspace, id: &str, archived: bool) {
        for t in &mut w.tabs {
            if t.id == id {
                t.archived = archived;
            }
        }
    }

    // ---------- the type itself ----------

    #[test]
    fn default_view_state_is_a_placeholder_not_a_zero_rect() {
        let v = ViewState::default();
        assert_eq!(
            v.bounds,
            Rect::new(0.0, 0.0, 1.0, 1.0),
            "a zero-sized webview may not start"
        );
        assert!(!v.overlay);
        assert!(v.live.is_empty() && v.want_live.is_empty() && v.emulation.is_empty());
        assert!(!v.focus_next);
        assert!(Plan::default().is_empty());
    }

    #[test]
    fn an_empty_workspace_plans_nothing() {
        let w = Workspace::default();
        let mut v = view();
        assert!(run(&w, &mut v).is_empty());
    }

    #[test]
    fn no_active_tab_plans_nothing() {
        let mut w = Workspace::default();
        let a = bg(&mut w, "https://a.test");
        assert!(w.active_tab.is_none(), "a background open never activates");
        let mut v = view();
        assert!(run(&w, &mut v).is_empty());
        assert!(v.live.is_empty());
        let _ = a;
    }

    // ---------- the happy path ----------

    #[test]
    fn first_activation_creates_one_visible_webview_at_the_bounds() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        let p = run(&w, &mut v);
        let c = only(&p);
        assert_eq!(c.id, a);
        assert_eq!(c.url, "https://a.test");
        assert_eq!(c.rect, area());
        assert!(
            c.visible,
            "a fresh pane is created visible, it is not created hidden and then shown"
        );
        assert!(
            p.discard.is_empty() && p.place.is_empty() && p.show.is_empty() && p.hide.is_empty()
        );
        assert!(p.focus.is_none());
        assert_eq!(
            v.live.get(&a),
            Some(&Live {
                visible: true,
                rect: area()
            })
        );
    }

    #[test]
    fn second_call_with_no_change_is_a_no_op() {
        let (w, _a) = ws("https://a.test");
        let mut v = view();
        assert!(!run(&w, &mut v).is_empty());
        let again = run(&w, &mut v);
        assert!(again.is_empty(), "expected an empty plan, got {again:?}");
        assert_eq!(v.live.len(), 1);
    }

    // ---------- switching ----------

    #[test]
    fn switching_tabs_creates_the_new_one_and_hides_the_old() {
        let (mut w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        let b = next(&mut w, "https://b.test");
        let p = run(&w, &mut v);
        let c = only(&p);
        assert_eq!(c.id, b);
        assert_eq!(c.url, "https://b.test");
        assert_eq!(c.rect, area());
        assert!(c.visible);
        assert_eq!(
            ids(&p.hide),
            vec![a.as_str()],
            "the outgoing pane is hidden"
        );
        assert!(p.show.is_empty() && p.place.is_empty() && p.discard.is_empty());
        assert!(!v.live[&a].visible && v.live[&b].visible);
    }

    #[test]
    fn switching_back_reuses_the_existing_webview() {
        let (mut w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        let b = next(&mut w, "https://b.test");
        run(&w, &mut v);
        assert!(w.activate(&a, 3));
        let p = run(&w, &mut v);
        assert!(
            p.create.is_empty(),
            "switching back must not re-create: {p:?}"
        );
        assert_eq!(ids(&p.show), vec![a.as_str()]);
        assert_eq!(ids(&p.hide), vec![b.as_str()]);
        assert!(p.place.is_empty(), "the rect never changed");
        assert!(p.discard.is_empty());
        assert!(v.live[&a].visible && !v.live[&b].visible);
    }

    // ---------- overlay ----------

    #[test]
    fn overlay_hides_everything_and_closing_reveals_the_same_webviews() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        assert!(v.live[&a].visible && v.live[&b].visible);

        v.overlay = true;
        let p = run(&w, &mut v);
        assert_eq!(sorted(&p.hide), sorted(&[a.clone(), b.clone()]));
        assert!(p.create.is_empty() && p.place.is_empty() && p.show.is_empty());
        assert!(!v.live[&a].visible && !v.live[&b].visible);

        v.overlay = false;
        let p = run(&w, &mut v);
        assert!(
            p.create.is_empty(),
            "the webviews were only hidden, not freed"
        );
        assert_eq!(sorted(&p.show), sorted(&[a.clone(), b.clone()]));
        assert!(p.hide.is_empty() && p.place.is_empty());
        assert!(v.live[&a].visible && v.live[&b].visible);
    }

    #[test]
    fn overlay_only_suppresses_panes_not_want_live_webviews() {
        let (mut w, _a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        v.overlay = true;
        v.want_live.insert(b.clone());
        let p = run(&w, &mut v);
        assert_eq!(created(&p), vec![b.as_str()]);
        assert!(
            !create_of(&p, &b).visible,
            "an overlay must never leave a webview on screen"
        );
        assert!(p.show.is_empty() && p.hide.is_empty() && p.place.is_empty());
        assert!(!v.live[&b].visible);
    }

    // ---------- bounds ----------

    #[test]
    fn bounds_change_replaces_the_webview_without_creating() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        let moved = Rect::new(10.0, 20.0, 800.0, 500.0);
        v.bounds = moved;
        let p = run(&w, &mut v);
        assert!(
            p.create.is_empty() && p.show.is_empty() && p.hide.is_empty() && p.discard.is_empty()
        );
        assert_place(&p, &[(a.clone(), moved)], "bounds change");
        assert_eq!(v.live[&a].rect, moved);
    }

    #[test]
    fn unchanged_bounds_plan_nothing() {
        let (w, _a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.bounds = area();
        assert!(run(&w, &mut v).is_empty());
    }

    // ---------- viewport emulation ----------

    #[test]
    fn emulation_shrinks_and_centres_the_pane() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.emulation.insert(a.clone(), (390.0, 844.0));
        let p = run(&w, &mut v);
        let want = Rect::new(305.0, 0.0, 390.0, 600.0);
        assert_place(&p, &[(a.clone(), want)], "emulated pane");
        assert_eq!(v.live[&a].rect, want);
    }

    #[test]
    fn emulation_clamps_to_a_pane_smaller_than_the_preset() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.bounds = Rect::new(0.0, 0.0, 300.0, 200.0);
        v.emulation.insert(a.clone(), (390.0, 844.0));
        let p = run(&w, &mut v);
        let want = Rect::new(0.0, 0.0, 300.0, 200.0);
        assert_place(
            &p,
            &[(a.clone(), want)],
            "emulated pane clamped to the pane",
        );
        assert_eq!(v.live[&a].rect, want);
    }

    #[test]
    fn clearing_emulation_replaces_the_pane_back_to_full_size() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.emulation.insert(a.clone(), (390.0, 844.0));
        run(&w, &mut v);
        v.emulation.remove(&a);
        let p = run(&w, &mut v);
        assert_place(&p, &[(a.clone(), area())], "emulation cleared");
        assert_eq!(v.live[&a].rect, area());
    }

    #[test]
    fn emulation_does_not_touch_tabs_that_are_not_panes() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        v.want_live.insert(b.clone());
        run(&w, &mut v);
        v.emulation.insert(b.clone(), (390.0, 844.0));
        let p = run(&w, &mut v);
        assert!(
            p.is_empty(),
            "a background webview has no pane to emulate: {p:?}"
        );
        assert_eq!(
            v.live[&b].rect,
            area(),
            "the hidden webview keeps the content bounds"
        );
        assert_eq!(v.live[&a].rect, area());
    }

    #[test]
    fn emulation_is_applied_per_pane_inside_a_split() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        // A 390px-wide viewport centred inside a 498px-wide left pane.
        v.emulation.insert(a.clone(), (390.0, 844.0));
        let p = run(&w, &mut v);
        assert_place(
            &p,
            &[(a.clone(), Rect::new(54.0, 0.0, 390.0, 600.0))],
            "emulated split pane",
        );
        assert_eq!(
            v.live[&b].rect,
            Rect::new(502.0, 0.0, 498.0, 600.0),
            "the neighbour is untouched"
        );
    }

    // ---------- internal pages ----------

    #[test]
    fn internal_page_active_means_nothing_visible() {
        let (w, a) = ws(NEW_TAB_URL);
        let mut v = view();
        let p = run(&w, &mut v);
        assert!(p.is_empty(), "the shell draws internal pages itself: {p:?}");
        assert!(v.live.is_empty());
        assert!(desired_panes(&w, &v).is_empty());
        let _ = a;
    }

    #[test]
    fn navigating_a_live_tab_to_an_internal_page_discards_it() {
        let (mut w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        w.update_tab(&a, Some("athanor://settings"), None, None);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![a.as_str()]);
        assert!(
            p.create.is_empty() && p.show.is_empty() && p.hide.is_empty(),
            "a discarded webview is not also hidden"
        );
        assert!(v.live.is_empty());
    }

    #[test]
    fn navigating_back_out_of_an_internal_page_creates_a_fresh_webview() {
        let (mut w, a) = ws(NEW_TAB_URL);
        let mut v = view();
        run(&w, &mut v);
        w.update_tab(&a, Some("https://a.test"), None, None);
        let p = run(&w, &mut v);
        let c = only(&p);
        assert_eq!(c.id, a);
        assert_eq!(c.url, "https://a.test");
        assert!(c.visible);
        assert!(v.live[&a].visible);
    }

    #[test]
    fn an_internal_tab_inside_a_split_keeps_its_placeholder_rect_and_is_discarded() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        let left = Rect::new(0.0, 0.0, 498.0, 600.0);
        w.update_tab(&b, Some("athanor://history"), None, None);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![b.as_str()]);
        assert!(
            p.create.is_empty() && p.place.is_empty() && p.show.is_empty() && p.hide.is_empty()
        );
        assert_eq!(
            v.live[&a].rect, left,
            "the tree keeps the internal page's placeholder slot"
        );
    }

    // ---------- archive / close ----------

    #[test]
    fn archived_background_tab_is_discarded_and_recreated_on_activation() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        v.want_live.insert(b.clone());
        let p = run(&w, &mut v);
        assert_eq!(created(&p), sorted(&[a.clone(), b.clone()]));
        assert!(!v.live[&b].visible, "a want_live webview starts hidden");

        set_archived(&mut w, &b, true);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![b.as_str()]);
        assert!(!v.live.contains_key(&b), "the renderer is gone");

        assert!(w.activate(&b, 5), "activating un-archives");
        assert!(!w.tab(&b).unwrap().archived);
        let p = run(&w, &mut v);
        assert_eq!(created(&p), vec![b.as_str()]);
        assert!(
            v.live[&b].visible,
            "the re-created webview is the new active pane"
        );
        assert_eq!(ids(&p.hide), vec![a.as_str()]);
    }

    #[test]
    fn a_discarded_tab_is_not_also_hidden() {
        let (mut w, _a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        v.want_live.insert(b.clone());
        run(&w, &mut v);
        set_archived(&mut w, &b, true);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![b.as_str()]);
        assert!(
            p.hide.is_empty(),
            "the renderer is gone, there is nothing left to hide"
        );
    }

    /// An archived split leaf is not a desired pane: the same plan must not discard the
    /// renderer and then immediately re-create it. It comes back when it is activated
    /// (which un-archives) or the split is left.
    #[test]
    fn archived_split_pane_is_discarded_and_stays_discarded() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        set_archived(&mut w, &b, true);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![b.as_str()]);
        assert!(
            p.create.is_empty(),
            "an archived leaf must not be re-created: {p:?}"
        );
        assert!(p.hide.is_empty(), "a still-visible pane keeps the screen");
        assert!(v.live.contains_key(&a) && v.live[&a].visible);
        assert!(!v.live.contains_key(&b));
        assert!(
            run(&w, &mut v).is_empty(),
            "the plan settles instead of churning"
        );
        assert_eq!(
            desired_panes(&w, &v),
            vec![(a, Rect::new(0.0, 0.0, 498.0, 600.0))],
            "only the live half of the split stays on screen"
        );
    }

    /// Same for the active tab: an archived active tab owns no webview at all.
    #[test]
    fn archived_active_tab_is_discarded_and_stays_discarded() {
        let (mut w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        set_archived(&mut w, &a, true);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![a.as_str()]);
        assert!(
            p.create.is_empty(),
            "an archived active tab must not be re-created: {p:?}"
        );
        assert!(v.live.is_empty());
        assert!(desired_panes(&w, &v).is_empty());
        assert!(
            run(&w, &mut v).is_empty(),
            "the plan settles instead of churning"
        );
        // Activating un-archives and the pane comes back.
        assert!(w.activate(&a, 5));
        let p = run(&w, &mut v);
        assert_eq!(created(&p), vec![a.as_str()]);
        assert!(create_of(&p, &a).visible);
    }

    #[test]
    fn closed_tab_missing_from_the_workspace_is_discarded() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        v.want_live.insert(b.clone());
        run(&w, &mut v);
        assert!(w.close_tab(&b).removed);
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![b.as_str()]);
        assert!(p.create.is_empty());
        assert_eq!(v.live.keys().cloned().collect::<Vec<_>>(), vec![a]);
    }

    #[test]
    fn discarding_a_tab_takes_its_want_live_request_with_it() {
        let (w, _a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.live.insert(
            "ghost".into(),
            Live {
                visible: true,
                rect: area(),
            },
        );
        v.want_live.insert("ghost".into());
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec!["ghost"]);
        assert!(
            !v.want_live.contains("ghost"),
            "the request dies with the renderer"
        );
        assert!(p.create.is_empty() && p.hide.is_empty());
    }

    // ---------- split ----------

    #[test]
    fn split_two_panes_lays_out_both_and_leaves_other_tabs_alone() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let c = bg(&mut w, "https://c.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.activate(&c, 3));
        run(&w, &mut v);
        assert!(v.live[&c].visible && !v.live[&a].visible);

        assert!(w.split_with(&b, Dir::Row, false));
        let p = run(&w, &mut v);
        let left = Rect::new(0.0, 0.0, 498.0, 600.0);
        let right = Rect::new(502.0, 0.0, 498.0, 600.0);
        let cr = only(&p);
        assert_eq!(cr.id, b);
        assert_eq!(cr.rect, right);
        assert!(cr.visible);
        assert_place(&p, &[(c.clone(), left)], "two-pane split");
        assert!(p.discard.is_empty() && p.show.is_empty());
        assert!(
            p.hide.is_empty(),
            "the third tab was hidden by the activation and stays hidden"
        );
        assert_eq!(v.live[&c].rect, left);
        assert_eq!(v.live[&b].rect, right);
        assert!(!v.live[&a].visible);
    }

    #[test]
    fn split_three_panes_nests_rows_and_columns() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let c = bg(&mut w, "https://c.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        assert!(w.split_with(&c, Dir::Column, false));
        let p = run(&w, &mut v);
        let a_rect = Rect::new(0.0, 0.0, 498.0, 600.0);
        let b_rect = Rect::new(502.0, 0.0, 498.0, 298.0);
        let c_rect = Rect::new(502.0, 302.0, 498.0, 298.0);
        assert_eq!(
            created(&p),
            sorted(&[b.clone(), c.clone()]),
            "both new panes are created visible"
        );
        assert_close(create_of(&p, &b).rect, b_rect);
        assert_close(create_of(&p, &c).rect, c_rect);
        assert_place(
            &p,
            &[(a.clone(), a_rect)],
            "only the pane that moved is placed",
        );
        assert!(p.show.is_empty() && p.hide.is_empty());
        assert_eq!(v.live[&a].rect, a_rect);
        assert_eq!(v.live[&b].rect, b_rect);
        assert_eq!(v.live[&c].rect, c_rect);
    }

    #[test]
    fn splitting_a_column_stack_uses_the_full_height() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Column, false));
        let p = run(&w, &mut v);
        assert_eq!(only(&p).rect, Rect::new(0.0, 302.0, 1000.0, 298.0));
        assert_place(
            &p,
            &[(a.clone(), Rect::new(0.0, 0.0, 1000.0, 298.0))],
            "column split",
        );
    }

    #[test]
    fn unsplitting_restores_a_single_full_width_pane() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        w.unsplit();
        let p = run(&w, &mut v);
        assert!(p.create.is_empty());
        assert_place(&p, &[(a.clone(), area())], "unsplit");
        assert_eq!(ids(&p.hide), vec![b.as_str()]);
        assert_eq!(v.live[&a].rect, area());
        assert!(!v.live[&b].visible);
    }

    #[test]
    fn a_split_that_does_not_contain_the_active_tab_falls_back_to_one_pane() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let c = bg(&mut w, "https://c.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Row, false));
        run(&w, &mut v);
        assert!(
            w.activate(&c, 9),
            "c is active but is not a pane of the split"
        );
        let p = run(&w, &mut v);
        let cr = only(&p);
        assert_eq!(cr.id, c);
        assert_eq!(
            cr.rect,
            area(),
            "no split: the active tab takes the whole content area"
        );
        assert_eq!(sorted(&p.hide), sorted(&[a.clone(), b.clone()]));
        assert!(p.place.is_empty());
    }

    // ---------- want_live ----------

    #[test]
    fn want_live_creates_a_hidden_webview_once_and_clears_the_request() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        v.want_live.insert(b.clone());
        let p = run(&w, &mut v);
        let c = only(&p);
        assert_eq!(c.id, b);
        assert_eq!(c.url, "https://b.test");
        assert!(!c.visible);
        assert_eq!(
            c.rect,
            area(),
            "a background webview is sized to the content area"
        );
        assert!(!v.live[&b].visible && v.live[&a].visible);
        assert!(v.want_live.is_empty(), "the request is one-shot");
    }

    #[test]
    fn want_live_for_the_active_pane_creates_it_visible_and_only_once() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        v.want_live.insert(a.clone());
        let p = run(&w, &mut v);
        let c = only(&p);
        assert_eq!(c.id, a);
        assert!(c.visible, "the pane branch wins over the want_live branch");
        assert!(v.live[&a].visible);
    }

    #[test]
    fn a_repeated_want_live_does_not_create_a_second_webview() {
        let (mut w, _a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        v.want_live.insert(b.clone());
        run(&w, &mut v);
        v.want_live.insert(b.clone());
        let p = run(&w, &mut v);
        assert!(p.is_empty(), "{p:?}");
        assert_eq!(v.live.len(), 2);
    }

    /// A `want_live` request is one-shot even when the tab already owns a webview, so the set
    /// always shrinks back to empty instead of holding stale ids forever.
    #[test]
    fn want_live_for_an_already_live_tab_is_cleared() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.want_live.insert(a.clone());
        let p = run(&w, &mut v);
        assert!(p.is_empty(), "{p:?}");
        assert!(
            !v.want_live.contains(&a),
            "the tab already has its renderer, so the request dies"
        );
        assert!(v.live[&a].visible, "the pane is left as it was");
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Kind {
        Web,
        Internal,
        Archived,
        Missing,
    }

    /// Table for the whole `want_live` eligibility rule: kind of tab x request on/off.
    #[test]
    fn want_live_eligibility_table() {
        // (tab kind, want_live requested, created as a hidden webview?)
        let cases = [
            (Kind::Web, false, false),
            (Kind::Web, true, true),
            (Kind::Internal, false, false),
            (Kind::Internal, true, false),
            (Kind::Archived, false, false),
            (Kind::Archived, true, false),
            (Kind::Missing, false, false),
            (Kind::Missing, true, false),
        ];
        for (kind, request, expect_webview) in cases {
            let case = format!("{kind:?}/want_live={request}");
            let (mut w, _a) = ws("https://a.test");
            let subject = match kind {
                Kind::Web => Some(bg(&mut w, "https://b.test")),
                Kind::Internal => Some(bg(&mut w, "athanor://settings")),
                Kind::Archived => {
                    let id = bg(&mut w, "https://b.test");
                    set_archived(&mut w, &id, true);
                    Some(id)
                }
                Kind::Missing => None,
            };
            let id = subject.clone().unwrap_or_else(|| "missing".to_string());
            let mut v = view();
            if request {
                v.want_live.insert(id.clone());
            }
            let p = run(&w, &mut v);
            // the active web tab is always created; the subject tab only when eligible
            assert_eq!(
                p.create.len(),
                if expect_webview { 2 } else { 1 },
                "{case}: {p:?}"
            );
            assert_eq!(v.live.contains_key(&id), expect_webview, "{case}");
            if expect_webview {
                assert!(!create_of(&p, &id).visible, "{case}");
            }
            assert!(v.want_live.is_empty(), "{case}: the request is one-shot");
        }
    }

    // ---------- focus ----------

    #[test]
    fn focus_next_is_consumed_once() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.focus_next = true;
        let p = run(&w, &mut v);
        assert_eq!(p.focus.as_deref(), Some(a.as_str()));
        assert!(
            !v.focus_next,
            "the request is cleared even though it was honoured"
        );
        assert!(run(&w, &mut v).focus.is_none());
    }

    #[test]
    fn focus_next_is_ignored_when_nothing_is_visible() {
        // (case, mutate the workspace / view before the plan)
        let (mut w, a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        w.update_tab(&a, Some("athanor://newtab"), None, None);
        v.focus_next = true;
        let p = run(&w, &mut v);
        assert_eq!(ids(&p.discard), vec![a.as_str()]);
        assert!(
            p.focus.is_none(),
            "focus must not follow a discarded webview"
        );
        assert!(!v.focus_next, "consumed even when not honoured");

        let (w, _a) = ws("https://a.test");
        let mut v = view();
        run(&w, &mut v);
        v.overlay = true;
        v.focus_next = true;
        let p = run(&w, &mut v);
        assert!(p.focus.is_none(), "nothing is on screen to focus");
        assert!(!v.focus_next);
    }

    #[test]
    fn focus_next_picks_the_active_split_pane() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        let mut v = view();
        run(&w, &mut v);
        assert!(w.split_with(&b, Dir::Column, false));
        run(&w, &mut v);
        assert!(w.activate(&b, 7));
        v.focus_next = true;
        let p = run(&w, &mut v);
        assert_eq!(p.focus.as_deref(), Some(b.as_str()));
        let _ = a;
    }

    #[test]
    fn focus_is_never_produced_without_a_request() {
        let (w, a) = ws("https://a.test");
        let mut v = view();
        assert!(run(&w, &mut v).focus.is_none());
        assert!(!v.focus_next, "planning must not invent a focus request");
        assert!(run(&w, &mut v).focus.is_none());
        let _ = a;
    }

    // ---------- the invariant tying it together ----------

    /// The rects the plan applies are exactly the panes `desired_panes` reports.
    #[test]
    fn applied_geometry_matches_desired_panes() {
        let (mut w, a) = ws("https://a.test");
        let b = bg(&mut w, "https://b.test");
        assert!(w.split_with(&b, Dir::Row, false));
        for overlay in [false, true] {
            for preset in [None, Some((390.0, 844.0)), Some((1280.0, 800.0))] {
                let mut v = view();
                v.overlay = overlay;
                if let Some((pw, ph)) = preset {
                    v.emulation.insert(a.clone(), (pw, ph));
                }
                let panes = desired_panes(&w, &v);
                let p = run(&w, &mut v);
                for (id, rect) in &panes {
                    let applied = p
                        .create
                        .iter()
                        .find(|c| &c.id == id)
                        .map(|c| c.rect)
                        .or_else(|| p.place.iter().find(|(i, _)| i == id).map(|(_, r)| *r));
                    assert_close(
                        applied.unwrap_or_else(|| panic!("{id} neither created nor placed: {p:?}")),
                        *rect,
                    );
                }
                let touched = p.create.len() + p.place.len();
                assert_eq!(
                    touched,
                    panes.len(),
                    "overlay={overlay} preset={preset:?}: {p:?}"
                );
                assert!(p.discard.is_empty() && p.show.is_empty() && p.hide.is_empty());
            }
        }
    }
}

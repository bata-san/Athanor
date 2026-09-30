//! Split-view layout as a binary tree of panes. Pure geometry, no engine types.

use crate::Id;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dir {
    /// Panes sit side by side.
    Row,
    /// Panes are stacked.
    Column,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Leaf {
        tab: Id,
    },
    Split {
        dir: Dir,
        ratio: f64,
        a: Box<Node>,
        b: Box<Node>,
    },
}

const MIN_RATIO: f64 = 0.1;

/// A draggable divider between two panes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DividerInfo {
    /// Route from the root: `false` = first child, `true` = second.
    pub path: Vec<bool>,
    pub dir: Dir,
    pub rect: Rect,
    pub ratio: f64,
}

impl Node {
    pub fn leaf(tab: impl Into<Id>) -> Self {
        Node::Leaf { tab: tab.into() }
    }

    pub fn tabs(&self) -> Vec<&Id> {
        match self {
            Node::Leaf { tab } => vec![tab],
            Node::Split { a, b, .. } => {
                let mut v = a.tabs();
                v.extend(b.tabs());
                v
            }
        }
    }

    pub fn contains(&self, id: &str) -> bool {
        self.tabs().iter().any(|t| t.as_str() == id)
    }

    /// Resolve every leaf to a rectangle inside `area`, leaving `gap` pixels between panes.
    pub fn rects(&self, area: Rect, gap: f64) -> Vec<(Id, Rect)> {
        let mut out = Vec::new();
        self.walk(area, gap, &mut out);
        out
    }

    fn walk(&self, area: Rect, gap: f64, out: &mut Vec<(Id, Rect)>) {
        match self {
            Node::Leaf { tab } => out.push((tab.clone(), area)),
            Node::Split { dir, ratio, a, b } => {
                let r = ratio.clamp(MIN_RATIO, 1.0 - MIN_RATIO);
                match dir {
                    Dir::Row => {
                        let usable = (area.w - gap).max(0.0);
                        let wa = usable * r;
                        a.walk(Rect::new(area.x, area.y, wa, area.h), gap, out);
                        b.walk(
                            Rect::new(area.x + wa + gap, area.y, usable - wa, area.h),
                            gap,
                            out,
                        );
                    }
                    Dir::Column => {
                        let usable = (area.h - gap).max(0.0);
                        let ha = usable * r;
                        a.walk(Rect::new(area.x, area.y, area.w, ha), gap, out);
                        b.walk(
                            Rect::new(area.x, area.y + ha + gap, area.w, usable - ha),
                            gap,
                            out,
                        );
                    }
                }
            }
        }
    }

    /// Divider rectangles (each `gap` thick) matching what [`Node::rects`] lays out.
    pub fn dividers(&self, area: Rect, gap: f64) -> Vec<DividerInfo> {
        let mut out = Vec::new();
        self.walk_dividers(area, gap, &mut Vec::new(), &mut out);
        out
    }

    fn walk_dividers(
        &self,
        area: Rect,
        gap: f64,
        path: &mut Vec<bool>,
        out: &mut Vec<DividerInfo>,
    ) {
        let Node::Split { dir, ratio, a, b } = self else {
            return;
        };
        let r = ratio.clamp(MIN_RATIO, 1.0 - MIN_RATIO);
        let (area_a, area_b, rect) = match dir {
            Dir::Row => {
                let usable = (area.w - gap).max(0.0);
                let wa = usable * r;
                (
                    Rect::new(area.x, area.y, wa, area.h),
                    Rect::new(area.x + wa + gap, area.y, usable - wa, area.h),
                    Rect::new(area.x + wa, area.y, gap, area.h),
                )
            }
            Dir::Column => {
                let usable = (area.h - gap).max(0.0);
                let ha = usable * r;
                (
                    Rect::new(area.x, area.y, area.w, ha),
                    Rect::new(area.x, area.y + ha + gap, area.w, usable - ha),
                    Rect::new(area.x, area.y + ha, area.w, gap),
                )
            }
        };
        out.push(DividerInfo {
            path: path.clone(),
            dir: *dir,
            rect,
            ratio: r,
        });
        path.push(false);
        a.walk_dividers(area_a, gap, path, out);
        path.pop();
        path.push(true);
        b.walk_dividers(area_b, gap, path, out);
        path.pop();
    }

    /// Replace `target` leaf with a split holding `target` and `new_tab`.
    /// Returns false if `target` is not in the tree.
    pub fn split_leaf(&mut self, target: &str, new_tab: &str, dir: Dir, new_first: bool) -> bool {
        match self {
            Node::Leaf { tab } if tab == target => {
                let old = Node::leaf(tab.clone());
                let fresh = Node::leaf(new_tab);
                let (a, b) = if new_first {
                    (fresh, old)
                } else {
                    (old, fresh)
                };
                *self = Node::Split {
                    dir,
                    ratio: 0.5,
                    a: Box::new(a),
                    b: Box::new(b),
                };
                true
            }
            Node::Leaf { .. } => false,
            Node::Split { a, b, .. } => {
                a.split_leaf(target, new_tab, dir, new_first)
                    || b.split_leaf(target, new_tab, dir, new_first)
            }
        }
    }

    /// Remove a leaf, collapsing its parent. Returns `None` if the whole tree vanished.
    pub fn remove(self, id: &str) -> Option<Node> {
        match self {
            Node::Leaf { tab } => (tab != id).then_some(Node::Leaf { tab }),
            Node::Split { dir, ratio, a, b } => match (a.remove(id), b.remove(id)) {
                (Some(a), Some(b)) => Some(Node::Split {
                    dir,
                    ratio,
                    a: Box::new(a),
                    b: Box::new(b),
                }),
                (Some(x), None) | (None, Some(x)) => Some(x),
                (None, None) => None,
            },
        }
    }

    /// Set the divider ratio of the split reached by `path` (false = first child, true = second).
    pub fn set_ratio(&mut self, path: &[bool], value: f64) -> bool {
        match (self, path.split_first()) {
            (Node::Split { ratio, .. }, None) => {
                *ratio = value.clamp(MIN_RATIO, 1.0 - MIN_RATIO);
                true
            }
            (Node::Split { a, b, .. }, Some((second, rest))) => {
                if *second {
                    b.set_ratio(rest, value)
                } else {
                    a.set_ratio(rest, value)
                }
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> Rect {
        Rect::new(0.0, 0.0, 1000.0, 600.0)
    }

    #[test]
    fn single_leaf_fills_area() {
        let r = Node::leaf("a").rects(area(), 4.0);
        assert_eq!(r, vec![("a".to_string(), area())]);
    }

    #[test]
    fn row_split_halves_with_gap() {
        let mut n = Node::leaf("a");
        assert!(n.split_leaf("a", "b", Dir::Row, false));
        let r = n.rects(area(), 4.0);
        assert_eq!(r[0].1, Rect::new(0.0, 0.0, 498.0, 600.0));
        assert_eq!(r[1].1, Rect::new(502.0, 0.0, 498.0, 600.0));
    }

    #[test]
    fn nested_split_and_remove_collapses() {
        let mut n = Node::leaf("a");
        n.split_leaf("a", "b", Dir::Row, false);
        n.split_leaf("b", "c", Dir::Column, false);
        assert_eq!(n.tabs().len(), 3);
        let n = n.remove("b").unwrap();
        assert_eq!(n.tabs().len(), 2);
        let n = n.remove("a").unwrap();
        assert_eq!(n, Node::leaf("c"));
        assert!(n.remove("c").is_none());
    }

    #[test]
    fn ratio_is_clamped() {
        let mut n = Node::leaf("a");
        n.split_leaf("a", "b", Dir::Row, false);
        assert!(n.set_ratio(&[], 0.99));
        let r = n.rects(area(), 0.0);
        assert!((r[0].1.w - 900.0).abs() < 1e-9);
        assert!(!Node::leaf("x").set_ratio(&[], 0.5));
    }

    #[test]
    fn dividers_sit_between_panes() {
        let mut n = Node::leaf("a");
        n.split_leaf("a", "b", Dir::Row, false);
        n.split_leaf("b", "c", Dir::Column, false);
        let d = n.dividers(area(), 4.0);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].path, Vec::<bool>::new());
        assert_eq!(d[0].rect, Rect::new(498.0, 0.0, 4.0, 600.0));
        assert_eq!(d[1].path, vec![true]);
        assert_eq!(d[1].dir, Dir::Column);
        assert_eq!(d[1].rect, Rect::new(502.0, 298.0, 498.0, 4.0));
    }

    #[test]
    fn new_first_puts_new_tab_before() {
        let mut n = Node::leaf("a");
        n.split_leaf("a", "b", Dir::Row, true);
        assert_eq!(n.tabs(), vec!["b", "a"]);
    }
}

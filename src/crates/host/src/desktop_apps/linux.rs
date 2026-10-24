//! Packaged application IDs are Windows' alone: no client's app is opened from
//! the HUD here yet.

pub(super) fn installed(_id: &str) -> bool {
    false
}

pub(super) fn double_click_ms() -> u32 {
    500
}

pub(super) fn open(_id: &str) -> Result<(), String> {
    Err("Opening a client's desktop app from the HUD is not implemented on this host".into())
}

//! Packaged apps through the Windows app model: installed when the current
//! user has the package family, brought forward through a visible window of
//! one of the family's processes, otherwise started (or asked to show itself)
//! through the shell's activation manager, as Start does. Nothing is looked up
//! by path and no command line runs.
use windows::core::{BOOL, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HWND, LPARAM,
};
use windows::Win32::Storage::Packaging::Appx::{GetPackageFamilyName, GetPackagesByPackageFamily};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
use windows::Win32::UI::Shell::{
    ApplicationActivationManager, IApplicationActivationManager, AO_NONE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
};

/// A character package and application names allow.
fn allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')
}

/// The package family of an application ID, what precedes its `!`, when both
/// halves hold only the characters package and application names allow.
fn family(id: &str) -> Option<&str> {
    let (family, app) = id.split_once('!')?;
    let plain = |part: &str| !part.is_empty() && part.chars().all(allowed);
    (plain(family) && plain(app)).then_some(family)
}

pub(super) fn installed(id: &str) -> bool {
    let Some(family) = family(id) else {
        return false;
    };
    let (mut count, mut length) = (0u32, 0u32);
    // Without buffers the call only counts the current user's packages of the
    // family, and asks for room when there are any.
    let status = unsafe {
        GetPackagesByPackageFamily(&HSTRING::from(family), &mut count, None, &mut length, None)
    };
    (status == ERROR_INSUFFICIENT_BUFFER || status == ERROR_SUCCESS) && count > 0
}

pub(super) fn double_click_ms() -> u32 {
    unsafe { GetDoubleClickTime() }
}

pub(super) fn open(id: &str) -> Result<(), String> {
    let family = family(id).ok_or("The desktop app's ID is not valid")?;
    if let Some(window) = family_window(family) {
        // The HUD just took the double-click, so Windows lets it hand over
        // the foreground.
        unsafe {
            if IsIconic(window).as_bool() {
                let _ = ShowWindow(window, SW_RESTORE);
            }
            if SetForegroundWindow(window).as_bool() {
                return Ok(());
            }
        }
    }
    activate(id)
}

/// Starts the app, or has the running app show its window when it has none
/// on screen (closed to the tray), as Start does.
fn activate(id: &str) -> Result<(), String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
            .and_then(|manager: IApplicationActivationManager| {
                manager.ActivateApplication(&HSTRING::from(id), PCWSTR::null(), AO_NONE)
            });
        if initialized {
            CoUninitialize();
        }
        result
            .map(|_| ())
            .map_err(|error| format!("The desktop app could not be opened: {error}"))
    }
}

struct Search<'a> {
    family: &'a str,
    found: Option<HWND>,
}

/// A visible top-level window that one of the family's processes owns.
fn family_window(family: &str) -> Option<HWND> {
    let mut search = Search {
        family,
        found: None,
    };
    // Stopping at the first match makes EnumWindows report failure.
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
    search.found
}

unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
    let search = unsafe { &mut *(data.0 as *mut Search) };
    let shown = unsafe { IsWindowVisible(window) }.as_bool()
        && unsafe { GetWindow(window, GW_OWNER) }.is_err();
    if shown {
        let mut process = 0u32;
        unsafe { GetWindowThreadProcessId(window, Some(&mut process)) };
        if in_family(process, search.family) {
            search.found = Some(window);
            return false.into();
        }
    }
    true.into()
}

fn in_family(process: u32, family: &str) -> bool {
    process_family(process).is_some_and(|name| name.eq_ignore_ascii_case(family))
}

/// The package family of a process, when it runs from a package.
fn process_family(process: u32) -> Option<String> {
    if process == 0 {
        return None;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process) }.ok()?;
    // PACKAGE_FAMILY_NAME_MAX_LENGTH is 64 characters, with the terminator.
    let mut name = [0u16; 128];
    let mut length = name.len() as u32;
    let status =
        unsafe { GetPackageFamilyName(handle, &mut length, Some(PWSTR(name.as_mut_ptr()))) };
    let _ = unsafe { CloseHandle(handle) };
    (status == ERROR_SUCCESS).then(|| {
        let end = (length as usize).saturating_sub(1).min(name.len());
        String::from_utf16_lossy(&name[..end])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_application_id_names_its_family() {
        assert_eq!(
            family("Claude_pzs8sxrjxfjjc!Claude"),
            Some("Claude_pzs8sxrjxfjjc")
        );
        assert_eq!(
            family("OpenAI.Codex_2p2nqsd0c76g0!App"),
            Some("OpenAI.Codex_2p2nqsd0c76g0")
        );
    }

    #[test]
    fn anything_else_is_not_an_application_id() {
        for id in ["", "Claude", "!App", "C:\\x.exe!App", "a b!App", "a!b!c"] {
            assert_eq!(family(id), None, "{id}");
        }
    }

    #[test]
    fn an_unregistered_family_is_not_installed() {
        assert!(!installed("AgentHUD.Test.NotInstalled_0000000000000!App"));
    }
}

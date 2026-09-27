//! The zega engine for the iOS demo: the same calls the wasm binding exposes
//! (`zega-wasm/src/lib.rs`), over a C ABI the Swift app can link. Every entry
//! point returns a newly allocated C string the caller frees with
//! `zega_ios_free_string`, carrying an envelope: `{"ok": <value>}` on success
//! or `{"err": "<message>"}` on failure — the message is the same
//! `error.to_string()` text the wasm build throws.
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use zega::Zega;

#[cfg(test)]
mod tests;

pub struct ZegaHandle {
    inner: Zega,
}

fn json_envelope(result: Result<serde_json::Value, String>) -> *mut c_char {
    let text = match result {
        Ok(value) => serde_json::json!({ "ok": value }).to_string(),
        Err(message) => serde_json::json!({ "err": message }).to_string(),
    };
    CString::new(text).unwrap().into_raw()
}

fn read<'a>(ptr: *const c_char) -> &'a str {
    if ptr.is_null() {
        return "";
    }
    unsafe { CStr::from_ptr(ptr) }.to_str().unwrap_or("")
}

#[no_mangle]
pub extern "C" fn zega_ios_new() -> *mut ZegaHandle {
    match Zega::in_memory().build() {
        Ok(inner) => Box::into_raw(Box::new(ZegaHandle { inner })),
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `handle` must come from `zega_ios_new` and be freed at most once.
#[no_mangle]
pub unsafe extern "C" fn zega_ios_free(handle: *mut ZegaHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// # Safety
/// `string` must come from one of this library's calls and be freed at most once.
#[no_mangle]
pub unsafe extern "C" fn zega_ios_free_string(string: *mut c_char) {
    if !string.is_null() {
        drop(CString::from_raw(string));
    }
}

/// The locations written in a ZQL document (the CSV files to load), as JSON.
///
/// # Safety
/// `source` must be a valid NUL-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn zega_ios_load_locations(source: *const c_char, document: bool) -> *mut c_char {
    let entry = if document {
        zega::ZqlEntryPoint::File
    } else {
        zega::ZqlEntryPoint::Statement
    };
    let result = zega::zql_load_locations(entry, read(source))
        .map(|locations| serde_json::json!(locations))
        .map_err(|e| e.to_string());
    json_envelope(result)
}

/// Apply a `.zql` document with the raw source texts of its locations (JSON
/// object keyed by location). Returns the applied value as JSON.
///
/// # Safety
/// All pointers must be valid NUL-terminated UTF-8 strings; `handle` must be live.
#[no_mangle]
pub unsafe extern "C" fn zega_ios_apply_with_sources(
    handle: *const ZegaHandle,
    source: *const c_char,
    sources: *const c_char,
) -> *mut c_char {
    let sources: Result<_, String> =
        serde_json::from_str(read(sources)).map_err(|e: serde_json::Error| e.to_string());
    let result = sources.and_then(|sources| {
        unsafe { &*handle }
            .inner
            .apply_zql_with_sources(read(source), &sources)
            .map_err(|e| e.to_string())
    });
    json_envelope(result)
}

/// Run one ZQL read query against the schema document text. Returns the rows
/// as JSON — the same call the web demo makes as `run(schema, zql)`.
///
/// # Safety
/// All pointers must be valid NUL-terminated UTF-8 strings; `handle` must be live.
#[no_mangle]
pub unsafe extern "C" fn zega_ios_run(
    handle: *const ZegaHandle,
    schema: *const c_char,
    zql: *const c_char,
) -> *mut c_char {
    let result = unsafe { &*handle }
        .inner
        .run_lang(read(schema), read(zql))
        .map_err(|e| e.to_string());
    json_envelope(result)
}

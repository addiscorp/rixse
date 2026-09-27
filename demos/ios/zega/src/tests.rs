// End-to-end on the host: the same envelope + engine calls the iOS app makes,
// over the real movies samples bundled with the web demo. The iOS staticlibs
// share this exact code path.
use std::ffi::{CStr, CString};

fn c(s: &str) -> CString {
    CString::new(s).unwrap()
}

fn envelope(ptr: *mut std::os::raw::c_char) -> serde_json::Value {
    assert!(!ptr.is_null());
    let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_owned();
    unsafe { super::zega_ios_free_string(ptr) };
    serde_json::from_str(&text).unwrap()
}

#[test]
fn load_apply_and_query_the_movies_samples() {
    // Locations are written relative to the zega root (e.g. "./samples/…"),
    // exactly like the web demo fetches them.
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../canvas/public/zega");
    let source = std::fs::read_to_string(format!("{dir}/samples/movies.zql")).unwrap();

    // The locations the document writes (the CSVs), then the document applied
    // with their raw texts — the same load sequence as the web demo.
    let locations = envelope(unsafe { super::zega_ios_load_locations(c(&source).as_ptr(), true) });
    let locations = locations["ok"].as_array().expect("locations envelope");
    assert!(!locations.is_empty());
    let mut sources = serde_json::Map::new();
    for loc in locations {
        let loc = loc.as_str().unwrap();
        let path = format!("{dir}/{}", loc.trim_start_matches("./"));
        sources.insert(loc.to_string(), serde_json::Value::String(std::fs::read_to_string(path).unwrap()));
    }
    let sources_json = c(&serde_json::Value::Object(sources).to_string());

    let handle = super::zega_ios_new();
    assert!(!handle.is_null());
    let applied = envelope(unsafe { super::zega_ios_apply_with_sources(handle, c(&source).as_ptr(), sources_json.as_ptr()) });
    assert!(applied.get("err").is_none(), "apply failed: {applied}");

    // A real query, shaped like the demo's: Titanic's box office.
    let rows = envelope(unsafe {
        super::zega_ios_run(handle, c(&source).as_ptr(), c("{ Movie(title findLike \"Titanic\") limit 100000 { title gross } }").as_ptr())
    });
    let rows = rows["ok"].as_array().expect("run envelope");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["title"], "Titanic");
    assert!(rows[0]["gross"].as_i64().unwrap() > 1_000_000_000);

    // And an error comes back as the message the hint rewrites.
    let bad = envelope(unsafe {
        super::zega_ios_run(handle, c(&source).as_ptr(), c("{ Movie(title findLike \"Titanic\") limit 100000 { title genres } }").as_ptr())
    });
    let err = bad["err"].as_str().expect("bad query should error");
    assert!(err.contains("genres"), "unexpected error: {err}");

    unsafe { super::zega_ios_free(handle) };
}

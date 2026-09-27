// The zega engine for the iOS demo (zega-ios Rust crate). Every call returns
// a newly allocated C string carrying an envelope — {"ok": <value>} or
// {"err": "<message>"} — that the caller frees with zega_ios_free_string.
#ifndef ZEGA_IOS_H
#define ZEGA_IOS_H

#include <stdbool.h>

typedef struct ZegaHandle ZegaHandle;

ZegaHandle *zega_ios_new(void);
void zega_ios_free(ZegaHandle *handle);
void zega_ios_free_string(char *string);

/// The locations written in a ZQL document (the files to load), as JSON.
char *zega_ios_load_locations(const char *source, bool document);

/// Apply a `.zql` document with the raw texts of its locations (JSON keyed by
/// location). Returns the applied value as JSON.
char *zega_ios_apply_with_sources(const ZegaHandle *handle, const char *source, const char *sources);

/// Run one ZQL read query against the schema document text. Returns the rows
/// as JSON — the same call the web demo makes as run(schema, zql).
char *zega_ios_run(const ZegaHandle *handle, const char *schema, const char *zql);

#endif

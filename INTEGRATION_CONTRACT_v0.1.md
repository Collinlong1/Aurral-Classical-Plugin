# Integration contract — implemented Phase 1 and future v0.1 design

Current APIs and compatibility are defined in the Implemented Phase 1 contract section at the end: user-operations v1 and acquisition-identity v1. Core PR36 and plugin PR6 implement only those portions. Earlier sections below are historical proposals; views, model, grouping and segment APIs are not implemented.

Status update: Phase 0.5 preservation completed; this remains a proposal, with no classical implementation or migration. Phase 1 approval is pending. Runtime validation now includes Node 26.12.0; see PHASE_05_REPORT.md for exact results and remaining baseline issues.

Status: draft. This contract is not available in the frozen stock or fork source. Existing manifest API remains `api: 1`; proposed hooks negotiate their own versions. Names below are illustrative until Phase 1 freezes schemas. See the main report's static compatibility matrix; no running stock/fork compatibility test was performed.

## Initialization, capabilities and fallback

Host handshake proposal: `{contract:"aurral.plugin-integration",version:"0.1.0",hostBuild:{commit,apiVersion},pluginApi:1,capabilities:{"views.v1":{enabled:true},"userOperations.v1":{enabled:true},"localTrackRefs.v1":{enabled:true},"albumPresentation.v1":{enabled:true},"queueSegments.v1":{enabled:true},"librarySnapshot.v1":{enabled:true}}}`. Each capability independently negotiated and opt-in; distinguish unsupported, administrator-disabled, permission-denied and temporary-unavailable. Unknown optional fields ignored; unknown major version/missing required capability rejected for that feature. Do not call guessed URLs as a capability probe. Older API-1 plugins keep their existing behavior.

The plugin exports declarative descriptors and data handlers through the existing host process, never its own HTTP service. The host mounts same-origin authenticated view/resources, validates input/output and enforces CSP. Plugin UI assets remain bundled with the plugin. UI gets no filesystem path, admin API key or provider secret. Browser requests use native session auth and core CSRF protection. Plugin settings/metadata mutations require current admin authorization; browsing and playback use real current users.

On current stock/fork without `views.v1`, model/job back-end can run but **editor/work page/diagnostics UI are unavailable**. Show a host-level missing-capability notice and hide entry points needing those hooks; do not claim spec-compliant stock fallback. To meet the v1.0 stock promise, obtain equivalent hooks upstream or explicitly renegotiate scope with the user. A separate web app/service is outside the architecture. Lack of grouped album UI returns ordinary album rows; lack of bounded playback hides segment-dependent play actions with an explanation. A provider outage still permits manual data and native playback where the host hooks exist.

## Trusted auth and user-scoped operations

Existing action `input.user` is trusted only because host builds it; API-key requests do not inherit it. Proposed host-issued opaque delegation token is bound to plugin ID, invocation/job correlation, real user ID, permitted operations, expiry, resource scope and idempotency key. It must be generated/verified in core and never constructed from a user-supplied body/header. Do not implement global user impersonation.

Use session context for interactive operations. For background work, persist an opaque core operation handle, not session cookies or reusable broad credentials. Recheck current user status, playlist ownership, blocked artists and acquisition permission before execution. Metadata mutation requires admin. Local browse/compare/queue/own-playlist needs normal library/playlist permissions, not acquisition permission. Acquisition follows existing Aurral permission. Admin pick is server-scoped; user pick/favourites are always user-scoped. A user losing permission before execution receives a terminal authorization error; no fallback to plugin admin authority.

## API data proposals

All inputs are versioned objects, bounded in size, validated by host and plugin. Common success: `{schemaVersion:1,data,revision}`; error: `{code,message,retryable,correlationId,details?}`. Common errors include `UNSUPPORTED_CAPABILITY`, `FORBIDDEN`, `STALE_REVISION`, `TRACK_UNAVAILABLE`, `AMBIGUOUS_LINK`, `PROVIDER_UNAVAILABLE`. Never include secrets or raw provider payloads in user errors. Optimistic writes carry `expectedRevision`; idempotent retries carry a stable request key. Correct state conflicts return 409, auth 401/403, unavailable dependency 503; do not count expected user/data errors as broken-plugin crashes.

Proposed native reference: `{kind:"library",instanceId,trackId,fileId?,placement:{albumId,discNumber,trackNumber}?,revision?,range:{startMs,endMs}?}`. IDs opaque across wire, including numeric IDs serialized consistently; MBID is evidence, not playable identity. No arbitrary path accepted from browser. A privileged backward-compatible path input is resolved under existing core indexing/access rules and normalized to the same reference. Specifying `fileId` matters for different encodings/duplicates/segments; coordinates are file-local.

Playlist operation proposal: `{schemaVersion:1,requestId,name,tracks:[nativeRef...],downloadMissing:false,expectedPlaylistRevision?}`. Owner comes from trusted context, not payload. Create/update/append use the same core resolver, check availability and path mappings, preserve explicit order and repeated range occurrences, and return `{operationId,state:"queued"}`. UI polls an existing or extended operation-status API to committed success/failure before claiming completion. Update is atomic with respect to playlist membership and rejects stale refs rather than silently initiating acquisition.

Work-page proposal response: `{schemaVersion:1,work:{id,title,composers,catalogueNumbers,movements},recordings:[{id,realizationId,performerCredits,releaseIds,artworkRef,date,durationMs,completeness,playPlanRef,isFavourite,pickScope}],page:{cursor,nextCursor,total},revision}`. Sort name/date/duration/popularity with stable ID tiebreak; oldest-first explicit. Counts/popularity must have documented user/global visibility and retention policy; existing play events can seed plugin counters, but historical core totals need public API verification before claiming complete ranking.

Album presentation proposal: `{schemaVersion:1,albumId,classification,groups:[{id,title,orderedNativeRefs,missingItems,playPlanRef}],trackDecorations:[{trackId,displayTitle,displayArtist}],supportsToggle}`. Only confirmed classical tracks get decorations; unsure/non-classical return no opinion. Core owns rendering, normal row actions and native playback. Preserve mixed album stock rows, native track IDs, disc structure, user By Work/By Track preference. No classical schema or composer-name parsing in core.

Queue operation proposal: `{schemaVersion:1,requestId,mode:"replace"|"append"|"next",items:[nativeRef...],source:{pluginId,opaquePlanId}}`. Resolve at enqueue and at playback. For bounded ranges: seek to start after metadata is ready, stop/advance at end without playing rest of track, clamp invalid changes only with explicit error policy, persist range across queue restore, handle seek/repeat/pause/next and duration displays. A multi-work file must not play unrelated ranges. Preserve ordinary queue semantics when ranges are absent. Plugin disable cannot make ordinary native queued items depend on plugin process availability.

## Track reconciliation protocol

Read the **public core library API** or proposed snapshot hook, never query Aurral SQLite. Snapshot has stable generation/cursor, track/file IDs, all album placements, availability, source/path mapping context, duration/size and any stable file identifiers that core exposes. If missing evidence can be safely read from a supported library path, collect it in plugin jobs; D06 adds only fields public APIs cannot supply. An interrupted page traversal is not proof of deletion.

1. Bind to a core installation identity and library generation. Verify an existing ID still agrees with its evidence; IDs can be reused after DB replacement/restore.
2. Prefer exact unchanged core track/file identity plus consistent evidence. A unique stable file identifier or strong content evidence can support a move. Path+size+duration is supporting evidence, not universal identity.
3. For missing IDs, score candidates with previous path, stable file ID where meaningful, duration, size, recording/release tags and optional versioned audio fingerprint. Matching only a recording MBID cannot choose among encodings/reissues. Never infer a move from matching title alone.
4. If exactly one high-confidence candidate passes documented evidence rules, transactionally update the link and append audit history. If several candidates qualify, retain old link as ambiguous and queue review. Missing files become unavailable, not deleted catalogue entities.
5. Full scan completion alone can mark unseen old evidence unavailable. Provider refresh never rewrites manual links/pins. Review decisions survive retries; a changed candidate revision invalidates a stale approval.
6. Deduplicate playback at the recording/realization level with explicit release preference. Preserve every physical file link and release association. A retag changes file size/mtime without proving the audio changed; optional fingerprints are audio-based and versioned.

Acceptance: rename, folder move, retag, rescan, DB rebuild/restore, duplicate files, same recording on several releases, path mapping change, deleted/missing file, interrupted snapshot, duration disagreement and manual reattachment. Ambiguity never silently reassigns audio; pinned metadata remains attached to catalogue identity rather than a volatile core ID.

## Persistent jobs and restart behavior

Use plugin-owned jobs/outbox tables (schema draft) and existing host schedule as a bounded executor. No permanent in-memory singleton or always-running service. Workers in multiple host processes claim jobs using short `BEGIN IMMEDIATE` transactions and lease generation/fencing. Each batch checkpoint is transactional. Never hold a DB lock across HTTP, audio I/O or playback requests.

States: queued → leased/running → succeeded; running → retry_wait → queued; running → review_required; queued/running/retry_wait → cancel_requested → cancelled; exhausted permanent errors → failed. Paused jobs retain cursor and resume explicitly. Heartbeats extend leases; expired leases can be reclaimed only with incremented generation; stale holders cannot commit results. Cancel between small file/provider batches and before side effects. Commit metadata only if input revision and lease generation still match.

Initial bounds proposal: one catalogue writer, two bounded file readers, one MusicBrainz request stream globally per configured public provider; respect ≥1 second across all plugin processes plus Retry-After. Explicit mirror limits configurable, never unlimited by assumption. Timeouts and backoff with jitter; separate malformed/404/deleted/provider-outage states; bound attempts and response sizes. Jobs remain below host action/schedule budgets and enqueue continuation. Cancellation cannot undo an already committed external effect; compensate or report accurately.

Outbox commits intended core playlist operations alongside job state. Reconcile with core operation status after restart using idempotency key; never create duplicate playlists because response was lost. Local caches include provider version/ETag/TTL and source licence. Current file directory locks and JSON processed fingerprints are not sufficient fencing for the new model.

Identification begins only after admin action; enabling reads and advertises capabilities. Provider refresh/identification/rescan are admin jobs; user playlists and picks retain the initiating user. Playback never waits for identification or provider requests. Minimal diagnostics exposes queued/running/review/failed counts and reason codes to admin in v0.1; full pause/progress UI may mature later, but durable cancellation/recovery is infrastructure now.

## Compatibility acceptance

Test current stock with no hooks (honest missing UI), fork with each capability separately off, fork with complete hooks, old API-1 plugin under new host, plugin absent/disabled/crashed, and weekly latest-upstream drift. Use two users plus admin, synthetic mixed library and provider fixtures. Negative tests include forged user IDs/tokens, wrong playlist owner, revoked permissions, unsafe local ref, invalid segment and stale revision. Native playback/non-classical ranking must remain unchanged when plugin returns no opinion.
# Implemented Phase 1 contract — user-operations v1 / acquisition-identity v1

This section supersedes draft status only for the following interfaces. API manifest version remains 1; later sections describe future v0.1 design.

Action manifest localPlaylists:true opts into action input userOperations:{version:1,url,token}. Missing input means unsupported; never guess URLs or fall back to the broad admin key. Disabled action capabilities disappear from the host action menu. Grant errors return 401/403 and create no playlist. Tokens bind plugin/action/user/30-minute expiry, are never browser session cookies, and can only access the plugin's three local-operation routes. Requests require X-Action-Grant. Existing API-1 plugins without the opt-in are unchanged.

- GET URL/library returns {version:1,complete:true,library:{artists,albums,tracks}} with all available indexed files and optional mapped readPath. Incomplete or unreadable evidence cancels comparison; no deletions/reconciliation are inferred.
- POST URL/playlists accepts {key,name,tracks:[{path,artistName?,trackName?}]}. Owner and playlist ID are host-derived; paths must resolve to permitted available indexed files. It enqueues a local-only upsert and returns {queued:true,operationId,playlistId}. Stable ID is scoped by plugin/user/key. Existing DB queue records persist the grant, and execution rechecks current user/action/capability/expiry/ownership. Expired/revoked grants fail terminally.
- GET URL/jobs/ID returns own operation {state,error}. The plugin waits for done or reports failed/cancelled/pending explicitly. HTTP enqueue alone is never reported as completion.

Acquisition manifest downloadSource.acquisitionIdentity:true adds an independently switchable acquisitionIdentity capability under the existing enabled download source. Host calls downloadSource.acquisitionIdentity with track input before native Soulseek queries regardless of source priority. Return null for no opinion, {blocked:true} for known unresolved identity, or {artist,aliases,requiredTerms?}. Required terms are bounded strings, matched as normalized words in native result paths. Identity persists with search attempts, does not rewrite display artist, and does not bypass existing duration/quality/integrity checks. Provider errors hold acquisition; playback is independent. Disabled/absent hooks use stock behavior.

| Host | Phase 1 tag/source | User-owned local compare | Later editor/work/grouping/segments |
| --- | --- | --- | --- |
| Frozen stock API-1 | Existing actions/source; background media writes opt-in | Unsupported; explanatory error, no admin-owned fallback | Unavailable |
| Fork before Phase 1 | Same | Unsupported | Unavailable |
| Fork with Phase 1 review | Clear/restore/preview and performer queries | Supported for real admin/regular accounts; accessPlaylists required, acquisition permission unnecessary | Unavailable; future phases |
| Phase 1 fork, plugin disabled/no opinion | Stock playback/queries | Hidden/denied | Unavailable |

No SQL schema migration. No service/iframe/player replacement. No claim of the later full native-ref, view, cursor, optimistic revision or classical model interfaces yet.


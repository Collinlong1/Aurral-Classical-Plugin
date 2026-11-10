# Schema draft — classical data version 1 (proposal only)

Status update: Phase 0.5 preservation completed; this remains a proposal, with no classical implementation or migration. Phase 1 approval is pending. Existing-plugin test runtime validation now includes Node 26.12.0; standalone plugin SQLite volume/concurrency/migration validation remains pending; see PHASE_05_REPORT.md for exact results and remaining baseline issues.

No SQL or migrations executed. All tables below belong in the plugin's independent SQLite database. UUIDs are plugin-generated and never derived from provider IDs, titles, filenames or Aurral IDs. Every mutable row has `revision`, `created_at`, `updated_at`; deletions use tombstones where history/links matter. Time is UTC milliseconds. Date metadata uses partial ISO text plus precision, not invented January 1 dates.

## Entities and cardinalities

| Table | Key fields and constraints | Cardinality / purpose |
| --- | --- | --- |
| `entity` | `id PK`, `kind CHECK(person,ensemble,work,movement,collection,performance,recording,release)`, tombstone, revision | Common target for typed assertions/credits; subtype constraints checked in transactions |
| `person` | `entity_id PK/FK`, person kind | Composer is a person in composer role, not a separate incompatible identity; one person may compose, perform and conduct |
| `ensemble` | `entity_id PK/FK`, ensemble kind | Orchestra, choir, chamber ensemble; no artificial person record |
| `work` | `entity_id PK/FK`, work kind | Independent composition; zero external IDs allowed |
| `movement` | `entity_id PK/FK`, `work_id FK`, order key, number/display label; unique order within work | Work 1 → 0..N movements; a movement belongs to exactly one canonical work; independent pieces in an étude set are works, not movements |
| `collection` | `entity_id PK/FK`, collection kind, missing-member policy | Named collection/parent work, e.g. Op. 10; parent identity distinct from its independently playable works |
| `collection_member` | `(collection_id, member_id, occurrence) PK`, member kind work/collection, order key, required flag | Collections M:N works and collections; reject self membership and cycles; repeat occurrences intentional |
| `work_relation` | `id PK`, from/to work, kind arrangement/revision/related, evidence | Explicit relationships; never an implicit identity merge |
| `performance` | `entity_id PK/FK`, event type, date precision, venue | One interpretation/event can perform several works; a studio interpretation can span sessions, represented by optional `performance_session` children |
| `performance_work` | `id PK`, performance FK, work FK, occurrence, order | M:N performance/work; occurrence separates repeated performances of same work at an event |
| `recording` | `entity_id PK/FK`, capture/edit kind, optional duration | One audio capture or edit; remastered/edited identities explicit; not one recording per release or movement by assumption |
| `recording_performance` | `(recording_id,performance_id,occurrence) PK`, source order, optional capture offsets | M:N permits one event captured multiple times and one edited recording compiled from several events |
| `recording_relation` | from/to recording FK, relation capture-source/edit-of/remaster-of, evidence | Do not silently treat all edits as same recording; reversible explicit association |
| `recording_content` | `id PK`, recording FK, performance_work FK, optional movement FK, content ordinal, start/end ms in recording | Recording 1:N ordered content spans; supports multi-work recordings, repeated movements and partial captures; movement must belong to referenced work |
| `release` | `entity_id PK/FK`, publication kind | Publication/edition, not Aurral album identity and not the MB release group |
| `release_item` | `id PK`, release FK, disc, position, side, order; unique placement per release | Release 1:N physical/digital track slots |
| `release_item_recording` | `(release_item_id,recording_id,occurrence) PK`, item offsets, recording offsets | M:N releases/recordings through items; one recording on several releases; one release item can contain several recordings, a recording can span items |
| `track_link` | `id PK`, core instance ID, opaque Aurral track ID, optional file ID, chosen placement, state, revision | A plugin-owned link to a core playable identity; no FK into Aurral DB. Track IDs alone do not distinguish every physical duplicate/album placement |
| `track_release_item` | `(track_link_id,release_item_id) PK`, confidence/evidence | Many core items/encodings may realize one release slot, one track can have multiple catalogue associations; explicit chosen playback file avoids arbitrary duplicates |
| `segment` | `id PK`, track_link FK, start_ms, end_ms nullable only for whole-track/open end, occurrence, kind | Track 1:N playable bounded ranges; zero start valid; positive lengths; end ≤ known track duration; whole-track can use explicit kind |
| `segment_content` | `(segment_id,recording_content_id,occurrence) PK`, offsets | Links track-local audio to capture content; supports multiple works/movements per track and no forced one-track=one-movement rule |
| `realization` | `id PK`, work FK, performance_work FK, optional edition label | One concrete owned interpretation of a work; multiple releases may realize it, preventing mixes of movements from different performances |
| `realization_item` | `id PK`, realization FK, movement nullable, segment FK, sequence, repeat occurrence, completeness status | Ordered play plan within an interpretation. Null movement supports unsegmented work/single-movement piece; order is explicit, not title sorting |
| `credit` | `id PK`, target entity FK, contributor entity FK(person/ensemble), role FK, instrument/vocal-range nullable, display order, provenance assertion FK | M:N role-aware contributors for works, performances, recordings and releases; composer/soloist/conductor/orchestra/choir/arranger distinct; no parsing display ARTIST to recover roles |
| `role`, `instrument`, `period`, `form` | controlled keys plus version, labels/aliases | Versioned vocabulary; derived/unknown allowed; no provider's taxonomy treated as exhaustive |
| `entity_term` | entity FK, term vocabulary FK, assertion FK | M:N instrumentation/form and other classifications where valid |
| `alias` | id, entity FK, text, normalized text, language, alias kind, assertion FK | Many spellings/transliterations/nicknames per entity; normalized match is not identity equality |
| `catalogue_number` | id, work/collection FK, system, display, normalized key, component/ordinal, assertion FK | Multiple catalogue systems per work; normalize K./BWV/Hob./D./Op. numbers without global title merge |
| `external_identity` | entity FK, provider, provider entity kind, provider ID, state, evidence; active uniqueness per provider identity mapping | 0..N provider IDs per entity; provider merge/deletion does not delete local identity; conflicts go to review |

Subtype membership checks and foreign-key checks are transactionally validated. Use a unique active mapping per provider object unless an explicit relationship documents why that provider groups several local entities. A MusicBrainz movement-work ID maps to movement identity where appropriate, not automatically a parent work. Tracks are external links rather than catalogue entities, so field values on a track/album override use a typed local target registered for those link objects.

## Provenance and pinned overrides

`metadata_target(id PK, entity_id nullable, track_link_id nullable, core_album_ref nullable)` has exactly one target column set; unique target registration allows real FKs instead of unchecked `(type,id)` pointers. Album-specific artist and classification overrides attach here.

| Table | Required fields / invariants |
| --- | --- |
| `field_definition` | `(target_kind,field_key)`, typed scalar/list/object, empty-value semantics, validation version; role credits are structured relations, not a flat scalar |
| `assertion` | id PK, target FK, field key FK, **typed value JSON including empty string/empty array/null according to field definition**, source type provider/manual/derived, provider FK/record ID nullable, fetched_at, source_updated_at, confidence 0..1 nullable, author core user ref nullable, state active/stale/conflict/deleted, derivation rule version, prior assertion FK |
| `pinned_override` | `(target_id,field_key) PK`, assertion_id FK, pinned_by, pinned_at, revision; referenced assertion is manual and has matching field/target; **row existence means pinned**, including a deliberately blank value |
| `field_resolution` | `(target_id,field_key) PK`, chosen assertion FK, rule version, revision; materialized cache invalidated with inputs, not independent authority |
| `provider` | id PK, name, API/source URL, licence/notice URL, enabled, rate/cache policy version; no secrets in catalogue rows |
| `provider_record` | provider + record type + external ID + response version, cache hash, ETag, retrieved/expires times, HTTP status, licence/source URL; deleted/conflict data retained |
| `review_item` | id, kind, target, candidate assertions/identities/evidence, status, actor resolution, timestamps; no auto-merge on low confidence |
| `audit_event` | id, actor ref, action, target, before/after revision or diff, job/correlation ID, timestamp; secrets excluded |
| `merge_event`, `merge_member` | explicit survivor/retired IDs, before snapshots and redirected links, actor, inverse event; reversible until incompatible subsequent edits require conflict review |

Resolution is deterministic **per field**: pinned manual row → active provider assertions (MusicBrainz ahead of Open Opus where both actually supply that field; field-specific policy table) → unpinned manual → derived → unknown. Invalid, deleted or stale provider assertions do not silently substitute a conflicting value: retain last displayed value with stale/review status until policy explicitly resolves it. Pinning intentionally blank wins over every provider. 'Use provider value' removes only the pin, preserves manual history and recomputes resolution. Do not equate absent JSON key, SQL NULL and pinned blank. Lists/credit sets carry provenance per list item where contributors have different evidence; whole-list overrides replace intentionally and atomically.

Provider refresh appends/updates underlying assertions in a transaction and never updates pinned rows. Confidence is evidence, not proof; low-confidence identity matches create review items. Core favourites and role membership are never written directly.

## User state, classification and settings

- `core_user_ref(instance_id,user_id)` is an opaque reference, not a second user/password system. Resolve active status and role through core at request and job execution time. Retain historical deleted-user attribution without allowing login.
- `favourite(user_ref,target_entity_id,kind)` unique per user/entity; targets limited to work/recording/composer-person. A favourite and a pick are separate relations.
- `recording_pick(scope, user_ref nullable, work_id, realization_or_recording_id)` unique per work/scope owner. Scope `admin` requires NULL user; scope `user` requires real user. Pick's recording must realize the work. A user's pick overrides admin pick for that user's view only; show provenance label.
- `classification_decision(target_id,state classical/not_classical/unsure,score,evidence,rule_version,manual_pin)`; album and track independent decisions, track wins on mixed albums. `classification_rule(scope artist/folder/album/track,reference,decision,priority,pinned)` has deterministic specificity; explicit track decision > album > folder/artist rules > scored inference, conflicting equal-specificity rules become unsure. Manual pins survive rescans.
- `server_setting`, `user_setting`, `album_setting` store versioned typed settings and revision with validated scope. Role-aware search/acquisition ignores display artist setting.
- `playlist_link(user_ref,comparison_scope,target_id,core_playlist_id,last_operation_id,revision)` unique by user/target/scope; never discover ownership from playlist name.

## Reconciliation and job infrastructure tables

- `core_instance(id,installation_identity,library_epoch,last_complete_scan_token)` identifies a core DB installation, not hostname or server credential. Replacing/restoring core DB can invalidate track IDs; do not carry IDs to another instance implicitly.
- `track_evidence(track_link_id,scan_generation,path_canonical,path_display,size,duration_ms,mtime,file_stable_id nullable,recording_tag_ids,audio_fingerprint nullable,hash_kind/value nullable,observed_at)` preserves old observations; path-only/mtime evidence is never a globally stable ID.
- `reconciliation_candidate(link_id,scan_generation,candidate_core_id,file_id,score,reasons,status)` records ambiguous and rejected matches. `reconciliation_event` records before/after links; explicit review reassignment is reversible.
- `job(id,type,state,input_version,input_json,user_ref nullable,idempotency_key,scope_revision,priority,attempt,max_attempts,next_run_at,lease_owner,lease_until,lease_generation,cancel_requested,cursor,progress,error_code,created_at,updated_at)`; unique active idempotency key; see contract for transitions.
- `job_item(job_id,item_key,state,cursor,result_digest,error)`; unique item key; enables resumable bounded batches.
- `outbox(id,job_id,operation_kind,idempotency_key,state,payload_version,payload,core_operation_id,last_error)` atomically records intended side effects with model updates; no distributed transaction with core DB.
- `provider_rate_slot(provider,next_allowed_at,lease_generation)`, response cache metadata, `schema_version` and migration journal. Migration completion is committed with schema version; no SQL is included in this proposal.

## Playback and completeness invariants

Build a plan for one `realization`, not every track with the same title/work. Order canonical movements and explicit repeat occurrences; choose one reviewed playable segment per occurrence and preferred release/file. Missing movement is skipped with a visible report, never filled with another performance silently. Étude collection members are optional independent works; incompleteness applies only when a defined complete parent-work template makes members required. Reissues share the same recording identity when evidence supports it, but storage encodings and segment coordinates remain file-specific. Reject out-of-bounds ranges, unintended overlapping play spans, cycles, wrong-parent movement and duplicated sequence slots. Allow intentional repeated/overlapping artistic content only with explicit occurrence semantics. A work may have zero movements, zero owned realizations and no provider identities.

## Migration and rollback design

Forward-only plugin schema versions; exclusive migration lease plus short transactional schema changes; old code refuses newer unsupported versions without destructive downgrade. Before migration use consistent SQLite backup, validate restore on a fixture copy, then apply and run integrity/FK checks. Kill/failure must leave old schema or fully committed new schema; restart can safely resume the migration journal. Old JSON cache/index is optional evidence; import it idempotently only when provenance is known, preserve originals and exclusions, and never manufacture pinned data. Disable is not downgrade. Restoring a prior plugin version may require restoring its matching backup. Core schema is never altered by plugin migrations.

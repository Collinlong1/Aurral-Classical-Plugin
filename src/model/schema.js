// All SQL runs against classical.sqlite in the plugin's own dataFolder.
export const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE entity (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN
 ('person','ensemble','work','movement','collection','performance','recording','release')),
 data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)), revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE relation (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES entity(id),
 target_id TEXT NOT NULL REFERENCES entity(id), position INTEGER NOT NULL DEFAULT 1 CHECK(position>0),
 occurrence INTEGER NOT NULL DEFAULT 1 CHECK(occurrence>0), data TEXT NOT NULL CHECK(json_valid(data)),
 UNIQUE(kind,source_id,target_id,occurrence), UNIQUE(kind,source_id,position)
);
CREATE TABLE credit (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES entity(id),
 contributor_id TEXT NOT NULL REFERENCES entity(id), role TEXT NOT NULL,
 instrument TEXT, position INTEGER NOT NULL CHECK(position>0), assertion_id TEXT REFERENCES assertion(id),
 UNIQUE(target_id,contributor_id,role,instrument)
);
CREATE TABLE external_identity (
 entity_id TEXT NOT NULL REFERENCES entity(id), provider TEXT NOT NULL, record_kind TEXT NOT NULL,
 record_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','stale','deleted','conflict')),
 evidence TEXT NOT NULL CHECK(json_valid(evidence)), PRIMARY KEY(entity_id,provider,record_kind,record_id)
);
CREATE UNIQUE INDEX external_identity_active ON external_identity(provider,record_kind,record_id) WHERE state='active';
CREATE TABLE alias (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entity(id), text TEXT NOT NULL,
 normalized TEXT NOT NULL, language TEXT, kind TEXT NOT NULL, assertion_id TEXT REFERENCES assertion(id)
);
CREATE TABLE catalogue_number (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entity(id), system TEXT NOT NULL,
 display TEXT NOT NULL, normalized TEXT NOT NULL, assertion_id TEXT REFERENCES assertion(id)
);
CREATE TABLE core_instance (id TEXT PRIMARY KEY, epoch TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE track_link (
 id TEXT PRIMARY KEY, instance_id TEXT NOT NULL REFERENCES core_instance(id), core_id TEXT NOT NULL,
 file_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','missing','review')),
 evidence TEXT NOT NULL CHECK(json_valid(evidence)), revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX track_instance ON track_link(instance_id);
CREATE INDEX track_path ON track_link(json_extract(evidence,'$.path'));
CREATE INDEX track_read_path ON track_link(json_extract(evidence,'$.readPath'));
CREATE INDEX track_real_path ON track_link(json_extract(evidence,'$.observedRealPath'));
CREATE UNIQUE INDEX track_active ON track_link(instance_id,core_id,file_id) WHERE state='active';
CREATE TABLE track_evidence (
 id INTEGER PRIMARY KEY, track_link_id TEXT NOT NULL REFERENCES track_link(id), generation INTEGER NOT NULL,
 evidence TEXT NOT NULL CHECK(json_valid(evidence)), observed_at INTEGER NOT NULL
);
CREATE TABLE release_item (
 id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES entity(id), disc INTEGER NOT NULL CHECK(disc>0),
 position INTEGER NOT NULL CHECK(position>0), UNIQUE(release_id,disc,position)
);
CREATE TABLE release_item_recording (
 item_id TEXT NOT NULL REFERENCES release_item(id), recording_id TEXT NOT NULL REFERENCES entity(id),
 occurrence INTEGER NOT NULL CHECK(occurrence>0), start_ms INTEGER NOT NULL CHECK(start_ms>=0),
 end_ms INTEGER CHECK(end_ms>start_ms), PRIMARY KEY(item_id,recording_id,occurrence)
);
CREATE TABLE track_release_item (
 track_link_id TEXT NOT NULL REFERENCES track_link(id), item_id TEXT NOT NULL REFERENCES release_item(id),
 PRIMARY KEY(track_link_id,item_id)
);
CREATE TABLE recording_content (
 id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES entity(id),
 performance_work_id TEXT NOT NULL REFERENCES relation(id), movement_id TEXT REFERENCES entity(id),
 position INTEGER NOT NULL CHECK(position>0), start_ms INTEGER NOT NULL CHECK(start_ms>=0),
 end_ms INTEGER CHECK(end_ms>start_ms), UNIQUE(recording_id,position)
);
CREATE TABLE segment (
 id TEXT PRIMARY KEY, track_link_id TEXT NOT NULL REFERENCES track_link(id), start_ms INTEGER NOT NULL CHECK(start_ms>=0),
 end_ms INTEGER CHECK(end_ms>start_ms), kind TEXT NOT NULL CHECK(kind IN ('whole','range')),
 CHECK(kind='whole' OR end_ms IS NOT NULL)
);
CREATE TABLE segment_content (
 segment_id TEXT NOT NULL REFERENCES segment(id), content_id TEXT NOT NULL REFERENCES recording_content(id),
 occurrence INTEGER NOT NULL CHECK(occurrence>0), PRIMARY KEY(segment_id,content_id,occurrence)
);
CREATE TABLE realization (
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES entity(id), performance_work_id TEXT NOT NULL REFERENCES relation(id),
 label TEXT
);
CREATE TABLE realization_item (
 id TEXT PRIMARY KEY, realization_id TEXT NOT NULL REFERENCES realization(id), movement_id TEXT REFERENCES entity(id),
 segment_id TEXT NOT NULL REFERENCES segment(id), sequence INTEGER NOT NULL CHECK(sequence>0),
 occurrence INTEGER NOT NULL CHECK(occurrence>0), UNIQUE(realization_id,sequence)
);
CREATE TABLE metadata_target (
 id TEXT PRIMARY KEY, entity_id TEXT UNIQUE REFERENCES entity(id), track_link_id TEXT UNIQUE REFERENCES track_link(id),
 album_ref TEXT UNIQUE, CHECK((entity_id IS NOT NULL)+(track_link_id IS NOT NULL)+(album_ref IS NOT NULL)=1)
);
CREATE TABLE field_definition (key TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('string','number','array','object','boolean')));
INSERT INTO field_definition VALUES
 ('title','string'),('name','string'),('nickname','string'),('description','string'),('date','string'),
 ('period','string'),('form','string'),('key','string'),('catalogue','array'),('instrumentation','array'),
 ('artistDisplay','string'),('movementNumber','string'),('tempo','string'),('aliases','array');
CREATE TABLE assertion (
 id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES metadata_target(id), field TEXT NOT NULL REFERENCES field_definition(key),
 value TEXT NOT NULL CHECK(json_valid(value)), source TEXT NOT NULL CHECK(source IN ('manual','provider','derived')),
 provider TEXT, record_id TEXT, state TEXT NOT NULL CHECK(state IN ('active','stale','deleted','conflict','superseded')),
 confidence REAL CHECK(confidence BETWEEN 0 AND 1), actor TEXT, updated_at INTEGER NOT NULL,
 prior_id TEXT REFERENCES assertion(id), CHECK(source!='provider' OR (provider IS NOT NULL AND record_id IS NOT NULL))
);
CREATE INDEX assertion_field ON assertion(target_id,field,updated_at);
CREATE TABLE pinned_override (
 target_id TEXT NOT NULL REFERENCES metadata_target(id), field TEXT NOT NULL REFERENCES field_definition(key),
 assertion_id TEXT NOT NULL REFERENCES assertion(id), actor TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(target_id,field)
);
CREATE TABLE field_resolution (
 target_id TEXT NOT NULL REFERENCES metadata_target(id), field TEXT NOT NULL REFERENCES field_definition(key),
 assertion_id TEXT NOT NULL REFERENCES assertion(id), PRIMARY KEY(target_id,field)
);
CREATE TABLE provider_record (
 provider TEXT NOT NULL, record_id TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES metadata_target(id),
 state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(provider,record_id,target_id)
);
CREATE TABLE classification (
 target_id TEXT PRIMARY KEY REFERENCES metadata_target(id), state TEXT NOT NULL CHECK(state IN ('classical','not_classical','unsure')),
 pinned INTEGER NOT NULL CHECK(pinned IN (0,1)), score INTEGER NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 rule_version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE review_item (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX review_open ON review_item(kind,target_id) WHERE status='open';
CREATE TABLE audit_event (
 id INTEGER PRIMARY KEY, actor TEXT, action TEXT NOT NULL, target_id TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)), created_at INTEGER NOT NULL
);
CREATE TABLE model_job (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, key TEXT NOT NULL, input TEXT NOT NULL CHECK(json_valid(input)),
 state TEXT NOT NULL CHECK(state IN ('queued','running','retry','done','failed','cancelled')),
 progress TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(progress)), owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 generation INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
 next_run_at INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX job_active ON model_job(key) WHERE state IN ('queued','running','retry');
`,
  },
];

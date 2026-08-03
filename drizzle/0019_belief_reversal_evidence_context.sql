begin;

set local transaction isolation level read committed;

-- Fail before the first catalog mutation unless the exact 0018 owner/digest
-- prerequisite is present.  This intentionally precedes every LOCK/DDL.
do $prerequisite$
declare
  digest_schema text;
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and not rolcanlogin and not rolinherit and not rolsuper
      and not rolcreaterole and not rolcreatedb and not rolreplication
      and not rolbypassrls
  ) then
    raise exception 'VSEE_0019_REQUIRES_COMPLETE_0018_OWNER'
      using errcode = '55000';
  end if;

  select namespace.nspname into strict digest_schema
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as procedure_record on procedure_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and procedure_record.proname = 'digest'
    and procedure_record.proargtypes = '17 25'::oidvector;

  if not pg_catalog.has_schema_privilege(
    'vsee_registry_owner', digest_schema, 'USAGE'
  ) then
    raise exception 'VSEE_0019_REQUIRES_COMPLETE_0018_DIGEST_USAGE'
      using errcode = '55000';
  end if;
end;
$prerequisite$;

do $maintenance_locks$
declare
  app_table_name text;
begin
  foreach app_table_name in array array[
    'company_analyses', 'deals', 'intelligence_reports',
    'market_evidence_snapshot_events', 'market_evidence_snapshots',
    'market_events', 'reasoner_judgments', 'run_evidence_bindings',
    'run_market_events', 'scan_run_steps', 'scan_runs',
    'uploaded_documents', 'workspace_test_generations', 'workspaces'
  ] loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', app_table_name))
      is not null then
      execute pg_catalog.format(
        'lock table public.%I in access exclusive mode', app_table_name
      );
    end if;
  end loop;
end;
$maintenance_locks$;

do $maintenance_quiescence$
begin
  if exists (
    select 1 from public.scan_runs
    where status in ('queued', 'running') or lease_expires_at is not null
  ) or exists (
    select 1 from public.uploaded_documents
    where status in ('extracting', 'ingesting_memory')
      or lease_expires_at is not null
  ) then
    raise exception 'Active scans or upload leases remain; 0019 requires maintenance'
      using errcode = '55006';
  end if;
end;
$maintenance_quiescence$;

-- PostgreSQL 17 CREATEROLE executors retain only the bootstrap-admin
-- membership after 0009-0018. Temporarily enable inherited/SET access to the
-- isolated owner so owner-owned wrapper functions can be renamed and
-- replaced, then restore the exact bootstrap membership before commit.
do $registry_owner_prepare$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_registry_owner is not in its attested state';
  end if;
  if not executor_is_superuser then
    if not exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and membership.grantor = 10
        and (select rolsuper from pg_catalog.pg_roles
          where oid = membership.grantor)
        and membership.admin_option
        and not membership.inherit_option and not membership.set_option
    ) then
      raise exception
        'The migration executor lacks the attested registry-owner administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_registry_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$registry_owner_prepare$;

grant create on schema public to vsee_registry_owner;

create or replace function public.evidence_event_in_window_0019(
  p_published_value text,
  p_published_precision text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_window_timezone text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  publication_instant timestamptz;
  publication_date date;
  day_start timestamptz;
  day_end timestamptz;
begin
  if p_window_start > p_window_end then return false; end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = p_window_timezone
  ) then return false; end if;
  if p_published_precision = 'timestamp' then
    if p_published_value !~ '^\\d{4}-\\d{2}-\\d{2}T' then return false; end if;
    publication_instant := p_published_value::timestamptz;
    return publication_instant between p_window_start and p_window_end;
  elsif p_published_precision = 'date' then
    if p_published_value !~ '^\\d{4}-\\d{2}-\\d{2}$' then return false; end if;
    publication_date := p_published_value::date;
    if publication_date::text <> p_published_value then return false; end if;
    day_start := publication_date::timestamp at time zone p_window_timezone;
    day_end := (publication_date + 1)::timestamp at time zone p_window_timezone;
    return day_start <= p_window_end and day_end > p_window_start;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create table public.market_evidence_snapshots (
  workspace_id text not null,
  id text not null,
  schema_version text not null check (schema_version = 'market-evidence-snapshot-v1'),
  snapshot_as_of_date date not null,
  window_days integer not null check (window_days = 14),
  anchor_at timestamptz not null,
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  window_timezone text not null,
  display_label text not null,
  event_count integer not null check (event_count > 0),
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, id),
  unique (workspace_id, id, snapshot_fingerprint),
  foreign key (workspace_id) references public.workspaces(id),
  check (window_start_at <= window_end_at),
  check (display_label = 'Demo evidence snapshot as of ' || snapshot_as_of_date::text)
);

create table public.market_evidence_snapshot_events (
  workspace_id text not null,
  snapshot_id text not null,
  ordinal integer not null check (ordinal >= 0),
  event_id text not null check (btrim(event_id) <> ''),
  event_content_fingerprint text not null check (event_content_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  published_value text not null,
  published_precision text not null check (published_precision in ('date', 'timestamp')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id, snapshot_id, ordinal),
  unique (workspace_id, snapshot_id, event_id),
  foreign key (workspace_id, snapshot_id)
    references public.market_evidence_snapshots(workspace_id, id),
  check (payload ->> 'id' = event_id),
  check (payload ->> 'contentFingerprint' = event_content_fingerprint),
  check (payload ->> 'publishedAt' = published_value),
  check (payload ->> 'publishedAtPrecision' = published_precision),
  check (payload ->> 'schemaVersion' = 'market-event-v2'),
  check (payload ->> 'adaptation' = 'canonical')
);

alter table public.scan_runs
  add column evidence_context_version text,
  add column evidence_mode text,
  add column evidence_anchor_at timestamptz,
  add column evidence_window_start_at timestamptz,
  add column evidence_window_end_at timestamptz,
  add column evidence_window_timezone text,
  add column evidence_snapshot_id text,
  add column evidence_snapshot_fingerprint text,
  add column evidence_context_fingerprint text;

alter table public.scan_runs add constraint scan_runs_evidence_context_check check (
  (evidence_context_version is null and evidence_mode is null
    and evidence_anchor_at is null and evidence_window_start_at is null
    and evidence_window_end_at is null and evidence_window_timezone is null
    and evidence_snapshot_id is null and evidence_snapshot_fingerprint is null
    and evidence_context_fingerprint is null)
  or
  (evidence_context_version = 'run-evidence-context-v1'
    and evidence_mode in ('live', 'pinned')
    and evidence_anchor_at is not null and evidence_window_start_at is not null
    and evidence_window_end_at is not null and evidence_window_timezone is not null
    and evidence_window_start_at <= evidence_window_end_at
    and evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and ((evidence_mode = 'live' and evidence_snapshot_id is null
      and evidence_snapshot_fingerprint is null)
      or (evidence_mode = 'pinned' and evidence_snapshot_id is not null
      and evidence_snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$')))
);

alter table public.scan_runs add constraint scan_runs_evidence_snapshot_fkey
  foreign key (workspace_id, evidence_snapshot_id, evidence_snapshot_fingerprint)
  references public.market_evidence_snapshots(workspace_id, id, snapshot_fingerprint)
  match simple;

create table public.run_evidence_bindings (
  workspace_id text not null,
  run_id uuid not null,
  schema_version text not null check (schema_version = 'run-evidence-binding-v1'),
  evidence_context_version text not null check (evidence_context_version = 'run-evidence-context-v1'),
  evidence_mode text not null check (evidence_mode in ('live', 'pinned')),
  window_days integer not null check (window_days = 14),
  anchor_at timestamptz not null,
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  window_timezone text not null,
  snapshot_id text,
  snapshot_fingerprint text,
  evidence_context_fingerprint text not null check (evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  display_label text not null,
  event_count integer not null check (event_count >= 0),
  event_set_fingerprint text not null check (event_set_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  binding_fingerprint text not null check (binding_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, run_id),
  unique (workspace_id, binding_fingerprint),
  unique (workspace_id, run_id, binding_fingerprint),
  foreign key (workspace_id, run_id) references public.scan_runs(workspace_id, id),
  foreign key (workspace_id, snapshot_id, snapshot_fingerprint)
    references public.market_evidence_snapshots(workspace_id, id, snapshot_fingerprint)
    match simple,
  check (window_start_at <= window_end_at),
  check ((evidence_mode = 'live' and snapshot_id is null and snapshot_fingerprint is null)
    or (evidence_mode = 'pinned' and snapshot_id is not null
      and snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$'))
);

create table public.run_market_events (
  workspace_id text not null,
  run_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  event_id text not null check (btrim(event_id) <> ''),
  event_content_fingerprint text not null check (event_content_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  published_value text not null,
  published_precision text not null check (published_precision in ('date', 'timestamp')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id, run_id, ordinal),
  unique (workspace_id, run_id, event_id),
  foreign key (workspace_id, run_id)
    references public.run_evidence_bindings(workspace_id, run_id),
  check (payload ->> 'id' = event_id),
  check (payload ->> 'contentFingerprint' = event_content_fingerprint),
  check (payload ->> 'publishedAt' = published_value),
  check (payload ->> 'publishedAtPrecision' = published_precision),
  check (payload ->> 'schemaVersion' = 'market-event-v2'),
  check (payload ->> 'adaptation' = 'canonical')
);

alter table public.intelligence_reports
  add column evidence_context_version text,
  add column evidence_mode text,
  add column evidence_window_days integer,
  add column evidence_anchor_at timestamptz,
  add column evidence_window_start_at timestamptz,
  add column evidence_window_end_at timestamptz,
  add column evidence_window_timezone text,
  add column evidence_snapshot_id text,
  add column evidence_snapshot_fingerprint text,
  add column evidence_context_fingerprint text,
  add column evidence_display_label text,
  add column evidence_event_count integer,
  add column evidence_event_set_fingerprint text,
  add column evidence_binding_fingerprint text;

alter table public.intelligence_reports add constraint intelligence_reports_evidence_context_check check (
  (evidence_context_version is null and evidence_mode is null
    and evidence_window_days is null and evidence_anchor_at is null
    and evidence_window_start_at is null and evidence_window_end_at is null
    and evidence_window_timezone is null and evidence_snapshot_id is null
    and evidence_snapshot_fingerprint is null and evidence_context_fingerprint is null
    and evidence_display_label is null and evidence_event_count is null
    and evidence_event_set_fingerprint is null and evidence_binding_fingerprint is null)
  or
  (evidence_context_version = 'run-evidence-context-v1'
    and evidence_mode in ('live', 'pinned') and evidence_window_days = 14
    and evidence_anchor_at is not null and evidence_window_start_at is not null
    and evidence_window_end_at is not null and evidence_window_timezone is not null
    and evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and btrim(evidence_display_label) <> '' and evidence_event_count >= 0
    and evidence_event_set_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and evidence_binding_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and ((evidence_mode = 'live' and evidence_snapshot_id is null
      and evidence_snapshot_fingerprint is null)
      or (evidence_mode = 'pinned' and evidence_snapshot_id is not null
      and evidence_snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$')))
);

alter table public.intelligence_reports add constraint intelligence_reports_binding_fkey
  foreign key (workspace_id, run_id, evidence_binding_fingerprint)
  references public.run_evidence_bindings(workspace_id, run_id, binding_fingerprint)
  match simple;

alter table public.company_analyses
  add column belief_assessment_version text,
  add column belief_direction text,
  add column belief_score_breakdown jsonb,
  add column belief_gate_context jsonb,
  add column belief_gate_results jsonb,
  add column belief_actions jsonb;

alter table public.company_analyses add constraint company_analyses_belief_assessment_check check (
  (belief_assessment_version is null and belief_direction is null
    and belief_score_breakdown is null and belief_gate_context is null
    and belief_gate_results is null and belief_actions is null)
  or
  (belief_assessment_version = 'belief-change-assessment-v1'
    and belief_direction in ('positive', 'mixed', 'negative', 'none', 'unavailable')
    and jsonb_typeof(belief_score_breakdown) = 'object'
    and jsonb_typeof(belief_gate_context) = 'object'
    and jsonb_typeof(belief_gate_results) = 'object'
    and jsonb_typeof(belief_actions) = 'array'
    and jsonb_array_length(belief_actions) > 0
    and (belief_score_breakdown ->> 'finalScore')::double precision = score
    and belief_score_breakdown ->> 'confidence' = confidence
    and belief_gate_results ?& array['chronology','revisitConditionMapping','counterevidence','actionDelta','allPassed']
    and (belief_gate_results ->> 'allPassed')::boolean =
      ((belief_gate_results #>> '{chronology,passed}')::boolean
      and (belief_gate_results #>> '{revisitConditionMapping,passed}')::boolean
      and (belief_gate_results #>> '{counterevidence,passed}')::boolean
      and (belief_gate_results #>> '{actionDelta,passed}')::boolean)
    and (outcome <> 'belief_revised' or (
      belief_direction in ('positive', 'mixed', 'negative')
      and confidence in ('medium', 'high')
      and (belief_gate_results ->> 'allPassed')::boolean)))
);

alter table public.reasoner_judgments
  add column judgment_schema_version text,
  add column judgment_record_fingerprint text,
  add column evidence_context_fingerprint text,
  add column evidence_binding_fingerprint text;

alter table public.reasoner_judgments add constraint reasoner_judgments_current_shape_check check (
  (judgment_schema_version is null and judgment_record_fingerprint is null
    and evidence_context_fingerprint is null and evidence_binding_fingerprint is null)
  or
  (judgment_schema_version = 'reasoner-judgment-record-v1'
    and judgment_record_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and ((evidence_context_fingerprint is null and evidence_binding_fingerprint is null)
      or (evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
        and evidence_binding_fingerprint ~ '^sha256:[0-9a-f]{64}$')))
);

create or replace function public.reject_immutable_row_0019()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_EVIDENCE_LINEAGE' using errcode = '55000';
end;
$$;

create or replace function public.reject_immutable_statement_0019()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_EVIDENCE_LINEAGE' using errcode = '55000';
end;
$$;

do $immutable_triggers$
declare table_name text;
begin
  foreach table_name in array array[
    'market_evidence_snapshots', 'market_evidence_snapshot_events',
    'run_evidence_bindings', 'run_market_events', 'reasoner_judgments'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_immutable_row_0019()',
      table_name || '_immutable_row', table_name
    );
    execute pg_catalog.format(
      'create trigger %I before truncate on public.%I for each statement execute function public.reject_immutable_statement_0019()',
      table_name || '_immutable_truncate', table_name
    );
  end loop;
end;
$immutable_triggers$;

create or replace function public.validate_snapshot_0019(
  p_workspace_id text, p_snapshot_id text
)
returns void language plpgsql security definer set search_path = '' as $$
declare snapshot public.market_evidence_snapshots%rowtype;
declare actual_count integer;
declare actual_ids text[];
declare expected_ids text[];
declare actual_fingerprint text;
begin
  select * into strict snapshot from public.market_evidence_snapshots
  where workspace_id = p_workspace_id and id = p_snapshot_id;
  select count(*)::integer,
    array_agg(event_id order by ordinal),
    array_agg(event_id order by event_id collate "C")
  into actual_count, actual_ids, expected_ids
  from public.market_evidence_snapshot_events
  where workspace_id = p_workspace_id and snapshot_id = p_snapshot_id;
  if actual_count <> snapshot.event_count
    or actual_ids is distinct from expected_ids
    or exists (
      select 1 from public.market_evidence_snapshot_events as event
      where event.workspace_id = p_workspace_id and event.snapshot_id = p_snapshot_id
        and (event.ordinal < 0 or event.ordinal >= snapshot.event_count
          or not public.evidence_event_in_window_0019(
            event.published_value, event.published_precision,
            snapshot.window_start_at, snapshot.window_end_at, snapshot.window_timezone))
    ) then
    raise exception 'INVALID_MARKET_EVIDENCE_SNAPSHOT';
  end if;
  select public.sha256_length_framed(array[
    snapshot.schema_version, snapshot.workspace_id, snapshot.id,
    snapshot.snapshot_as_of_date::text, snapshot.display_label,
    snapshot.window_days::text,
    public.canonical_utc_iso_milliseconds(snapshot.anchor_at),
    public.canonical_utc_iso_milliseconds(snapshot.window_start_at),
    public.canonical_utc_iso_milliseconds(snapshot.window_end_at),
    snapshot.window_timezone
  ] || coalesce(array(
    select payload::text from public.market_evidence_snapshot_events
    where workspace_id = p_workspace_id and snapshot_id = p_snapshot_id
    order by ordinal
  ), array[]::text[])) into actual_fingerprint;
  if actual_fingerprint <> snapshot.snapshot_fingerprint then
    raise exception 'INVALID_MARKET_EVIDENCE_SNAPSHOT_FINGERPRINT';
  end if;
end;
$$;

create or replace function public.validate_snapshot_deferred_0019()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.validate_snapshot_0019(
    coalesce(new.workspace_id, old.workspace_id),
    coalesce(new.snapshot_id, old.snapshot_id)
  );
  return null;
end;
$$;

create constraint trigger market_evidence_snapshot_events_validate
after insert or update or delete on public.market_evidence_snapshot_events
deferrable initially deferred for each row
execute function public.validate_snapshot_deferred_0019();

create or replace function public.create_market_evidence_snapshot(p_request jsonb)
returns setof public.market_evidence_snapshots
language plpgsql security definer set search_path = '' as $$
declare workspace text := btrim(p_request ->> 'workspaceId');
declare snapshot_id text := btrim(p_request ->> 'id');
declare events jsonb := p_request -> 'events';
declare fingerprint text;
declare existing public.market_evidence_snapshots%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      is distinct from array['anchorAt','events','id','schemaVersion','snapshotAsOfDate','windowDays','windowEndAt','windowStartAt','windowTimezone','workspaceId']
    or p_request ->> 'schemaVersion' <> 'market-evidence-snapshot-v1'
    or (p_request ->> 'windowDays')::integer <> 14
    or jsonb_typeof(events) <> 'array' or jsonb_array_length(events) = 0
  then raise exception 'INVALID_MARKET_EVIDENCE_SNAPSHOT_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(jsonb_build_array(workspace, snapshot_id)::text, 0)
  );
  select public.sha256_length_framed(array[
    'market-evidence-snapshot-v1', workspace, snapshot_id,
    p_request ->> 'snapshotAsOfDate',
    'Demo evidence snapshot as of ' || (p_request ->> 'snapshotAsOfDate'),
    '14',
    public.canonical_utc_iso_milliseconds((p_request ->> 'anchorAt')::timestamptz),
    public.canonical_utc_iso_milliseconds((p_request ->> 'windowStartAt')::timestamptz),
    public.canonical_utc_iso_milliseconds((p_request ->> 'windowEndAt')::timestamptz),
    p_request ->> 'windowTimezone'
  ] || array(select value::text from jsonb_array_elements(events) value order by value ->> 'id' collate "C"))
  into fingerprint;
  select * into existing from public.market_evidence_snapshots
  where workspace_id = workspace and id = snapshot_id;
  if found then
    if existing.snapshot_fingerprint <> fingerprint then
      raise exception 'MARKET_EVIDENCE_SNAPSHOT_COLLISION' using errcode = '23505';
    end if;
    perform public.validate_snapshot_0019(workspace, snapshot_id);
    return query select * from public.market_evidence_snapshots
      where workspace_id = workspace and id = snapshot_id;
    return;
  end if;
  insert into public.market_evidence_snapshots(
    workspace_id,id,schema_version,snapshot_as_of_date,window_days,
    anchor_at,window_start_at,window_end_at,window_timezone,display_label,
    event_count,snapshot_fingerprint
  ) values (
    workspace,snapshot_id,'market-evidence-snapshot-v1',
    (p_request ->> 'snapshotAsOfDate')::date,14,
    (p_request ->> 'anchorAt')::timestamptz,
    (p_request ->> 'windowStartAt')::timestamptz,
    (p_request ->> 'windowEndAt')::timestamptz,
    p_request ->> 'windowTimezone',
    'Demo evidence snapshot as of ' || (p_request ->> 'snapshotAsOfDate'),
    jsonb_array_length(events),fingerprint
  );
  insert into public.market_evidence_snapshot_events(
    workspace_id,snapshot_id,ordinal,event_id,event_content_fingerprint,
    published_value,published_precision,payload
  ) select workspace,snapshot_id,(row_number() over(order by value ->> 'id' collate "C")-1)::integer,
    value ->> 'id',value ->> 'contentFingerprint',value ->> 'publishedAt',
    value ->> 'publishedAtPrecision',value
  from jsonb_array_elements(events) value;
  perform public.validate_snapshot_0019(workspace, snapshot_id);
  return query select * from public.market_evidence_snapshots
    where workspace_id = workspace and id = snapshot_id;
end;
$$;

create or replace function public.create_scan_run_with_evidence_context(p_request jsonb)
returns setof public.scan_runs
language plpgsql security definer set search_path = '' as $$
declare workspace text := btrim(p_request ->> 'workspaceId');
declare run_mode text := p_request ->> 'mode';
declare evidence jsonb := p_request -> 'evidenceRequest';
declare evidence_mode text := evidence ->> 'evidenceMode';
declare active public.scan_runs%rowtype;
declare snapshot public.market_evidence_snapshots%rowtype;
declare anchor_value timestamptz;
declare start_value timestamptz;
declare end_value timestamptz;
declare timezone_value text;
declare snapshot_id text;
declare snapshot_fingerprint text;
declare context_fingerprint text;
begin
  if workspace = '' or run_mode not in ('xtrace','structured')
    or (p_request ->> 'windowDays')::integer <> 14
    or evidence ->> 'schemaVersion' <> 'run-evidence-request-v1'
    or evidence_mode not in ('live','pinned')
  then raise exception 'INVALID_RUN_EVIDENCE_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    jsonb_build_array(workspace,run_mode,14,'active-run')::text,0));
  select * into active from public.scan_runs
  where workspace_id = workspace and mode = run_mode and window_days = 14
    and status in ('queued','running') for update;
  if found then
    if active.evidence_context_version = 'run-evidence-context-v1'
      and active.evidence_mode = evidence_mode
      and (evidence_mode = 'live' or active.evidence_snapshot_id = evidence ->> 'snapshotId')
    then return next active; return;
    end if;
    raise exception 'ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT' using errcode = '55006';
  end if;
  if evidence_mode = 'pinned' then
    snapshot_id := btrim(evidence ->> 'snapshotId');
    select * into strict snapshot from public.market_evidence_snapshots
      where workspace_id = workspace and id = snapshot_id for share;
    anchor_value := snapshot.anchor_at; start_value := snapshot.window_start_at;
    end_value := snapshot.window_end_at; timezone_value := snapshot.window_timezone;
    snapshot_fingerprint := snapshot.snapshot_fingerprint;
  else
    anchor_value := pg_catalog.clock_timestamp();
    start_value := anchor_value - interval '14 days';
    end_value := anchor_value; timezone_value := 'America/Los_Angeles';
  end if;
  context_fingerprint := public.sha256_length_framed(array[
    'run-evidence-context-v1',workspace,run_mode,'14',evidence_mode,
    public.canonical_utc_iso_milliseconds(anchor_value),
    public.canonical_utc_iso_milliseconds(start_value),
    public.canonical_utc_iso_milliseconds(end_value),timezone_value,
    coalesce(snapshot_id,''),coalesce(snapshot_fingerprint,'')]);
  insert into public.scan_runs(
    workspace_id,mode,window_days,evidence_context_version,evidence_mode,
    evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,
    evidence_window_timezone,evidence_snapshot_id,evidence_snapshot_fingerprint,
    evidence_context_fingerprint
  ) values (workspace,run_mode,14,'run-evidence-context-v1',evidence_mode,
    anchor_value,start_value,end_value,timezone_value,snapshot_id,
    snapshot_fingerprint,context_fingerprint)
  returning * into active;
  return next active;
end;
$$;

create or replace function public.validate_run_binding_0019(
  p_workspace_id text, p_run_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare binding public.run_evidence_bindings%rowtype;
declare run public.scan_runs%rowtype;
declare actual_count integer;
declare ids_by_ordinal text[];
declare ids_by_name text[];
declare event_fingerprint text;
declare binding_digest text;
begin
  select * into strict binding from public.run_evidence_bindings
    where workspace_id=p_workspace_id and run_id=p_run_id;
  select * into strict run from public.scan_runs
    where workspace_id=p_workspace_id and id=p_run_id;
  select count(*)::integer,array_agg(event_id order by ordinal),
    array_agg(event_id order by event_id collate "C")
  into actual_count,ids_by_ordinal,ids_by_name from public.run_market_events
    where workspace_id=p_workspace_id and run_id=p_run_id;
  if binding.event_count <> actual_count or ids_by_ordinal is distinct from ids_by_name
    or binding.evidence_context_fingerprint <> run.evidence_context_fingerprint
    or binding.evidence_mode <> run.evidence_mode
    or binding.snapshot_id is distinct from run.evidence_snapshot_id
    or binding.snapshot_fingerprint is distinct from run.evidence_snapshot_fingerprint
  then raise exception 'INVALID_RUN_EVIDENCE_BINDING'; end if;
  event_fingerprint := public.sha256_length_framed(array['run-event-set-v1'] || coalesce(array(
    select payload::text from public.run_market_events
    where workspace_id=p_workspace_id and run_id=p_run_id order by ordinal
  ),array[]::text[]));
  binding_digest := public.sha256_length_framed(array[
    'run-evidence-binding-v1',p_workspace_id,p_run_id::text,
    binding.evidence_context_fingerprint,event_fingerprint,actual_count::text]);
  if event_fingerprint <> binding.event_set_fingerprint
    or binding_digest <> binding.binding_fingerprint
  then raise exception 'INVALID_RUN_EVIDENCE_BINDING_FINGERPRINT'; end if;
end;
$$;

create or replace function public.bind_pinned_run_market_events(
  p_workspace_id text,p_run_id uuid
)
returns setof public.run_evidence_bindings
language plpgsql security definer set search_path = '' as $$
declare run public.scan_runs%rowtype;
declare event_set_digest text;
declare binding_digest text;
begin
  select * into strict run from public.scan_runs where workspace_id=p_workspace_id and id=p_run_id for update;
  if run.evidence_mode <> 'pinned' then raise exception 'PINNED_BINDING_REQUIRES_PINNED_RUN'; end if;
  if exists(select 1 from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id) then
    perform public.validate_run_binding_0019(p_workspace_id,p_run_id);
    return query select * from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id; return;
  end if;
  event_set_digest := public.sha256_length_framed(array['run-event-set-v1'] || array(
    select payload::text from public.market_evidence_snapshot_events
    where workspace_id=p_workspace_id and snapshot_id=run.evidence_snapshot_id order by ordinal));
  binding_digest := public.sha256_length_framed(array['run-evidence-binding-v1',p_workspace_id,p_run_id::text,
    run.evidence_context_fingerprint,event_set_digest,
    (select count(*)::text from public.market_evidence_snapshot_events where workspace_id=p_workspace_id and snapshot_id=run.evidence_snapshot_id)]);
  insert into public.run_evidence_bindings select p_workspace_id,p_run_id,'run-evidence-binding-v1',
    run.evidence_context_version,run.evidence_mode,run.window_days,run.evidence_anchor_at,
    run.evidence_window_start_at,run.evidence_window_end_at,run.evidence_window_timezone,
    run.evidence_snapshot_id,run.evidence_snapshot_fingerprint,run.evidence_context_fingerprint,
    snapshot.display_label,snapshot.event_count,event_set_digest,binding_digest,pg_catalog.clock_timestamp()
  from public.market_evidence_snapshots snapshot where snapshot.workspace_id=p_workspace_id and snapshot.id=run.evidence_snapshot_id;
  insert into public.run_market_events select p_workspace_id,p_run_id,ordinal,event_id,
    event_content_fingerprint,published_value,published_precision,payload
  from public.market_evidence_snapshot_events where workspace_id=p_workspace_id and snapshot_id=run.evidence_snapshot_id;
  perform public.validate_run_binding_0019(p_workspace_id,p_run_id);
  return query select * from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id;
end;
$$;

create or replace function public.bind_live_run_market_events(
  p_workspace_id text,p_run_id uuid,p_event_ids text[]
)
returns setof public.run_evidence_bindings
language plpgsql security definer set search_path = '' as $$
declare run public.scan_runs%rowtype;
declare requested integer := coalesce(cardinality(p_event_ids),0);
declare resolved integer;
declare event_set_digest text;
declare binding_digest text;
begin
  select * into strict run from public.scan_runs where workspace_id=p_workspace_id and id=p_run_id for update;
  if run.evidence_mode <> 'live' then raise exception 'LIVE_BINDING_REQUIRES_LIVE_RUN'; end if;
  if requested <> coalesce((select count(distinct value) from unnest(p_event_ids) value),0) then
    raise exception 'DUPLICATE_LIVE_EVENT_ID'; end if;
  select count(*)::integer into resolved from public.market_events event
    where event.workspace_id=p_workspace_id and event.id=any(coalesce(p_event_ids,array[]::text[]))
      and public.evidence_event_in_window_0019(event.payload->>'publishedAt',event.payload->>'publishedAtPrecision',
        run.evidence_window_start_at,run.evidence_window_end_at,run.evidence_window_timezone);
  if resolved <> requested then raise exception 'UNKNOWN_OR_OUT_OF_WINDOW_LIVE_EVENT'; end if;
  event_set_digest := public.sha256_length_framed(array['run-event-set-v1'] || coalesce(array(
    select payload::text from public.market_events where workspace_id=p_workspace_id
      and id=any(coalesce(p_event_ids,array[]::text[])) order by id collate "C"),array[]::text[]));
  binding_digest := public.sha256_length_framed(array['run-evidence-binding-v1',p_workspace_id,p_run_id::text,
    run.evidence_context_fingerprint,event_set_digest,requested::text]);
  if exists(select 1 from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id) then
    perform public.validate_run_binding_0019(p_workspace_id,p_run_id);
    if not exists(select 1 from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id and binding_fingerprint=binding_digest)
    then raise exception 'RUN_EVIDENCE_BINDING_COLLISION'; end if;
    return query select * from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id; return;
  end if;
  insert into public.run_evidence_bindings values(p_workspace_id,p_run_id,'run-evidence-binding-v1',
    run.evidence_context_version,'live',14,run.evidence_anchor_at,run.evidence_window_start_at,
    run.evidence_window_end_at,run.evidence_window_timezone,null,null,run.evidence_context_fingerprint,
    'Live evidence window ending '||public.canonical_utc_iso_milliseconds(run.evidence_window_end_at),
    requested,event_set_digest,binding_digest,pg_catalog.clock_timestamp());
  insert into public.run_market_events select p_workspace_id,p_run_id,
    (row_number() over(order by id collate "C")-1)::integer,id,payload->>'contentFingerprint',
    payload->>'publishedAt',payload->>'publishedAtPrecision',payload
  from public.market_events where workspace_id=p_workspace_id and id=any(coalesce(p_event_ids,array[]::text[]));
  perform public.validate_run_binding_0019(p_workspace_id,p_run_id);
  return query select * from public.run_evidence_bindings where workspace_id=p_workspace_id and run_id=p_run_id;
end;
$$;

create or replace function public.save_reasoner_judgment_immutable(p_request jsonb)
returns setof public.reasoner_judgments
language plpgsql security definer set search_path = '' as $$
declare semantic_key text := p_request->>'fingerprint';
declare record_digest text;
declare existing public.reasoner_judgments%rowtype;
begin
  if jsonb_typeof(p_request)<>'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      is distinct from array['evidenceBindingFingerprint','evidenceContextFingerprint','fingerprint','model','payload']
    or semantic_key !~ '^reasoner-judgment-v3:sha256:[0-9a-f]{64}$'
    or btrim(p_request->>'model')=''
    or ((p_request->>'evidenceBindingFingerprint' is null) <> (p_request->>'evidenceContextFingerprint' is null))
  then raise exception 'INVALID_REASONER_JUDGMENT_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(semantic_key,0));
  record_digest := public.sha256_length_framed(array['reasoner-judgment-record-v1',semantic_key,
    p_request->>'model',coalesce(p_request->>'evidenceContextFingerprint',''),
    coalesce(p_request->>'evidenceBindingFingerprint',''),(p_request->'payload')::text]);
  select * into existing from public.reasoner_judgments where fingerprint=semantic_key;
  if found then
    if existing.model<>p_request->>'model' or existing.payload<>p_request->'payload'
      or existing.evidence_context_fingerprint is distinct from p_request->>'evidenceContextFingerprint'
      or existing.evidence_binding_fingerprint is distinct from p_request->>'evidenceBindingFingerprint'
    then raise exception 'REASONER_JUDGMENT_COLLISION' using errcode='23505'; end if;
    return next existing; return;
  end if;
  insert into public.reasoner_judgments(fingerprint,model,payload,judgment_schema_version,
    judgment_record_fingerprint,evidence_context_fingerprint,evidence_binding_fingerprint)
  values(semantic_key,p_request->>'model',p_request->'payload','reasoner-judgment-record-v1',
    record_digest,p_request->>'evidenceContextFingerprint',p_request->>'evidenceBindingFingerprint')
  returning * into existing;
  return next existing;
end;
$$;

create or replace function public.protect_scan_run_identity_0019()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SCAN_RUN_LINEAGE_IS_LOGICALLY_HIDDEN_NOT_DELETED';
  end if;
  if row(old.id,old.workspace_id,old.mode,old.window_days,
      old.evidence_context_version,old.evidence_mode,old.evidence_anchor_at,
      old.evidence_window_start_at,old.evidence_window_end_at,
      old.evidence_window_timezone,old.evidence_snapshot_id,
      old.evidence_snapshot_fingerprint,old.evidence_context_fingerprint)
    is distinct from
    row(new.id,new.workspace_id,new.mode,new.window_days,
      new.evidence_context_version,new.evidence_mode,new.evidence_anchor_at,
      new.evidence_window_start_at,new.evidence_window_end_at,
      new.evidence_window_timezone,new.evidence_snapshot_id,
      new.evidence_snapshot_fingerprint,new.evidence_context_fingerprint)
  then raise exception 'SCAN_RUN_EVIDENCE_IDENTITY_IS_IMMUTABLE'; end if;
  return new;
end;
$$;

create trigger scan_runs_protect_identity_0019
before update or delete on public.scan_runs for each row
execute function public.protect_scan_run_identity_0019();

create or replace function public.protect_report_evidence_0019()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.evidence_context_version is not null then
      raise exception 'CURRENT_REPORT_LINEAGE_IS_IMMUTABLE';
    end if;
    return old;
  end if;
  if row(old.evidence_context_version,old.evidence_mode,old.evidence_window_days,
      old.evidence_anchor_at,old.evidence_window_start_at,old.evidence_window_end_at,
      old.evidence_window_timezone,old.evidence_snapshot_id,old.evidence_snapshot_fingerprint,
      old.evidence_context_fingerprint,old.evidence_display_label,old.evidence_event_count,
      old.evidence_event_set_fingerprint,old.evidence_binding_fingerprint)
    is distinct from
    row(new.evidence_context_version,new.evidence_mode,new.evidence_window_days,
      new.evidence_anchor_at,new.evidence_window_start_at,new.evidence_window_end_at,
      new.evidence_window_timezone,new.evidence_snapshot_id,new.evidence_snapshot_fingerprint,
      new.evidence_context_fingerprint,new.evidence_display_label,new.evidence_event_count,
      new.evidence_event_set_fingerprint,new.evidence_binding_fingerprint)
  then
    if old.evidence_context_version is not null
      or new.evidence_context_version <> 'run-evidence-context-v1'
      or pg_catalog.current_setting('vsee.0019_finalizer',true) <> 'on'
    then raise exception 'REPORT_EVIDENCE_CONTEXT_IS_IMMUTABLE'; end if;
  end if;
  return new;
end;
$$;

create trigger intelligence_reports_protect_evidence_0019
before update or delete on public.intelligence_reports for each row
execute function public.protect_report_evidence_0019();

create or replace function public.protect_analysis_assessment_0019()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from public.intelligence_reports report
      where report.workspace_id=old.workspace_id and report.id=old.report_id
        and report.evidence_context_version is not null)
    then raise exception 'CURRENT_ANALYSIS_LINEAGE_IS_IMMUTABLE'; end if;
    return old;
  end if;
  if row(old.belief_assessment_version,old.belief_direction,
      old.belief_score_breakdown,old.belief_gate_context,
      old.belief_gate_results,old.belief_actions)
    is distinct from
    row(new.belief_assessment_version,new.belief_direction,
      new.belief_score_breakdown,new.belief_gate_context,
      new.belief_gate_results,new.belief_actions)
  then
    if old.belief_assessment_version is not null
      or new.belief_assessment_version <> 'belief-change-assessment-v1'
      or pg_catalog.current_setting('vsee.0019_finalizer',true) <> 'on'
    then raise exception 'BELIEF_ASSESSMENT_IS_IMMUTABLE'; end if;
  end if;
  return new;
end;
$$;

create trigger company_analyses_protect_assessment_0019
before update or delete on public.company_analyses for each row
execute function public.protect_analysis_assessment_0019();

alter function public.save_intelligence_report(jsonb,jsonb)
  rename to save_intelligence_report_legacy_0019;

create or replace function public.finalize_new_report_current_fields_0019(
  p_workspace_id text,p_report_id text,p_run_id uuid,
  p_binding_fingerprint text,p_analyses jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare binding public.run_evidence_bindings%rowtype;
declare analysis jsonb;
declare ranked_deal_ids text[];
declare submitted_deal_ids text[];
declare submitted_priority_deal_id text;
begin
  select * into strict binding from public.run_evidence_bindings
    where workspace_id=p_workspace_id and run_id=p_run_id
      and binding_fingerprint=p_binding_fingerprint;
  perform pg_catalog.set_config('vsee.0019_finalizer','on',true);
  update public.intelligence_reports report set
    evidence_context_version=binding.evidence_context_version,
    evidence_mode=binding.evidence_mode,evidence_window_days=binding.window_days,
    evidence_anchor_at=binding.anchor_at,evidence_window_start_at=binding.window_start_at,
    evidence_window_end_at=binding.window_end_at,
    evidence_window_timezone=binding.window_timezone,
    evidence_snapshot_id=binding.snapshot_id,
    evidence_snapshot_fingerprint=binding.snapshot_fingerprint,
    evidence_context_fingerprint=binding.evidence_context_fingerprint,
    evidence_display_label=binding.display_label,
    evidence_event_count=binding.event_count,
    evidence_event_set_fingerprint=binding.event_set_fingerprint,
    evidence_binding_fingerprint=binding.binding_fingerprint
  where report.workspace_id=p_workspace_id and report.id=p_report_id
    and report.run_id=p_run_id and report.evidence_context_version is null;
  if not found then raise exception 'REPORT_CURRENT_FINALIZATION_REQUIRES_NEW_ROW'; end if;

  for analysis in select value from jsonb_array_elements(p_analyses) value loop
    if analysis ->> 'workspaceId' <> p_workspace_id
      or (analysis ->> 'runId')::uuid <> p_run_id
      or not exists(select 1 from public.deals deal
        where deal.workspace_id=p_workspace_id and deal.id=analysis->>'dealId'
          and deal.status=analysis->>'dealStatus')
    then raise exception 'ANALYSIS_DEAL_STATUS_AUTHORITY_MISMATCH'; end if;
    if analysis ->> 'beliefAssessmentVersion' is not null then
      if analysis ->> 'beliefAssessmentVersion' <> 'belief-change-assessment-v1'
        or analysis ->> 'beliefDirection' is null
        or analysis -> 'beliefScoreBreakdown' = 'null'::jsonb
        or analysis -> 'beliefGateContext' = 'null'::jsonb
        or analysis -> 'beliefGateResults' = 'null'::jsonb
        or analysis -> 'beliefActions' = 'null'::jsonb
      then raise exception 'PARTIAL_BELIEF_ASSESSMENT'; end if;
      if not exists(select 1 from public.run_market_events event
        where event.workspace_id=p_workspace_id and event.run_id=p_run_id
          and event.event_id=analysis#>>'{beliefGateContext,selectedTriggerEventId}')
      then raise exception 'ASSESSMENT_TRIGGER_EVENT_OUTSIDE_RUN'; end if;
      update public.company_analyses stored set
        belief_assessment_version=analysis->>'beliefAssessmentVersion',
        belief_direction=analysis->>'beliefDirection',
        belief_score_breakdown=analysis->'beliefScoreBreakdown',
        belief_gate_context=analysis->'beliefGateContext',
        belief_gate_results=analysis->'beliefGateResults',
        belief_actions=analysis->'beliefActions'
      where stored.workspace_id=p_workspace_id and stored.report_id=p_report_id
        and stored.id=analysis->>'id' and stored.belief_assessment_version is null;
      if not found then raise exception 'ANALYSIS_CURRENT_FINALIZATION_REQUIRES_NEW_ROW'; end if;
    end if;
    if exists(
      select 1 from jsonb_array_elements(coalesce(analysis#>'{marketEvidence,events}','[]'::jsonb)) supplied
      where not exists(select 1 from public.run_market_events event
        where event.workspace_id=p_workspace_id and event.run_id=p_run_id
          and event.event_id=supplied->>'id' and event.payload=supplied)
    ) then raise exception 'REPORT_EVENT_OUTSIDE_RUN_BINDING'; end if;
  end loop;
  select coalesce(array_agg(ranked.deal_id order by ranked.rank),array[]::text[])
  into ranked_deal_ids
  from (
    select stored.deal_id,
      row_number() over(order by stored.score desc,stored.deal_id collate "C") as rank
    from public.company_analyses stored
    join public.deals deal on deal.workspace_id=stored.workspace_id
      and deal.id=stored.deal_id and deal.status=stored.deal_status
    where stored.workspace_id=p_workspace_id and stored.report_id=p_report_id
      and stored.belief_assessment_version='belief-change-assessment-v1'
      and stored.outcome='belief_revised'
      and stored.confidence in ('medium','high')
      and stored.belief_direction in ('positive','mixed','negative')
      and (stored.belief_gate_results->>'allPassed')::boolean
    order by stored.score desc,stored.deal_id collate "C"
    limit 5
  ) ranked;
  select coalesce(array_agg(value->>'dealId' order by ordinal),array[]::text[])
  into submitted_deal_ids
  from jsonb_array_elements(coalesce(
    (select report.opportunities from public.intelligence_reports report
      where report.workspace_id=p_workspace_id and report.id=p_report_id),
    '[]'::jsonb
  )) with ordinality as opportunity(value,ordinal);
  select report.priority_deal_id into submitted_priority_deal_id
  from public.intelligence_reports report
  where report.workspace_id=p_workspace_id and report.id=p_report_id;
  if ranked_deal_ids is distinct from submitted_deal_ids
    or submitted_priority_deal_id is distinct from ranked_deal_ids[1]
  then raise exception 'REPORT_TOP_FIVE_AUTHORITY_MISMATCH'; end if;
end;
$$;

create or replace function public.save_intelligence_report(p_report jsonb,p_analyses jsonb)
returns setof public.intelligence_reports
language plpgsql security definer set search_path = '' as $$
declare workspace text := btrim(p_report->>'workspaceId');
declare report_id text := btrim(p_report->>'id');
declare run_id uuid := (p_report->>'runId')::uuid;
declare binding_fingerprint text := nullif(btrim(p_report->>'evidenceBindingFingerprint'),'');
declare existing public.intelligence_reports%rowtype;
begin
  if binding_fingerprint is null then
    return query select * from public.save_intelligence_report_legacy_0019(p_report,p_analyses);
    return;
  end if;
  if p_report ?| array['evidenceMode','evidenceAnchorAt','evidenceWindowStartAt',
    'evidenceWindowEndAt','evidenceWindowTimezone','evidenceSnapshotId',
    'evidenceSnapshotFingerprint','evidenceContextFingerprint','evidenceDisplayLabel',
    'evidenceEventCount','evidenceEventSetFingerprint']
  then raise exception 'CALLER_OWNED_REPORT_EVIDENCE_CONTEXT_FORBIDDEN'; end if;
  select * into existing from public.intelligence_reports
    where workspace_id=workspace and id=report_id;
  if found then
    if existing.run_id<>run_id
      or existing.evidence_binding_fingerprint is distinct from binding_fingerprint
      or existing.created_at is distinct from (p_report->>'createdAt')::timestamptz
      or existing.market_summary is distinct from p_report->>'marketSummary'
      or existing.opportunities is distinct from p_report->'opportunities'
      or existing.analysis_status is distinct from p_report->>'analysisStatus'
      or existing.company_count is distinct from (p_report->>'companyCount')::integer
      or existing.belief_revised_count is distinct from (p_report->>'beliefRevisedCount')::integer
      or existing.monitor_count is distinct from (p_report->>'monitorCount')::integer
      or existing.no_material_change_count is distinct from (p_report->>'noMaterialChangeCount')::integer
      or existing.analysis_unavailable_count is distinct from (p_report->>'analysisUnavailableCount')::integer
      or existing.priority_deal_id is distinct from nullif(p_report->>'priorityDealId','')
      or existing.evidence_coverage is distinct from p_report->'evidenceCoverage'
      or existing.eligible_snapshot_count is distinct from (p_report->>'eligibleSnapshotCount')::integer
      or existing.eligible_snapshot_fingerprint is distinct from p_report->>'eligibleSnapshotFingerprint'
      or (select count(*) from public.company_analyses stored
          where stored.workspace_id=workspace and stored.report_id=report_id)
        <> jsonb_array_length(p_analyses)
      or exists (
        select 1 from jsonb_array_elements(p_analyses) submitted
        where not exists (
          select 1 from public.company_analyses stored
          where stored.workspace_id=workspace and stored.report_id=report_id
            and stored.id=submitted->>'id'
            and stored.run_id=(submitted->>'runId')::uuid
            and stored.deal_id=submitted->>'dealId'
            and stored.deal_status=submitted->>'dealStatus'
            and stored.outcome=submitted->>'outcome'
            and stored.confidence=submitted->>'confidence'
            and stored.score=(submitted->>'score')::double precision
            and stored.investment_memory=submitted->'investmentMemory'
            and stored.market_evidence=submitted->'marketEvidence'
            and stored.implications=submitted->'implications'
            and stored.recommended_next_move=submitted->>'recommendedNextMove'
            and stored.company_brief=submitted->'companyBrief'
            and stored.source_refs=submitted->'sourceRefs'
            and stored.belief_assessment_version is not distinct from submitted->>'beliefAssessmentVersion'
            and stored.belief_direction is not distinct from submitted->>'beliefDirection'
            and stored.belief_score_breakdown is not distinct from submitted->'beliefScoreBreakdown'
            and stored.belief_gate_context is not distinct from submitted->'beliefGateContext'
            and stored.belief_gate_results is not distinct from submitted->'beliefGateResults'
            and stored.belief_actions is not distinct from submitted->'beliefActions'
        )
      )
    then raise exception 'REPORT_EVIDENCE_BINDING_COLLISION'; end if;
    return next existing; return;
  end if;
  perform 1 from public.save_intelligence_report_legacy_0019(
    p_report-'evidenceBindingFingerprint',p_analyses);
  perform public.finalize_new_report_current_fields_0019(
    workspace,report_id,run_id,binding_fingerprint,p_analyses);
  return query select * from public.intelligence_reports
    where workspace_id=workspace and id=report_id;
end;
$$;

create or replace function public.reset_intelligence_products(p_workspace_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare workspace text := btrim(p_workspace_id);
begin
  if workspace='' then raise exception 'A workspace is required'; end if;
  if exists(select 1 from public.scan_runs where workspace_id=workspace
    and status in ('queued','running'))
  then raise exception 'ACTIVE_SCAN_PREVENTS_LOGICAL_RESET'; end if;
  insert into public.workspace_test_generations(workspace_id,reset_at,updated_by)
  values(workspace,pg_catalog.clock_timestamp(),'reset_intelligence_products')
  on conflict(workspace_id) do update set reset_at=excluded.reset_at,updated_by=excluded.updated_by;
end;
$$;

-- Preserve the existing active-run invariant across evidence contexts.
drop index if exists public.scan_runs_one_active;
create unique index scan_runs_one_active on public.scan_runs(workspace_id,mode,window_days)
  where status in ('queued','running');
create unique index scan_runs_one_active_live on public.scan_runs(workspace_id,mode,window_days)
  where status in ('queued','running') and evidence_mode='live';

alter table public.market_evidence_snapshots enable row level security;
alter table public.market_evidence_snapshot_events enable row level security;
alter table public.run_evidence_bindings enable row level security;
alter table public.run_market_events enable row level security;

create policy market_evidence_snapshots_registry_owner_0019
  on public.market_evidence_snapshots for all to vsee_registry_owner
  using (true) with check (true);
create policy market_evidence_snapshot_events_registry_owner_0019
  on public.market_evidence_snapshot_events for all to vsee_registry_owner
  using (true) with check (true);
create policy run_evidence_bindings_registry_owner_0019
  on public.run_evidence_bindings for all to vsee_registry_owner
  using (true) with check (true);
create policy run_market_events_registry_owner_0019
  on public.run_market_events for all to vsee_registry_owner
  using (true) with check (true);
create policy reasoner_judgments_registry_owner_0019
  on public.reasoner_judgments for all to vsee_registry_owner
  using (true) with check (true);

revoke all on table public.market_evidence_snapshots, public.market_evidence_snapshot_events,
  public.run_evidence_bindings, public.run_market_events, public.reasoner_judgments from public, anon, authenticated, service_role;
revoke insert, delete, truncate on public.scan_runs from service_role;
revoke update on public.scan_runs from service_role;
revoke insert, update, delete, truncate on public.intelligence_reports,
  public.company_analyses from service_role;
grant select on public.scan_runs, public.market_evidence_snapshots,
  public.market_evidence_snapshot_events, public.run_evidence_bindings,
  public.run_market_events, public.reasoner_judgments to service_role;
grant update(status,current_stage,warning_count,warnings,worker_id,started_at,completed_at,lease_expires_at)
  on public.scan_runs to service_role;

do $ownership$
declare function_identity regprocedure;
begin
  foreach function_identity in array array[
    'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)'::regprocedure,
    'public.reject_immutable_row_0019()'::regprocedure,
    'public.reject_immutable_statement_0019()'::regprocedure,
    'public.validate_snapshot_0019(text,text)'::regprocedure,
    'public.validate_snapshot_deferred_0019()'::regprocedure,
    'public.create_market_evidence_snapshot(jsonb)'::regprocedure,
    'public.create_scan_run_with_evidence_context(jsonb)'::regprocedure,
    'public.validate_run_binding_0019(text,uuid)'::regprocedure,
    'public.bind_pinned_run_market_events(text,uuid)'::regprocedure,
    'public.bind_live_run_market_events(text,uuid,text[])'::regprocedure,
    'public.save_reasoner_judgment_immutable(jsonb)'::regprocedure
    ,'public.protect_scan_run_identity_0019()'::regprocedure
    ,'public.protect_report_evidence_0019()'::regprocedure
    ,'public.protect_analysis_assessment_0019()'::regprocedure
    ,'public.save_intelligence_report_legacy_0019(jsonb,jsonb)'::regprocedure
    ,'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure
    ,'public.save_intelligence_report(jsonb,jsonb)'::regprocedure
    ,'public.reset_intelligence_products(text)'::regprocedure
  ] loop
    execute pg_catalog.format('alter function %s owner to vsee_registry_owner',function_identity);
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated',function_identity);
  end loop;
end;
$ownership$;

-- The stage-aware post-migration invariant runs as the migration executor and
-- invokes only this pure publication-window oracle. Keep default/API-role
-- EXECUTE revoked while allowing that exact read-only release check.
do $invariant_executor_grant$
begin
  execute pg_catalog.format(
    'grant execute on function public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text) to %I',
    current_user
  );
end;
$invariant_executor_grant$;

revoke update on public.intelligence_reports, public.company_analyses
  from vsee_registry_owner;
grant usage on schema public to vsee_registry_owner;
grant select,insert on public.scan_runs,public.market_evidence_snapshots,
  public.market_evidence_snapshot_events,public.run_evidence_bindings,
  public.run_market_events,public.reasoner_judgments to vsee_registry_owner;
grant select on public.workspaces,public.deals,public.market_events,
  public.workspace_test_generations to vsee_registry_owner;
grant select,insert,delete on public.intelligence_reports,
  public.company_analyses to vsee_registry_owner;
grant update(run_id,created_at,market_summary,opportunities,analysis_status,
  company_count,belief_revised_count,monitor_count,no_material_change_count,
  analysis_unavailable_count,priority_deal_id,evidence_coverage,
  eligible_snapshot_count,eligible_snapshot_fingerprint)
  on public.intelligence_reports to vsee_registry_owner;
grant update(evidence_context_version,evidence_mode,evidence_window_days,
  evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,
  evidence_window_timezone,evidence_snapshot_id,evidence_snapshot_fingerprint,
  evidence_context_fingerprint,evidence_display_label,evidence_event_count,
  evidence_event_set_fingerprint,evidence_binding_fingerprint)
  on public.intelligence_reports to vsee_registry_owner;
grant update(belief_assessment_version,belief_direction,belief_score_breakdown,
  belief_gate_context,belief_gate_results,belief_actions)
  on public.company_analyses to vsee_registry_owner;
grant execute on function public.create_market_evidence_snapshot(jsonb),
  public.create_scan_run_with_evidence_context(jsonb),
  public.bind_pinned_run_market_events(text,uuid),
  public.bind_live_run_market_events(text,uuid,text[]),
  public.save_reasoner_judgment_immutable(jsonb),
  public.save_intelligence_report(jsonb,jsonb),
  public.reset_intelligence_products(text) to service_role;

revoke create on schema public from vsee_registry_owner;

do $registry_owner_finish$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_registry_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_registry_owner did not return to its attested state';
  end if;
end;
$registry_owner_finish$;

-- Re-attest the isolated owner before commit.
do $owner_attestation$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='vsee_registry_owner'
    and not rolcanlogin and not rolinherit and not rolsuper and not rolcreaterole
    and not rolcreatedb and not rolreplication and not rolbypassrls)
  then raise exception 'VSEE_REGISTRY_OWNER_ATTESTATION_FAILED'; end if;
end;
$owner_attestation$;

commit;

notify pgrst, 'reload schema';

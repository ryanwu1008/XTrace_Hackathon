begin;

select public.prepare_isolated_owner_0021('vsee_registry_owner', false);
select public.prepare_isolated_owner_0021(
  'vsee_underwriting_owner', true
);

-- Local/disposable forward migration only. Production remains pinned at 0018.
-- Named Lens provider execution and final presentation artifacts are immutable,
-- candidate-local, and never update the shared scan-level report row.

alter table public.candidate_checkpoints
  drop constraint if exists candidate_checkpoints_stage_check;
alter table public.candidate_checkpoints
  add constraint candidate_checkpoints_stage_check check (
    stage in (
      'evidence_pack', 'context_router', 'valuation', 'framework_catalog',
      'framework_lenses', 'decision', 'named_lens_presentation',
      'narrative_drafts', 'finalization'
    )
  );

alter table public.candidate_runs
  drop constraint if exists candidate_runs_artifact_alias_shape_check;
alter table public.candidate_runs
  add constraint candidate_runs_artifact_alias_shape_check check (
    artifact_source_candidate_run_id is null
    or (
      status in ('completed', 'partial')
      and rerun_of_id = artifact_source_candidate_run_id
    )
  );

do $candidate_identity$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.candidate_runs'::regclass
      and conname = 'candidate_runs_workspace_id_deal_unique'
  ) then
    alter table public.candidate_runs
      add constraint candidate_runs_workspace_id_deal_unique
      unique (workspace_id, id, deal_id);
  end if;
end;
$candidate_identity$;

drop index if exists public.candidate_runs_completed_fingerprint_unique;
drop index if exists public.candidate_runs_terminal_fingerprint_unique;
create unique index candidate_runs_terminal_fingerprint_unique
on public.candidate_runs(workspace_id, candidate_analysis_fingerprint)
where status in ('completed', 'partial')
  and artifact_source_candidate_run_id is null;

create table public.decision_critical_evidence_projections (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  projection_id text not null check (btrim(projection_id) <> ''),
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint decision_critical_evidence_projections_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id)
);

create table public.named_lens_passage_attempt_events (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  judgment_or_catalog_candidate_id text not null check (
    btrim(judgment_or_catalog_candidate_id) <> ''
  ),
  logical_passage_id text not null check (btrim(logical_passage_id) <> ''),
  attempt_no integer not null check (attempt_no > 0),
  event_status text not null check (
    event_status in ('reserved', 'completed', 'failed', 'aborted')
  ),
  attempt_fingerprint text not null check (
    attempt_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  telemetry jsonb,
  failure_reason jsonb,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (
    workspace_id, candidate_run_id, logical_passage_id,
    attempt_no, event_status
  ),
  constraint named_lens_passage_attempt_events_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id),
  constraint named_lens_passage_attempt_events_settlement_shape_check check (
    (event_status = 'reserved' and telemetry is null and failure_reason is null)
    or (
      event_status = 'completed'
      and jsonb_typeof(telemetry) = 'object'
      and failure_reason is null
    )
    or (
      event_status in ('failed', 'aborted')
      and telemetry is null
      and jsonb_typeof(failure_reason) = 'object'
    )
  )
);

create table public.named_lens_dispositions (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  catalog_ordinal integer not null check (catalog_ordinal > 0),
  judgment_or_catalog_candidate_id text not null check (
    btrim(judgment_or_catalog_candidate_id) <> ''
  ),
  judgment_id text,
  disposition text not null check (
    disposition in (
      'context_inapplicable', 'ineligible', 'abstained', 'unavailable',
      'withheld', 'selected_main', 'appendix_only'
    )
  ),
  selected_position integer check (selected_position between 1 and 6),
  passage_fingerprint text check (
    passage_fingerprint is null
    or passage_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  projection_id text not null check (btrim(projection_id) <> ''),
  projection_fingerprint text not null check (
    projection_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  catalog_consideration_fingerprint text not null check (
    catalog_consideration_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  catalog_consideration jsonb not null check (
    jsonb_typeof(catalog_consideration) = 'object'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (
    workspace_id, candidate_run_id, judgment_or_catalog_candidate_id
  ),
  constraint named_lens_dispositions_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id),
  constraint named_lens_dispositions_publishable_shape_check check (
    (
      disposition = 'selected_main'
      and selected_position is not null
      and passage_fingerprint is not null
    )
    or (
      disposition = 'appendix_only'
      and selected_position is null
      and passage_fingerprint is not null
    )
    or (
      disposition not in ('selected_main', 'appendix_only')
      and selected_position is null
      and passage_fingerprint is null
    )
  ),
  unique (workspace_id, candidate_run_id, catalog_ordinal),
  unique (workspace_id, candidate_run_id, judgment_id),
  unique (workspace_id, candidate_run_id, selected_position)
);

create table public.named_lens_passages (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  judgment_id text not null check (btrim(judgment_id) <> ''),
  passage_fingerprint text not null check (
    passage_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id, judgment_id),
  constraint named_lens_passages_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id),
  constraint named_lens_passages_disposition_fkey
    foreign key (workspace_id, candidate_run_id, judgment_id)
    references public.named_lens_dispositions(
      workspace_id, candidate_run_id, judgment_id
    ),
  unique (workspace_id, candidate_run_id, passage_fingerprint)
);

create table public.named_lens_passage_segments (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  judgment_id text not null,
  segment_ordinal integer not null check (segment_ordinal between 1 and 5),
  segment_kind text not null check (
    segment_kind in (
      'premise', 'case_application', 'countercase', 'unknown_boundary',
      'conditional_conclusion'
    )
  ),
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (
    workspace_id, candidate_run_id, judgment_id, segment_ordinal
  ),
  constraint named_lens_passage_segments_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id),
  constraint named_lens_passage_segments_passage_fkey
    foreign key (workspace_id, candidate_run_id, judgment_id)
    references public.named_lens_passages(
      workspace_id, candidate_run_id, judgment_id
    ),
  unique (
    workspace_id, candidate_run_id, judgment_id, segment_kind
  )
);

create table public.underwriting_presentations (
  workspace_id text not null,
  candidate_run_id text not null,
  deal_id text not null,
  report_id text not null,
  presentation_fingerprint text not null check (
    presentation_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint underwriting_presentations_candidate_fkey
    foreign key (workspace_id, candidate_run_id, deal_id)
    references public.candidate_runs(workspace_id, id, deal_id),
  constraint underwriting_presentations_report_fkey
    foreign key (workspace_id, report_id)
    references public.intelligence_reports(workspace_id, id)
);

alter table public.decision_critical_evidence_projections
  owner to vsee_underwriting_owner;
alter table public.named_lens_passage_attempt_events
  owner to vsee_underwriting_owner;
alter table public.named_lens_dispositions
  owner to vsee_underwriting_owner;
alter table public.named_lens_passages
  owner to vsee_underwriting_owner;
alter table public.named_lens_passage_segments
  owner to vsee_underwriting_owner;
alter table public.underwriting_presentations
  owner to vsee_underwriting_owner;

grant select (workspace_id, id, run_id, analysis_status)
  on public.intelligence_reports to vsee_underwriting_owner;
grant select (workspace_id, report_id, run_id, deal_id)
  on public.company_analyses to vsee_underwriting_owner;
drop policy if exists intelligence_reports_underwriting_owner_0027
  on public.intelligence_reports;
create policy intelligence_reports_underwriting_owner_0027
  on public.intelligence_reports for select to vsee_underwriting_owner
  using (true);
drop policy if exists company_analyses_underwriting_owner_0027
  on public.company_analyses;
create policy company_analyses_underwriting_owner_0027
  on public.company_analyses for select to vsee_underwriting_owner
  using (true);

do $named_lens_segment_fingerprint$
declare
  digest_schema text;
begin
  select namespace.nspname into strict digest_schema
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as procedure_record
    on procedure_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and procedure_record.proname = 'digest'
    and procedure_record.proargtypes = '17 25'::oidvector;

  execute pg_catalog.format(
    'grant usage on schema %I to vsee_underwriting_owner',
    digest_schema
  );
  execute pg_catalog.format(
    $function$
create or replace function public.named_lens_segment_fingerprint_0027(
  p_segment jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $body$
  select 'sha256:' || pg_catalog.encode(
    %I.digest(
      pg_catalog.convert_to(
        public.canonical_ecmascript_jsonb_text_0023(p_segment),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$body$;
    $function$,
    digest_schema
  );
end;
$named_lens_segment_fingerprint$;
alter function public.named_lens_segment_fingerprint_0027(jsonb)
  owner to vsee_underwriting_owner;
revoke all on function public.named_lens_segment_fingerprint_0027(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.named_lens_segment_fingerprint_0027(jsonb)
  to vsee_underwriting_owner;
grant execute on function public.canonical_ecmascript_jsonb_text_0023(jsonb)
  to vsee_underwriting_owner;

create or replace function public.assert_named_lens_candidate_owner_0027()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.candidate_runs candidate
  where candidate.workspace_id = new.workspace_id
    and candidate.id = new.candidate_run_id
    and candidate.deal_id = new.deal_id
    and candidate.status = 'running'
    and candidate.artifact_source_candidate_run_id is null;
  if not found then
    raise exception
      'Named Lens artifacts require one running canonical candidate owner';
  end if;
  return new;
end;
$$;
alter function public.assert_named_lens_candidate_owner_0027()
  owner to vsee_underwriting_owner;

do $artifact_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'decision_critical_evidence_projections',
    'named_lens_passage_attempt_events',
    'named_lens_dispositions',
    'named_lens_passages',
    'named_lens_passage_segments',
    'underwriting_presentations'
  ]
  loop
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.assert_named_lens_candidate_owner_0027()',
      table_name || '_candidate_owner_0027', table_name
    );
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_immutable_underwriting_artifact()',
      table_name || '_immutable_0027', table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update, delete on table public.%I to vsee_underwriting_owner', table_name);
    execute format('grant select on table public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to vsee_underwriting_owner using (true) with check (true)',
      table_name || '_underwriting_owner_0027', table_name
    );
  end loop;
end;
$artifact_triggers$;

create or replace function public.reserve_named_lens_passage_attempt(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  candidate_id text := btrim(p_payload ->> 'artifactSourceCandidateRunId');
  candidate_key text := btrim(
    p_payload ->> 'judgmentOrCatalogCandidateId'
  );
  logical_id text := btrim(p_payload ->> 'logicalPassageId');
  attempt_number integer;
  fingerprint text := btrim(p_payload ->> 'attemptFingerprint');
  event_payload jsonb;
begin
  begin
    attempt_number := (p_payload ->> 'attemptNumber')::integer;
  exception when others then
    raise exception 'Named Lens reserve attempt number is invalid';
  end;
  select * into target
  from public.candidate_runs
  where workspace_id = btrim(p_payload ->> 'workspaceId')
    and id = candidate_id
  for update;
  if not found
    or target.status <> 'running'
    or target.artifact_source_candidate_run_id is not null
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception
      'Named Lens reserve requires the running canonical Candidate lease';
  end if;
  if candidate_key = '' or logical_id = '' or attempt_number <= 0
    or fingerprint !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'Named Lens reserve attempt identity is invalid';
  end if;
  if attempt_number <> coalesce((
      select max(event.attempt_no) + 1
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = target.workspace_id
        and event.candidate_run_id = target.id
        and event.logical_passage_id = logical_id
        and event.event_status = 'reserved'
    ), 1)
  then
    raise exception 'Named Lens reserve attempt numbers must be monotonic';
  end if;
  event_payload := jsonb_build_object(
    'workspaceId', target.workspace_id,
    'artifactSourceCandidateRunId', target.id,
    'judgmentOrCatalogCandidateId', candidate_key,
    'logicalPassageId', logical_id,
    'attemptNumber', attempt_number,
    'attemptFingerprint', fingerprint,
    'status', 'reserved',
    'telemetry', null,
    'failureReason', null
  );
  insert into public.named_lens_passage_attempt_events (
    workspace_id, candidate_run_id, deal_id,
    judgment_or_catalog_candidate_id, logical_passage_id, attempt_no,
    event_status, attempt_fingerprint, telemetry, failure_reason, payload
  ) values (
    target.workspace_id, target.id, target.deal_id,
    candidate_key, logical_id, attempt_number,
    'reserved', fingerprint, null, null, event_payload
  );
  return event_payload;
end;
$$;
alter function public.reserve_named_lens_passage_attempt(jsonb)
  owner to vsee_underwriting_owner;

create or replace function public.settle_named_lens_passage_attempt(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  reserved public.named_lens_passage_attempt_events%rowtype;
  candidate_id text := btrim(p_payload ->> 'artifactSourceCandidateRunId');
  candidate_key text := btrim(
    p_payload ->> 'judgmentOrCatalogCandidateId'
  );
  logical_id text := btrim(p_payload ->> 'logicalPassageId');
  attempt_number integer;
  fingerprint text := btrim(p_payload ->> 'attemptFingerprint');
  settlement_status text := btrim(p_payload ->> 'status');
  telemetry_payload jsonb := p_payload -> 'telemetry';
  failure_payload jsonb := p_payload -> 'failureReason';
  event_payload jsonb;
begin
  begin
    attempt_number := (p_payload ->> 'attemptNumber')::integer;
  exception when others then
    raise exception 'Named Lens settlement attempt number is invalid';
  end;
  select * into target
  from public.candidate_runs
  where workspace_id = btrim(p_payload ->> 'workspaceId')
    and id = candidate_id
  for update;
  if not found
    or target.status <> 'running'
    or target.artifact_source_candidate_run_id is not null
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception
      'Named Lens settlement requires the running canonical Candidate lease';
  end if;
  select * into reserved
  from public.named_lens_passage_attempt_events event
  where event.workspace_id = target.workspace_id
    and event.candidate_run_id = target.id
    and event.logical_passage_id = logical_id
    and event.attempt_no = attempt_number
    and event.event_status = 'reserved'
  for key share;
  if not found
    or reserved.judgment_or_catalog_candidate_id <> candidate_key
    or reserved.attempt_fingerprint <> fingerprint
  then
    raise exception
      'Named Lens settlement requires the exact reserved attempt fingerprint';
  end if;
  if settlement_status not in ('completed', 'failed', 'aborted')
    or (
      settlement_status = 'completed'
      and (
        jsonb_typeof(telemetry_payload) <> 'object'
        or failure_payload <> 'null'::jsonb
      )
    )
    or (
      settlement_status in ('failed', 'aborted')
      and (
        telemetry_payload <> 'null'::jsonb
        or jsonb_typeof(failure_payload) <> 'object'
      )
    )
  then
    raise exception 'Named Lens settlement telemetry shape is invalid';
  end if;
  if exists (
    select 1
    from public.named_lens_passage_attempt_events event
    where event.workspace_id = target.workspace_id
      and event.candidate_run_id = target.id
      and event.logical_passage_id = logical_id
      and event.attempt_no = attempt_number
      and event.event_status in ('completed', 'failed', 'aborted')
  ) then
    raise exception 'Named Lens provider attempt is already settled';
  end if;
  event_payload := jsonb_build_object(
    'workspaceId', target.workspace_id,
    'artifactSourceCandidateRunId', target.id,
    'judgmentOrCatalogCandidateId', candidate_key,
    'logicalPassageId', logical_id,
    'attemptNumber', attempt_number,
    'attemptFingerprint', fingerprint,
    'status', settlement_status,
    'telemetry', telemetry_payload,
    'failureReason', failure_payload
  );
  insert into public.named_lens_passage_attempt_events (
    workspace_id, candidate_run_id, deal_id,
    judgment_or_catalog_candidate_id, logical_passage_id, attempt_no,
    event_status, attempt_fingerprint, telemetry, failure_reason, payload
  ) values (
    target.workspace_id, target.id, target.deal_id,
    candidate_key, logical_id, attempt_number,
    settlement_status, fingerprint,
    nullif(telemetry_payload, 'null'::jsonb),
    nullif(failure_payload, 'null'::jsonb), event_payload
  );
  return event_payload;
end;
$$;
alter function public.settle_named_lens_passage_attempt(jsonb)
  owner to vsee_underwriting_owner;

revoke all on function public.reserve_named_lens_passage_attempt(jsonb),
  public.settle_named_lens_passage_attempt(jsonb)
from public, anon, authenticated;
grant execute on function public.reserve_named_lens_passage_attempt(jsonb),
  public.settle_named_lens_passage_attempt(jsonb)
to service_role;

create or replace function public.named_lens_local_identity_0027(
  p_value jsonb,
  p_workspace_id text,
  p_candidate_run_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and pg_catalog.jsonb_typeof(p_value -> 'workspaceId') = 'string'
    and pg_catalog.btrim(p_value ->> 'workspaceId') <> ''
    and (p_value ->> 'workspaceId') is not distinct from p_workspace_id
    and pg_catalog.jsonb_typeof(
      p_value -> 'artifactSourceCandidateRunId'
    ) = 'string'
    and pg_catalog.btrim(
      p_value ->> 'artifactSourceCandidateRunId'
    ) <> ''
    and (p_value ->> 'artifactSourceCandidateRunId')
      is not distinct from p_candidate_run_id,
    false
  )
$$;

create or replace function public.named_lens_text_array_subset_0027(
  p_actual jsonb,
  p_allowed jsonb,
  p_require_nonempty boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_actual) is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_allowed) is distinct from 'array'
    or (p_require_nonempty and pg_catalog.jsonb_array_length(p_actual) = 0)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_actual) item
      where pg_catalog.jsonb_typeof(item) <> 'string'
        or pg_catalog.btrim(item #>> '{}') = ''
        or not exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_allowed) allowed
          where pg_catalog.jsonb_typeof(allowed) = 'string'
            and allowed #>> '{}' = item #>> '{}'
        )
    )
    or (
      select pg_catalog.count(*)
        <> pg_catalog.count(distinct item #>> '{}')
      from pg_catalog.jsonb_array_elements(p_actual) item
    )
  then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.named_lens_card_field_text_0027(
  p_component jsonb,
  p_field_ref text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  current_value jsonb := p_component;
  token text;
begin
  if p_field_ref is null
    or p_field_ref !~ '^[A-Za-z][A-Za-z0-9]*(?:(?:\.[A-Za-z][A-Za-z0-9]*)|(?:\[[0-9]+\]))*$'
  then
    return null;
  end if;
  for token in
    select match[1]
    from pg_catalog.regexp_matches(
      p_field_ref, '([A-Za-z][A-Za-z0-9]*|[0-9]+)', 'g'
    ) match
  loop
    if pg_catalog.jsonb_typeof(current_value) = 'array'
      and token ~ '^[0-9]+$'
    then
      if token::integer >= pg_catalog.jsonb_array_length(current_value) then
        return null;
      end if;
      current_value := current_value -> token::integer;
    elsif pg_catalog.jsonb_typeof(current_value) = 'object'
      and current_value ? token
    then
      current_value := current_value -> token;
    else
      return null;
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(current_value) is distinct from 'string' then
    return null;
  end if;
  return current_value #>> '{}';
end;
$$;

create or replace function public.named_lens_evidence_ids_0027(
  p_evidence_pack jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(item_id order by item_id), '[]'::jsonb
  )
  from (
    select item ->> 'id' as item_id
    from pg_catalog.jsonb_array_elements(
      coalesce(p_evidence_pack -> 'facts', '[]'::jsonb)
    ) item
    union all
    select item ->> 'id'
    from pg_catalog.jsonb_array_elements(
      coalesce(p_evidence_pack -> 'assumptions', '[]'::jsonb)
    ) item
  ) saved
$$;

create or replace function public.named_lens_projection_ids_0027(
  p_projection jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(item ->> 'evidencePackItemId'
      order by item ->> 'evidencePackItemId'),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(
    coalesce(p_projection -> 'evidenceRefs', '[]'::jsonb)
  ) item
$$;

create or replace function public.named_lens_passage_authoritative_0027(
  p_passage jsonb,
  p_judgments jsonb,
  p_dispositions jsonb,
  p_projection jsonb,
  p_evidence_pack jsonb,
  p_workspace_id text,
  p_candidate_run_id text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  judgment jsonb;
  disposition jsonb;
  premise jsonb := p_passage -> 'premise';
  case_segment jsonb := p_passage -> 'caseApplication';
  counter_segment jsonb := p_passage -> 'countercase';
  unknown_segment jsonb := p_passage -> 'unknownBoundary';
  conclusion_segment jsonb := p_passage -> 'conditionalConclusion';
  component jsonb;
  source_id jsonb;
  pack_ids jsonb := public.named_lens_evidence_ids_0027(p_evidence_pack);
  projection_ids jsonb := public.named_lens_projection_ids_0027(p_projection);
  judgment_evidence_ids jsonb;
begin
  if public.named_lens_local_identity_0027(
      p_passage, p_workspace_id, p_candidate_run_id
    ) is distinct from true
    or pg_catalog.jsonb_typeof(p_passage -> 'judgmentId')
      is distinct from 'string'
    or pg_catalog.btrim(p_passage ->> 'judgmentId') = ''
    or pg_catalog.jsonb_typeof(p_passage -> 'frameworkCardId')
      is distinct from 'string'
    or pg_catalog.btrim(p_passage ->> 'frameworkCardId') = ''
    or pg_catalog.jsonb_typeof(p_passage -> 'frameworkVersion')
      is distinct from 'string'
    or pg_catalog.btrim(p_passage ->> 'frameworkVersion') = ''
    or pg_catalog.jsonb_typeof(p_passage -> 'decisionQuestionCode')
      is distinct from 'string'
    or pg_catalog.btrim(p_passage ->> 'decisionQuestionCode') = ''
    or pg_catalog.jsonb_typeof(p_passage -> 'schemaVersion')
      is distinct from 'string'
    or (p_passage ->> 'schemaVersion')
      is distinct from 'named-lens-passage-v1'
    or pg_catalog.jsonb_typeof(p_passage -> 'generatorVersion')
      is distinct from 'string'
    or (p_passage ->> 'generatorVersion')
      is distinct from 'named-lens-generator-v1'
    or pg_catalog.jsonb_typeof(p_passage -> 'fingerprint')
      is distinct from 'string'
    or (p_passage ->> 'fingerprint') !~ '^sha256:[0-9a-f]{64}$'
    or p_passage -> 'advisoryContract' is distinct from
      pg_catalog.jsonb_build_object(
        'formalDecisionWeight', '0',
        'noEndorsement', true,
        'namedPersonImpersonation', false,
        'hiddenChainOfThought', false
      )
    or pg_catalog.jsonb_typeof(premise) is distinct from 'object'
    or pg_catalog.jsonb_typeof(case_segment) is distinct from 'object'
    or pg_catalog.jsonb_typeof(counter_segment) is distinct from 'object'
    or pg_catalog.jsonb_typeof(unknown_segment) is distinct from 'object'
    or pg_catalog.jsonb_typeof(conclusion_segment) is distinct from 'object'
    or pg_catalog.btrim(coalesce(premise ->> 'text', '')) = ''
    or pg_catalog.btrim(coalesce(case_segment ->> 'text', '')) = ''
    or pg_catalog.btrim(coalesce(counter_segment ->> 'text', '')) = ''
    or pg_catalog.btrim(coalesce(unknown_segment ->> 'text', '')) = ''
    or pg_catalog.btrim(coalesce(conclusion_segment ->> 'text', '')) = ''
  then
    return false;
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(
      coalesce(p_judgments, '[]'::jsonb)
    ) item
    where pg_catalog.jsonb_typeof(item -> 'id') = 'string'
      and (item ->> 'id') is not distinct from (p_passage ->> 'judgmentId')
      and (item ->> 'frameworkCardId')
        is not distinct from (p_passage ->> 'frameworkCardId')
      and (item ->> 'frameworkVersion')
        is not distinct from (p_passage ->> 'frameworkVersion')
      and item ->> 'analysisType' = 'framework_judgment'
      and item ->> 'applicability' = 'applicable'
      and item ->> 'conclusion' in ('supportive', 'mixed', 'negative')
      and pg_catalog.jsonb_typeof(item -> 'frameworkMetadata') = 'object'
      and pg_catalog.jsonb_typeof(item -> 'counterevidenceBoundary') = 'object'
  ) <> 1 then
    return false;
  end if;
  select item into judgment
  from pg_catalog.jsonb_array_elements(p_judgments) item
  where (item ->> 'id') is not distinct from (p_passage ->> 'judgmentId')
    and (item ->> 'frameworkCardId')
      is not distinct from (p_passage ->> 'frameworkCardId')
    and (item ->> 'frameworkVersion')
      is not distinct from (p_passage ->> 'frameworkVersion')
    and item ->> 'applicability' = 'applicable';

  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(
      coalesce(p_dispositions, '[]'::jsonb)
    ) item
    where (item ->> 'judgmentId')
      is not distinct from (p_passage ->> 'judgmentId')
      and (item ->> 'passageFingerprint')
        is not distinct from (p_passage ->> 'fingerprint')
      and item ->> 'disposition' in ('selected_main', 'appendix_only')
  ) <> 1 then
    return false;
  end if;
  select item into disposition
  from pg_catalog.jsonb_array_elements(p_dispositions) item
  where (item ->> 'judgmentId')
      is not distinct from (p_passage ->> 'judgmentId')
    and (item ->> 'passageFingerprint')
      is not distinct from (p_passage ->> 'fingerprint')
    and item ->> 'disposition' in ('selected_main', 'appendix_only');

  select coalesce(
    pg_catalog.jsonb_agg(value order by value), '[]'::jsonb
  ) into judgment_evidence_ids
  from (
    select value
    from pg_catalog.jsonb_array_elements_text(
      coalesce(judgment -> 'supportEvidenceItemIds', '[]'::jsonb)
    ) value
    union
    select value
    from pg_catalog.jsonb_array_elements_text(
      coalesce(judgment -> 'counterEvidenceItemIds', '[]'::jsonb)
    ) value
  ) saved;

  if (disposition ->> 'frameworkCardId')
      is distinct from (p_passage ->> 'frameworkCardId')
    or (disposition ->> 'frameworkVersion')
      is distinct from (p_passage ->> 'frameworkVersion')
    or (disposition ->> 'decisionQuestionCode')
      is distinct from (p_passage ->> 'decisionQuestionCode')
    or (disposition ->> 'stance')
      is distinct from (conclusion_segment ->> 'stance')
    or (disposition ->> 'advisoryPosture')
      is distinct from (conclusion_segment ->> 'advisoryPosture')
    or (conclusion_segment ->> 'stance')
      is distinct from (judgment ->> 'conclusion')
    or (conclusion_segment ->> 'advisoryPosture')
      is distinct from public.named_lens_posture_for_stance_0027(
        judgment ->> 'conclusion'
      )
    or p_passage -> 'selectionBasisEvidenceIds'
      is distinct from disposition -> 'selectionBasisEvidenceIds'
    or public.named_lens_text_array_subset_0027(
      disposition -> 'selectionBasisEvidenceIds', projection_ids,
      disposition ->> 'disposition' = 'selected_main'
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      disposition -> 'selectionBasisEvidenceIds', judgment_evidence_ids,
      false
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      case_segment -> 'evidenceItemIds', pack_ids, true
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      case_segment -> 'evidenceItemIds',
      judgment -> 'supportEvidenceItemIds', true
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      counter_segment -> 'evidenceItemIds', pack_ids,
      counter_segment ->> 'boundaryKind' = 'grounded_counterevidence'
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      counter_segment -> 'evidenceItemIds',
      judgment -> 'counterEvidenceItemIds',
      counter_segment ->> 'boundaryKind' = 'grounded_counterevidence'
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      unknown_segment -> 'judgmentUnknownRefs', judgment -> 'unknowns', false
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      unknown_segment -> 'judgmentLimitationRefs', judgment -> 'limitations',
      false
    ) is distinct from true
    or (counter_segment ->> 'boundaryKind')
      is distinct from (judgment -> 'counterevidenceBoundary' ->> 'kind')
    or counter_segment -> 'evidenceRequestRefs'
      is distinct from judgment -> 'counterevidenceBoundary'
        -> 'evidenceRequestRefs'
    or public.named_lens_text_array_subset_0027(
      unknown_segment -> 'evidenceRequestRefs',
      judgment -> 'counterevidenceBoundary' -> 'evidenceRequestRefs', false
    ) is distinct from true
    or (
      pg_catalog.jsonb_array_length(
        unknown_segment -> 'judgmentUnknownRefs'
      ) = 0
      and pg_catalog.jsonb_array_length(
        unknown_segment -> 'judgmentLimitationRefs'
      ) = 0
      and pg_catalog.jsonb_array_length(
        unknown_segment -> 'evidenceRequestRefs'
      ) = 0
    )
    or pg_catalog.jsonb_typeof(disposition -> 'criticalEvidence')
      is distinct from 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        disposition -> 'criticalEvidence'
      ) critical
      where pg_catalog.jsonb_typeof(critical) is distinct from 'object'
        or pg_catalog.jsonb_typeof(critical -> 'evidencePackItemId')
          is distinct from 'string'
        or (
          select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(
            p_projection -> 'evidenceRefs'
          ) projected
          where (projected ->> 'evidencePackItemId')
              is not distinct from (critical ->> 'evidencePackItemId')
            and (projected ->> 'classification')
              is not distinct from (critical ->> 'classification')
        ) <> 1
    )
  then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(premise -> 'componentFrameworkId')
      is distinct from 'string'
    or pg_catalog.btrim(premise ->> 'componentFrameworkId') = ''
    or pg_catalog.jsonb_typeof(premise -> 'componentVersion')
      is distinct from 'string'
    or pg_catalog.btrim(premise ->> 'componentVersion') = ''
    or pg_catalog.jsonb_typeof(premise -> 'cardFieldRef')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(premise -> 'locator')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(premise -> 'attributionScope')
      is distinct from 'string'
    or public.named_lens_text_array_subset_0027(
      premise -> 'publicSourceIds',
      (
        select coalesce(
          pg_catalog.jsonb_agg(source ->> 'sourceId'), '[]'::jsonb
        )
        from pg_catalog.jsonb_array_elements(
          judgment -> 'frameworkMetadata' -> 'sources'
        ) source
      ), true
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      pg_catalog.jsonb_build_array(premise ->> 'componentFrameworkId'),
      judgment -> 'frameworkMetadata' -> 'componentCardIds', true
    ) is distinct from true
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(
        judgment -> 'frameworkMetadata' -> 'components'
      ) item
      where (item ->> 'frameworkId')
          is not distinct from (premise ->> 'componentFrameworkId')
        and (item ->> 'version')
          is not distinct from (premise ->> 'componentVersion')
    ) <> 1
  then
    return false;
  end if;
  select item into component
  from pg_catalog.jsonb_array_elements(
    judgment -> 'frameworkMetadata' -> 'components'
  ) item
  where (item ->> 'frameworkId')
      is not distinct from (premise ->> 'componentFrameworkId')
    and (item ->> 'version')
      is not distinct from (premise ->> 'componentVersion');
  if public.named_lens_card_field_text_0027(
      component, premise ->> 'cardFieldRef'
    ) is null
  then
    return false;
  end if;
  for source_id in
    select value
    from pg_catalog.jsonb_array_elements(premise -> 'publicSourceIds') value
  loop
    if (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(component -> 'sourceRefs') ref
      where pg_catalog.jsonb_typeof(ref -> 'sourceId') = 'string'
        and (ref ->> 'sourceId') is not distinct from (source_id #>> '{}')
        and (ref ->> 'attributionScope')
          is not distinct from (premise ->> 'attributionScope')
        and ref -> 'locator' is not distinct from premise -> 'locator'
        and public.named_lens_text_array_subset_0027(
          premise -> 'claimIds', ref -> 'claimIds', true
        )
    ) < 1 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.named_lens_posture_for_stance_0027(
  p_stance text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stance
    when 'supportive' then 'supports_further_diligence'
    when 'negative' then 'urges_caution'
    when 'mixed' then 'withholds_view'
    when 'abstain' then 'withholds_view'
    else null
  end
$$;

create or replace function public.named_lens_presentation_authoritative_0027(
  p_presentation jsonb,
  p_passages jsonb,
  p_dispositions jsonb,
  p_decision jsonb,
  p_evidence_pack jsonb,
  p_workspace_id text,
  p_candidate_run_id text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  synthesis jsonb := p_presentation -> 'synthesis';
  first_screen jsonb := p_presentation -> 'firstScreenProjectionRefs';
  citation jsonb;
  passage jsonb;
  selected_judgment_ids jsonb;
  selected_evidence_ids jsonb;
  decision_evidence_ids jsonb;
  pack_ids jsonb := public.named_lens_evidence_ids_0027(p_evidence_pack);
  allowed_evidence jsonb;
  allowed_sources jsonb;
  allowed_claims jsonb;
  allowed_unknowns jsonb;
  allowed_limitations jsonb;
  allowed_requests jsonb;
  allowed_stances jsonb;
  allowed_postures jsonb;
begin
  if public.named_lens_local_identity_0027(
      p_presentation, p_workspace_id, p_candidate_run_id
    ) is distinct from true
    or pg_catalog.jsonb_typeof(p_presentation -> 'schemaVersion')
      is distinct from 'string'
    or (p_presentation ->> 'schemaVersion')
      is distinct from 'decision-first-named-lens-v1'
    or pg_catalog.jsonb_typeof(p_presentation -> 'rendererVersion')
      is distinct from 'string'
    or pg_catalog.btrim(p_presentation ->> 'rendererVersion') = ''
    or pg_catalog.jsonb_typeof(p_presentation -> 'fingerprint')
      is distinct from 'string'
    or (p_presentation ->> 'fingerprint') !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(synthesis) is distinct from 'object'
    or pg_catalog.jsonb_typeof(first_screen) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_presentation -> 'segmentCitations')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(synthesis -> 'judgmentIds')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(synthesis -> 'evidenceItemIds')
      is distinct from 'array'
    or pg_catalog.btrim(coalesce(synthesis ->> 'text', '')) = ''
    or pg_catalog.jsonb_typeof(first_screen -> 'decisionId')
      is distinct from 'string'
    or (first_screen ->> 'decisionId')
      is distinct from (p_decision ->> 'id')
    or pg_catalog.jsonb_typeof(first_screen -> 'decisionEvidenceItemIds')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(first_screen -> 'selectedJudgmentIds')
      is distinct from 'array'
  then
    return false;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      item -> 'judgmentId'
      order by (item ->> 'selectedPosition')::integer
    ),
    '[]'::jsonb
  ) into selected_judgment_ids
  from pg_catalog.jsonb_array_elements(p_dispositions) item
  where item ->> 'disposition' = 'selected_main';
  if first_screen -> 'selectedJudgmentIds'
      is distinct from selected_judgment_ids
  then
    return false;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      selected.evidence_id order by selected.evidence_id
    ), '[]'::jsonb
  ) into selected_evidence_ids
  from (
    select basis.evidence_id
    from pg_catalog.jsonb_array_elements(p_dispositions)
        disposition(item),
      lateral pg_catalog.jsonb_array_elements_text(
        coalesce(
          disposition.item -> 'selectionBasisEvidenceIds', '[]'::jsonb
        )
      ) basis(evidence_id)
    where disposition.item ->> 'disposition' = 'selected_main'
    union
    select critical.item ->> 'evidencePackItemId'
    from pg_catalog.jsonb_array_elements(p_dispositions)
        disposition(item),
      lateral pg_catalog.jsonb_array_elements(
        coalesce(disposition.item -> 'criticalEvidence', '[]'::jsonb)
      ) critical(item)
    where disposition.item ->> 'disposition' = 'selected_main'
  ) selected(evidence_id);
  select coalesce(
    pg_catalog.jsonb_agg(
      decision_reference.evidence_id
      order by decision_reference.evidence_id
    ), '[]'::jsonb
  ) into decision_evidence_ids
  from (
    select blocked.evidence_id
    from pg_catalog.jsonb_array_elements_text(
      coalesce(p_decision -> 'blockingEvidenceItemIds', '[]'::jsonb)
    ) blocked(evidence_id)
    union
    select input_ref.evidence_id
    from pg_catalog.jsonb_array_elements(
      coalesce(p_decision -> 'firedRules', '[]'::jsonb)
    ) rule(item),
      lateral pg_catalog.jsonb_array_elements_text(
        coalesce(rule.item -> 'inputRefs', '[]'::jsonb)
      ) input_ref(evidence_id)
    union
    select edge.item ->> 'dependencyItemId'
    from pg_catalog.jsonb_array_elements(
      coalesce(p_decision -> 'claimEdges', '[]'::jsonb)
    ) edge(item)
    where edge.item ->> 'dependencyType' in ('fact', 'assumption')
  ) decision_reference(evidence_id)
  where public.named_lens_text_array_subset_0027(
    pg_catalog.jsonb_build_array(decision_reference.evidence_id),
    pack_ids, true
  );

  if public.named_lens_text_array_subset_0027(
      first_screen -> 'decisionEvidenceItemIds', decision_evidence_ids, false
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      synthesis -> 'judgmentIds', selected_judgment_ids, false
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      synthesis -> 'evidenceItemIds', selected_evidence_ids, false
    ) is distinct from true
    or public.named_lens_text_array_subset_0027(
      synthesis -> 'evidenceItemIds', pack_ids, false
    ) is distinct from true
  then
    return false;
  end if;

  for citation in
    select value
    from pg_catalog.jsonb_array_elements(
      p_presentation -> 'segmentCitations'
    ) value
  loop
    if pg_catalog.jsonb_typeof(citation) is distinct from 'object'
      or pg_catalog.jsonb_typeof(citation -> 'judgmentId')
        is distinct from 'string'
      or citation ->> 'segment' not in (
        'premise', 'case_application', 'countercase', 'unknown_boundary',
        'conditional_conclusion', 'synthesis'
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(p_passages) saved_passage
        join pg_catalog.jsonb_array_elements(p_dispositions) disposition
          on disposition ->> 'judgmentId'
            = saved_passage ->> 'judgmentId'
          and disposition ->> 'passageFingerprint'
            = saved_passage ->> 'fingerprint'
          and disposition ->> 'disposition' = 'selected_main'
        where saved_passage ->> 'judgmentId'
          = citation ->> 'judgmentId'
      ) <> 1
    then
      return false;
    end if;
    select saved_passage into passage
    from pg_catalog.jsonb_array_elements(p_passages) saved_passage
    join pg_catalog.jsonb_array_elements(p_dispositions) disposition
      on disposition ->> 'judgmentId' = saved_passage ->> 'judgmentId'
      and disposition ->> 'passageFingerprint'
        = saved_passage ->> 'fingerprint'
      and disposition ->> 'disposition' = 'selected_main'
    where saved_passage ->> 'judgmentId' = citation ->> 'judgmentId';

    allowed_evidence := case citation ->> 'segment'
      when 'case_application' then
        passage -> 'caseApplication' -> 'evidenceItemIds'
      when 'countercase' then passage -> 'countercase' -> 'evidenceItemIds'
      when 'synthesis' then synthesis -> 'evidenceItemIds'
      else '[]'::jsonb
    end;
    allowed_sources := case citation ->> 'segment'
      when 'premise' then passage -> 'premise' -> 'publicSourceIds'
      else '[]'::jsonb
    end;
    allowed_claims := case citation ->> 'segment'
      when 'premise' then passage -> 'premise' -> 'claimIds'
      else '[]'::jsonb
    end;
    allowed_unknowns := case citation ->> 'segment'
      when 'unknown_boundary' then
        passage -> 'unknownBoundary' -> 'judgmentUnknownRefs'
      else '[]'::jsonb
    end;
    allowed_limitations := case citation ->> 'segment'
      when 'unknown_boundary' then
        passage -> 'unknownBoundary' -> 'judgmentLimitationRefs'
      else '[]'::jsonb
    end;
    allowed_requests := case citation ->> 'segment'
      when 'unknown_boundary' then
        passage -> 'unknownBoundary' -> 'evidenceRequestRefs'
      when 'countercase' then
        passage -> 'countercase' -> 'evidenceRequestRefs'
      else '[]'::jsonb
    end;
    allowed_stances := case citation ->> 'segment'
      when 'conditional_conclusion' then pg_catalog.jsonb_build_array(
        passage -> 'conditionalConclusion' ->> 'stance'
      )
      else '[]'::jsonb
    end;
    allowed_postures := case citation ->> 'segment'
      when 'conditional_conclusion' then pg_catalog.jsonb_build_array(
        passage -> 'conditionalConclusion' ->> 'advisoryPosture'
      )
      else '[]'::jsonb
    end;
    if public.named_lens_text_array_subset_0027(
        citation -> 'evidenceItemIds', allowed_evidence, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'publicSourceIds', allowed_sources, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'claimIds', allowed_claims, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'judgmentUnknownRefs', allowed_unknowns, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'judgmentLimitationRefs', allowed_limitations, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'evidenceRequestRefs', allowed_requests, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'stanceRefs', allowed_stances, false
      ) is distinct from true
      or public.named_lens_text_array_subset_0027(
        citation -> 'advisoryPostureRefs', allowed_postures, false
      ) is distinct from true
    then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter function public.named_lens_local_identity_0027(jsonb, text, text)
  owner to vsee_underwriting_owner;
alter function public.named_lens_text_array_subset_0027(
  jsonb, jsonb, boolean
) owner to vsee_underwriting_owner;
alter function public.named_lens_posture_for_stance_0027(text)
  owner to vsee_underwriting_owner;
alter function public.named_lens_card_field_text_0027(jsonb, text)
  owner to vsee_underwriting_owner;
alter function public.named_lens_evidence_ids_0027(jsonb)
  owner to vsee_underwriting_owner;
alter function public.named_lens_projection_ids_0027(jsonb)
  owner to vsee_underwriting_owner;
alter function public.named_lens_passage_authoritative_0027(
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text
) owner to vsee_underwriting_owner;
alter function public.named_lens_presentation_authoritative_0027(
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text
) owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_local_identity_0027(jsonb, text, text),
  public.named_lens_text_array_subset_0027(jsonb, jsonb, boolean),
  public.named_lens_posture_for_stance_0027(text),
  public.named_lens_card_field_text_0027(jsonb, text),
  public.named_lens_evidence_ids_0027(jsonb),
  public.named_lens_projection_ids_0027(jsonb),
  public.named_lens_passage_authoritative_0027(
    jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  ),
  public.named_lens_presentation_authoritative_0027(
    jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_local_identity_0027(jsonb, text, text),
  public.named_lens_text_array_subset_0027(jsonb, jsonb, boolean),
  public.named_lens_posture_for_stance_0027(text),
  public.named_lens_card_field_text_0027(jsonb, text),
  public.named_lens_evidence_ids_0027(jsonb),
  public.named_lens_projection_ids_0027(jsonb),
  public.named_lens_passage_authoritative_0027(
    jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  ),
  public.named_lens_presentation_authoritative_0027(
    jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  )
to vsee_underwriting_owner;

create or replace function public.assert_named_lens_presentation_finalization_0027(
  p_payload jsonb,
  p_workspace_id text,
  p_candidate_run_id text,
  p_deal_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  catalog jsonb := p_payload -> 'namedLensCatalogConsiderations';
  projection jsonb := p_payload -> 'decisionCriticalEvidenceProjection';
  attempt_refs jsonb := p_payload -> 'namedLensAttemptRefs';
  dispositions jsonb := p_payload -> 'namedLensDispositions';
  passages jsonb := p_payload -> 'namedLensPassages';
  presentation jsonb := p_payload -> 'namedLensPresentation';
  report_id text := btrim(p_payload ->> 'underwritingPresentationReportId');
  terminal_status text := btrim(p_payload ->> 'terminalStatus');
  terminal_reasons jsonb := p_payload -> 'terminalReasonCodes';
  evidence_pack jsonb := p_payload -> 'evidencePack';
  consideration_value jsonb;
  disposition_value jsonb;
  passage_value jsonb;
  segment_value jsonb;
  segment_kind text;
  selected_count integer;
  passage_count integer;
  applicable_count integer;
  unavailable_applicable_count integer;
  catalog_ordinal_value bigint;
  segment_ordinal integer;
begin
  if jsonb_typeof(version_snapshot -> 'namedLensSelectionPolicyVersion')
      is distinct from 'string'
    or (version_snapshot ->> 'namedLensSelectionPolicyVersion')
      is distinct from 'named-lens-selection-v1'
    or jsonb_typeof(version_snapshot -> 'namedLensPassageSchemaVersion')
      is distinct from 'string'
    or (version_snapshot ->> 'namedLensPassageSchemaVersion')
      is distinct from 'named-lens-passage-v1'
    or jsonb_typeof(version_snapshot -> 'namedLensGeneratorVersion')
      is distinct from 'string'
    or (version_snapshot ->> 'namedLensGeneratorVersion')
      is distinct from 'named-lens-generator-v1'
    or jsonb_typeof(
      version_snapshot -> 'underwritingPresentationSchemaVersion'
    ) is distinct from 'string'
    or (version_snapshot ->> 'underwritingPresentationSchemaVersion')
      is distinct from 'decision-first-named-lens-v1'
    or jsonb_typeof(version_snapshot -> 'decisionTaxonomyVersion')
      is distinct from 'string'
    or (version_snapshot ->> 'decisionTaxonomyVersion')
      is distinct from 'named-lens-decision-taxonomy-v1'
    or jsonb_typeof(catalog) is distinct from 'array'
    or jsonb_typeof(projection) is distinct from 'object'
    or jsonb_typeof(attempt_refs) is distinct from 'array'
    or jsonb_typeof(dispositions) is distinct from 'array'
    or jsonb_typeof(passages) is distinct from 'array'
    or jsonb_typeof(presentation) is distinct from 'object'
    or jsonb_typeof(terminal_reasons) is distinct from 'array'
    or jsonb_typeof(p_payload -> 'underwritingPresentationReportId')
      is distinct from 'string'
    or report_id = ''
    or jsonb_typeof(p_payload -> 'terminalStatus')
      is distinct from 'string'
    or terminal_status not in ('completed', 'partial')
  then
    raise exception 'Current Named Lens finalization contract is incomplete';
  end if;

  if public.named_lens_local_identity_0027(
      projection, p_workspace_id, p_candidate_run_id
    ) is distinct from true
    or jsonb_typeof(projection -> 'id') is distinct from 'string'
    or btrim(projection ->> 'id') = ''
    or jsonb_typeof(projection -> 'fingerprint') is distinct from 'string'
    or projection ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(projection -> 'evidenceRefs') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(projection -> 'evidenceRefs') evidence
      where jsonb_typeof(evidence) is distinct from 'object'
        or jsonb_typeof(evidence -> 'evidencePackItemId')
          is distinct from 'string'
        or btrim(evidence ->> 'evidencePackItemId') = ''
        or jsonb_typeof(evidence -> 'classification')
          is distinct from 'string'
        or evidence ->> 'classification' not in ('fact', 'assumption')
        or (
          select count(*)
          from jsonb_array_elements(
            case evidence ->> 'classification'
              when 'fact' then evidence_pack -> 'facts'
              else evidence_pack -> 'assumptions'
            end
          ) pack_item
          where jsonb_typeof(pack_item -> 'id') = 'string'
            and pack_item ->> 'id' = evidence ->> 'evidencePackItemId'
        ) <> 1
    )
    or (
      select count(*) <> count(distinct evidence ->> 'evidencePackItemId')
      from jsonb_array_elements(projection -> 'evidenceRefs') evidence
    )
  then
    raise exception
      'Decision-critical projection is not candidate-local or authoritative';
  end if;

  if jsonb_array_length(catalog) <> jsonb_array_length(dispositions)
    or (
      select count(*) <> count(distinct item ->> 'judgmentOrCatalogCandidateId')
      from jsonb_array_elements(catalog) item
    )
    or (
      select count(*) <> count(distinct item ->> 'judgmentOrCatalogCandidateId')
      from jsonb_array_elements(dispositions) item
    )
    or (
      select count(*)
      from jsonb_array_elements(p_payload -> 'judgments') judgment
      where judgment ->> 'analysisType' = 'framework_judgment'
        and judgment ->> 'applicability' = 'applicable'
        and judgment ->> 'conclusion' in ('supportive', 'mixed', 'negative')
        and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
    ) <> (
      select count(*)
      from jsonb_array_elements(catalog) consideration
      where consideration ->> 'initialDisposition' = 'judgment_eligible'
    )
    or exists (
      select 1
      from jsonb_array_elements(p_payload -> 'judgments') judgment
      where judgment ->> 'analysisType' = 'framework_judgment'
        and judgment ->> 'applicability' = 'applicable'
        and judgment ->> 'conclusion' in ('supportive', 'mixed', 'negative')
        and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
        and not exists (
          select 1
          from jsonb_array_elements(catalog) consideration
          where consideration ->> 'initialDisposition'
              = 'judgment_eligible'
            and consideration ->> 'judgmentId'
              is not distinct from judgment ->> 'id'
            and consideration ->> 'judgmentOrCatalogCandidateId'
              is not distinct from judgment ->> 'id'
            and consideration ->> 'frameworkCardId'
              is not distinct from judgment ->> 'frameworkCardId'
            and consideration ->> 'frameworkVersion'
              is not distinct from judgment ->> 'frameworkVersion'
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(catalog) with ordinality item(value, ordinal)
      where public.named_lens_local_identity_0027(
          item.value, p_workspace_id, p_candidate_run_id
        ) is distinct from true
        or jsonb_typeof(item.value -> 'judgmentOrCatalogCandidateId')
          is distinct from 'string'
        or btrim(item.value ->> 'judgmentOrCatalogCandidateId') = ''
        or jsonb_typeof(item.value -> 'frameworkCardId')
          is distinct from 'string'
        or btrim(item.value ->> 'frameworkCardId') = ''
        or jsonb_typeof(item.value -> 'frameworkVersion')
          is distinct from 'string'
        or btrim(item.value ->> 'frameworkVersion') = ''
        or jsonb_typeof(item.value -> 'initialDisposition')
          is distinct from 'string'
        or item.value ->> 'initialDisposition' not in (
          'judgment_eligible', 'context_inapplicable', 'ineligible',
          'abstained', 'unavailable'
        )
        or jsonb_typeof(item.value -> 'reasonCodes')
          is distinct from 'array'
        or jsonb_array_length(item.value -> 'reasonCodes') = 0
        or jsonb_typeof(item.value -> 'fingerprint')
          is distinct from 'string'
        or item.value ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
        or (item.ordinal > 1 and item.value ->> 'judgmentOrCatalogCandidateId'
          <= (catalog -> (item.ordinal::integer - 2))
            ->> 'judgmentOrCatalogCandidateId' collate "C")
        or (
          item.value ->> 'initialDisposition' = 'judgment_eligible'
          and (
            jsonb_typeof(item.value -> 'judgmentId')
              is distinct from 'string'
            or btrim(item.value ->> 'judgmentId') = ''
            or (
              select count(*)
              from jsonb_array_elements(p_payload -> 'judgments') judgment
              where judgment ->> 'analysisType' = 'framework_judgment'
                and judgment ->> 'applicability' = 'applicable'
                and judgment ->> 'conclusion'
                  in ('supportive', 'mixed', 'negative')
                and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
                and judgment ->> 'id'
                  = item.value ->> 'judgmentId'
                and judgment ->> 'id'
                  = item.value ->> 'judgmentOrCatalogCandidateId'
                and judgment ->> 'frameworkCardId'
                  = item.value ->> 'frameworkCardId'
                and judgment ->> 'frameworkVersion'
                  = item.value ->> 'frameworkVersion'
            ) <> 1
          )
        )
        or (
          item.value ->> 'initialDisposition' in (
            'context_inapplicable', 'ineligible'
          )
          and (
            item.value -> 'judgmentId' is distinct from 'null'::jsonb
            or exists (
              select 1
              from jsonb_array_elements(p_payload -> 'judgments') judgment
              where judgment ->> 'analysisType' = 'framework_judgment'
                and judgment ->> 'applicability' = 'applicable'
                and judgment ->> 'conclusion'
                  in ('supportive', 'mixed', 'negative')
                and (
                  judgment ->> 'id'
                    = item.value ->> 'judgmentOrCatalogCandidateId'
                  or (
                    judgment ->> 'frameworkCardId'
                      = item.value ->> 'frameworkCardId'
                    and judgment ->> 'frameworkVersion'
                      = item.value ->> 'frameworkVersion'
                  )
                )
            )
          )
        )
        or (
          item.value ->> 'initialDisposition' in ('abstained', 'unavailable')
          and exists (
            select 1
            from jsonb_array_elements(p_payload -> 'judgments') judgment
            where judgment ->> 'analysisType' = 'framework_judgment'
              and judgment ->> 'applicability' = 'applicable'
              and judgment ->> 'conclusion'
                in ('supportive', 'mixed', 'negative')
              and (
                judgment ->> 'id'
                  = item.value ->> 'judgmentOrCatalogCandidateId'
                or (
                  judgment ->> 'frameworkCardId'
                    = item.value ->> 'frameworkCardId'
                  and judgment ->> 'frameworkVersion'
                    = item.value ->> 'frameworkVersion'
                )
              )
          )
        )
        or (
          select count(*)
          from jsonb_array_elements(dispositions) disposition
          where disposition ->> 'judgmentOrCatalogCandidateId'
            = item.value ->> 'judgmentOrCatalogCandidateId'
            and disposition ->> 'judgmentId'
              is not distinct from item.value ->> 'judgmentId'
            and disposition ->> 'frameworkCardId'
              = item.value ->> 'frameworkCardId'
            and disposition ->> 'frameworkVersion'
              = item.value ->> 'frameworkVersion'
        ) <> 1
    )
  then
    raise exception
      'Every authorized catalog consideration requires exactly one disposition';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dispositions) item
    where public.named_lens_local_identity_0027(
        item, p_workspace_id, p_candidate_run_id
      ) is distinct from true
      or jsonb_typeof(item -> 'judgmentOrCatalogCandidateId')
        is distinct from 'string'
      or btrim(item ->> 'judgmentOrCatalogCandidateId') = ''
      or jsonb_typeof(item -> 'frameworkCardId') is distinct from 'string'
      or btrim(item ->> 'frameworkCardId') = ''
      or jsonb_typeof(item -> 'frameworkVersion') is distinct from 'string'
      or btrim(item ->> 'frameworkVersion') = ''
      or jsonb_typeof(item -> 'disposition') is distinct from 'string'
      or item ->> 'disposition' not in (
        'context_inapplicable', 'ineligible', 'abstained', 'unavailable',
        'withheld', 'selected_main', 'appendix_only'
      )
      or jsonb_typeof(item -> 'selectionBasisEvidenceIds')
        is distinct from 'array'
      or jsonb_typeof(item -> 'criticalEvidence') is distinct from 'array'
      or jsonb_typeof(item -> 'selectionPolicyVersion')
        is distinct from 'string'
      or item ->> 'selectionPolicyVersion'
        is distinct from 'named-lens-selection-v1'
      or jsonb_typeof(item -> 'fingerprint') is distinct from 'string'
      or item ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(item -> 'decisionCriticalEvidenceProjectionId')
        is distinct from 'string'
      or item ->> 'decisionCriticalEvidenceProjectionId'
        is distinct from projection ->> 'id'
      or jsonb_typeof(
        item -> 'decisionCriticalEvidenceProjectionFingerprint'
      ) is distinct from 'string'
      or item ->> 'decisionCriticalEvidenceProjectionFingerprint'
        is distinct from projection ->> 'fingerprint'
  ) then
    raise exception
      'Every disposition must bind the decision-critical projection fingerprint';
  end if;

  select count(*)::integer into selected_count
  from jsonb_array_elements(dispositions) item
  where item ->> 'disposition' = 'selected_main';
  if selected_count > 6
    or exists (
      select 1
      from jsonb_array_elements(dispositions) item
      where item ->> 'disposition' = 'selected_main'
        and (
          item ->> 'selectedPosition' !~ '^[1-6]$'
          or (item ->> 'selectedPosition')::integer > 6
        )
    )
  then
    raise exception 'Selected Named Lens positions must be one through six';
  end if;
  if (
      select coalesce(array_agg(position order by position), '{}'::integer[])
      from (
        select (item ->> 'selectedPosition')::integer as position
        from jsonb_array_elements(dispositions) item
        where item ->> 'disposition' = 'selected_main'
      ) selected
    ) <> (
      select coalesce(array_agg(position), '{}'::integer[])
      from generate_series(1, selected_count) position
    )
  then
    raise exception
      'Selected Named Lens positions must be unique and contiguous from one';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dispositions) item
    where (
      item ->> 'disposition' in ('selected_main', 'appendix_only')
      and (
        item ->> 'passageFingerprint' !~ '^sha256:[0-9a-f]{64}$'
        or nullif(btrim(item ->> 'judgmentId'), '') is null
        or (
          select count(*)
          from jsonb_array_elements(passages) passage
          where passage ->> 'judgmentId' = item ->> 'judgmentId'
            and passage ->> 'fingerprint' = item ->> 'passageFingerprint'
        ) <> 1
      )
    ) or (
      item ->> 'disposition' not in ('selected_main', 'appendix_only')
      and (
        item -> 'passageFingerprint' <> 'null'::jsonb
        or item -> 'selectedPosition' <> 'null'::jsonb
      )
    )
  ) or exists (
    select 1
    from jsonb_array_elements(passages) passage
    where (
      select count(*)
      from jsonb_array_elements(dispositions) item
      where item ->> 'judgmentId' = passage ->> 'judgmentId'
        and item ->> 'passageFingerprint' = passage ->> 'fingerprint'
        and item ->> 'disposition' in ('selected_main', 'appendix_only')
    ) <> 1
  )
  then
    raise exception
      'Every publishable disposition and passage must share one passage fingerprint';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(passages) passage
    where public.named_lens_passage_authoritative_0027(
      passage,
      p_payload -> 'judgments', dispositions, projection, evidence_pack,
      p_workspace_id, p_candidate_run_id
    ) is distinct from true
  ) then
    raise exception
      'Every candidate-local passage requires five deeply grounded segments, authoritative projection selection basis, and exact premise source claims';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(attempt_refs) reference
    where jsonb_typeof(reference) is distinct from 'object'
      or jsonb_typeof(reference -> 'judgmentOrCatalogCandidateId')
        is distinct from 'string'
      or btrim(reference ->> 'judgmentOrCatalogCandidateId') = ''
      or jsonb_typeof(reference -> 'logicalPassageId')
        is distinct from 'string'
      or btrim(reference ->> 'logicalPassageId') = ''
      or jsonb_typeof(reference -> 'attemptNumber') is distinct from 'number'
      or reference ->> 'attemptNumber' !~ '^[1-9][0-9]*$'
      or jsonb_typeof(reference -> 'attemptFingerprint')
        is distinct from 'string'
      or reference ->> 'attemptFingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or (
        select count(*)
        from jsonb_array_elements(catalog) consideration
        join jsonb_array_elements(dispositions) disposition
          on disposition ->> 'judgmentOrCatalogCandidateId'
            = consideration ->> 'judgmentOrCatalogCandidateId'
        where consideration ->> 'judgmentOrCatalogCandidateId'
          = reference ->> 'judgmentOrCatalogCandidateId'
      ) <> 1
  ) or (
    select count(*) <> count(distinct concat_ws(
      E'\u0001',
      reference ->> 'judgmentOrCatalogCandidateId',
      reference ->> 'logicalPassageId',
      reference ->> 'attemptNumber',
      reference ->> 'attemptFingerprint'
    ))
    from jsonb_array_elements(attempt_refs) reference
  ) then
    raise exception
      'Every provider attempt ref must be typed, unique, and authorized by one catalog disposition';
  end if;

  if (
      select count(*)
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and event.event_status = 'reserved'
    ) <> jsonb_array_length(attempt_refs)
    or (
      select count(*)
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and event.event_status in ('completed', 'failed', 'aborted')
    ) <> jsonb_array_length(attempt_refs)
    or exists (
      select 1
      from jsonb_array_elements(attempt_refs) reference
      where (
        select count(*)
        from public.named_lens_passage_attempt_events event
        where event.workspace_id = p_workspace_id
          and event.candidate_run_id = p_candidate_run_id
          and event.judgment_or_catalog_candidate_id
            = reference ->> 'judgmentOrCatalogCandidateId'
          and event.logical_passage_id = reference ->> 'logicalPassageId'
          and event.attempt_no = (reference ->> 'attemptNumber')::integer
          and event.attempt_fingerprint
            = reference ->> 'attemptFingerprint'
      ) <> 2
    )
    or exists (
      select 1
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and (
          select count(*)
          from jsonb_array_elements(catalog) consideration
          join jsonb_array_elements(dispositions) disposition
            on disposition ->> 'judgmentOrCatalogCandidateId'
              = consideration ->> 'judgmentOrCatalogCandidateId'
          where consideration ->> 'judgmentOrCatalogCandidateId'
            = event.judgment_or_catalog_candidate_id
        ) <> 1
    )
    or exists (
      select 1
      from jsonb_array_elements(catalog) consideration
      where consideration ->> 'initialDisposition' not in (
        'context_inapplicable', 'ineligible'
      ) and not exists (
        select 1
        from public.named_lens_passage_attempt_events event
        where event.workspace_id = p_workspace_id
          and event.candidate_run_id = p_candidate_run_id
          and event.judgment_or_catalog_candidate_id
            = consideration ->> 'judgmentOrCatalogCandidateId'
          and event.event_status in ('completed', 'failed', 'aborted')
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(dispositions) item
      where item ->> 'disposition' in ('selected_main', 'appendix_only')
        and not exists (
          select 1
          from public.named_lens_passage_attempt_events event
          where event.workspace_id = p_workspace_id
            and event.candidate_run_id = p_candidate_run_id
            and event.judgment_or_catalog_candidate_id
              = item ->> 'judgmentOrCatalogCandidateId'
            and event.event_status = 'completed'
        )
    )
  then
    raise exception
      'Finalization requires settled provider attempts covering every applicable catalog candidate';
  end if;

  perform 1
  from public.candidate_runs candidate
  join public.underwriting_batches batch
    on batch.workspace_id = candidate.workspace_id
    and batch.id = candidate.batch_id
  join public.intelligence_reports report
    on report.workspace_id = batch.workspace_id
    and report.run_id = batch.scan_run_id
    and report.id = report_id
    and report.analysis_status = 'completed'
  join public.company_analyses analysis
    on analysis.workspace_id = report.workspace_id
    and analysis.report_id = report.id
    and analysis.run_id = report.run_id
    and analysis.deal_id = candidate.deal_id
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_candidate_run_id
    and candidate.deal_id = p_deal_id;
  if not found then
    raise exception 'Underwriting presentation report identity is not authoritative';
  end if;
  if public.named_lens_presentation_authoritative_0027(
    presentation, passages, dispositions, p_payload -> 'decision',
    evidence_pack, p_workspace_id, p_candidate_run_id
  ) is distinct from true
  then
    raise exception
      'Underwriting presentation identity, selections, synthesis, or segment citations are not authoritative';
  end if;

  select jsonb_array_length(passages) into passage_count;
  select count(*)::integer into applicable_count
  from jsonb_array_elements(catalog) item
  where item ->> 'initialDisposition' not in (
    'context_inapplicable', 'ineligible'
  );
  select count(*)::integer into unavailable_applicable_count
  from jsonb_array_elements(catalog) consideration
  join jsonb_array_elements(dispositions) disposition
    on disposition ->> 'judgmentOrCatalogCandidateId'
      = consideration ->> 'judgmentOrCatalogCandidateId'
  where consideration ->> 'initialDisposition' not in (
      'context_inapplicable', 'ineligible'
    )
    and disposition ->> 'disposition' not in (
      'selected_main', 'appendix_only'
    );
  if terminal_status = 'completed' then
    if unavailable_applicable_count <> 0
      or passage_count <> applicable_count
      or (
        passage_count < 4
        and (
          applicable_count >= 4
          or terminal_reasons
            is distinct from jsonb_build_array('limited_framework_coverage')
        )
      )
      or (passage_count >= 4 and jsonb_array_length(terminal_reasons) <> 0)
    then
      raise exception
        'Completed Named Lens coverage is not genuinely limited or complete';
    end if;
  elsif unavailable_applicable_count = 0
    or jsonb_array_length(terminal_reasons) = 0
  then
    raise exception
      'Partial Named Lens coverage requires an exhausted applicable judgment or passage and canonical terminal reasons';
  end if;
  if (
      select count(*) <> count(distinct reason)
      from jsonb_array_elements_text(terminal_reasons) reason
    ) or exists (
      select 1
      from jsonb_array_elements_text(terminal_reasons) with ordinality
        reason(value, ordinal)
      where btrim(reason.value) = ''
        or (reason.ordinal > 1 and reason.value <=
          (terminal_reasons ->> (reason.ordinal::integer - 2)) collate "C")
    )
  then
    raise exception 'Named Lens terminal reasons must be unique and UTF-8 sorted';
  end if;

  insert into public.decision_critical_evidence_projections (
    workspace_id, candidate_run_id, deal_id, projection_id,
    payload_fingerprint, payload
  ) values (
    p_workspace_id, p_candidate_run_id, p_deal_id,
    projection ->> 'id', projection ->> 'fingerprint', projection
  );

  for consideration_value, catalog_ordinal_value in
    select value, ordinality
    from jsonb_array_elements(catalog) with ordinality
  loop
    select value into strict disposition_value
    from jsonb_array_elements(dispositions)
    where value ->> 'judgmentOrCatalogCandidateId'
      = consideration_value ->> 'judgmentOrCatalogCandidateId';
    insert into public.named_lens_dispositions (
      workspace_id, candidate_run_id, deal_id, catalog_ordinal,
      judgment_or_catalog_candidate_id, judgment_id, disposition,
      selected_position, passage_fingerprint, projection_id,
      projection_fingerprint, payload_fingerprint,
      catalog_consideration_fingerprint, catalog_consideration, payload
    ) values (
      p_workspace_id, p_candidate_run_id, p_deal_id, catalog_ordinal_value,
      disposition_value ->> 'judgmentOrCatalogCandidateId',
      nullif(disposition_value ->> 'judgmentId', ''),
      disposition_value ->> 'disposition',
      (disposition_value ->> 'selectedPosition')::integer,
      nullif(disposition_value ->> 'passageFingerprint', ''),
      projection ->> 'id', projection ->> 'fingerprint',
      disposition_value ->> 'fingerprint',
      consideration_value ->> 'fingerprint',
      consideration_value, disposition_value
    );
  end loop;

  for passage_value in select value from jsonb_array_elements(passages)
  loop
    insert into public.named_lens_passages (
      workspace_id, candidate_run_id, deal_id, judgment_id,
      passage_fingerprint, payload
    ) values (
      p_workspace_id, p_candidate_run_id, p_deal_id,
      passage_value ->> 'judgmentId', passage_value ->> 'fingerprint',
      passage_value
    );
    segment_ordinal := 0;
    foreach segment_kind in array array[
      'premise', 'caseApplication', 'countercase',
      'unknownBoundary', 'conditionalConclusion'
    ]
    loop
      segment_ordinal := segment_ordinal + 1;
      segment_value := passage_value -> segment_kind;
      insert into public.named_lens_passage_segments (
        workspace_id, candidate_run_id, deal_id, judgment_id,
        segment_ordinal, segment_kind, payload_fingerprint, payload
      ) values (
        p_workspace_id, p_candidate_run_id, p_deal_id,
        passage_value ->> 'judgmentId', segment_ordinal,
        case segment_kind
          when 'caseApplication' then 'case_application'
          when 'unknownBoundary' then 'unknown_boundary'
          when 'conditionalConclusion' then 'conditional_conclusion'
          else segment_kind
        end,
        public.named_lens_segment_fingerprint_0027(segment_value),
        segment_value
      );
    end loop;
  end loop;

  insert into public.underwriting_presentations (
    workspace_id, candidate_run_id, deal_id, report_id,
    presentation_fingerprint, payload
  ) values (
    p_workspace_id, p_candidate_run_id, p_deal_id, report_id,
    presentation ->> 'fingerprint', presentation
  );
end;
$$;
alter function public.assert_named_lens_presentation_finalization_0027(
  jsonb, text, text, text
) owner to vsee_underwriting_owner;
revoke all on function
  public.assert_named_lens_presentation_finalization_0027(
    jsonb, text, text, text
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.assert_named_lens_presentation_finalization_0027(
    jsonb, text, text, text
  )
to vsee_underwriting_owner;

create or replace function public.finalize_or_reuse_candidate_underwriting(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  reusable public.candidate_runs%rowtype;
  finalized jsonb;
  target_fingerprint text := btrim(
    p_payload ->> 'candidateAnalysisFingerprint'
  );
  build_input_fingerprint text := btrim(
    p_payload ->> 'evidencePackBuildInputFingerprint'
  );
  evidence_pack jsonb := p_payload -> 'evidencePack';
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  named_lens_version_count integer;
  named_lens_valid_version_count integer;
  current_named_lens boolean;
  terminal_status text;
  terminal_reasons jsonb;
begin
  select * into target
  from public.candidate_runs
  where id = btrim(p_payload ->> 'candidateRunId')
  for update;
  if not found
    or target.status <> 'running'
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception 'Candidate finalization lease does not match';
  end if;
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'A canonical candidate fingerprint is required';
  end if;

  select source.* into reusable
  from public.candidate_runs source
  where source.workspace_id = target.workspace_id
    and source.id = target.rerun_of_id
    and source.deal_id = target.deal_id
    and source.status in ('completed', 'partial')
    and source.candidate_analysis_fingerprint = target_fingerprint
    and source.artifact_source_candidate_run_id is null
  for key share;
  if found then
    update public.candidate_runs
    set status = reusable.status,
        candidate_analysis_fingerprint = target_fingerprint,
        artifact_source_candidate_run_id = reusable.id,
        unavailable_reason_codes = reusable.unavailable_reason_codes,
        public_failure_reason = reusable.public_failure_reason,
        finalized_at = now(), worker_id = null, lease_token = null,
        lease_expires_at = null
    where workspace_id = target.workspace_id and id = target.id
    returning * into target;
    perform public.refresh_underwriting_batch_status(target.batch_id);
    return jsonb_build_object(
      'id', target.id, 'batchId', target.batch_id,
      'workspaceId', target.workspace_id, 'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint', target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', public.canonical_utc_iso_milliseconds(target.finalized_at)
    );
  end if;

  if build_input_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(evidence_pack) <> 'object'
    or btrim(coalesce(evidence_pack ->> 'id', '')) = ''
    or evidence_pack ->> 'workspaceId' <> target.workspace_id
    or nullif(btrim(evidence_pack ->> 'dealId'), '')
      is distinct from target.deal_id
  then
    raise exception
      'Non-reuse finalization requires an immutable Evidence Pack build';
  end if;
  perform 1
  from public.evidence_pack_builds build
  where build.workspace_id = target.workspace_id
    and build.input_fingerprint = build_input_fingerprint
    and build.pack_id = evidence_pack ->> 'id'
    and build.pack_payload = evidence_pack
  for key share;
  if not found then
    raise exception
      'Non-reuse finalization requires the exact immutable Evidence Pack build';
  end if;

  perform public.assert_task9_current_finalization(
    p_payload, target.workspace_id, target.id, target.deal_id
  );
  select
    count(*) filter (where version_snapshot ? expected.key)::integer,
    count(*) filter (
      where version_snapshot ? expected.key
        and jsonb_typeof(version_snapshot -> expected.key) = 'string'
        and version_snapshot ->> expected.key = expected.value
    )::integer
  into named_lens_version_count, named_lens_valid_version_count
  from (values
    ('namedLensSelectionPolicyVersion', 'named-lens-selection-v1'),
    ('namedLensPassageSchemaVersion', 'named-lens-passage-v1'),
    ('namedLensGeneratorVersion', 'named-lens-generator-v1'),
    ('underwritingPresentationSchemaVersion',
      'decision-first-named-lens-v1'),
    ('decisionTaxonomyVersion', 'named-lens-decision-taxonomy-v1')
  ) expected(key, value);
  if named_lens_version_count <> 0
    and (
      named_lens_version_count <> 5
      or named_lens_valid_version_count <> 5
    )
  then
    raise exception
      'Named Lens finalization versions must be supplied as five exact typed values or none';
  end if;
  current_named_lens := named_lens_valid_version_count = 5;
  if current_named_lens then
    perform public.assert_named_lens_presentation_finalization_0027(
      p_payload, target.workspace_id, target.id, target.deal_id
    );
  elsif p_payload ?| array[
    'namedLensCatalogConsiderations',
    'decisionCriticalEvidenceProjection', 'namedLensAttemptRefs',
    'namedLensDispositions', 'namedLensPassages',
    'underwritingPresentationReportId', 'namedLensPresentation',
    'terminalStatus', 'terminalReasonCodes'
  ] then
    raise exception
      'Legacy finalization cannot smuggle current Named Lens artifacts';
  end if;

  finalized := public.finalize_candidate_underwriting(p_payload);
  if current_named_lens then
    terminal_status := p_payload ->> 'terminalStatus';
    terminal_reasons := p_payload -> 'terminalReasonCodes';
    update public.candidate_runs
    set status = terminal_status,
        unavailable_reason_codes = case
          when terminal_status = 'partial' then terminal_reasons
          else '[]'::jsonb
        end,
        public_failure_reason = null
    where workspace_id = target.workspace_id and id = target.id
    returning * into target;
    perform public.refresh_underwriting_batch_status(target.batch_id);
    finalized := jsonb_build_object(
      'id', target.id, 'batchId', target.batch_id,
      'workspaceId', target.workspace_id, 'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint', target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', public.canonical_utc_iso_milliseconds(target.finalized_at)
    );
  end if;
  return finalized;
end;
$$;
alter function public.finalize_or_reuse_candidate_underwriting(jsonb)
  owner to vsee_underwriting_owner;
revoke all on function public.finalize_or_reuse_candidate_underwriting(jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_or_reuse_candidate_underwriting(jsonb)
  to service_role;
revoke all on function public.finalize_candidate_underwriting(jsonb)
  from service_role;

revoke all on function public.assert_named_lens_candidate_owner_0027()
from public, anon, authenticated, service_role;

select public.finish_isolated_owner_0021(
  'vsee_underwriting_owner', true
);
select public.finish_isolated_owner_0021('vsee_registry_owner', false);

commit;

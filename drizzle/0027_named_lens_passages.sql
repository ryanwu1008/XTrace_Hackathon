begin;

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
  if version_snapshot ->> 'namedLensSelectionPolicyVersion'
      <> 'named-lens-selection-v1'
    or version_snapshot ->> 'namedLensPassageSchemaVersion'
      <> 'named-lens-passage-v1'
    or version_snapshot ->> 'namedLensGeneratorVersion'
      <> 'named-lens-generator-v1'
    or version_snapshot ->> 'underwritingPresentationSchemaVersion'
      <> 'decision-first-named-lens-v1'
    or version_snapshot ->> 'decisionTaxonomyVersion'
      <> 'named-lens-decision-taxonomy-v1'
    or jsonb_typeof(catalog) <> 'array'
    or jsonb_typeof(projection) <> 'object'
    or jsonb_typeof(attempt_refs) <> 'array'
    or jsonb_typeof(dispositions) <> 'array'
    or jsonb_typeof(passages) <> 'array'
    or jsonb_typeof(presentation) <> 'object'
    or jsonb_typeof(terminal_reasons) <> 'array'
    or terminal_status not in ('completed', 'partial')
  then
    raise exception 'Current Named Lens finalization contract is incomplete';
  end if;

  if projection ->> 'workspaceId' <> p_workspace_id
    or projection ->> 'artifactSourceCandidateRunId' <> p_candidate_run_id
    or btrim(coalesce(projection ->> 'id', '')) = ''
    or projection ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(projection -> 'evidenceRefs') <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(projection -> 'evidenceRefs') evidence
      where nullif(btrim(evidence ->> 'evidencePackItemId'), '') is null
        or evidence ->> 'classification' not in ('fact', 'assumption')
        or not exists (
          select 1
          from jsonb_array_elements(
            case evidence ->> 'classification'
              when 'fact' then evidence_pack -> 'facts'
              else evidence_pack -> 'assumptions'
            end
          ) pack_item
          where pack_item ->> 'id' = evidence ->> 'evidencePackItemId'
        )
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
    or exists (
      select 1
      from jsonb_array_elements(catalog) with ordinality item(value, ordinal)
      where item.value ->> 'workspaceId' <> p_workspace_id
        or item.value ->> 'artifactSourceCandidateRunId'
          <> p_candidate_run_id
        or nullif(btrim(item.value ->> 'judgmentOrCatalogCandidateId'), '')
          is null
        or item.value ->> 'initialDisposition' not in (
          'judgment_eligible', 'context_inapplicable', 'ineligible',
          'abstained', 'unavailable'
        )
        or item.value ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
        or (item.ordinal > 1 and item.value ->> 'judgmentOrCatalogCandidateId'
          <= (catalog -> (item.ordinal::integer - 2))
            ->> 'judgmentOrCatalogCandidateId' collate "C")
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
    where item ->> 'workspaceId' <> p_workspace_id
      or item ->> 'artifactSourceCandidateRunId' <> p_candidate_run_id
      or item ->> 'selectionPolicyVersion' <> 'named-lens-selection-v1'
      or item ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or item ->> 'decisionCriticalEvidenceProjectionId'
        <> projection ->> 'id'
      or item ->> 'decisionCriticalEvidenceProjectionFingerprint'
        <> projection ->> 'fingerprint'
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
    where passage ->> 'workspaceId' <> p_workspace_id
      or passage ->> 'artifactSourceCandidateRunId' <> p_candidate_run_id
      or passage ->> 'schemaVersion' <> 'named-lens-passage-v1'
      or passage ->> 'generatorVersion' <> 'named-lens-generator-v1'
      or passage ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or passage -> 'advisoryContract' is distinct from jsonb_build_object(
        'formalDecisionWeight', '0',
        'noEndorsement', true,
        'namedPersonImpersonation', false,
        'hiddenChainOfThought', false
      )
      or jsonb_typeof(passage -> 'premise') <> 'object'
      or jsonb_typeof(passage -> 'caseApplication') <> 'object'
      or jsonb_typeof(passage -> 'countercase') <> 'object'
      or jsonb_typeof(passage -> 'unknownBoundary') <> 'object'
      or jsonb_typeof(passage -> 'conditionalConclusion') <> 'object'
      or exists (
        select 1
        from unnest(array[
          passage -> 'premise', passage -> 'caseApplication',
          passage -> 'countercase', passage -> 'unknownBoundary',
          passage -> 'conditionalConclusion'
        ]) segment
        where nullif(btrim(segment ->> 'text'), '') is null
      )
      or not exists (
        select 1
        from jsonb_array_elements(p_payload -> 'judgments') judgment
        where judgment ->> 'id' = passage ->> 'judgmentId'
          and judgment ->> 'frameworkCardId'
            = passage ->> 'frameworkCardId'
          and judgment ->> 'frameworkVersion'
            = passage ->> 'frameworkVersion'
          and judgment ? 'frameworkMetadata'
      )
  ) then
    raise exception
      'Every candidate-local passage requires five ordered grounded segments and an advisory judgment';
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
  if presentation ->> 'workspaceId' <> p_workspace_id
    or presentation ->> 'artifactSourceCandidateRunId'
      <> p_candidate_run_id
    or presentation ->> 'schemaVersion' <> 'decision-first-named-lens-v1'
    or presentation ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    or presentation -> 'firstScreenProjectionRefs' ->> 'decisionId'
      <> p_payload -> 'decision' ->> 'id'
  then
    raise exception 'Underwriting presentation identity is invalid';
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
  select count(*)::integer into named_lens_version_count
  from unnest(array[
    'namedLensSelectionPolicyVersion', 'namedLensPassageSchemaVersion',
    'namedLensGeneratorVersion', 'underwritingPresentationSchemaVersion',
    'decisionTaxonomyVersion'
  ]) key
  where version_snapshot ? key;
  if named_lens_version_count not in (0, 5) then
    raise exception
      'Named Lens finalization versions must be supplied all or none';
  end if;
  current_named_lens := named_lens_version_count = 5;
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

commit;

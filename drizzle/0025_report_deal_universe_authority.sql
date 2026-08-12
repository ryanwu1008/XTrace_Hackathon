begin;

select public.prepare_isolated_owner_0021('vsee_registry_owner', true);
select public.prepare_isolated_owner_0021('vsee_xtrace_owner', true);
select public.prepare_isolated_owner_0021('vsee_underwriting_owner', true);

-- The evidence-context wire contract and canonical fingerprint both use
-- millisecond precision. PostgreSQL clock_timestamp() retains microseconds;
-- normalize new current-run rows at the authority boundary so a Deal universe
-- reconstructed through the typed API can still match exactly.
create or replace function public.canonicalize_run_evidence_time_0025()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.evidence_context_version = 'run-evidence-context-v1' then
    new.evidence_anchor_at :=
      pg_catalog.date_trunc('milliseconds', new.evidence_anchor_at);
    new.evidence_window_start_at :=
      pg_catalog.date_trunc('milliseconds', new.evidence_window_start_at);
    new.evidence_window_end_at :=
      pg_catalog.date_trunc('milliseconds', new.evidence_window_end_at);
  end if;
  return new;
end;
$$;

create trigger canonicalize_run_evidence_time_0025
before insert on public.scan_runs
for each row execute function public.canonicalize_run_evidence_time_0025();

-- A live MarketEvent records the current collection provider and retrieval
-- time, while its trigger SourceRef remains the immutable active Source
-- Revision observation. Keep every other provenance field exact, and reject a
-- collection that definitely predates the revision using the existing
-- precision-aware temporal helper.
do $market_event_collection_provenance_0025$
declare
  function_identity regprocedure :=
    'public.valid_market_event_v2_0019(jsonb)'::regprocedure;
  definition text;
  without_exact_collection text;
  rewritten text;
  exact_collection_fragment text :=
    '    or trigger_source->''retrievedAt'' is distinct from p_event->''retrievedAt''' || chr(10)
    || '    or trigger_source->''retrievedAtPrecision'' is distinct from p_event->''retrievedAtPrecision''' || chr(10)
    || '    or trigger_source->''updatedAt'' is distinct from p_event->''updatedAt''' || chr(10)
    || '    or trigger_source->''updatedAtPrecision'' is distinct from p_event->''updatedAtPrecision''' || chr(10)
    || '    or trigger_source->''providerId'' is distinct from p_event->''providerId''';
  temporal_fragment text :=
    '  then return false; end if;' || chr(10)
    || '  if public.temporal_definitely_before_0019(' || chr(10)
    || '      p_event->''retrievedAt'',p_event->''publishedAt''';
  revised_temporal_fragment text :=
    '  then return false; end if;' || chr(10)
    || '  if trigger_source->''retrievedAt'' = ''null''::jsonb' || chr(10)
    || '    or public.temporal_definitely_before_0019(' || chr(10)
    || '      p_event->''retrievedAt'',trigger_source->''retrievedAt''' || chr(10)
    || '    )' || chr(10)
    || '    or public.temporal_definitely_before_0019(' || chr(10)
    || '      p_event->''retrievedAt'',p_event->''publishedAt''';
begin
  select pg_catalog.pg_get_functiondef(function_identity)
  into strict definition;
  without_exact_collection := pg_catalog.replace(
    definition,
    exact_collection_fragment,
    '    or trigger_source->''updatedAt'' is distinct from p_event->''updatedAt''' || chr(10)
      || '    or trigger_source->''updatedAtPrecision'' is distinct from p_event->''updatedAtPrecision'''
  );
  if without_exact_collection = definition then
    raise exception 'VSEE_0025_MARKET_EVENT_COLLECTION_REWRITE_FAILED'
      using errcode = '55000';
  end if;
  rewritten := pg_catalog.replace(
    without_exact_collection,
    temporal_fragment,
    revised_temporal_fragment
  );
  if rewritten = without_exact_collection
    or pg_catalog.strpos(
      rewritten,
      'trigger_source->''retrievedAt'' is distinct from p_event->''retrievedAt'''
    ) <> 0
    or pg_catalog.strpos(
      rewritten,
      'trigger_source->''providerId'' is distinct from p_event->''providerId'''
    ) <> 0
    or pg_catalog.strpos(
      rewritten,
      'trigger_source->''retrievedAt'' = ''null''::jsonb'
    ) = 0
  then
    raise exception 'VSEE_0025_MARKET_EVENT_TEMPORAL_GATE_REWRITE_FAILED'
      using errcode = '55000';
  end if;
  execute rewritten;
end;
$market_event_collection_provenance_0025$;

-- 0024 extended the sample-decision CASE expression with a textual rewrite,
-- which unintentionally made Sample research screening parents behave like
-- synthetic VC interactions: their registry Source ID was removed and a
-- fixture ID was invented. Restore the typed parent-kind boundary explicitly.
-- A Sample decision record remains fixture-only; every Source Revision parent,
-- including Sample research screening context, resolves through its immutable
-- registry Source ID and exact revision with no fixture identity.
create or replace function public.resolve_xtrace_memory_v2(
  p_workspace_id text,
  p_memory_id text,
  p_deal_id text,
  p_active_parent_fingerprint text
)
returns table (
  memory_id text,
  workspace_id text,
  deal_id text,
  source_revision_ids jsonb,
  source_ids jsonb,
  fixture_ids jsonb,
  provenance text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    link.memory_id,
    link.workspace_id,
    link.deal_id,
    jsonb_build_array(link.source_revision_id),
    case link.parent_kind
      when 'sample_decision_record' then '[]'::jsonb
      when 'sample_research_screening_record'
        then jsonb_build_array(link.source_id)
      else jsonb_build_array(link.source_id)
    end,
    case when link.parent_kind = 'sample_decision_record'
      then jsonb_build_array(regexp_replace(link.source_id, '^source_', ''))
      else '[]'::jsonb end,
    case link.parent_kind
      when 'sample_decision_record' then 'demo_fixture'
      when 'canonical_source_revision' then 'public_web'
      when 'sample_research_screening_record' then 'source_document'
      else 'source_document'
    end
  from public.xtrace_memory_links_v2 link
  join public.deal_source_assignments assignment
    on assignment.workspace_id = link.workspace_id
   and assignment.deal_id = link.deal_id
   and assignment.source_id = link.source_id
   and assignment.source_revision_id = link.source_revision_id
   and assignment.superseded_at is null
  join public.source_revisions revision
    on revision.workspace_id = link.workspace_id
   and revision.id = link.source_revision_id
   and (case when revision.content_hash like 'sha256:%'
     then revision.content_hash else 'sha256:' || revision.content_hash end)
       = link.parent_fingerprint
  join public.deals deal
    on deal.workspace_id = link.workspace_id
   and deal.id = link.deal_id
   and deal.analysis_eligible_at is not null
   and deal.active_source_revision_fingerprint = p_active_parent_fingerprint
  where link.workspace_id = p_workspace_id
    and link.memory_id = p_memory_id
    and link.deal_id = p_deal_id
    and p_active_parent_fingerprint ~ '^sha256:[0-9a-f]{64}$'
$$;
alter function public.resolve_xtrace_memory_v2(text, text, text, text)
  owner to vsee_xtrace_owner;

-- 0019 counted all fourteen evidence columns and therefore mistook a complete
-- live context (whose two pinned-snapshot columns must be NULL) for a partial
-- write. Worse, the same count left a finalized 12-column live row outside the
-- immutable branch. Use the exact mode-specific table constraint shape: an
-- empty legacy row may transition once to one complete live or pinned context
-- in the guarded same transaction; every later mutation remains closed.
create or replace function public.protect_report_evidence_0019()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_count integer;
  new_count integer;
  old_empty boolean;
  old_complete boolean;
  new_complete boolean;
  evidence_changed boolean;
  non_evidence_changed boolean;
begin
  if tg_op = 'DELETE' then
    if old.evidence_context_version is not null then
      raise exception 'CURRENT_REPORT_LINEAGE_IS_IMMUTABLE';
    end if;
    return old;
  end if;
  old_count := pg_catalog.num_nonnulls(
    old.evidence_context_version,old.evidence_mode,old.evidence_window_days,
    old.evidence_anchor_at,old.evidence_window_start_at,old.evidence_window_end_at,
    old.evidence_window_timezone,old.evidence_snapshot_id,old.evidence_snapshot_fingerprint,
    old.evidence_context_fingerprint,old.evidence_display_label,old.evidence_event_count,
    old.evidence_event_set_fingerprint,old.evidence_binding_fingerprint
  );
  new_count := pg_catalog.num_nonnulls(
    new.evidence_context_version,new.evidence_mode,new.evidence_window_days,
    new.evidence_anchor_at,new.evidence_window_start_at,new.evidence_window_end_at,
    new.evidence_window_timezone,new.evidence_snapshot_id,new.evidence_snapshot_fingerprint,
    new.evidence_context_fingerprint,new.evidence_display_label,new.evidence_event_count,
    new.evidence_event_set_fingerprint,new.evidence_binding_fingerprint
  );
  old_empty := old_count = 0;
  old_complete := coalesce(
    old.evidence_context_version = 'run-evidence-context-v1'
    and old.evidence_mode in ('live','pinned')
    and old.evidence_window_days = 14
    and old.evidence_anchor_at is not null
    and old.evidence_window_start_at is not null
    and old.evidence_window_end_at is not null
    and old.evidence_window_timezone is not null
    and old.evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.btrim(old.evidence_display_label) <> ''
    and old.evidence_event_count >= 0
    and old.evidence_event_set_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and old.evidence_binding_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and (
      (old.evidence_mode = 'live'
        and old.evidence_snapshot_id is null
        and old.evidence_snapshot_fingerprint is null
        and old_count = 12)
      or (old.evidence_mode = 'pinned'
        and old.evidence_snapshot_id is not null
        and old.evidence_snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$'
        and old_count = 14)
    ),
    false
  );
  new_complete := coalesce(
    new.evidence_context_version = 'run-evidence-context-v1'
    and new.evidence_mode in ('live','pinned')
    and new.evidence_window_days = 14
    and new.evidence_anchor_at is not null
    and new.evidence_window_start_at is not null
    and new.evidence_window_end_at is not null
    and new.evidence_window_timezone is not null
    and new.evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.btrim(new.evidence_display_label) <> ''
    and new.evidence_event_count >= 0
    and new.evidence_event_set_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and new.evidence_binding_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and (
      (new.evidence_mode = 'live'
        and new.evidence_snapshot_id is null
        and new.evidence_snapshot_fingerprint is null
        and new_count = 12)
      or (new.evidence_mode = 'pinned'
        and new.evidence_snapshot_id is not null
        and new.evidence_snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$'
        and new_count = 14)
    ),
    false
  );
  evidence_changed := row(
      old.evidence_context_version,old.evidence_mode,old.evidence_window_days,
      old.evidence_anchor_at,old.evidence_window_start_at,old.evidence_window_end_at,
      old.evidence_window_timezone,old.evidence_snapshot_id,old.evidence_snapshot_fingerprint,
      old.evidence_context_fingerprint,old.evidence_display_label,old.evidence_event_count,
      old.evidence_event_set_fingerprint,old.evidence_binding_fingerprint
    ) is distinct from row(
      new.evidence_context_version,new.evidence_mode,new.evidence_window_days,
      new.evidence_anchor_at,new.evidence_window_start_at,new.evidence_window_end_at,
      new.evidence_window_timezone,new.evidence_snapshot_id,new.evidence_snapshot_fingerprint,
      new.evidence_context_fingerprint,new.evidence_display_label,new.evidence_event_count,
      new.evidence_event_set_fingerprint,new.evidence_binding_fingerprint
    );
  non_evidence_changed := (
    pg_catalog.to_jsonb(old)-array[
      'evidence_context_version','evidence_mode','evidence_window_days',
      'evidence_anchor_at','evidence_window_start_at','evidence_window_end_at',
      'evidence_window_timezone','evidence_snapshot_id','evidence_snapshot_fingerprint',
      'evidence_context_fingerprint','evidence_display_label','evidence_event_count',
      'evidence_event_set_fingerprint','evidence_binding_fingerprint'
    ]
  ) is distinct from (
    pg_catalog.to_jsonb(new)-array[
      'evidence_context_version','evidence_mode','evidence_window_days',
      'evidence_anchor_at','evidence_window_start_at','evidence_window_end_at',
      'evidence_window_timezone','evidence_snapshot_id','evidence_snapshot_fingerprint',
      'evidence_context_fingerprint','evidence_display_label','evidence_event_count',
      'evidence_event_set_fingerprint','evidence_binding_fingerprint'
    ]
  );
  if (old_complete or not old_empty)
    and (evidence_changed or non_evidence_changed)
  then
    raise exception 'CURRENT_REPORT_LINEAGE_IS_IMMUTABLE';
  end if;
  if evidence_changed then
    if not old_empty or not new_complete or non_evidence_changed
      or pg_catalog.current_setting(
        'vsee.report_finalizer_0019',true
      ) is distinct from 'on'
      or not exists(
        select 1 from public.intelligence_reports stored
        where stored.workspace_id=old.workspace_id and stored.id=old.id
          and stored.xmin::text=pg_catalog.pg_current_xact_id()::text
      )
    then
      raise exception
        'REPORT_EVIDENCE_CONTEXT_IS_IMMUTABLE (old_empty %, old_complete %, new_complete %, old_count %, new_count %, non_evidence_changed %, finalizer %, row_xmin %, current_xid %)',
        old_empty,old_complete,new_complete,old_count,new_count,
        non_evidence_changed,
        pg_catalog.current_setting('vsee.report_finalizer_0019',true),
        old.xmin::text,pg_catalog.pg_current_xact_id()::text;
    end if;
  elsif old_empty and not exists(
    select 1 from public.intelligence_reports stored
    where stored.workspace_id=old.workspace_id and stored.id=old.id
      and stored.xmin::text=pg_catalog.pg_current_xact_id()::text
  ) then
    if non_evidence_changed then
      raise exception 'COMMITTED_LEGACY_REPORT_IS_IMMUTABLE';
    end if;
    return null;
  end if;
  return new;
end;
$$;

-- Like immutable pinned snapshots, a live MarketEvent is copied into the
-- run-bound registry in one transaction. PostgreSQL 17 treats FOR SHARE as an
-- UPDATE-class privilege; remove the unnecessary lock instead of granting the
-- definer broader mutation access to public.market_events.
do $live_event_read_lock_0025$
declare
  function_identity regprocedure :=
    'public.bind_live_run_market_events(text,uuid,text[])'::regprocedure;
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(function_identity)
  into strict definition;
  rewritten := pg_catalog.replace(
    definition,
    'order by event.id collate "C" for share',
    'order by event.id collate "C"'
  );
  if rewritten = definition
    or pg_catalog.strpos(pg_catalog.lower(rewritten), 'for share') <> 0
  then
    raise exception 'VSEE_0025_LIVE_EVENT_READ_LOCK_REWRITE_FAILED'
      using errcode = '55000';
  end if;
  execute rewritten;
end;
$live_event_read_lock_0025$;

-- RLS remains enabled. Permit the narrow registry owner used by the sealed
-- live-binding RPC to read MarketEvents; writes still belong exclusively to
-- the service-role repository path.
create policy market_events_registry_owner_reader_0025
on public.market_events
for select
to vsee_registry_owner
using (true);

-- 0024 introduced immutable, run-bound Deal universes. The pre-existing
-- report writer still compared every report to the mutable workspace-wide
-- eligible snapshot, which incorrectly rejected the approved 23-Deal pinned
-- replay after the registry expanded to 30 Deals. Keep legacy-unbound writes
-- on their historical path, but require every current run to match its exact
-- persisted universe members and source-revision fingerprint.
create or replace function public.save_intelligence_report_legacy_0019(
  p_report jsonb,
  p_analyses jsonb
)
returns setof public.intelligence_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report_id text := pg_catalog.btrim(p_report ->> 'id');
  target_workspace_id text := pg_catalog.btrim(p_report ->> 'workspaceId');
  target_run_id uuid := (p_report ->> 'runId')::uuid;
  target_snapshot_count integer :=
    (p_report ->> 'eligibleSnapshotCount')::integer;
  target_snapshot_fingerprint text :=
    nullif(
      pg_catalog.btrim(p_report ->> 'eligibleSnapshotFingerprint'),
      ''
    );
  target_run public.scan_runs%rowtype;
  run_binding public.run_deal_universe_bindings_v1%rowtype;
  authoritative_snapshot jsonb;
  authoritative_deal_ids text[];
  authoritative_frames text[] := array['eligible-deals-v2'];
  authoritative_fingerprint text;
  submitted_deal_ids text[];
  captured record;
  captured_count integer := 0;
  existing_report public.intelligence_reports%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_report) <> 'object'
    or pg_catalog.jsonb_typeof(p_analyses) <> 'array'
  then
    raise exception 'A report object and analyses array are required';
  end if;
  if coalesce(target_report_id, '') = ''
    or coalesce(target_workspace_id, '') = ''
  then
    raise exception 'The report identity is required';
  end if;
  if target_snapshot_fingerprint is null then
    if pg_catalog.jsonb_array_length(p_analyses) <> 0 then
      raise exception
        'Legacy reports cannot save new company analyses without a snapshot';
    end if;
  elsif target_snapshot_count is null
    or target_snapshot_count < 0
    or target_snapshot_count <> pg_catalog.jsonb_array_length(p_analyses)
    or target_snapshot_count
      <> coalesce((p_report ->> 'companyCount')::integer, -1)
  then
    raise exception
      'The eligible Deal snapshot must match analyses and company count';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        target_workspace_id,
        target_report_id
      )::text,
      0
    )
  );

  if target_snapshot_fingerprint is not null then
    select run.* into target_run
    from public.scan_runs as run
    where run.workspace_id = target_workspace_id
      and run.id = target_run_id;
    if not found then
      raise exception 'REPORT_RUN_NOT_FOUND';
    end if;

    if target_run.evidence_context_version is not null then
      select binding.* into run_binding
      from public.run_deal_universe_bindings_v1 as binding
      where binding.workspace_id = target_workspace_id
        and binding.run_id = target_run_id;
      if not found then
        raise exception 'REPORT_RUN_DEAL_UNIVERSE_BINDING_REQUIRED';
      end if;

      authoritative_deal_ids := array(
        select member.deal_id
        from public.deal_universe_snapshot_members_v1 as member
        where member.workspace_id = target_workspace_id
          and member.universe_id = run_binding.universe_id
        order by member.deal_id collate "C"
      );
      for captured in
        select
          member.deal_id,
          member.deal_status,
          deal.active_source_revision_fingerprint as revision_fingerprint
        from public.deal_universe_snapshot_members_v1 as member
        join public.deals as deal
          on deal.workspace_id = member.workspace_id
          and deal.id = member.deal_id
          and deal.company_id = member.company_id
          and deal.status = member.deal_status
          and deal.analysis_eligible_at = member.analysis_eligible_at
        where member.workspace_id = target_workspace_id
          and member.universe_id = run_binding.universe_id
        order by member.deal_id collate "C"
      loop
        if captured.revision_fingerprint is null then
          raise exception
            'REPORT_RUN_DEAL_UNIVERSE_SOURCE_AUTHORITY_INCOMPLETE';
        end if;
        captured_count := captured_count + 1;
        authoritative_frames := pg_catalog.array_append(
          authoritative_frames,
          captured.deal_id
        );
        authoritative_frames := pg_catalog.array_append(
          authoritative_frames,
          captured.deal_status
        );
        authoritative_frames := pg_catalog.array_append(
          authoritative_frames,
          captured.revision_fingerprint
        );
      end loop;
      authoritative_fingerprint :=
        public.sha256_length_framed(authoritative_frames);
      submitted_deal_ids := array(
        select deal_id
        from (
          select distinct analysis ->> 'dealId' as deal_id
          from pg_catalog.jsonb_array_elements(p_analyses) as analysis
        ) as submitted
        order by deal_id collate "C"
      );

      if target_snapshot_count <> run_binding.deal_count
        or captured_count <> run_binding.deal_count
        or pg_catalog.cardinality(authoritative_deal_ids)
          <> run_binding.deal_count
        or target_snapshot_fingerprint <> authoritative_fingerprint
        or submitted_deal_ids is distinct from authoritative_deal_ids
        or pg_catalog.cardinality(submitted_deal_ids)
          <> pg_catalog.jsonb_array_length(p_analyses)
      then
        raise exception
          'REPORT_DOES_NOT_MATCH_BOUND_DEAL_UNIVERSE';
      end if;
    else
      -- Historical legacy-unbound reports retain their original validation.
      -- Current evidence-bound runs are never allowed to fall back here.
      authoritative_snapshot :=
        public.get_analysis_eligible_snapshot(target_workspace_id);
      authoritative_deal_ids := array(
        select value
        from pg_catalog.jsonb_array_elements_text(
          authoritative_snapshot -> 'dealIds'
        ) as ids(value)
        order by value collate "C"
      );
      submitted_deal_ids := array(
        select deal_id
        from (
          select distinct analysis ->> 'dealId' as deal_id
          from pg_catalog.jsonb_array_elements(p_analyses) as analysis
        ) as submitted
        order by deal_id collate "C"
      );
      if target_snapshot_count
          <> (authoritative_snapshot ->> 'count')::integer
        or target_snapshot_fingerprint
          <> authoritative_snapshot ->> 'fingerprint'
        or submitted_deal_ids is distinct from authoritative_deal_ids
        or pg_catalog.cardinality(submitted_deal_ids)
          <> pg_catalog.jsonb_array_length(p_analyses)
      then
        raise exception
          'The submitted report does not match the authoritative eligible Deal snapshot';
      end if;
    end if;
  end if;

  select report.* into existing_report
  from public.intelligence_reports as report
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;
  if found and (
    existing_report.run_id <> target_run_id
    or existing_report.eligible_snapshot_count
      is distinct from target_snapshot_count
    or existing_report.eligible_snapshot_fingerprint
      is distinct from target_snapshot_fingerprint
  ) then
    raise exception
      'A report cannot overwrite a different run or eligible Deal snapshot';
  end if;

  perform 1
  from public.save_intelligence_report_legacy_0009(
    p_report,
    p_analyses
  );

  update public.intelligence_reports as report
  set
    eligible_snapshot_count = target_snapshot_count,
    eligible_snapshot_fingerprint = target_snapshot_fingerprint
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;

  return query
  select report.*
  from public.intelligence_reports as report
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;
end;
$$;

alter function public.save_intelligence_report_legacy_0019(jsonb, jsonb)
  owner to vsee_registry_owner;
alter function public.canonicalize_run_evidence_time_0025()
  owner to vsee_registry_owner;
revoke all on function
  public.save_intelligence_report_legacy_0019(jsonb, jsonb),
  public.canonicalize_run_evidence_time_0025()
from public, anon, authenticated;

-- A partial underwriting result has already persisted a useful, immutable
-- artifact graph. It is terminal, not a resumable queue state: later workers
-- may neither claim it nor replace its persisted result with a generic failure.
create or replace function public.refresh_underwriting_batch_status(
  p_batch_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_count integer;
  terminal_count integer;
  completed_count integer;
  failed_count integer;
  selection_count integer;
  selected_count integer;
begin
  select
    count(*)::integer,
    count(*) filter (
      where status in ('completed', 'partial', 'unavailable', 'failed')
    )::integer,
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status in ('unavailable', 'failed'))::integer
  into candidate_count, terminal_count, completed_count, failed_count
  from public.candidate_runs
  where batch_id = p_batch_id;

  select
    count(*)::integer,
    count(*) filter (where status = 'selected')::integer
  into selection_count, selected_count
  from public.underwriting_selections
  where batch_id = p_batch_id;

  update public.underwriting_batches
  set status = case
    when candidate_count = 0
      and selection_count > 0
      and selected_count = 0
      then 'completed'
    when candidate_count = 0 then status
    when terminal_count < candidate_count then 'running'
    when completed_count = candidate_count then 'completed'
    when failed_count = candidate_count then 'failed'
    else 'partial'
  end
  where id = p_batch_id;
end;
$$;

create or replace function public.claim_next_underwriting_candidate(
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  target_token text;
begin
  if btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_seconds is null
    or p_lease_seconds <= 0
  then
    raise exception 'A worker and positive lease duration are required';
  end if;
  select * into target
  from public.candidate_runs
  where status = 'queued'
    or (
      status = 'running'
      and (lease_expires_at is null or lease_expires_at <= now())
    )
  order by created_at, id
  for update skip locked
  limit 1;
  if not found then return null; end if;

  target_token := gen_random_uuid()::text;
  update public.candidate_runs
  set status = 'running',
      worker_id = btrim(p_worker_id),
      lease_token = target_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);
  return jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', target.id,
      'batchId', target.batch_id,
      'workspaceId', target.workspace_id,
      'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint',
        target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', null
    ),
    'leaseToken', target_token,
    'leaseExpiresAt',
      public.canonical_utc_iso_milliseconds(target.lease_expires_at)
  );
end;
$$;

create or replace function public.claim_underwriting_candidate(
  p_workspace_id text,
  p_candidate_run_id text,
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  target_token text;
begin
  if btrim(coalesce(p_workspace_id, '')) = ''
    or btrim(coalesce(p_candidate_run_id, '')) = ''
    or btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_seconds is null
    or p_lease_seconds <= 0
  then
    raise exception
      'A workspace, candidate, worker, and positive lease are required';
  end if;

  select * into target
  from public.candidate_runs
  where workspace_id = btrim(p_workspace_id)
    and id = btrim(p_candidate_run_id)
    and (
      status = 'queued'
      or (
        status = 'running'
        and (lease_expires_at is null or lease_expires_at <= now())
      )
    )
  for update skip locked;
  if not found then return null; end if;

  target_token := gen_random_uuid()::text;
  update public.candidate_runs
  set status = 'running',
      worker_id = btrim(p_worker_id),
      lease_token = target_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where workspace_id = target.workspace_id
    and id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);

  return jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', target.id,
      'batchId', target.batch_id,
      'workspaceId', target.workspace_id,
      'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint',
        target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', null
    ),
    'leaseToken', target_token,
    'leaseExpiresAt',
      public.canonical_utc_iso_milliseconds(target.lease_expires_at)
  );
end;
$$;

create or replace function public.mark_candidate_underwriting_unavailable(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id text;
begin
  update public.candidate_runs
  set status = 'unavailable',
      unavailable_reason_codes = p_payload -> 'reasonCodes',
      finalized_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null
  where id = btrim(p_payload ->> 'candidateRunId')
    and status in ('queued', 'running')
  returning batch_id into target_batch_id;
  if target_batch_id is null then
    raise exception 'Candidate cannot be marked unavailable';
  end if;
  perform public.refresh_underwriting_batch_status(target_batch_id);
end;
$$;

create or replace function public.mark_candidate_underwriting_failed(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id text;
begin
  update public.candidate_runs
  set status = 'failed',
      public_failure_reason = btrim(p_payload ->> 'publicReason'),
      finalized_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null
  where id = btrim(p_payload ->> 'candidateRunId')
    and status in ('queued', 'running')
  returning batch_id into target_batch_id;
  if target_batch_id is null then
    raise exception 'Candidate cannot be marked failed';
  end if;
  perform public.refresh_underwriting_batch_status(target_batch_id);
end;
$$;

-- Priority is an ordering signal, never an underwriting eligibility cap.
-- The original 1–5 shape belonged to historical Top-5 batches only; the
-- immutable legacy report remains read through its legacy adapter, while every
-- selected belief revision in a new batch receives an immutable candidate.
alter table public.underwriting_selections
  drop constraint if exists underwriting_selections_rank_shape_check;
alter table public.underwriting_selections
  add constraint underwriting_selections_rank_shape_check check (
    (status = 'selected' and rank > 0)
    or (status = 'not_selected' and rank is null)
  );

create or replace function public.save_underwriting_selections(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.underwriting_batches%rowtype;
  item jsonb;
  target_rank integer;
  target_status text;
begin
  select * into target_batch
  from public.underwriting_batches
  where id = btrim(p_payload ->> 'batchId')
  for update;
  if not found then raise exception 'Underwriting batch not found'; end if;
  if jsonb_typeof(p_payload -> 'selections') <> 'array' then
    raise exception 'Selections must be an array';
  end if;

  for item in select value from jsonb_array_elements(
    p_payload -> 'selections'
  )
  loop
    target_rank := nullif(item ->> 'rank', '')::integer;
    target_status := case
      when item ->> 'status' = 'selected' and target_rank > 0
      then 'selected'
      else 'not_selected'
    end;
    if target_status = 'not_selected' then target_rank := null; end if;
    insert into public.underwriting_selections (
      batch_id, workspace_id, deal_id, status, rank, reason
    ) values (
      target_batch.id,
      target_batch.workspace_id,
      btrim(item ->> 'dealId'),
      target_status,
      target_rank,
      btrim(item ->> 'reason')
    )
    on conflict (batch_id, deal_id) do update set
      status = excluded.status,
      rank = excluded.rank,
      reason = excluded.reason;
  end loop;
  perform public.refresh_underwriting_batch_status(target_batch.id);
end;
$$;

create or replace function public.create_selected_underwriting_candidates(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.underwriting_batches%rowtype;
  target_deal_id text;
  target_candidate_id text;
begin
  select * into target_batch
  from public.underwriting_batches
  where id = btrim(p_payload ->> 'batchId')
  for update;
  if not found then raise exception 'Underwriting batch not found'; end if;
  if jsonb_typeof(p_payload -> 'dealIds') <> 'array' then
    raise exception 'Deal ids must be an array';
  end if;

  for target_deal_id in
    select btrim(value #>> '{}')
    from jsonb_array_elements(p_payload -> 'dealIds')
  loop
    if exists (
      select 1 from public.underwriting_selections
      where batch_id = target_batch.id
        and deal_id = target_deal_id
        and status = 'selected'
    ) then
      target_candidate_id := gen_random_uuid()::text;
      insert into public.candidate_runs (
        id, batch_id, workspace_id, deal_id, status,
        candidate_analysis_fingerprint, rerun_of_id
      ) values (
        target_candidate_id,
        target_batch.id,
        target_batch.workspace_id,
        target_deal_id,
        'queued',
        'pending:' || target_candidate_id,
        (
          select previous.id
          from public.candidate_runs as previous
          where previous.batch_id = target_batch.rerun_of_id
            and previous.deal_id = target_deal_id
          limit 1
        )
      )
      on conflict (batch_id, deal_id) do nothing;
    end if;
  end loop;
  perform public.refresh_underwriting_batch_status(target_batch.id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', candidate.id,
      'batchId', candidate.batch_id,
      'workspaceId', candidate.workspace_id,
      'dealId', candidate.deal_id,
      'status', candidate.status,
      'candidateAnalysisFingerprint',
        candidate.candidate_analysis_fingerprint,
      'rerunOfId', candidate.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(candidate.created_at),
      'finalizedAt', case
        when candidate.finalized_at is null then null
        else public.canonical_utc_iso_milliseconds(candidate.finalized_at)
      end
    ) order by selection.rank, candidate.deal_id, candidate.id)
    from public.candidate_runs as candidate
    join public.underwriting_selections as selection
      on selection.batch_id = candidate.batch_id
      and selection.deal_id = candidate.deal_id
    where candidate.batch_id = target_batch.id
      and selection.status = 'selected'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.claim_next_underwriting_candidate(
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  target_token text;
begin
  if btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_seconds is null
    or p_lease_seconds <= 0
  then
    raise exception 'A worker and positive lease duration are required';
  end if;
  select candidate.* into target
  from public.candidate_runs as candidate
  join public.underwriting_selections as selection
    on selection.batch_id = candidate.batch_id
    and selection.deal_id = candidate.deal_id
  where selection.status = 'selected'
    and (
      candidate.status = 'queued'
      or (
        candidate.status = 'running'
        and (candidate.lease_expires_at is null or candidate.lease_expires_at <= now())
      )
    )
  order by selection.rank, candidate.deal_id, candidate.id
  for update of candidate skip locked
  limit 1;
  if not found then return null; end if;

  target_token := gen_random_uuid()::text;
  update public.candidate_runs
  set status = 'running',
      worker_id = btrim(p_worker_id),
      lease_token = target_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);
  return jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', target.id,
      'batchId', target.batch_id,
      'workspaceId', target.workspace_id,
      'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint',
        target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', null
    ),
    'leaseToken', target_token,
    'leaseExpiresAt',
      public.canonical_utc_iso_milliseconds(target.lease_expires_at)
  );
end;
$$;

select public.finish_isolated_owner_0021(
  'vsee_underwriting_owner', true
);
select public.finish_isolated_owner_0021('vsee_xtrace_owner', true);
select public.finish_isolated_owner_0021('vsee_registry_owner', true);

commit;

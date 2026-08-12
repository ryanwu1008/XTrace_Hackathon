begin;

select public.prepare_isolated_owner_0021('vsee_registry_owner', true);
select public.prepare_isolated_owner_0021('vsee_xtrace_owner', false);

-- Local/disposable terminal migration only. Production remains pinned at 0018.
do $prerequisite$
begin
  if pg_catalog.to_regprocedure('public.sha256_canonical_jsonb_0019(jsonb)') is null
    or pg_catalog.to_regprocedure('public.reserve_xtrace_ingest_intent_v2(jsonb)') is null
    or pg_catalog.to_regclass('public.underwriting_selections') is null
  then
    raise exception 'VSEE_0024_REQUIRES_COMPLETE_0023' using errcode = '55000';
  end if;
end;
$prerequisite$;

alter table public.source_documents
  drop constraint if exists source_documents_role_check;
alter table public.source_documents
  add constraint source_documents_role_check check (role in (
    'deal_document', 'market_report', 'reference', 'public_web_snapshot',
    'sample_decision_record', 'sample_research_screening_record'
  ));

alter table public.xtrace_ingest_intents_v2
  drop constraint if exists xtrace_ingest_intents_v2_parent_kind_check;
alter table public.xtrace_ingest_intents_v2
  add constraint xtrace_ingest_intents_v2_parent_kind_check check (parent_kind in (
    'legacy_source_revision', 'canonical_source_revision',
    'sample_decision_record', 'sample_research_screening_record'
  ));

create table public.research_candidates (
  workspace_id text not null,
  candidate_id text not null,
  company_id text not null,
  deal_id text not null,
  schema_version text not null check (schema_version = 'research-candidate-v1'),
  disposition text not null check (disposition = 'qualified_not_selected'),
  research_snapshot_version text not null
    default 'research-evidence-snapshot-v1'
    check (research_snapshot_version = 'research-evidence-snapshot-v1'),
  snapshot_id text not null,
  snapshot_fingerprint text not null
    check (snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  anchor_at timestamptz not null,
  evidence_mode text not null check (evidence_mode = 'pinned'),
  entity_keys jsonb not null check (
    public.jsonb_sorted_unique_text_array_0019(entity_keys, false, true)
  ),
  active_parent_fingerprint text not null
    check (active_parent_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload) = 'object'),
  payload_fingerprint text not null check (
    payload_fingerprint = public.sha256_canonical_jsonb_0019(payload)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, candidate_id),
  unique (workspace_id, deal_id),
  unique (
    workspace_id, candidate_id, deal_id, snapshot_id, snapshot_fingerprint,
    anchor_at, active_parent_fingerprint
  ),
  constraint research_candidates_workspace_company_fkey
    foreign key (workspace_id, company_id)
    references public.companies(workspace_id, id),
  constraint research_candidates_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id),
  constraint research_candidates_snapshot_fkey
    foreign key (workspace_id, snapshot_id, snapshot_fingerprint)
    references public.market_evidence_snapshots(
      workspace_id, id, snapshot_fingerprint
    )
);

create table public.research_candidate_source_assignments (
  workspace_id text not null,
  candidate_id text not null,
  deal_id text not null,
  deal_assignment_id text not null,
  parent_kind text not null check (parent_kind in (
    'public_evidence', 'research_disposition'
  )),
  xtrace_parent_kind text not null check (xtrace_parent_kind in (
    'canonical_source_revision', 'sample_research_screening_record'
  )),
  claim_class text not null check (claim_class in (
    'fact', 'research_disposition'
  )),
  source_id text not null,
  source_revision_id text not null,
  source_revision_fingerprint text not null
    check (source_revision_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  source_role text not null check (source_role in (
    'public_web_snapshot', 'sample_research_screening_record'
  )),
  source_class text not null check (source_class in (
    'company_official','government_or_regulator','court_or_public_filing',
    'customer_or_partner_official','investor_official','funding_publication',
    'industry_publication','commercial_database','founder_social',
    'internal_decision_record','model_output'
  )),
  source_authority text not null check (source_authority in (
    'primary','secondary','not_applicable'
  )),
  evidence_role text not null check (evidence_role in (
    'trigger','corroborating','counterevidence','context'
  )),
  canonical_url text,
  event_at text,
  event_at_precision text,
  published_at text,
  published_at_precision text,
  retrieved_at text not null,
  retrieved_at_precision text not null,
  snapshot_id text not null,
  snapshot_fingerprint text not null,
  anchor_at timestamptz not null,
  entity_keys jsonb not null,
  active_parent_fingerprint text not null,
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload) = 'object'),
  payload_fingerprint text not null check (
    payload_fingerprint = public.sha256_canonical_jsonb_0019(payload)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    workspace_id, candidate_id, parent_kind, source_id, source_revision_id
  ),
  constraint research_candidate_sources_candidate_fkey
    foreign key (
      workspace_id, candidate_id, deal_id, snapshot_id, snapshot_fingerprint,
      anchor_at, active_parent_fingerprint
    ) references public.research_candidates(
      workspace_id, candidate_id, deal_id, snapshot_id, snapshot_fingerprint,
      anchor_at, active_parent_fingerprint
    ),
  constraint research_candidate_sources_deal_assignment_fkey
    foreign key (workspace_id, deal_assignment_id)
    references public.deal_source_assignments(workspace_id, id),
  constraint research_candidate_sources_revision_fkey
    foreign key (workspace_id, source_id, source_revision_id)
    references public.source_revisions(workspace_id, source_id, id),
  constraint research_candidate_sources_kind_check check (
    (parent_kind = 'public_evidence' and claim_class = 'fact'
      and xtrace_parent_kind = 'canonical_source_revision'
      and source_role = 'public_web_snapshot')
    or
    (parent_kind = 'research_disposition'
      and claim_class = 'research_disposition'
      and xtrace_parent_kind = 'sample_research_screening_record'
      and source_role = 'sample_research_screening_record')
  ),
  constraint research_candidate_sources_event_temporal_check check (
    public.valid_temporal_pair_0019(
      coalesce(pg_catalog.to_jsonb(event_at), 'null'::jsonb),
      coalesce(pg_catalog.to_jsonb(event_at_precision), 'null'::jsonb), true
    )
  ),
  constraint research_candidate_sources_published_temporal_check check (
    public.valid_temporal_pair_0019(
      coalesce(pg_catalog.to_jsonb(published_at), 'null'::jsonb),
      coalesce(pg_catalog.to_jsonb(published_at_precision), 'null'::jsonb), true
    )
  ),
  constraint research_candidate_sources_retrieved_temporal_check check (
    public.valid_temporal_pair_0019(
      pg_catalog.to_jsonb(retrieved_at),
      pg_catalog.to_jsonb(retrieved_at_precision), false
    )
  ),
  constraint research_candidate_sources_trigger_temporal_check check (
    evidence_role <> 'trigger'
    or (event_at is not null and published_at is not null)
  ),
  constraint research_candidate_sources_url_check check (
    canonical_url is null
    or public.valid_canonical_http_url_0019(pg_catalog.to_jsonb(canonical_url))
  ),
  constraint research_candidate_sources_chronology_check check (
    (event_at is null or published_at is null
      or not public.temporal_definitely_before_0019(
        pg_catalog.to_jsonb(published_at),pg_catalog.to_jsonb(event_at)
      ))
    and (published_at is null
      or not public.temporal_definitely_before_0019(
        pg_catalog.to_jsonb(retrieved_at),pg_catalog.to_jsonb(published_at)
      ))
  )
);

create table public.research_candidate_evidence_gaps (
  workspace_id text not null,
  candidate_id text not null,
  deal_id text not null,
  gap_id text not null,
  schema_version text not null
    check (schema_version = 'research-candidate-evidence-gap-v1'),
  gap_kind text not null check (gap_kind in (
    'unresolved_source', 'insufficient_corroboration', 'missing_metric',
    'identity_ambiguity'
  )),
  source_label text not null check (pg_catalog.btrim(source_label) <> ''),
  surfaced_url text,
  reason text not null check (pg_catalog.btrim(reason) <> ''),
  snapshot_id text not null,
  snapshot_fingerprint text not null,
  anchor_at timestamptz not null,
  active_parent_fingerprint text not null,
  entity_keys jsonb not null,
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload) = 'object'),
  payload_fingerprint text not null check (
    payload_fingerprint = public.sha256_canonical_jsonb_0019(payload)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, candidate_id, gap_id),
  constraint research_candidate_gaps_candidate_fkey
    foreign key (
      workspace_id, candidate_id, deal_id, snapshot_id, snapshot_fingerprint,
      anchor_at, active_parent_fingerprint
    ) references public.research_candidates(
      workspace_id, candidate_id, deal_id, snapshot_id, snapshot_fingerprint,
      anchor_at, active_parent_fingerprint
    )
);

create table public.deal_universe_snapshots_v1 (
  workspace_id text not null,
  universe_id text not null,
  schema_version text not null
    check (schema_version = 'deal-universe-snapshot-v1'),
  mode text not null check (mode in ('live', 'pinned')),
  anchor_at timestamptz not null,
  evidence_snapshot_id text,
  evidence_snapshot_fingerprint text,
  deal_count integer not null check (deal_count > 0),
  universe_fingerprint text not null
    check (universe_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, universe_id),
  unique (workspace_id, universe_id, universe_fingerprint),
  constraint deal_universe_snapshot_evidence_fkey
    foreign key (
      workspace_id, evidence_snapshot_id, evidence_snapshot_fingerprint
    ) references public.market_evidence_snapshots(
      workspace_id, id, snapshot_fingerprint
    ) match simple,
  constraint deal_universe_snapshot_mode_check check (
    (mode = 'live' and evidence_snapshot_id is null
      and evidence_snapshot_fingerprint is null)
    or
    (mode = 'pinned' and evidence_snapshot_id is not null
      and evidence_snapshot_fingerprint ~ '^sha256:[0-9a-f]{64}$')
  )
);

create table public.deal_universe_snapshot_members_v1 (
  workspace_id text not null,
  universe_id text not null,
  ordinal integer not null check (ordinal >= 0),
  deal_id text not null,
  company_id text not null,
  deal_status text not null check (deal_status in (
    'screening', 'watchlist', 'evaluating', 'passed', 'invested'
  )),
  analysis_eligible_at timestamptz not null,
  member_fingerprint text not null
    check (member_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  primary key (workspace_id, universe_id, ordinal),
  unique (workspace_id, universe_id, deal_id),
  constraint deal_universe_members_snapshot_fkey
    foreign key (workspace_id, universe_id)
    references public.deal_universe_snapshots_v1(workspace_id, universe_id),
  constraint deal_universe_members_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id),
  constraint deal_universe_members_company_fkey
    foreign key (workspace_id, company_id)
    references public.companies(workspace_id, id)
);

create table public.run_deal_universe_bindings_v1 (
  workspace_id text not null,
  run_id uuid not null,
  schema_version text not null
    check (schema_version = 'run-deal-universe-binding-v1'),
  universe_id text not null,
  universe_fingerprint text not null,
  deal_count integer not null check (deal_count > 0),
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, run_id),
  constraint run_deal_universe_binding_run_fkey
    foreign key (workspace_id, run_id)
    references public.scan_runs(workspace_id, id),
  constraint run_deal_universe_binding_universe_fkey
    foreign key (workspace_id, universe_id, universe_fingerprint)
    references public.deal_universe_snapshots_v1(
      workspace_id, universe_id, universe_fingerprint
    )
);

create table public.report_deal_universe_bindings_v1 (
  workspace_id text not null,
  report_id text not null,
  run_id uuid not null,
  universe_id text not null,
  universe_fingerprint text not null,
  deal_count integer not null check (deal_count > 0),
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (workspace_id, report_id),
  unique (workspace_id, run_id),
  constraint report_deal_universe_binding_report_fkey
    foreign key (workspace_id, report_id)
    references public.intelligence_reports(workspace_id, id),
  constraint report_deal_universe_binding_run_fkey
    foreign key (workspace_id, run_id)
    references public.run_deal_universe_bindings_v1(workspace_id, run_id),
  constraint report_deal_universe_binding_universe_fkey
    foreign key (workspace_id, universe_id, universe_fingerprint)
    references public.deal_universe_snapshots_v1(
      workspace_id, universe_id, universe_fingerprint
    )
);

alter table public.research_candidates owner to vsee_registry_owner;
alter table public.research_candidate_source_assignments owner to vsee_registry_owner;
alter table public.research_candidate_evidence_gaps owner to vsee_registry_owner;
alter table public.deal_universe_snapshots_v1 owner to vsee_registry_owner;
alter table public.deal_universe_snapshot_members_v1 owner to vsee_registry_owner;
alter table public.run_deal_universe_bindings_v1 owner to vsee_registry_owner;
alter table public.report_deal_universe_bindings_v1 owner to vsee_registry_owner;

alter table public.research_candidates enable row level security;
alter table public.research_candidate_source_assignments enable row level security;
alter table public.research_candidate_evidence_gaps enable row level security;
alter table public.deal_universe_snapshots_v1 enable row level security;
alter table public.deal_universe_snapshot_members_v1 enable row level security;
alter table public.run_deal_universe_bindings_v1 enable row level security;
alter table public.report_deal_universe_bindings_v1 enable row level security;

create or replace function public.protect_research_authority_0024()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'vsee_registry_owner' then
    raise exception 'Research and Deal-universe authority is RPC-only and immutable';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_research_candidates_0024
before insert or update or delete on public.research_candidates
for each row execute function public.protect_research_authority_0024();
create trigger protect_research_sources_0024
before insert or update or delete on public.research_candidate_source_assignments
for each row execute function public.protect_research_authority_0024();
create trigger protect_research_gaps_0024
before insert or update or delete on public.research_candidate_evidence_gaps
for each row execute function public.protect_research_authority_0024();
create trigger protect_deal_universe_snapshots_0024
before insert or update or delete on public.deal_universe_snapshots_v1
for each row execute function public.protect_research_authority_0024();
create trigger protect_deal_universe_members_0024
before insert or update or delete on public.deal_universe_snapshot_members_v1
for each row execute function public.protect_research_authority_0024();
create trigger protect_run_deal_universe_bindings_0024
before insert or update or delete on public.run_deal_universe_bindings_v1
for each row execute function public.protect_research_authority_0024();
create trigger protect_report_deal_universe_bindings_0024
before insert or update or delete on public.report_deal_universe_bindings_v1
for each row execute function public.protect_research_authority_0024();

create or replace function public.protect_sample_research_document_0024()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'vsee_registry_owner' and (
    (tg_op = 'DELETE' and old.role = 'sample_research_screening_record')
    or (tg_op = 'UPDATE' and (
      old.role = 'sample_research_screening_record'
      or new.role = 'sample_research_screening_record'
    ))
  ) then
    raise exception 'Sample research screening record parents are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_sample_research_document_0024
before update of role or delete on public.source_documents
for each row execute function public.protect_sample_research_document_0024();

create or replace function public.enforce_sample_research_xtrace_parent_0024()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_kind = 'sample_research_screening_record'
    and not exists (
      select 1 from public.source_documents document
      where document.id = new.source_id
        and document.role = 'sample_research_screening_record'
    )
  then
    raise exception 'Sample research XTrace parent lost its permanent source role';
  end if;
  return new;
end;
$$;

create trigger enforce_sample_research_xtrace_parent_0024
before insert on public.xtrace_ingest_intents_v2
for each row execute function public.enforce_sample_research_xtrace_parent_0024();

create or replace function public.save_research_candidate_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request alias for $1;
  target public.research_candidates%rowtype;
  anchor_value timestamptz;
  created boolean := false;
begin
  if not public.jsonb_exact_keys_0019(p_request, array[
    'activeParentFingerprint','anchorAt','candidateId','companyId','dealId',
    'disposition','entityKeys','evidenceMode','payload','payloadFingerprint',
    'schemaVersion','snapshotFingerprint','snapshotId','workspaceId'
  ])
    or p_request->>'schemaVersion' <> 'research-candidate-v1'
    or p_request->>'disposition' <> 'qualified_not_selected'
    or p_request->>'evidenceMode' <> 'pinned'
    or coalesce(p_request->>'snapshotFingerprint','')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_request->>'activeParentFingerprint','')
      !~ '^sha256:[0-9a-f]{64}$'
    or not public.jsonb_sorted_unique_text_array_0019(
      p_request->'entityKeys', false, true
    )
    or pg_catalog.jsonb_typeof(p_request->'payload') <> 'object'
    or p_request->>'payloadFingerprint'
      is distinct from public.sha256_canonical_jsonb_0019(p_request->'payload')
  then
    raise exception 'Research disposition must be qualified_not_selected';
  end if;
  begin
    anchor_value := (p_request->>'anchorAt')::timestamptz;
  exception when others then
    raise exception 'Invalid research candidate anchor';
  end;

  select * into target from public.research_candidates
  where workspace_id = p_request->>'workspaceId'
    and candidate_id = p_request->>'candidateId';
  if found then
    if target.company_id <> p_request->>'companyId'
      or target.deal_id <> p_request->>'dealId'
      or target.disposition <> p_request->>'disposition'
      or target.snapshot_id <> p_request->>'snapshotId'
      or target.snapshot_fingerprint <> p_request->>'snapshotFingerprint'
      or target.anchor_at <> anchor_value
      or target.entity_keys <> p_request->'entityKeys'
      or target.active_parent_fingerprint
        <> p_request->>'activeParentFingerprint'
      or target.payload <> p_request->'payload'
      or target.payload_fingerprint <> p_request->>'payloadFingerprint'
    then
      raise exception 'Research candidate identity has different immutable content';
    end if;
    return pg_catalog.jsonb_build_object(
      'created', false, 'candidateId', target.candidate_id,
      'dealId', target.deal_id, 'disposition', target.disposition
    );
  end if;

  if not exists (
    select 1 from public.deals deal
    where deal.workspace_id = p_request->>'workspaceId'
      and deal.id = p_request->>'dealId'
      and deal.company_id = p_request->>'companyId'
      and deal.status = 'screening'
      and deal.analysis_eligible_at is not null
      and deal.active_source_revision_fingerprint
        = p_request->>'activeParentFingerprint'
  ) then
    raise exception 'Research candidate requires one authoritative analysis-eligible screening Deal';
  end if;
  if not exists (
    select 1 from public.market_evidence_snapshots snapshot
    where snapshot.workspace_id = p_request->>'workspaceId'
      and snapshot.id = p_request->>'snapshotId'
      and snapshot.snapshot_fingerprint = p_request->>'snapshotFingerprint'
      and snapshot.anchor_at = anchor_value
  ) then
    raise exception 'Research candidate snapshot is not authoritative';
  end if;

  insert into public.research_candidates(
    workspace_id,candidate_id,company_id,deal_id,schema_version,disposition,
    snapshot_id,snapshot_fingerprint,anchor_at,evidence_mode,entity_keys,
    active_parent_fingerprint,payload,payload_fingerprint
  ) values (
    p_request->>'workspaceId',p_request->>'candidateId',
    p_request->>'companyId',p_request->>'dealId',p_request->>'schemaVersion',
    p_request->>'disposition',p_request->>'snapshotId',
    p_request->>'snapshotFingerprint',anchor_value,p_request->>'evidenceMode',
    p_request->'entityKeys',p_request->>'activeParentFingerprint',
    p_request->'payload',p_request->>'payloadFingerprint'
  );
  get diagnostics created = row_count;
  return pg_catalog.jsonb_build_object(
    'created', created, 'candidateId', p_request->>'candidateId',
    'dealId', p_request->>'dealId',
    'disposition', p_request->>'disposition'
  );
end;
$$;

create or replace function public.save_deal_universe_snapshot_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request alias for $1;
  target public.deal_universe_snapshots_v1%rowtype;
  anchor_value timestamptz;
  members jsonb := p_request->'members';
  member_count integer;
  candidate_fingerprint text;
  member jsonb;
begin
  if not public.jsonb_exact_keys_0019(p_request, array[
    'anchorAt','evidenceSnapshotFingerprint','evidenceSnapshotId','members',
    'mode','schemaVersion','universeId','workspaceId'
  ])
    or p_request->>'schemaVersion' <> 'deal-universe-snapshot-v1'
    or p_request->>'mode' not in ('live','pinned')
    or coalesce(pg_catalog.btrim(p_request->>'universeId'),'') = ''
    or pg_catalog.jsonb_typeof(members) <> 'array'
    or pg_catalog.jsonb_array_length(members) = 0
    or (p_request->>'mode' = 'live' and (
      p_request->'evidenceSnapshotId' <> 'null'::jsonb
      or p_request->'evidenceSnapshotFingerprint' <> 'null'::jsonb
    ))
    or (p_request->>'mode' = 'pinned' and (
      coalesce(p_request->>'evidenceSnapshotId','') = ''
      or coalesce(p_request->>'evidenceSnapshotFingerprint','')
        !~ '^sha256:[0-9a-f]{64}$'
    ))
  then
    raise exception 'Invalid Deal-universe snapshot';
  end if;
  begin
    anchor_value := (p_request->>'anchorAt')::timestamptz;
  exception when others then
    raise exception 'Invalid Deal-universe anchor';
  end;
  member_count := pg_catalog.jsonb_array_length(members);
  candidate_fingerprint := public.sha256_length_framed(array[
    'deal-universe-snapshot-v1',p_request->>'workspaceId',
    p_request->>'universeId',p_request->>'mode',
    anchor_value::text,coalesce(p_request->>'evidenceSnapshotId',''),
    coalesce(p_request->>'evidenceSnapshotFingerprint',''),
    public.canonical_jsonb_text_0019(members)
  ]);

  select * into target from public.deal_universe_snapshots_v1
  where workspace_id = p_request->>'workspaceId'
    and universe_id = p_request->>'universeId';
  if found then
    if target.schema_version <> p_request->>'schemaVersion'
      or target.mode <> p_request->>'mode'
      or target.anchor_at <> anchor_value
      or target.evidence_snapshot_id
        is distinct from p_request->>'evidenceSnapshotId'
      or target.evidence_snapshot_fingerprint
        is distinct from p_request->>'evidenceSnapshotFingerprint'
      or target.deal_count <> member_count
      or target.universe_fingerprint <> candidate_fingerprint
    then
      raise exception 'Deal-universe identity has different immutable content or fingerprint collision';
    end if;
    return pg_catalog.jsonb_build_object(
      'created',false,'universeId',target.universe_id,
      'dealCount',target.deal_count,
      'universeFingerprint',target.universe_fingerprint
    );
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(members) item
    where not public.jsonb_exact_keys_0019(item, array[
      'analysisEligibleAt','companyId','dealId','dealStatus','ordinal'
    ])
      or pg_catalog.jsonb_typeof(item->'ordinal') <> 'number'
      or (item->>'ordinal')::integer < 0
      or coalesce(pg_catalog.btrim(item->>'dealId'),'') = ''
      or coalesce(pg_catalog.btrim(item->>'companyId'),'') = ''
      or item->>'dealStatus' not in (
        'screening','watchlist','evaluating','passed','invested'
      )
      or item->>'analysisEligibleAt' is null
  ) or (
    select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'dealId')
      or pg_catalog.count(*) <> pg_catalog.count(distinct (item->>'ordinal')::integer)
      or pg_catalog.min((item->>'ordinal')::integer) <> 0
      or pg_catalog.max((item->>'ordinal')::integer) <> member_count - 1
    from pg_catalog.jsonb_array_elements(members) item
  ) then
    raise exception 'Deal-universe members are malformed or duplicated';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(members) item
    where not exists (
      select 1 from public.deals deal
      where deal.workspace_id = p_request->>'workspaceId'
        and deal.id = item->>'dealId'
        and deal.company_id = item->>'companyId'
        and deal.status = item->>'dealStatus'
        and deal.analysis_eligible_at = (item->>'analysisEligibleAt')::timestamptz
    )
  ) then
    raise exception 'Deal-universe member is not one authoritative analysis-eligible Deal';
  end if;
  if p_request->>'mode' = 'pinned' and not exists (
    select 1 from public.market_evidence_snapshots snapshot
    where snapshot.workspace_id = p_request->>'workspaceId'
      and snapshot.id = p_request->>'evidenceSnapshotId'
      and snapshot.snapshot_fingerprint
        = p_request->>'evidenceSnapshotFingerprint'
      and snapshot.anchor_at = anchor_value
  ) then
    raise exception 'Pinned Deal universe does not match its evidence snapshot';
  end if;

  insert into public.deal_universe_snapshots_v1(
    workspace_id,universe_id,schema_version,mode,anchor_at,
    evidence_snapshot_id,evidence_snapshot_fingerprint,deal_count,
    universe_fingerprint
  ) values (
    p_request->>'workspaceId',p_request->>'universeId',
    p_request->>'schemaVersion',p_request->>'mode',anchor_value,
    p_request->>'evidenceSnapshotId',
    p_request->>'evidenceSnapshotFingerprint',member_count,
    candidate_fingerprint
  );
  for member in select value from pg_catalog.jsonb_array_elements(members) value
  loop
    insert into public.deal_universe_snapshot_members_v1(
      workspace_id,universe_id,ordinal,deal_id,company_id,deal_status,
      analysis_eligible_at,member_fingerprint
    ) values (
      p_request->>'workspaceId',p_request->>'universeId',
      (member->>'ordinal')::integer,member->>'dealId',member->>'companyId',
      member->>'dealStatus',(member->>'analysisEligibleAt')::timestamptz,
      public.sha256_length_framed(array[
        'deal-universe-member-v1',p_request->>'workspaceId',
        p_request->>'universeId',member->>'ordinal',member->>'dealId',
        member->>'companyId',member->>'dealStatus',
        (member->>'analysisEligibleAt')::timestamptz::text
      ])
    );
  end loop;
  return pg_catalog.jsonb_build_object(
    'created',true,'universeId',p_request->>'universeId',
    'dealCount',member_count,'universeFingerprint',candidate_fingerprint
  );
exception when invalid_text_representation then
  raise exception 'Deal-universe member contains an invalid typed value';
end;
$$;

create or replace function public.bind_run_deal_universe_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request alias for $1;
  run public.scan_runs%rowtype;
  universe public.deal_universe_snapshots_v1%rowtype;
  target public.run_deal_universe_bindings_v1%rowtype;
begin
  if not public.jsonb_exact_keys_0019(p_request,array[
    'runId','schemaVersion','universeFingerprint','universeId','workspaceId'
  ]) or p_request->>'schemaVersion' <> 'run-deal-universe-binding-v1'
    or coalesce(p_request->>'universeFingerprint','')
      !~ '^sha256:[0-9a-f]{64}$'
  then raise exception 'Invalid run Deal-universe binding'; end if;
  begin
    select * into strict run from public.scan_runs
    where workspace_id=p_request->>'workspaceId'
      and id=(p_request->>'runId')::uuid;
  exception when no_data_found or invalid_text_representation then
    raise exception 'Run Deal-universe identity is not authoritative';
  end;
  select * into universe from public.deal_universe_snapshots_v1
  where workspace_id=p_request->>'workspaceId'
    and universe_id=p_request->>'universeId'
    and universe_fingerprint=p_request->>'universeFingerprint';
  if not found
    or run.evidence_context_version <> 'run-evidence-context-v1'
    or run.evidence_mode <> universe.mode
    or run.evidence_anchor_at <> universe.anchor_at
    or run.evidence_snapshot_id is distinct from universe.evidence_snapshot_id
    or run.evidence_snapshot_fingerprint
      is distinct from universe.evidence_snapshot_fingerprint
  then raise exception
    'Run and Deal-universe evidence authority drifted (run mode %, universe mode %, run anchor %, universe anchor %, run snapshot %, universe snapshot %, run fingerprint %, universe fingerprint %, universe found %)',
    run.evidence_mode,universe.mode,run.evidence_anchor_at,universe.anchor_at,
    run.evidence_snapshot_id,universe.evidence_snapshot_id,
    run.evidence_snapshot_fingerprint,universe.evidence_snapshot_fingerprint,
    found;
  end if;

  insert into public.run_deal_universe_bindings_v1(
    workspace_id,run_id,schema_version,universe_id,universe_fingerprint,deal_count
  ) values (
    p_request->>'workspaceId',(p_request->>'runId')::uuid,
    p_request->>'schemaVersion',universe.universe_id,
    universe.universe_fingerprint,universe.deal_count
  ) on conflict (workspace_id,run_id) do nothing;
  select * into strict target from public.run_deal_universe_bindings_v1
  where workspace_id=p_request->>'workspaceId'
    and run_id=(p_request->>'runId')::uuid;
  if target.universe_id<>universe.universe_id
    or target.universe_fingerprint<>universe.universe_fingerprint
    or target.deal_count<>universe.deal_count
  then raise exception 'Run Deal-universe binding has different immutable content'; end if;
  return pg_catalog.jsonb_build_object(
    'runId',target.run_id,'universeId',target.universe_id,
    'universeFingerprint',target.universe_fingerprint,
    'dealCount',target.deal_count
  );
end;
$$;

alter table public.underwriting_selections
  drop constraint if exists underwriting_selections_rank_shape_check;
alter table public.underwriting_selections
  add constraint underwriting_selections_rank_shape_check check (
    (status = 'selected' and rank > 0)
    or (status = 'not_selected' and rank is null)
  );
alter table public.candidate_runs
  add constraint candidate_runs_terminal_reason_check check (
    status not in ('partial','unavailable','failed')
    or coalesce(pg_catalog.btrim(public_failure_reason),'') <> ''
    or pg_catalog.jsonb_array_length(unavailable_reason_codes) > 0
  );

grant select on public.underwriting_batches,
  public.underwriting_selections,
  public.candidate_runs
to vsee_registry_owner;
create policy underwriting_batches_registry_completion_reader_0024
  on public.underwriting_batches for select to vsee_registry_owner
  using (true);
create policy underwriting_selections_registry_completion_reader_0024
  on public.underwriting_selections for select to vsee_registry_owner
  using (true);
create policy candidate_runs_registry_completion_reader_0024
  on public.candidate_runs for select to vsee_registry_owner
  using (true);

create or replace function public.bind_report_deal_universe_0024()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.report_deal_universe_bindings_v1(
    workspace_id,report_id,run_id,universe_id,universe_fingerprint,deal_count
  )
  select binding.workspace_id,new.id,binding.run_id,binding.universe_id,
    binding.universe_fingerprint,binding.deal_count
  from public.run_deal_universe_bindings_v1 binding
  where binding.workspace_id=new.workspace_id and binding.run_id=new.run_id;
  return new;
end;
$$;

create trigger bind_report_deal_universe_0024
after insert on public.intelligence_reports
for each row execute function public.bind_report_deal_universe_0024();

create or replace function public.assert_completed_run_deal_universe_v1(
  p_workspace_id text,
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  binding public.run_deal_universe_bindings_v1%rowtype;
  report public.intelligence_reports%rowtype;
  batch public.underwriting_batches%rowtype;
  analysis_count integer;
  selected_count integer;
  candidate_count integer;
  terminal_count integer;
begin
  begin
    select * into strict binding from public.run_deal_universe_bindings_v1
    where workspace_id=p_workspace_id and run_id=p_run_id;
    select * into strict report from public.intelligence_reports
    where workspace_id=p_workspace_id and run_id=p_run_id
      and analysis_status='completed';
    select * into strict batch from public.underwriting_batches
    where workspace_id=p_workspace_id and scan_run_id=p_run_id
      and status='completed' and not force_refresh;
  exception when no_data_found or too_many_rows then
    raise exception 'Completed current run requires one universe, report, and terminal underwriting batch';
  end;

  if not exists (
    select 1 from public.report_deal_universe_bindings_v1 report_binding
    where report_binding.workspace_id=p_workspace_id
      and report_binding.report_id=report.id
      and report_binding.run_id=p_run_id
      and report_binding.universe_id=binding.universe_id
      and report_binding.universe_fingerprint=binding.universe_fingerprint
      and report_binding.deal_count=binding.deal_count
  ) then
    raise exception 'Completed report Deal-universe binding is missing or drifted';
  end if;

  select pg_catalog.count(*)::integer into analysis_count
  from public.company_analyses analysis
  where analysis.workspace_id=p_workspace_id and analysis.report_id=report.id;
  if binding.deal_count<>analysis_count
    or report.company_count is distinct from binding.deal_count
    or report.eligible_snapshot_count is distinct from binding.deal_count
    or report.belief_revised_count+report.monitor_count
      +report.no_material_change_count+report.analysis_unavailable_count
      <> binding.deal_count
    or exists (
      select 1 from public.deal_universe_snapshot_members_v1 member
      where member.workspace_id=p_workspace_id
        and member.universe_id=binding.universe_id
        and not exists (
          select 1 from public.company_analyses analysis
          where analysis.workspace_id=p_workspace_id
            and analysis.report_id=report.id
            and analysis.run_id=p_run_id
            and analysis.deal_id=member.deal_id
            and analysis.deal_status=member.deal_status
        )
    )
    or exists (
      select 1 from public.company_analyses analysis
      where analysis.workspace_id=p_workspace_id and analysis.report_id=report.id
        and (analysis.outcome not in (
          'belief_revised','monitor','no_material_change','analysis_unavailable'
        ) or not exists (
          select 1 from public.deal_universe_snapshot_members_v1 member
          where member.workspace_id=p_workspace_id
            and member.universe_id=binding.universe_id
            and member.deal_id=analysis.deal_id
        ))
    )
  then
    raise exception 'Completed report must contain exactly one authoritative analysis per Deal-universe member';
  end if;

  select pg_catalog.count(*) filter(where selection.status='selected')::integer
  into selected_count
  from public.underwriting_selections selection
  where selection.workspace_id=p_workspace_id and selection.batch_id=batch.id;
  if (select pg_catalog.count(*) from public.underwriting_selections selection
      where selection.workspace_id=p_workspace_id and selection.batch_id=batch.id)
      <> binding.deal_count
    or selected_count<>report.belief_revised_count
    or selected_count<>pg_catalog.jsonb_array_length(report.opportunities)
    or exists (
      select 1 from public.underwriting_selections selection
      join public.company_analyses analysis
        on analysis.workspace_id=selection.workspace_id
       and analysis.report_id=report.id and analysis.deal_id=selection.deal_id
      where selection.workspace_id=p_workspace_id and selection.batch_id=batch.id
        and ((selection.status='selected') is distinct from
          (analysis.outcome='belief_revised'))
    )
    or (selected_count>0 and exists (
      select 1 from pg_catalog.generate_series(1,selected_count) expected(rank)
      where not exists (
        select 1 from public.underwriting_selections selection
        where selection.batch_id=batch.id and selection.status='selected'
          and selection.rank=expected.rank
      )
    ))
  then
    raise exception 'Belief-revised analyses and uncapped underwriting selection authority differ';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter(where candidate.status in (
      'completed','partial','unavailable','failed'
    ))::integer
  into candidate_count,terminal_count
  from public.candidate_runs candidate
  where candidate.workspace_id=p_workspace_id and candidate.batch_id=batch.id;
  if candidate_count<>selected_count or terminal_count<>selected_count
    or exists (
      select 1 from public.candidate_runs candidate
      where candidate.workspace_id=p_workspace_id and candidate.batch_id=batch.id
        and not exists (
          select 1 from public.underwriting_selections selection
          where selection.batch_id=batch.id and selection.deal_id=candidate.deal_id
            and selection.status='selected'
        )
    )
    or exists (
      select 1 from public.candidate_runs candidate
      where candidate.workspace_id=p_workspace_id and candidate.batch_id=batch.id
        and candidate.status in ('partial','unavailable','failed')
        and coalesce(pg_catalog.btrim(candidate.public_failure_reason),'')=''
        and pg_catalog.jsonb_array_length(candidate.unavailable_reason_codes)=0
    )
  then
    raise exception 'Every belief-revised Deal requires one immutable terminal underwriting job and persisted failure reason';
  end if;
end;
$$;

create or replace function public.enforce_completed_run_deal_universe_0024()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='completed'
    and (tg_op='INSERT' or old.status is distinct from 'completed')
    and new.evidence_context_version='run-evidence-context-v1'
  then
    perform public.assert_completed_run_deal_universe_v1(
      new.workspace_id,new.id
    );
  end if;
  return new;
end;
$$;

create trigger enforce_completed_run_deal_universe_0024
before insert or update on public.scan_runs
for each row execute function public.enforce_completed_run_deal_universe_0024();

-- Current reports rank every belief revision; rank is presentation order, not
-- a five-company capacity gate. Historical finalized reports remain immutable.
do $uncapped_report_priority$
declare
  function_identity regprocedure :=
    'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure;
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(function_identity)
  into strict definition;
  rewritten := pg_catalog.regexp_replace(
    definition,
    $pattern$and stored\.belief_assessment_version='belief-change-assessment-v1'[[:space:]]+and stored\.outcome='belief_revised'[[:space:]]+and stored\.confidence in \('medium','high'\)[[:space:]]+and stored\.belief_direction in \('positive','mixed','negative'\)[[:space:]]+and \(stored\.belief_gate_results->>'allPassed'\)::boolean[[:space:]]+order by stored\.score desc,stored\.deal_id collate "C"[[:space:]]+limit 5$pattern$,
    $replacement$and stored.belief_assessment_version='belief-change-assessment-v1'
      and stored.outcome='belief_revised'
    order by stored.score desc,stored.deal_id collate "C"$replacement$
  );
  rewritten := pg_catalog.replace(
    rewritten,
    'REPORT_TOP_FIVE_AUTHORITY_MISMATCH',
    'REPORT_PRIORITY_ORDER_AUTHORITY_MISMATCH'
  );
  if rewritten=definition
    or pg_catalog.strpos(rewritten,'limit 5')<>0
    or pg_catalog.strpos(rewritten,'REPORT_PRIORITY_ORDER_AUTHORITY_MISMATCH')=0
  then
    raise exception 'VSEE_0024_UNCAPPED_REPORT_AUTHORITY_REWRITE_FAILED'
      using errcode='55000';
  end if;
  execute rewritten;
end;
$uncapped_report_priority$;

create or replace function public.save_research_candidate_source_assignment_v1(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request alias for $1;
  candidate public.research_candidates%rowtype;
  snapshot public.market_evidence_snapshots%rowtype;
  target public.research_candidate_source_assignments%rowtype;
  expected_revision_fingerprint text;
  expected_role text;
  anchor_value timestamptz;
  created boolean := false;
begin
  if not public.jsonb_exact_keys_0019(p_request,array[
    'activeParentFingerprint','anchorAt','candidateId','canonicalUrl','claimClass',
    'dealAssignmentId','dealId','entityKeys','eventAt','eventAtPrecision',
    'evidenceRole','parentKind','payload','payloadFingerprint','publishedAt',
    'publishedAtPrecision','retrievedAt','retrievedAtPrecision','schemaVersion',
    'snapshotFingerprint','snapshotId','sourceAuthority','sourceClass','sourceId',
    'sourceRevisionFingerprint','sourceRevisionId','sourceRole','workspaceId',
    'xtraceParentKind'
  ])
    or p_request->>'schemaVersion'
      <> 'research-candidate-source-assignment-v1'
    or coalesce(p_request->>'sourceRevisionFingerprint','')
      !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_request->'payload')<>'object'
    or p_request->>'payloadFingerprint'
      is distinct from public.sha256_canonical_jsonb_0019(p_request->'payload')
    or not public.jsonb_sorted_unique_text_array_0019(
      p_request->'entityKeys',false,true
    )
    or (p_request->>'parentKind'='public_evidence' and (
      p_request#>>'{payload,schemaVersion}'
        <> 'research-public-evidence-memory-v1'
      or p_request#>>'{payload,memoryKind}' <> 'public_evidence'
      or coalesce(pg_catalog.btrim(
        p_request#>>'{payload,source,verbatimExcerpt}'
      ),'')=''
      or coalesce(pg_catalog.btrim(
        p_request#>>'{payload,source,normalizedStatement}'
      ),'')=''
      or p_request#>>'{payload,source,verbatimExcerpt}'
        = p_request#>>'{payload,source,normalizedStatement}'
      or pg_catalog.cardinality(pg_catalog.regexp_split_to_array(
        pg_catalog.btrim(p_request#>>'{payload,source,verbatimExcerpt}'),
        '\s+'
      ))>25
    ))
    or (p_request->>'parentKind'='research_disposition' and (
      p_request#>>'{payload,schemaVersion}'
        <> 'research-disposition-memory-v1'
      or p_request#>>'{payload,memoryKind}' <> 'research_disposition'
      or p_request#>>'{payload,recordKind}'
        <> 'research_screening_disposition'
      or p_request#>>'{payload,label}'
        <> 'Sample research screening record'
      or p_request#>>'{payload,provenance}' <> 'synthetic_research_record'
      or p_request#>'{payload,meetingOccurred}'
        is distinct from 'false'::jsonb
      or p_request#>'{payload,vcInteraction}'
        is distinct from 'false'::jsonb
    ))
  then raise exception 'Invalid research source assignment'; end if;
  begin anchor_value:=(p_request->>'anchorAt')::timestamptz;
  exception when others then raise exception 'Invalid research source anchor'; end;

  select * into candidate from public.research_candidates
  where workspace_id=p_request->>'workspaceId'
    and candidate_id=p_request->>'candidateId';
  if not found or candidate.deal_id<>p_request->>'dealId'
    or candidate.snapshot_id<>p_request->>'snapshotId'
    or candidate.snapshot_fingerprint<>p_request->>'snapshotFingerprint'
    or candidate.anchor_at<>anchor_value
    or candidate.entity_keys<>p_request->'entityKeys'
    or candidate.active_parent_fingerprint
      <>p_request->>'activeParentFingerprint'
  then raise exception 'Research candidate source scope is not authoritative'; end if;
  select * into strict snapshot from public.market_evidence_snapshots
  where workspace_id=candidate.workspace_id and id=candidate.snapshot_id
    and snapshot_fingerprint=candidate.snapshot_fingerprint;
  if (p_request->>'retrievedAt')::timestamptz>candidate.anchor_at
    or (p_request->>'evidenceRole'='trigger' and (
      p_request->'eventAt'='null'::jsonb
      or p_request->'publishedAt'='null'::jsonb
      or not public.evidence_event_in_window_0019(
        p_request->>'eventAt',p_request->>'eventAtPrecision',
        snapshot.window_start_at,snapshot.window_end_at,snapshot.window_timezone
      )
      or not public.evidence_event_in_window_0019(
        p_request->>'publishedAt',p_request->>'publishedAtPrecision',
        snapshot.window_start_at,snapshot.window_end_at,snapshot.window_timezone
      )
    ))
  then raise exception 'Research trigger is outside the pinned 14-day window'; end if;

  select case when revision.content_hash like 'sha256:%'
      then revision.content_hash else 'sha256:'||revision.content_hash end,
    document.role
  into expected_revision_fingerprint,expected_role
  from public.deal_source_assignments assignment
  join public.source_revisions revision
    on revision.workspace_id=assignment.workspace_id
   and revision.source_id=assignment.source_id
   and revision.id=assignment.source_revision_id
  join public.source_documents document on document.id=assignment.source_id
  join public.workspace_documents workspace_document
    on workspace_document.workspace_id=assignment.workspace_id
   and workspace_document.document_id=assignment.source_id
  where assignment.workspace_id=p_request->>'workspaceId'
    and assignment.id=p_request->>'dealAssignmentId'
    and assignment.deal_id=p_request->>'dealId'
    and assignment.source_id=p_request->>'sourceId'
    and assignment.source_revision_id=p_request->>'sourceRevisionId'
    and assignment.superseded_at is null;
  if expected_revision_fingerprint is null
    or expected_revision_fingerprint<>p_request->>'sourceRevisionFingerprint'
    or expected_role<>p_request->>'sourceRole'
    or (p_request->>'parentKind'='public_evidence' and (
      p_request->>'claimClass'<>'fact'
      or p_request->>'xtraceParentKind'<>'canonical_source_revision'
      or expected_role<>'public_web_snapshot'
    ))
    or (p_request->>'parentKind'='research_disposition' and (
      p_request->>'claimClass'<>'research_disposition'
      or p_request->>'xtraceParentKind'<>'sample_research_screening_record'
      or expected_role<>'sample_research_screening_record'
      or p_request->>'sourceClass'<>'internal_decision_record'
      or p_request->>'sourceAuthority'<>'primary'
      or p_request->>'evidenceRole'<>'context'
    ))
  then raise exception 'Exact active Deal Source Revision or source role is not authoritative'; end if;

  insert into public.research_candidate_source_assignments(
    workspace_id,candidate_id,deal_id,deal_assignment_id,parent_kind,
    xtrace_parent_kind,claim_class,source_id,source_revision_id,
    source_revision_fingerprint,source_role,source_class,source_authority,
    evidence_role,canonical_url,event_at,event_at_precision,published_at,
    published_at_precision,retrieved_at,retrieved_at_precision,snapshot_id,
    snapshot_fingerprint,anchor_at,entity_keys,active_parent_fingerprint,
    payload,payload_fingerprint
  ) values (
    p_request->>'workspaceId',p_request->>'candidateId',p_request->>'dealId',
    p_request->>'dealAssignmentId',p_request->>'parentKind',
    p_request->>'xtraceParentKind',p_request->>'claimClass',
    p_request->>'sourceId',p_request->>'sourceRevisionId',
    p_request->>'sourceRevisionFingerprint',p_request->>'sourceRole',
    p_request->>'sourceClass',p_request->>'sourceAuthority',
    p_request->>'evidenceRole',p_request->>'canonicalUrl',
    p_request->>'eventAt',p_request->>'eventAtPrecision',
    p_request->>'publishedAt',p_request->>'publishedAtPrecision',
    p_request->>'retrievedAt',p_request->>'retrievedAtPrecision',
    p_request->>'snapshotId',p_request->>'snapshotFingerprint',anchor_value,
    p_request->'entityKeys',p_request->>'activeParentFingerprint',
    p_request->'payload',p_request->>'payloadFingerprint'
  ) on conflict (
    workspace_id,candidate_id,parent_kind,source_id,source_revision_id
  ) do nothing;
  get diagnostics created=row_count;
  select * into strict target from public.research_candidate_source_assignments
  where workspace_id=p_request->>'workspaceId'
    and candidate_id=p_request->>'candidateId'
    and parent_kind=p_request->>'parentKind'
    and source_id=p_request->>'sourceId'
    and source_revision_id=p_request->>'sourceRevisionId';
  if target.deal_id<>p_request->>'dealId'
    or target.deal_assignment_id<>p_request->>'dealAssignmentId'
    or target.xtrace_parent_kind<>p_request->>'xtraceParentKind'
    or target.claim_class<>p_request->>'claimClass'
    or target.source_revision_fingerprint<>p_request->>'sourceRevisionFingerprint'
    or target.source_role<>p_request->>'sourceRole'
    or target.source_class<>p_request->>'sourceClass'
    or target.source_authority<>p_request->>'sourceAuthority'
    or target.evidence_role<>p_request->>'evidenceRole'
    or target.canonical_url is distinct from p_request->>'canonicalUrl'
    or target.event_at is distinct from p_request->>'eventAt'
    or target.event_at_precision is distinct from p_request->>'eventAtPrecision'
    or target.published_at is distinct from p_request->>'publishedAt'
    or target.published_at_precision is distinct from p_request->>'publishedAtPrecision'
    or target.retrieved_at<>p_request->>'retrievedAt'
    or target.retrieved_at_precision<>p_request->>'retrievedAtPrecision'
    or target.payload<>p_request->'payload'
  then raise exception 'Research source assignment has different immutable content'; end if;
  return pg_catalog.jsonb_build_object(
    'created',created,'candidateId',target.candidate_id,
    'dealId',target.deal_id,'sourceRevisionId',target.source_revision_id,
    'xtraceParentKind',target.xtrace_parent_kind
  );
exception when invalid_text_representation then
  raise exception 'Research source assignment contains an invalid typed value';
end;
$$;

create or replace function public.save_research_candidate_evidence_gap_v1(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request alias for $1;
  candidate public.research_candidates%rowtype;
  target public.research_candidate_evidence_gaps%rowtype;
  anchor_value timestamptz;
  created boolean:=false;
begin
  if not public.jsonb_exact_keys_0019(p_request,array[
    'activeParentFingerprint','anchorAt','candidateId','dealId','entityKeys',
    'gapId','gapKind','payload','payloadFingerprint','reason','schemaVersion',
    'snapshotFingerprint','snapshotId','sourceLabel','surfacedUrl','workspaceId'
  ])
    or p_request->>'schemaVersion'<>'research-candidate-evidence-gap-v1'
    or p_request->>'gapKind' not in (
      'unresolved_source','insufficient_corroboration','missing_metric',
      'identity_ambiguity'
    )
    or pg_catalog.jsonb_typeof(p_request->'payload')<>'object'
    or p_request->>'payloadFingerprint'
      is distinct from public.sha256_canonical_jsonb_0019(p_request->'payload')
  then raise exception 'Invalid unresolved research gap; Source Revision is forbidden'; end if;
  begin anchor_value:=(p_request->>'anchorAt')::timestamptz;
  exception when others then raise exception 'Invalid research gap anchor'; end;
  select * into candidate from public.research_candidates
  where workspace_id=p_request->>'workspaceId'
    and candidate_id=p_request->>'candidateId';
  if not found or candidate.deal_id<>p_request->>'dealId'
    or candidate.snapshot_id<>p_request->>'snapshotId'
    or candidate.snapshot_fingerprint<>p_request->>'snapshotFingerprint'
    or candidate.anchor_at<>anchor_value
    or candidate.entity_keys<>p_request->'entityKeys'
    or candidate.active_parent_fingerprint<>p_request->>'activeParentFingerprint'
  then raise exception 'Research gap candidate scope is not authoritative'; end if;
  insert into public.research_candidate_evidence_gaps(
    workspace_id,candidate_id,deal_id,gap_id,schema_version,gap_kind,
    source_label,surfaced_url,reason,snapshot_id,snapshot_fingerprint,
    anchor_at,active_parent_fingerprint,entity_keys,payload,payload_fingerprint
  ) values (
    p_request->>'workspaceId',p_request->>'candidateId',p_request->>'dealId',
    p_request->>'gapId',p_request->>'schemaVersion',p_request->>'gapKind',
    p_request->>'sourceLabel',p_request->>'surfacedUrl',p_request->>'reason',
    p_request->>'snapshotId',p_request->>'snapshotFingerprint',anchor_value,
    p_request->>'activeParentFingerprint',p_request->'entityKeys',
    p_request->'payload',p_request->>'payloadFingerprint'
  ) on conflict (workspace_id,candidate_id,gap_id) do nothing;
  get diagnostics created=row_count;
  select * into strict target from public.research_candidate_evidence_gaps
  where workspace_id=p_request->>'workspaceId'
    and candidate_id=p_request->>'candidateId' and gap_id=p_request->>'gapId';
  if target.deal_id<>p_request->>'dealId'
    or target.gap_kind<>p_request->>'gapKind'
    or target.source_label<>p_request->>'sourceLabel'
    or target.surfaced_url is distinct from p_request->>'surfacedUrl'
    or target.reason<>p_request->>'reason'
    or target.payload<>p_request->'payload'
  then raise exception 'Research gap has different immutable content'; end if;
  return pg_catalog.jsonb_build_object(
    'created',created,'candidateId',target.candidate_id,'gapId',target.gap_id
  );
end;
$$;

do $research_xtrace_resolution$
declare
  function_identity regprocedure :=
    'public.resolve_xtrace_memory_v2(text,text,text,text)'::regprocedure;
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(function_identity) into strict definition;
  rewritten:=pg_catalog.replace(
    definition,
    $$link.parent_kind = 'sample_decision_record'$$,
    $$link.parent_kind in ('sample_decision_record', 'sample_research_screening_record')$$
  );
  rewritten:=pg_catalog.replace(
    rewritten,
    $$when 'sample_decision_record' then 'demo_fixture'$$,
    $$when 'sample_decision_record' then 'demo_fixture'
      when 'sample_research_screening_record' then 'sample_research_screening'$$
  );
  if rewritten=definition
    or pg_catalog.strpos(rewritten,'sample_research_screening')=0
  then
    raise exception 'VSEE_0024_RESEARCH_XTRACE_RESOLUTION_REWRITE_FAILED'
      using errcode='55000';
  end if;
  execute rewritten;
end;
$research_xtrace_resolution$;

create policy research_candidates_registry_owner_0024
  on public.research_candidates for all to vsee_registry_owner
  using (true) with check (true);
create policy research_sources_registry_owner_0024
  on public.research_candidate_source_assignments for all to vsee_registry_owner
  using (true) with check (true);
create policy research_gaps_registry_owner_0024
  on public.research_candidate_evidence_gaps for all to vsee_registry_owner
  using (true) with check (true);
create policy deal_universe_registry_owner_0024
  on public.deal_universe_snapshots_v1 for all to vsee_registry_owner
  using (true) with check (true);
create policy deal_universe_members_registry_owner_0024
  on public.deal_universe_snapshot_members_v1 for all to vsee_registry_owner
  using (true) with check (true);
create policy run_deal_universe_registry_owner_0024
  on public.run_deal_universe_bindings_v1 for all to vsee_registry_owner
  using (true) with check (true);
create policy report_deal_universe_registry_owner_0024
  on public.report_deal_universe_bindings_v1 for all to vsee_registry_owner
  using (true) with check (true);

alter function public.protect_research_authority_0024()
  owner to vsee_registry_owner;
alter function public.protect_sample_research_document_0024()
  owner to vsee_registry_owner;
alter function public.enforce_sample_research_xtrace_parent_0024()
  owner to vsee_registry_owner;
alter function public.save_research_candidate_v1(jsonb)
  owner to vsee_registry_owner;
alter function public.save_research_candidate_source_assignment_v1(jsonb)
  owner to vsee_registry_owner;
alter function public.save_research_candidate_evidence_gap_v1(jsonb)
  owner to vsee_registry_owner;
alter function public.save_deal_universe_snapshot_v1(jsonb)
  owner to vsee_registry_owner;
alter function public.bind_run_deal_universe_v1(jsonb)
  owner to vsee_registry_owner;
alter function public.bind_report_deal_universe_0024()
  owner to vsee_registry_owner;
alter function public.assert_completed_run_deal_universe_v1(text,uuid)
  owner to vsee_registry_owner;
alter function public.enforce_completed_run_deal_universe_0024()
  owner to vsee_registry_owner;

revoke all on public.research_candidates,
  public.research_candidate_source_assignments,
  public.research_candidate_evidence_gaps,
  public.deal_universe_snapshots_v1,
  public.deal_universe_snapshot_members_v1,
  public.run_deal_universe_bindings_v1,
  public.report_deal_universe_bindings_v1
  from public,anon,authenticated;
revoke all on function
  public.save_research_candidate_v1(jsonb),
  public.save_research_candidate_source_assignment_v1(jsonb),
  public.save_research_candidate_evidence_gap_v1(jsonb),
  public.save_deal_universe_snapshot_v1(jsonb),
  public.bind_run_deal_universe_v1(jsonb),
  public.assert_completed_run_deal_universe_v1(text,uuid)
  from public,anon,authenticated;

do $service_grants$
begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then
    revoke all on public.research_candidates,
      public.research_candidate_source_assignments,
      public.research_candidate_evidence_gaps,
      public.deal_universe_snapshots_v1,
      public.deal_universe_snapshot_members_v1,
      public.run_deal_universe_bindings_v1,
      public.report_deal_universe_bindings_v1 from service_role;
    grant select on public.research_candidates,
      public.research_candidate_source_assignments,
      public.research_candidate_evidence_gaps,
      public.deal_universe_snapshots_v1,
      public.deal_universe_snapshot_members_v1,
      public.run_deal_universe_bindings_v1,
      public.report_deal_universe_bindings_v1 to service_role;
    grant execute on function
      public.save_research_candidate_v1(jsonb),
      public.save_research_candidate_source_assignment_v1(jsonb),
      public.save_research_candidate_evidence_gap_v1(jsonb),
      public.save_deal_universe_snapshot_v1(jsonb),
      public.bind_run_deal_universe_v1(jsonb)
      to service_role;
  end if;
end;
$service_grants$;

select public.finish_isolated_owner_0021('vsee_xtrace_owner', false);
select public.finish_isolated_owner_0021('vsee_registry_owner', true);

commit;

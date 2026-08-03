begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vsee_xtrace_owner') then
    create role vsee_xtrace_owner nologin noinherit;
  end if;
end;
$$;

create table public.xtrace_ingest_intents_v2 (
  intent_id text not null,
  workspace_id text not null,
  deal_id text not null,
  parent_kind text not null check (parent_kind in (
    'legacy_source_revision',
    'canonical_source_revision',
    'sample_decision_record'
  )),
  source_id text not null,
  source_revision_id text not null,
  parent_fingerprint text not null check (
    parent_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  serializer_version text not null,
  state text not null check (state in (
    'reserved', 'submitting', 'submitted', 'running', 'succeeded', 'failed',
    'submission_unknown'
  )),
  state_history jsonb not null check (jsonb_typeof(state_history) = 'array'),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_job_id text,
  memory_ids jsonb not null default '[]'::jsonb check (
    jsonb_typeof(memory_ids) = 'array'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, intent_id),
  constraint xtrace_ingest_intents_v2_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id) on delete cascade,
  constraint xtrace_ingest_intents_v2_workspace_revision_fkey
    foreign key (workspace_id, source_revision_id)
    references public.source_revisions(workspace_id, id),
  constraint xtrace_ingest_intents_v2_lease_shape check (
    (state = 'submitting' and lease_token is not null and lease_expires_at is not null)
    or (state <> 'submitting' and lease_token is null and lease_expires_at is null)
  ),
  constraint xtrace_ingest_intents_v2_job_shape check (
    (state in ('reserved', 'submitting', 'submission_unknown') and provider_job_id is null)
    or (state in ('submitted', 'running', 'succeeded', 'failed') and provider_job_id is not null)
  ),
  unique (
    workspace_id, deal_id, parent_kind, source_id, source_revision_id,
    parent_fingerprint, serializer_version
  )
);

create unique index xtrace_ingest_intents_v2_provider_job_unique
  on public.xtrace_ingest_intents_v2(workspace_id, provider_job_id)
  where provider_job_id is not null;

create table public.xtrace_memory_links_v2 (
  workspace_id text not null,
  memory_id text not null,
  intent_id text not null,
  deal_id text not null,
  parent_kind text not null,
  source_id text not null,
  source_revision_id text not null,
  parent_fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, memory_id),
  constraint xtrace_memory_links_v2_intent_fkey
    foreign key (workspace_id, intent_id)
    references public.xtrace_ingest_intents_v2(workspace_id, intent_id),
  constraint xtrace_memory_links_v2_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id) on delete cascade,
  constraint xtrace_memory_links_v2_workspace_revision_fkey
    foreign key (workspace_id, source_revision_id)
    references public.source_revisions(workspace_id, id)
);

create table public.xtrace_recall_audits_v2 (
  audit_id text primary key,
  workspace_id text not null,
  run_id uuid not null,
  deal_id text not null,
  evidence_context_fingerprint text not null check (
    evidence_context_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  active_parent_fingerprint text not null check (
    active_parent_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  query_fingerprint text not null check (query_fingerprint ~ '^[0-9a-f]{64}$'),
  memory_ids jsonb not null check (jsonb_typeof(memory_ids) = 'array'),
  created_at timestamptz not null default now(),
  constraint xtrace_recall_audits_v2_workspace_run_fkey
    foreign key (workspace_id, run_id)
    references public.scan_runs(workspace_id, id) on delete cascade,
  constraint xtrace_recall_audits_v2_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id) on delete cascade
);

alter table public.xtrace_ingest_intents_v2 owner to vsee_xtrace_owner;
alter table public.xtrace_memory_links_v2 owner to vsee_xtrace_owner;
alter table public.xtrace_recall_audits_v2 owner to vsee_xtrace_owner;
alter table public.xtrace_ingest_intents_v2 enable row level security;
alter table public.xtrace_memory_links_v2 enable row level security;
alter table public.xtrace_recall_audits_v2 enable row level security;

create or replace function public.protect_xtrace_lineage_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user <> 'vsee_xtrace_owner' then
    raise exception 'XTrace v2 lineage is RPC-only and immutable';
  end if;
  return coalesce(new, old);
end;
$$;
alter function public.protect_xtrace_lineage_v2() owner to vsee_xtrace_owner;

create trigger protect_xtrace_ingest_intents_v2
before insert or update or delete on public.xtrace_ingest_intents_v2
for each row execute function public.protect_xtrace_lineage_v2();
create trigger protect_xtrace_memory_links_v2
before insert or update or delete on public.xtrace_memory_links_v2
for each row execute function public.protect_xtrace_lineage_v2();
create trigger protect_xtrace_recall_audits_v2
before insert or update or delete on public.xtrace_recall_audits_v2
for each row execute function public.protect_xtrace_lineage_v2();

create or replace function public.xtrace_ingest_intent_v2_json(
  p_intent public.xtrace_ingest_intents_v2
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'intentId', p_intent.intent_id,
    'workspaceId', p_intent.workspace_id,
    'dealId', p_intent.deal_id,
    'parentKind', p_intent.parent_kind,
    'sourceId', p_intent.source_id,
    'sourceRevisionId', p_intent.source_revision_id,
    'parentFingerprint', p_intent.parent_fingerprint,
    'payloadFingerprint', p_intent.payload_fingerprint,
    'serializerVersion', p_intent.serializer_version,
    'state', p_intent.state,
    'stateHistory', p_intent.state_history,
    'leaseToken', p_intent.lease_token,
    'providerJobId', p_intent.provider_job_id,
    'memoryIds', p_intent.memory_ids
  )
$$;
alter function public.xtrace_ingest_intent_v2_json(
  public.xtrace_ingest_intents_v2
) owner to vsee_xtrace_owner;

create or replace function public.reserve_xtrace_ingest_intent_v2(p_intent jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.xtrace_ingest_intents_v2%rowtype;
  expected_parent_fingerprint text;
  action text;
  created boolean := false;
begin
  if jsonb_typeof(p_intent) <> 'object'
     or coalesce(p_intent ->> 'intentId', '') !~ '^xtrace_intent_[0-9a-f]{64}$'
     or coalesce(p_intent ->> 'parentFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_intent ->> 'payloadFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_intent ->> 'serializerVersion', '') = '' then
    raise exception 'Invalid exact XTrace intent';
  end if;
  select case
    when revision.content_hash like 'sha256:%' then revision.content_hash
    else 'sha256:' || revision.content_hash
  end into expected_parent_fingerprint
  from public.deal_source_assignments assignment
  join public.source_revisions revision
    on revision.workspace_id = assignment.workspace_id
   and revision.id = assignment.source_revision_id
  join public.deals deal
    on deal.workspace_id = assignment.workspace_id
   and deal.id = assignment.deal_id
  where assignment.workspace_id = p_intent ->> 'workspaceId'
    and assignment.deal_id = p_intent ->> 'dealId'
    and assignment.source_id = p_intent ->> 'sourceId'
    and assignment.source_revision_id = p_intent ->> 'sourceRevisionId'
    and assignment.superseded_at is null
    and deal.analysis_eligible_at is not null;
  if expected_parent_fingerprint is null
     or expected_parent_fingerprint <> p_intent ->> 'parentFingerprint' then
    raise exception 'Exact XTrace parent is not an active authoritative assignment';
  end if;
  if (p_intent ->> 'parentKind') = 'sample_decision_record' and not exists (
    select 1 from public.source_documents document
    where document.id = p_intent ->> 'sourceId'
      and document.role = 'sample_decision_record'
  ) then
    raise exception 'Sample XTrace parent lost its permanent source role';
  end if;

  insert into public.xtrace_ingest_intents_v2(
    intent_id, workspace_id, deal_id, parent_kind, source_id,
    source_revision_id, parent_fingerprint, payload_fingerprint,
    serializer_version, state, state_history, lease_token, lease_expires_at
  ) values (
    p_intent ->> 'intentId', p_intent ->> 'workspaceId',
    p_intent ->> 'dealId', p_intent ->> 'parentKind',
    p_intent ->> 'sourceId', p_intent ->> 'sourceRevisionId',
    p_intent ->> 'parentFingerprint', p_intent ->> 'payloadFingerprint',
    p_intent ->> 'serializerVersion', 'submitting',
    '["reserved","submitting"]'::jsonb, public.gen_random_uuid(),
    clock_timestamp() + interval '5 minutes'
  ) on conflict do nothing;
  get diagnostics created = row_count;

  select * into strict target
  from public.xtrace_ingest_intents_v2
  where workspace_id = p_intent ->> 'workspaceId'
    and deal_id = p_intent ->> 'dealId'
    and parent_kind = p_intent ->> 'parentKind'
    and source_id = p_intent ->> 'sourceId'
    and source_revision_id = p_intent ->> 'sourceRevisionId'
    and parent_fingerprint = p_intent ->> 'parentFingerprint'
    and serializer_version = p_intent ->> 'serializerVersion'
  for update;
  if target.payload_fingerprint <> p_intent ->> 'payloadFingerprint' then
    raise exception 'Exact parent identity already has a different immutable payload';
  end if;
  action := case
    when created then 'submit'
    when target.state = 'succeeded' then 'reuse'
    when target.state in ('failed', 'submission_unknown') then 'blocked'
    else 'wait'
  end;
  return jsonb_build_object(
    'action', action,
    'intent', public.xtrace_ingest_intent_v2_json(target)
  );
end;
$$;
alter function public.reserve_xtrace_ingest_intent_v2(jsonb)
  owner to vsee_xtrace_owner;

create or replace function public.attach_xtrace_ingest_job_v2(
  p_intent_id text,
  p_lease_token uuid,
  p_provider_job_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare target public.xtrace_ingest_intents_v2%rowtype;
begin
  if coalesce(btrim(p_provider_job_id), '') = '' then
    raise exception 'Provider job id is required';
  end if;
  select * into strict target from public.xtrace_ingest_intents_v2
  where intent_id = p_intent_id for update;
  if target.state <> 'submitting' or target.lease_token <> p_lease_token then
    raise exception 'Exact XTrace submitter lease is not active';
  end if;
  if exists (
    select 1 from public.xtrace_ingest_intents_v2 existing
    where existing.workspace_id = target.workspace_id
      and existing.provider_job_id = p_provider_job_id
      and existing.intent_id <> target.intent_id
  ) then
    raise exception 'Provider job belongs to a different exact intent';
  end if;
  update public.xtrace_ingest_intents_v2 set
    provider_job_id = p_provider_job_id,
    state = 'submitted',
    state_history = state_history || '"submitted"'::jsonb,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where workspace_id = target.workspace_id and intent_id = target.intent_id
  returning * into target;
  return public.xtrace_ingest_intent_v2_json(target);
end;
$$;
alter function public.attach_xtrace_ingest_job_v2(text, uuid, text)
  owner to vsee_xtrace_owner;

create or replace function public.mark_xtrace_submission_unknown_v2(
  p_intent_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare target public.xtrace_ingest_intents_v2%rowtype;
begin
  select * into strict target from public.xtrace_ingest_intents_v2
  where intent_id = p_intent_id for update;
  if target.state <> 'submitting' or target.lease_token <> p_lease_token then
    raise exception 'Exact XTrace submitter lease is not active';
  end if;
  update public.xtrace_ingest_intents_v2 set
    state = 'submission_unknown',
    state_history = state_history || '"submission_unknown"'::jsonb,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where workspace_id = target.workspace_id and intent_id = target.intent_id
  returning * into target;
  return public.xtrace_ingest_intent_v2_json(target);
end;
$$;
alter function public.mark_xtrace_submission_unknown_v2(text, uuid)
  owner to vsee_xtrace_owner;

create or replace function public.advance_xtrace_ingest_intent_v2(
  p_intent_id text,
  p_provider_job_id text,
  p_state text,
  p_memory_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.xtrace_ingest_intents_v2%rowtype;
  child text;
  existing public.xtrace_memory_links_v2%rowtype;
begin
  select * into strict target from public.xtrace_ingest_intents_v2
  where intent_id = p_intent_id for update;
  if target.provider_job_id <> p_provider_job_id
     or target.state not in ('submitted', 'running')
     or p_state not in ('running', 'succeeded', 'failed') then
    raise exception 'Invalid exact XTrace state transition';
  end if;
  if p_state = 'succeeded' then
    foreach child in array coalesce(p_memory_ids, array[]::text[]) loop
      if coalesce(btrim(child), '') = '' then
        raise exception 'Provider memory id is required';
      end if;
      select * into existing from public.xtrace_memory_links_v2
      where workspace_id = target.workspace_id and memory_id = child;
      if found and (
        existing.intent_id <> target.intent_id
        or existing.deal_id <> target.deal_id
        or existing.source_revision_id <> target.source_revision_id
        or existing.parent_fingerprint <> target.parent_fingerprint
      ) then
        raise exception 'Provider memory child belongs to a different exact parent';
      end if;
      if not found then
        insert into public.xtrace_memory_links_v2(
          workspace_id, memory_id, intent_id, deal_id, parent_kind, source_id,
          source_revision_id, parent_fingerprint
        ) values (
          target.workspace_id, child, target.intent_id, target.deal_id,
          target.parent_kind, target.source_id, target.source_revision_id,
          target.parent_fingerprint
        );
      end if;
    end loop;
  end if;
  update public.xtrace_ingest_intents_v2 set
    state = p_state,
    state_history = state_history || to_jsonb(p_state),
    memory_ids = to_jsonb(coalesce(p_memory_ids, array[]::text[])),
    updated_at = clock_timestamp()
  where workspace_id = target.workspace_id and intent_id = target.intent_id
  returning * into target;
  return public.xtrace_ingest_intent_v2_json(target);
end;
$$;
alter function public.advance_xtrace_ingest_intent_v2(text, text, text, text[])
  owner to vsee_xtrace_owner;

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
set search_path = pg_catalog, public
as $$
  select
    link.memory_id,
    link.workspace_id,
    link.deal_id,
    jsonb_build_array(link.source_revision_id),
    case when link.parent_kind = 'sample_decision_record'
      then '[]'::jsonb else jsonb_build_array(link.source_id) end,
    case when link.parent_kind = 'sample_decision_record'
      then jsonb_build_array(regexp_replace(link.source_id, '^source_', ''))
      else '[]'::jsonb end,
    case link.parent_kind
      when 'sample_decision_record' then 'demo_fixture'
      when 'canonical_source_revision' then 'public_web'
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
  where link.workspace_id = p_workspace_id
    and link.memory_id = p_memory_id
    and link.deal_id = p_deal_id
    and p_active_parent_fingerprint ~ '^sha256:[0-9a-f]{64}$'
$$;
alter function public.resolve_xtrace_memory_v2(text, text, text, text)
  owner to vsee_xtrace_owner;

create or replace function public.record_xtrace_recall_audit_v2(p_audit jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_audit_id text;
begin
  if jsonb_typeof(p_audit) <> 'object'
     or coalesce(p_audit ->> 'evidenceContextFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_audit ->> 'activeParentFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_audit ->> 'queryFingerprint', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_audit -> 'memoryIds') <> 'array' then
    raise exception 'Invalid exact XTrace recall audit';
  end if;
  v_audit_id := 'xtrace_audit_' || encode(digest(p_audit::text, 'sha256'), 'hex');
  insert into public.xtrace_recall_audits_v2(
    audit_id, workspace_id, run_id, deal_id, evidence_context_fingerprint,
    active_parent_fingerprint, query_fingerprint, memory_ids
  ) values (
    v_audit_id, p_audit ->> 'workspaceId', (p_audit ->> 'runId')::uuid,
    p_audit ->> 'dealId', p_audit ->> 'evidenceContextFingerprint',
    p_audit ->> 'activeParentFingerprint', p_audit ->> 'queryFingerprint',
    p_audit -> 'memoryIds'
  ) on conflict (audit_id) do nothing;
end;
$$;
alter function public.record_xtrace_recall_audit_v2(jsonb)
  owner to vsee_xtrace_owner;

grant select on public.deals, public.source_documents, public.source_revisions,
  public.deal_source_assignments to vsee_xtrace_owner;
create policy deals_xtrace_owner_select on public.deals
  for select to vsee_xtrace_owner using (true);
create policy source_documents_xtrace_owner_select on public.source_documents
  for select to vsee_xtrace_owner using (true);
create policy source_revisions_xtrace_owner_select on public.source_revisions
  for select to vsee_xtrace_owner using (true);
create policy deal_source_assignments_xtrace_owner_select
  on public.deal_source_assignments
  for select to vsee_xtrace_owner using (true);
grant select, insert, update on public.xtrace_ingest_intents_v2
  to vsee_xtrace_owner;
grant select, insert on public.xtrace_memory_links_v2,
  public.xtrace_recall_audits_v2 to vsee_xtrace_owner;

revoke all on public.xtrace_ingest_intents_v2,
  public.xtrace_memory_links_v2,
  public.xtrace_recall_audits_v2 from public, anon, authenticated;
revoke all on function public.reserve_xtrace_ingest_intent_v2(jsonb),
  public.attach_xtrace_ingest_job_v2(text, uuid, text),
  public.mark_xtrace_submission_unknown_v2(text, uuid),
  public.advance_xtrace_ingest_intent_v2(text, text, text, text[]),
  public.resolve_xtrace_memory_v2(text, text, text, text),
  public.record_xtrace_recall_audit_v2(jsonb)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.xtrace_ingest_intents_v2,
      public.xtrace_memory_links_v2,
      public.xtrace_recall_audits_v2 to service_role;
    grant execute on function public.reserve_xtrace_ingest_intent_v2(jsonb),
      public.attach_xtrace_ingest_job_v2(text, uuid, text),
      public.mark_xtrace_submission_unknown_v2(text, uuid),
      public.advance_xtrace_ingest_intent_v2(text, text, text, text[]),
      public.resolve_xtrace_memory_v2(text, text, text, text),
      public.record_xtrace_recall_audit_v2(jsonb) to service_role;
  end if;
end;
$$;

commit;

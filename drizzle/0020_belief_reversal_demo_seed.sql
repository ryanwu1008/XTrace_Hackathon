begin;

set local transaction isolation level read committed;

do $prerequisite$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and not rolcanlogin and not rolinherit and not rolsuper
      and not rolcreaterole and not rolcreatedb and not rolreplication
      and not rolbypassrls
  ) or pg_catalog.to_regprocedure(
    'public.save_reasoner_judgment_immutable(jsonb)'
  ) is null then
    raise exception 'VSEE_0020_REQUIRES_COMPLETE_0019'
      using errcode = '55000';
  end if;
end;
$prerequisite$;

do $registry_owner_prepare$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into strict executor_is_superuser
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

alter table public.source_documents
  drop constraint if exists source_documents_role_check;
alter table public.source_documents
  add constraint source_documents_role_check check (
    role in (
      'deal_document', 'market_report', 'reference',
      'public_web_snapshot', 'sample_decision_record'
    )
  );

alter table public.deal_interactions
  add column if not exists prior_actions jsonb,
  add column if not exists action_policy_version text,
  add column if not exists interaction_schema_version text;

alter table public.deal_interactions
  drop constraint if exists deal_interactions_versioned_sample_check;
alter table public.deal_interactions
  add constraint deal_interactions_versioned_sample_check check (
    (prior_actions is null and action_policy_version is null
      and interaction_schema_version is null)
    or (
      prior_actions is not null
      and jsonb_typeof(prior_actions) = 'array'
      and jsonb_array_length(prior_actions) > 0
      and coalesce(btrim(action_policy_version), '') <> ''
      and coalesce(btrim(interaction_schema_version), '') <> ''
      and prior_actions <@ '["reopen_diligence","advance_diligence","continue_monitoring","deprioritize","evaluate_follow_on","pause_follow_on","portfolio_risk_review","no_new_action","review_analysis_failure"]'::jsonb
    )
  );

create or replace function public.protect_sample_decision_interaction_0020()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_document_role text;
  new_document_role text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select role into old_document_role
    from public.source_documents where id = old.document_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select role into new_document_role
    from public.source_documents where id = new.document_id;
  end if;
  if (old_document_role = 'sample_decision_record'
      or new_document_role = 'sample_decision_record')
    and current_user <> 'vsee_registry_owner'
  then
    raise exception 'Sample decision records are RPC-only and immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_sample_decision_interaction_0020
  on public.deal_interactions;
create trigger protect_sample_decision_interaction_0020
before insert or update or delete on public.deal_interactions
for each row execute function public.protect_sample_decision_interaction_0020();

create or replace function public.save_sample_decision_interaction(
  p_interaction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := btrim(p_interaction ->> 'workspaceId');
  v_id text := btrim(p_interaction ->> 'id');
  v_document_id text := btrim(p_interaction ->> 'documentId');
  v_revision_id text := btrim(p_interaction ->> 'sourceRevisionId');
  v_deal_id text := btrim(p_interaction ->> 'dealId');
  v_company_name text := btrim(p_interaction ->> 'companyName');
  v_status text := btrim(p_interaction ->> 'status');
  v_occurred_at timestamptz;
  v_prior_actions jsonb := p_interaction -> 'priorActions';
  v_action_policy_version text := btrim(
    p_interaction ->> 'actionPolicyVersion'
  );
  v_schema_version text := btrim(
    p_interaction ->> 'interactionSchemaVersion'
  );
  v_created boolean := false;
  v_row_count integer := 0;
  target public.deal_interactions%rowtype;
begin
  if coalesce(v_workspace_id, '') = '' or coalesce(v_id, '') = ''
    or coalesce(v_document_id, '') = '' or coalesce(v_revision_id, '') = ''
    or coalesce(v_deal_id, '') = '' or coalesce(v_company_name, '') = ''
    or coalesce(v_action_policy_version, '') = ''
    or coalesce(v_schema_version, '') = ''
    or coalesce(btrim(p_interaction ->> 'decisionReason'), '') = ''
    or coalesce(btrim(p_interaction ->> 'meetingSummary'), '') = ''
    or p_interaction ->> 'provenance' <> 'demo_fixture'
    or p_interaction ->> 'label' <> 'Sample decision record'
    or v_status not in ('passed', 'watchlist', 'invested')
    or jsonb_typeof(v_prior_actions) <> 'array'
    or jsonb_array_length(v_prior_actions) = 0
    or jsonb_typeof(p_interaction -> 'concerns') <> 'array'
    or jsonb_typeof(p_interaction -> 'revisitConditions') <> 'array'
    or not v_prior_actions <@ '["reopen_diligence","advance_diligence","continue_monitoring","deprioritize","evaluate_follow_on","pause_follow_on","portfolio_risk_review","no_new_action","review_analysis_failure"]'::jsonb
  then
    raise exception 'A canonical versioned Sample decision record is required';
  end if;
  begin
    v_occurred_at := (p_interaction ->> 'occurredAt')::timestamptz;
  exception when others then
    raise exception 'A valid Sample decision occurrence time is required';
  end;

  if not exists (
    select 1
    from public.deals as deal
    join public.source_documents as document
      on document.id = v_document_id
      and document.role = 'sample_decision_record'
    join public.source_revisions as revision
      on revision.workspace_id = v_workspace_id
      and revision.id = v_revision_id
      and revision.source_id = v_document_id
    join public.deal_source_assignments as assignment
      on assignment.workspace_id = v_workspace_id
      and assignment.deal_id = v_deal_id
      and assignment.source_id = v_document_id
      and assignment.source_revision_id = v_revision_id
      and assignment.superseded_at is null
    where deal.workspace_id = v_workspace_id
      and deal.id = v_deal_id
      and deal.company_name = v_company_name
      and deal.status = v_status
  ) then
    raise exception
      'Sample decision source, revision, active assignment, Deal, and status must share exact ownership';
  end if;

  insert into public.deal_interactions (
    id, workspace_id, document_id, source_revision_id, deal_id,
    company_name, occurred_at, provenance, label, status,
    decision_reason, concerns, revisit_conditions, meeting_summary,
    prior_actions, action_policy_version, interaction_schema_version
  ) values (
    v_id, v_workspace_id, v_document_id, v_revision_id, v_deal_id,
    v_company_name, v_occurred_at, 'demo_fixture',
    'Sample decision record', v_status,
    p_interaction ->> 'decisionReason', p_interaction -> 'concerns',
    p_interaction -> 'revisitConditions', p_interaction ->> 'meetingSummary',
    v_prior_actions, v_action_policy_version, v_schema_version
  ) on conflict (workspace_id, id) do nothing;
  get diagnostics v_row_count = row_count;
  v_created := v_row_count = 1;

  select * into strict target from public.deal_interactions
  where workspace_id = v_workspace_id and id = v_id
  for key share;
  if target.document_id is distinct from v_document_id
    or target.source_revision_id is distinct from v_revision_id
    or target.deal_id is distinct from v_deal_id
    or target.company_name is distinct from v_company_name
    or target.occurred_at is distinct from v_occurred_at
    or target.provenance is distinct from 'demo_fixture'
    or target.label is distinct from 'Sample decision record'
    or target.status is distinct from v_status
    or target.decision_reason is distinct from p_interaction ->> 'decisionReason'
    or target.concerns is distinct from p_interaction -> 'concerns'
    or target.revisit_conditions is distinct from p_interaction -> 'revisitConditions'
    or target.meeting_summary is distinct from p_interaction ->> 'meetingSummary'
    or target.prior_actions is distinct from v_prior_actions
    or target.action_policy_version is distinct from v_action_policy_version
    or target.interaction_schema_version is distinct from v_schema_version
  then
    raise exception 'Sample decision interaction % is immutable and already differs', v_id;
  end if;
  return jsonb_build_object('created', v_created, 'id', v_id);
end;
$$;

alter function public.protect_sample_decision_interaction_0020()
  owner to vsee_registry_owner;
alter function public.save_sample_decision_interaction(jsonb)
  owner to vsee_registry_owner;
revoke all on function public.protect_sample_decision_interaction_0020()
  from public, anon, authenticated, service_role;
revoke all on function public.save_sample_decision_interaction(jsonb)
  from public, anon, authenticated, service_role;

grant select on public.source_documents, public.source_revisions,
  public.deal_source_assignments, public.deals to vsee_registry_owner;
grant select, insert on public.deal_interactions to vsee_registry_owner;
grant execute on function public.save_sample_decision_interaction(jsonb)
  to service_role;

revoke create on schema public from vsee_registry_owner;

do $registry_owner_finish$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into strict executor_is_superuser
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

commit;

notify pgrst, 'reload schema';

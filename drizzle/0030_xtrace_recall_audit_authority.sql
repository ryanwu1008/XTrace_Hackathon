begin;

-- Forward repair for databases that applied the historical 0021 before its
-- hosted-pgcrypto hardening. Do not rely on edited historical migrations:
-- resolve the extension-owned digest function and rebuild the audit RPC here.
do $xtrace_owner_prepare_0030$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into strict executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_xtrace_owner'
      and not rolcanlogin and not rolinherit and not rolsuper
      and not rolcreaterole and not rolcreatedb and not rolreplication
      and not rolbypassrls
  ) then
    raise exception 'VSEE_XTRACE_OWNER_ATTESTATION_FAILED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
      or membership.member = 'vsee_xtrace_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and (select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_xtrace_owner is not in its attested state';
  end if;
  if not executor_is_superuser then
    if not exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and (select rolsuper from pg_catalog.pg_roles
          where oid = membership.grantor)
        and membership.admin_option
        and not membership.inherit_option and not membership.set_option
    ) then
      raise exception
        'The migration executor lacks the attested XTrace-owner administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_xtrace_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$xtrace_owner_prepare_0030$;

grant usage, create on schema public to vsee_xtrace_owner;

do $record_xtrace_recall_audit_0030$
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
    'grant usage on schema %I to vsee_xtrace_owner',
    digest_schema
  );
  execute pg_catalog.format(
    $function$
create or replace function public.record_xtrace_recall_audit_v2(p_audit jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_audit_id text;
  authorized boolean;
begin
  if jsonb_typeof(p_audit) <> 'object'
     or coalesce(p_audit ->> 'evidenceContextFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_audit ->> 'activeParentFingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_audit ->> 'queryFingerprint', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_audit -> 'memoryIds') <> 'array' then
    raise exception 'Invalid exact XTrace recall audit';
  end if;
  v_audit_id := 'xtrace_audit_' || pg_catalog.encode(
    %I.digest(pg_catalog.convert_to(p_audit::text, 'UTF8'), 'sha256'),
    'hex'
  );
  with authority as materialized (
    select 1
    from public.scan_runs run
    join public.deals deal
      on deal.workspace_id = run.workspace_id
     and deal.id = p_audit ->> 'dealId'
    where run.workspace_id = p_audit ->> 'workspaceId'
      and run.id = (p_audit ->> 'runId')::uuid
      and run.evidence_context_version = 'run-evidence-context-v1'
      and run.evidence_mode in ('live', 'pinned')
      and run.evidence_context_fingerprint = p_audit ->> 'evidenceContextFingerprint'
      and deal.analysis_eligible_at is not null
      and deal.active_source_revision_fingerprint = p_audit ->> 'activeParentFingerprint'
  ), inserted as (
    insert into public.xtrace_recall_audits_v2(
      audit_id, workspace_id, run_id, deal_id, evidence_context_fingerprint,
      active_parent_fingerprint, query_fingerprint, memory_ids
    )
    select
      v_audit_id, p_audit ->> 'workspaceId', (p_audit ->> 'runId')::uuid,
      p_audit ->> 'dealId', p_audit ->> 'evidenceContextFingerprint',
      p_audit ->> 'activeParentFingerprint', p_audit ->> 'queryFingerprint',
      p_audit -> 'memoryIds'
    from authority
    on conflict (audit_id) do nothing
    returning 1
  )
  select exists(select 1 from authority) into authorized;
  if not authorized then
    raise exception 'Exact XTrace recall audit authority drifted';
  end if;
end;
$body$;
    $function$,
    digest_schema
  );
end;
$record_xtrace_recall_audit_0030$;

alter function public.record_xtrace_recall_audit_v2(jsonb)
  owner to vsee_xtrace_owner;
revoke all on function public.record_xtrace_recall_audit_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_xtrace_recall_audit_v2(jsonb)
  to service_role;

revoke create on schema public from vsee_xtrace_owner;

do $xtrace_owner_finish_0030$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into strict executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_xtrace_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_xtrace_owner'
      and not rolcanlogin and not rolinherit and not rolsuper
      and not rolcreaterole and not rolcreatedb and not rolreplication
      and not rolbypassrls
  ) or pg_catalog.has_schema_privilege(
    'vsee_xtrace_owner', 'public', 'create'
  ) or exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
      or membership.member = 'vsee_xtrace_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and (select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_xtrace_owner did not return to its attested state';
  end if;
end;
$xtrace_owner_finish_0030$;

do $xtrace_recall_audit_authority_0030$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_xtrace_recall_audit_v2(jsonb)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'public.record_xtrace_recall_audit_v2(jsonb)'
        ::pg_catalog.regprocedure
    ) <> 'vsee_xtrace_owner'
    or (
      select proconfig
      from pg_catalog.pg_proc
      where oid = 'public.record_xtrace_recall_audit_v2(jsonb)'
        ::pg_catalog.regprocedure
    ) is distinct from array['search_path=""']
    or function_definition !~ '[a-zA-Z0-9_]+\.digest\('
  then
    raise exception 'VSEE_XTRACE_RECALL_AUDIT_AUTHORITY_0030_FAILED';
  end if;
end;
$xtrace_recall_audit_authority_0030$;

commit;

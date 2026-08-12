begin;

do $xtrace_owner_prepare_0029$
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
      and membership.grantor = 10
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
        and membership.grantor = 10
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
$xtrace_owner_prepare_0029$;

revoke all on schema public from vsee_xtrace_owner;
grant usage, create on schema public to vsee_xtrace_owner;

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
    pg_catalog.jsonb_build_array(link.source_revision_id),
    case link.parent_kind
      when 'sample_decision_record' then '[]'::jsonb
      when 'sample_research_screening_record'
        then pg_catalog.jsonb_build_array(link.source_id)
      else pg_catalog.jsonb_build_array(link.source_id)
    end,
    case when link.parent_kind = 'sample_decision_record'
      then pg_catalog.jsonb_build_array(
        pg_catalog.regexp_replace(link.source_id, '^source_', '')
      )
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

revoke all on function public.resolve_xtrace_memory_v2(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_xtrace_memory_v2(text, text, text, text)
  to service_role;

revoke create on schema public from vsee_xtrace_owner;

do $xtrace_owner_finish_0029$
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
    )
    or (
      not executor_is_superuser
      and not exists (
        select 1 from pg_catalog.pg_auth_members as membership
        where membership.roleid = 'vsee_xtrace_owner'::pg_catalog.regrole
          and membership.member = (
            select oid from pg_catalog.pg_roles where rolname = executor_role
          )
          and membership.grantor = 10
          and (select rolsuper from pg_catalog.pg_roles
            where oid = membership.grantor)
          and membership.admin_option
          and not membership.inherit_option and not membership.set_option
      )
    )
    or pg_catalog.has_schema_privilege(
      'vsee_xtrace_owner', 'public', 'create'
    )
    or exists (
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
        and membership.grantor = 10
        and (select rolsuper from pg_catalog.pg_roles
          where oid = membership.grantor)
        and membership.admin_option
        and not membership.inherit_option and not membership.set_option
      )
    )
  then
    raise exception 'vsee_xtrace_owner did not return to its attested state';
  end if;
end;
$xtrace_owner_finish_0029$;

drop function if exists public.finish_isolated_owner_0021(text,boolean);
drop function if exists public.prepare_isolated_owner_0021(text,boolean);

do $xtrace_final_authority_0029$
begin
  if (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'public.resolve_xtrace_memory_v2(text,text,text,text)'
        ::pg_catalog.regprocedure
    ) <> 'vsee_xtrace_owner'
    or (
      select proconfig
      from pg_catalog.pg_proc
      where oid = 'public.resolve_xtrace_memory_v2(text,text,text,text)'
        ::pg_catalog.regprocedure
    ) is distinct from array['search_path=""']
    or pg_catalog.to_regprocedure(
      'public.prepare_isolated_owner_0021(text,boolean)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.finish_isolated_owner_0021(text,boolean)'
    ) is not null
  then
    raise exception 'VSEE_XTRACE_FINAL_AUTHORITY_0029_FAILED';
  end if;
end;
$xtrace_final_authority_0029$;

commit;

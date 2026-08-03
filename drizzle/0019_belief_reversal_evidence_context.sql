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

create or replace function public.jsonb_exact_keys_0019(
  p_value jsonb,
  p_expected_keys text[]
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and array(
      select key
      from pg_catalog.jsonb_object_keys(p_value) as object_key(key)
      order by key collate "C"
    ) is not distinct from array(
      select key
      from pg_catalog.unnest(p_expected_keys) as expected(key)
      order by key collate "C"
    )
$$;

create or replace function public.canonical_jsonb_text_0019(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare rendered text;
begin
  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(key)::text || ':'
        || public.canonical_jsonb_text_0019(value),
      ',' order by key collate "C"
    ), '') || '}'
    into rendered
    from pg_catalog.jsonb_each(p_value) as member(key, value);
    return rendered;
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      public.canonical_jsonb_text_0019(value),
      ',' order by ordinal
    ), '') || ']'
    into rendered
    from pg_catalog.jsonb_array_elements(p_value)
      with ordinality as member(value, ordinal);
    return rendered;
  end if;
  return p_value::text;
end;
$$;

do $canonical_json_digest$
declare digest_schema text;
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
    $function$
create or replace function public.sha256_canonical_jsonb_0019(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $body$
  select 'sha256:' || pg_catalog.encode(
    %I.digest(
      pg_catalog.convert_to(public.canonical_jsonb_text_0019(p_value), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$body$;
    $function$,
    digest_schema
  );
end;
$canonical_json_digest$;

create or replace function public.jsonb_sorted_unique_text_array_0019(
  p_value jsonb,
  p_allow_empty boolean,
  p_entity_keys boolean default false
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare actual text[];
declare sorted text[];
declare item_count integer;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then return false; end if;
  select count(*)::integer,
    coalesce(array_agg(value #>> '{}' order by ordinal), array[]::text[]),
    coalesce(array_agg(value #>> '{}' order by value #>> '{}' collate "C"), array[]::text[])
  into item_count, actual, sorted
  from pg_catalog.jsonb_array_elements(p_value)
    with ordinality as item(value, ordinal)
  where pg_catalog.jsonb_typeof(value) = 'string'
    and btrim(value #>> '{}') <> ''
    and (
      not p_entity_keys
      or value #>> '{}' ~ '^[a-z0-9]+([._:-][a-z0-9]+)*$'
    );
  return item_count = pg_catalog.jsonb_array_length(p_value)
    and (p_allow_empty or item_count > 0)
    and cardinality(actual) = cardinality(array(
      select distinct value from pg_catalog.unnest(actual) as member(value)
    ))
    and actual is not distinct from sorted;
exception when others then
  return false;
end;
$$;

create or replace function public.valid_temporal_pair_0019(
  p_value jsonb,
  p_precision jsonb,
  p_nullable boolean
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare temporal_value text;
declare precision_value text;
declare parsed_date date;
declare parsed_timestamp timestamptz;
begin
  if p_value = 'null'::jsonb or p_precision = 'null'::jsonb then
    return p_nullable and p_value = 'null'::jsonb and p_precision = 'null'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'string'
    or pg_catalog.jsonb_typeof(p_precision) <> 'string'
  then return false; end if;
  temporal_value := p_value #>> '{}';
  precision_value := p_precision #>> '{}';
  if precision_value = 'date' and temporal_value ~ '^\d{4}-\d{2}-\d{2}$' then
    parsed_date := temporal_value::date;
    return parsed_date::text = temporal_value;
  elsif precision_value = 'timestamp'
    and temporal_value ~ '^\d{4}-\d{2}-\d{2}T'
  then
    parsed_timestamp := temporal_value::timestamptz;
    return parsed_timestamp is not null;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create or replace function public.temporal_definitely_before_0019(
  p_left jsonb,
  p_right jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare left_value text := p_left #>> '{}';
declare right_value text := p_right #>> '{}';
declare left_latest timestamptz;
declare right_earliest timestamptz;
begin
  if p_left = 'null'::jsonb or p_right = 'null'::jsonb then return false; end if;
  left_latest := case
    when left_value ~ '^\d{4}-\d{2}-\d{2}$'
      then (left_value::date + 1)::timestamp at time zone 'UTC'
        - interval '1 millisecond'
    else left_value::timestamptz
  end;
  right_earliest := case
    when right_value ~ '^\d{4}-\d{2}-\d{2}$'
      then right_value::date::timestamp at time zone 'UTC'
    else right_value::timestamptz
  end;
  return left_latest < right_earliest;
exception when others then
  return true;
end;
$$;

create or replace function public.valid_canonical_http_url_0019(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare url_value text;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then return false; end if;
  url_value := p_value #>> '{}';
  return url_value ~ '^https?://[^/?#@[:space:]]+([^#[:space:]]*)?$'
    and url_value !~ '/$'
    and url_value !~* '([?&])(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)='
    and url_value !~ '[?&]$';
exception when others then
  return false;
end;
$$;

create or replace function public.valid_source_ref_v2_0019(p_source jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare text_payload jsonb;
declare text_status text;
declare locator_payload jsonb;
declare locator_kind text;
declare provenance_value text;
declare source_class_value text;
declare authority_value text;
declare role_value text;
begin
  if not public.jsonb_exact_keys_0019(p_source, array[
    'adaptation','canonicalUrl','contentFingerprint','documentId','entityKeys',
    'eventAt','eventAtPrecision','evidenceRole','id','locator','provenance',
    'providerId','publishedAt','publishedAtPrecision','publisher','retrievedAt',
    'retrievedAtPrecision','schemaVersion','sourceAuthority','sourceClass',
    'sourceRevisionId','text','title','updatedAt','updatedAtPrecision'
  ]) or p_source ->> 'schemaVersion' <> 'source-ref-v2'
    or p_source ->> 'adaptation' <> 'canonical'
    or coalesce(btrim(p_source ->> 'id'), '') = ''
    or coalesce(btrim(p_source ->> 'title'), '') = ''
    or not public.jsonb_sorted_unique_text_array_0019(
      p_source -> 'entityKeys', true, true
    )
    or not public.valid_temporal_pair_0019(
      p_source -> 'eventAt', p_source -> 'eventAtPrecision', true
    )
    or not public.valid_temporal_pair_0019(
      p_source -> 'publishedAt', p_source -> 'publishedAtPrecision', true
    )
    or not public.valid_temporal_pair_0019(
      p_source -> 'retrievedAt', p_source -> 'retrievedAtPrecision', true
    )
    or not public.valid_temporal_pair_0019(
      p_source -> 'updatedAt', p_source -> 'updatedAtPrecision', true
    )
  then return false; end if;

  provenance_value := p_source ->> 'provenance';
  source_class_value := p_source ->> 'sourceClass';
  authority_value := p_source ->> 'sourceAuthority';
  role_value := p_source ->> 'evidenceRole';
  if provenance_value not in (
      'source_document','public_web','demo_fixture','model_inference'
    ) or source_class_value not in (
      'company_official','government_or_regulator','court_or_public_filing',
      'customer_or_partner_official','investor_official','funding_publication',
      'industry_publication','commercial_database','founder_social',
      'internal_decision_record','model_output'
    ) or authority_value not in ('primary','secondary','not_applicable')
    or role_value not in ('trigger','corroborating','counterevidence','context')
  then return false; end if;

  if p_source -> 'canonicalUrl' <> 'null'::jsonb
    and not public.valid_canonical_http_url_0019(p_source -> 'canonicalUrl')
  then return false; end if;
  foreach text_payload in array array[
    p_source -> 'documentId', p_source -> 'publisher', p_source -> 'providerId',
    p_source -> 'sourceRevisionId'
  ] loop
    if text_payload <> 'null'::jsonb and (
      pg_catalog.jsonb_typeof(text_payload) <> 'string'
      or coalesce(btrim(text_payload #>> '{}'), '') = ''
    ) then return false; end if;
  end loop;
  if p_source -> 'contentFingerprint' <> 'null'::jsonb and (
    pg_catalog.jsonb_typeof(p_source -> 'contentFingerprint') <> 'string'
    or p_source ->> 'contentFingerprint' !~ '^sha256:[0-9a-f]{64}$'
  ) then return false; end if;

  locator_payload := p_source -> 'locator';
  if locator_payload <> 'null'::jsonb then
    locator_kind := locator_payload ->> 'kind';
    if (locator_kind = 'web_text' and (
        not public.jsonb_exact_keys_0019(locator_payload,array['kind','selector'])
        or coalesce(btrim(locator_payload->>'selector'),'')=''
      )) or (locator_kind = 'document_page' and (
        not public.jsonb_exact_keys_0019(locator_payload,array['kind','page'])
        or pg_catalog.jsonb_typeof(locator_payload->'page') <> 'number'
        or locator_payload->>'page' !~ '^[1-9][0-9]*$'
      )) or (locator_kind = 'json_pointer' and (
        not public.jsonb_exact_keys_0019(locator_payload,array['kind','pointer'])
        or locator_payload->>'pointer'
          !~ '^/([^~/]|~[01])+(/([^~/]|~[01])+)*$'
      )) or (locator_kind = 'line_range' and (
        not public.jsonb_exact_keys_0019(
          locator_payload,array['endLine','kind','startLine']
        )
        or pg_catalog.jsonb_typeof(locator_payload->'startLine') <> 'number'
        or pg_catalog.jsonb_typeof(locator_payload->'endLine') <> 'number'
        or locator_payload->>'startLine' !~ '^[1-9][0-9]*$'
        or locator_payload->>'endLine' !~ '^[1-9][0-9]*$'
        or (locator_payload->>'endLine')::integer
          < (locator_payload->>'startLine')::integer
      )) or locator_kind not in (
        'web_text','document_page','json_pointer','line_range'
      ) then return false; end if;
  end if;

  text_payload := p_source -> 'text';
  text_status := text_payload ->> 'status';
  if text_status = 'normalized_only' then
    if not public.jsonb_exact_keys_0019(
      text_payload,array['normalizedStatement','status']
    ) or coalesce(btrim(text_payload->>'normalizedStatement'),'')=''
      or length(text_payload->>'normalizedStatement') > 2000
    then return false; end if;
  elsif text_status = 'verified_exact' then
    if not (
      public.jsonb_exact_keys_0019(
        text_payload,array['status','verbatimExcerpt']
      ) or public.jsonb_exact_keys_0019(
        text_payload,array['normalizedStatement','status','verbatimExcerpt']
      )
    ) or coalesce(btrim(text_payload->>'verbatimExcerpt'),'')=''
      or length(text_payload->>'verbatimExcerpt') > 2000
      or array_length(regexp_split_to_array(btrim(text_payload->>'verbatimExcerpt'),'\s+'),1) > 25
      or (text_payload ? 'normalizedStatement' and (
        coalesce(btrim(text_payload->>'normalizedStatement'),'')=''
        or length(text_payload->>'normalizedStatement') > 2000
        or text_payload->>'normalizedStatement'=text_payload->>'verbatimExcerpt'
      ))
      or p_source -> 'sourceRevisionId' = 'null'::jsonb
      or locator_payload = 'null'::jsonb
      or p_source -> 'retrievedAt' = 'null'::jsonb
      or p_source -> 'contentFingerprint' = 'null'::jsonb
    then return false; end if;
  elsif text_status = 'model_inference' then
    if not public.jsonb_exact_keys_0019(
      text_payload,array['model','normalizedStatement','status']
    ) or coalesce(btrim(text_payload->>'normalizedStatement'),'')=''
      or length(text_payload->>'normalizedStatement') > 2000
      or not public.jsonb_exact_keys_0019(
        text_payload->'model',array['generatedAt','inputFingerprint','model','provider']
      )
      or coalesce(btrim(text_payload#>>'{model,provider}'),'')=''
      or coalesce(btrim(text_payload#>>'{model,model}'),'')=''
      or not public.valid_temporal_pair_0019(
        text_payload#>'{model,generatedAt}', '"timestamp"'::jsonb, false
      )
      or text_payload#>>'{model,inputFingerprint}' !~ '^sha256:[0-9a-f]{64}$'
    then return false; end if;
  else return false;
  end if;

  if provenance_value = 'public_web' and (
      p_source -> 'canonicalUrl' = 'null'::jsonb
      or p_source -> 'publisher' = 'null'::jsonb
      or p_source -> 'providerId' = 'null'::jsonb
      or p_source -> 'retrievedAt' = 'null'::jsonb
      or p_source -> 'contentFingerprint' = 'null'::jsonb
      or source_class_value in ('internal_decision_record','model_output')
    )
  then return false; end if;
  if provenance_value = 'source_document' and (
      p_source -> 'documentId' = 'null'::jsonb
      or p_source -> 'sourceRevisionId' = 'null'::jsonb
      or p_source -> 'retrievedAt' = 'null'::jsonb
      or p_source -> 'contentFingerprint' = 'null'::jsonb
    )
  then return false; end if;
  if public.temporal_definitely_before_0019(
      p_source->'retrievedAt',p_source->'publishedAt'
    ) or public.temporal_definitely_before_0019(
      p_source->'updatedAt',p_source->'publishedAt'
    ) or public.temporal_definitely_before_0019(
      p_source->'retrievedAt',p_source->'updatedAt'
    )
  then return false; end if;
  if provenance_value = 'demo_fixture' and (
      p_source ->> 'title' <> 'Sample decision record'
      or source_class_value <> 'internal_decision_record'
      or authority_value <> 'primary' or role_value <> 'context'
      or text_status <> 'normalized_only'
      or p_source#>>'{text,normalizedStatement}'
        not like 'Sample decision record. %'
    )
  then return false; end if;
  if text_status = 'model_inference' then
    return provenance_value='model_inference'
      and source_class_value='model_output'
      and authority_value='not_applicable' and role_value='context';
  end if;
  return provenance_value <> 'model_inference'
    and source_class_value <> 'model_output'
    and authority_value <> 'not_applicable';
exception when others then
  return false;
end;
$$;

create or replace function public.valid_market_event_v2_0019(p_event jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare source jsonb;
declare trigger_source jsonb;
declare source_ids text[] := array[]::text[];
declare source_entity_keys text[] := array[]::text[];
declare trigger_count integer := 0;
declare prior_non_trigger_id text;
begin
  if not public.jsonb_exact_keys_0019(p_event,array[
    'adaptation','canonicalUrl','confidence','contentFingerprint','entityKeys',
    'eventAt','eventAtPrecision','eventType','id','negativeImplications',
    'positiveImplications','providerId','publishedAt','publishedAtPrecision',
    'retrievedAt','retrievedAtPrecision','schemaVersion','sectors','sources',
    'summary','themes','title','triggerSourceId','updatedAt','updatedAtPrecision'
  ]) or p_event->>'schemaVersion'<>'market-event-v2'
    or p_event->>'adaptation'<>'canonical'
    or coalesce(btrim(p_event->>'id'),'')=''
    or coalesce(btrim(p_event->>'title'),'')=''
    or coalesce(btrim(p_event->>'eventType'),'')=''
    or coalesce(btrim(p_event->>'summary'),'')=''
    or coalesce(btrim(p_event->>'providerId'),'')=''
    or p_event->>'confidence' not in ('low','medium','high')
    or p_event->>'contentFingerprint' !~ '^sha256:[0-9a-f]{64}$'
    or not public.valid_canonical_http_url_0019(p_event->'canonicalUrl')
    or not public.jsonb_sorted_unique_text_array_0019(p_event->'sectors',true,false)
    or not public.jsonb_sorted_unique_text_array_0019(p_event->'themes',true,false)
    or not public.jsonb_sorted_unique_text_array_0019(
      p_event->'positiveImplications',true,false
    ) or not public.jsonb_sorted_unique_text_array_0019(
      p_event->'negativeImplications',true,false
    ) or not public.jsonb_sorted_unique_text_array_0019(
      p_event->'entityKeys',true,true
    ) or not public.valid_temporal_pair_0019(
      p_event->'eventAt',p_event->'eventAtPrecision',true
    ) or not public.valid_temporal_pair_0019(
      p_event->'publishedAt',p_event->'publishedAtPrecision',false
    ) or not public.valid_temporal_pair_0019(
      p_event->'retrievedAt',p_event->'retrievedAtPrecision',false
    ) or not public.valid_temporal_pair_0019(
      p_event->'updatedAt',p_event->'updatedAtPrecision',true
    ) or pg_catalog.jsonb_typeof(p_event->'sources')<>'array'
      or pg_catalog.jsonb_array_length(p_event->'sources')=0
  then return false; end if;

  for source in
    select value from pg_catalog.jsonb_array_elements(p_event->'sources')
      with ordinality as item(value,ordinal) order by ordinal
  loop
    if not public.valid_source_ref_v2_0019(source)
      or source->>'provenance' in ('demo_fixture','model_inference')
      or source->>'sourceClass' in ('internal_decision_record','model_output')
    then return false; end if;
    if source->>'id'=any(source_ids) then return false; end if;
    source_ids := source_ids || source->>'id';
    select source_entity_keys || coalesce(array_agg(value#>>'{}'),array[]::text[])
    into source_entity_keys
    from pg_catalog.jsonb_array_elements(source->'entityKeys') as key(value);
    if source->>'evidenceRole'='trigger' then
      trigger_count := trigger_count+1;
      trigger_source := source;
      if cardinality(source_ids)<>1 then return false; end if;
    else
      if prior_non_trigger_id is not null
        and prior_non_trigger_id collate "C" >= source->>'id' collate "C"
      then return false; end if;
      prior_non_trigger_id := source->>'id';
    end if;
  end loop;
  if trigger_count<>1 or trigger_source->>'id'<>p_event->>'triggerSourceId'
    or trigger_source->>'provenance'<>'public_web'
    or trigger_source->'canonicalUrl' is distinct from p_event->'canonicalUrl'
    or trigger_source->'eventAt' is distinct from p_event->'eventAt'
    or trigger_source->'eventAtPrecision' is distinct from p_event->'eventAtPrecision'
    or trigger_source->'publishedAt' is distinct from p_event->'publishedAt'
    or trigger_source->'publishedAtPrecision' is distinct from p_event->'publishedAtPrecision'
    or trigger_source->'retrievedAt' is distinct from p_event->'retrievedAt'
    or trigger_source->'retrievedAtPrecision' is distinct from p_event->'retrievedAtPrecision'
    or trigger_source->'updatedAt' is distinct from p_event->'updatedAt'
    or trigger_source->'updatedAtPrecision' is distinct from p_event->'updatedAtPrecision'
    or trigger_source->'providerId' is distinct from p_event->'providerId'
  then return false; end if;
  if public.temporal_definitely_before_0019(
      p_event->'retrievedAt',p_event->'publishedAt'
    ) or public.temporal_definitely_before_0019(
      p_event->'updatedAt',p_event->'publishedAt'
    ) or public.temporal_definitely_before_0019(
      p_event->'retrievedAt',p_event->'updatedAt'
    )
  then return false; end if;
  select coalesce(array_agg(distinct entity_key order by entity_key collate "C"),array[]::text[])
  into source_entity_keys from pg_catalog.unnest(source_entity_keys) as key(entity_key);
  if source_entity_keys is distinct from array(
      select value#>>'{}' from pg_catalog.jsonb_array_elements(p_event->'entityKeys')
        with ordinality as item(value,ordinal) order by ordinal
    ) or p_event->>'contentFingerprint' is distinct from
      public.sha256_canonical_jsonb_0019(p_event-'id'-'contentFingerprint')
  then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.market_event_sources_are_verified_0019(
  p_event jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select public.valid_market_event_v2_0019(p_event)
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_event->'sources') as source(value)
      where value#>>'{text,status}' <> 'verified_exact'
    )
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
  check (payload ->> 'adaptation' = 'canonical'),
  check (public.valid_market_event_v2_0019(payload) is true)
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
  check (payload ->> 'adaptation' = 'canonical'),
  check (public.valid_market_event_v2_0019(payload) is true)
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

create or replace function public.valid_belief_action_0019(p_action jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare action_kind text := p_action->>'kind';
declare expected_scope text;
declare expected_priority text;
begin
  if not public.jsonb_exact_keys_0019(
      p_action,array['kind','priority','scope','visibility']
    ) or action_kind not in (
      'advance_diligence','continue_monitoring','deprioritize',
      'reopen_diligence','evaluate_follow_on','pause_follow_on',
      'portfolio_risk_review','no_new_action','review_analysis_failure'
    )
  then return false; end if;
  expected_scope := case
    when action_kind='review_analysis_failure' then 'analysis'
    when action_kind in (
      'evaluate_follow_on','pause_follow_on','portfolio_risk_review'
    ) then 'portfolio'
    else 'deal'
  end;
  expected_priority := case when action_kind in (
    'pause_follow_on','portfolio_risk_review'
  ) then 'high' else 'standard' end;
  return p_action->>'scope'=expected_scope
    and p_action->>'priority'=expected_priority
    and p_action->>'visibility'='internal_only';
exception when others then return false;
end;
$$;

create or replace function public.expected_belief_actions_0019(
  p_status text,p_direction text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare kinds text[];
declare action_kind text;
declare actions jsonb := '[]'::jsonb;
begin
  kinds := case
    when p_direction='positive' and p_status='passed' then array['reopen_diligence']
    when p_direction='positive' and p_status='invested' then array['evaluate_follow_on']
    when p_direction='positive' then array['advance_diligence']
    when p_direction='mixed' then array['continue_monitoring']
    when p_direction='negative' and p_status='invested'
      then array['pause_follow_on','portfolio_risk_review']
    when p_direction='negative' then array['deprioritize']
    when p_direction='none' then array['no_new_action']
    when p_direction='unavailable' then array['review_analysis_failure']
    else null
  end;
  if p_status not in ('screening','watchlist','evaluating','passed','invested')
    or kinds is null
  then return null; end if;
  foreach action_kind in array kinds loop
    actions := actions || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind',action_kind,
      'scope',case
        when action_kind='review_analysis_failure' then 'analysis'
        when action_kind in (
          'evaluate_follow_on','pause_follow_on','portfolio_risk_review'
        ) then 'portfolio'
        else 'deal' end,
      'priority',case when action_kind in (
        'pause_follow_on','portfolio_risk_review'
      ) then 'high' else 'standard' end,
      'visibility','internal_only'
    ));
  end loop;
  return actions;
end;
$$;

create or replace function public.valid_belief_action_list_0019(p_actions jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare action jsonb;
begin
  if pg_catalog.jsonb_typeof(p_actions)<>'array'
    or pg_catalog.jsonb_array_length(p_actions)=0
  then return false; end if;
  for action in select value from pg_catalog.jsonb_array_elements(p_actions) value loop
    if not public.valid_belief_action_0019(action) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.jsonb_unique_nonempty_text_array_0019(
  p_value jsonb,p_allow_empty boolean default false
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare item_count integer;
declare distinct_count integer;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'array' then return false; end if;
  select count(*)::integer,count(distinct value#>>'{}')::integer
  into item_count,distinct_count
  from pg_catalog.jsonb_array_elements(p_value) item(value)
  where pg_catalog.jsonb_typeof(value)='string' and btrim(value#>>'{}')<>'';
  return item_count=pg_catalog.jsonb_array_length(p_value)
    and item_count=distinct_count and (p_allow_empty or item_count>0);
exception when others then return false;
end;
$$;

create or replace function public.belief_action_compatibility_text_0019(
  p_actions jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare result text;
begin
  if not public.valid_belief_action_list_0019(p_actions) then return null; end if;
  select pg_catalog.string_agg(case value->>'kind'
    when 'advance_diligence' then 'Advance internal diligence based on the cited evidence.'
    when 'continue_monitoring' then 'Continue internal monitoring based on the cited evidence.'
    when 'deprioritize' then 'Deprioritize this Deal based on the cited evidence.'
    when 'reopen_diligence' then 'Reopen internal diligence based on the cited evidence.'
    when 'evaluate_follow_on' then 'Evaluate a follow-on investment based on the cited evidence.'
    when 'pause_follow_on' then 'Pause follow-on investment activity based on the cited evidence.'
    when 'portfolio_risk_review' then 'Begin an internal portfolio-risk review based on the cited evidence.'
    when 'no_new_action' then 'No new internal action is recommended.'
    when 'review_analysis_failure' then 'Review the analysis failure before relying on this company analysis.'
  end,' ' order by ordinal)
  into result
  from pg_catalog.jsonb_array_elements(p_actions)
    with ordinality as action(value,ordinal);
  return result;
end;
$$;

create or replace function public.valid_belief_assessment_shape_0019(
  p_version text,p_direction text,p_score_breakdown jsonb,
  p_gate_context jsonb,p_gate_results jsonb,p_actions jsonb,
  p_deal_status text,p_outcome text,p_confidence text,p_score double precision,
  p_recommended_next_move text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare prior jsonb;
declare trigger_event jsonb;
declare sources jsonb;
declare source jsonb;
declare source_ids text[] := array[]::text[];
declare trigger_source_ids text[];
declare prior_actions jsonb;
declare chronology jsonb;
declare revisit jsonb;
declare counter jsonb;
declare action_delta jsonb;
declare expected_actions jsonb;
declare expected_score numeric;
declare expected_confidence text;
declare chronology_passed boolean;
declare revisit_passed boolean;
declare counter_passed boolean;
declare action_passed boolean;
declare all_passed boolean;
declare qualified boolean;
declare mapped_condition text;
declare citation text;
declare counter_words integer;
begin
  if p_version<>'belief-change-assessment-v1'
    or p_direction not in ('positive','mixed','negative','none','unavailable')
    or p_deal_status not in ('screening','watchlist','evaluating','passed','invested')
    or p_outcome not in (
      'belief_revised','monitor','no_material_change','analysis_unavailable'
    ) or p_confidence not in ('low','medium','high')
    or p_score is null or p_score<'0'::double precision or p_score>'1'::double precision
  then return false; end if;

  if not public.jsonb_exact_keys_0019(p_score_breakdown,array[
      'confidence','dealRelevance','eventRelevance','evidenceQuality',
      'finalScore','priorContextStrength'
    ]) or exists (
      select 1 from pg_catalog.unnest(array[
        'eventRelevance','dealRelevance','priorContextStrength','evidenceQuality','finalScore'
      ]) field
      where pg_catalog.jsonb_typeof(p_score_breakdown->field)<>'number'
        or (p_score_breakdown->>field)::numeric<0
        or (p_score_breakdown->>field)::numeric>1
    )
  then return false; end if;
  expected_score := pg_catalog.round((
    (p_score_breakdown->>'eventRelevance')::numeric*0.35
    +(p_score_breakdown->>'dealRelevance')::numeric*0.30
    +(p_score_breakdown->>'priorContextStrength')::numeric*0.20
    +(p_score_breakdown->>'evidenceQuality')::numeric*0.15
  ),4);
  expected_confidence := case when expected_score>=0.78 then 'high'
    when expected_score>=0.5 then 'medium' else 'low' end;
  if (p_score_breakdown->>'finalScore')::numeric<>expected_score
    or p_score_breakdown->>'confidence'<>expected_confidence
    or p_score<>expected_score::double precision
    or p_confidence<>expected_confidence
  then return false; end if;

  if not public.jsonb_exact_keys_0019(
      p_gate_context,array['priorInteraction','sources','triggerEvent']
    )
  then return false; end if;
  prior := p_gate_context->'priorInteraction';
  trigger_event := p_gate_context->'triggerEvent';
  sources := p_gate_context->'sources';
  if not public.jsonb_exact_keys_0019(prior,array[
      'id','label','occurredAt','priorActions','provenance',
      'revisitConditions','sourceIds'
    ]) or not public.jsonb_exact_keys_0019(
      trigger_event,array['eventAt','id','sourceIds']
    ) or coalesce(btrim(prior->>'id'),'')=''
      or prior->>'provenance'<>'demo_fixture'
      or prior->>'label'<>'Sample decision record'
      or not public.valid_temporal_pair_0019(
        prior->'occurredAt','"timestamp"'::jsonb,false
      ) or not public.jsonb_unique_nonempty_text_array_0019(
        prior->'sourceIds',false
      ) or pg_catalog.jsonb_array_length(prior->'sourceIds')<>1
      or prior#>>'{sourceIds,0}'<>prior->>'id'
      or not public.jsonb_unique_nonempty_text_array_0019(
        prior->'revisitConditions',false
      ) or not public.valid_belief_action_list_0019(prior->'priorActions')
      or coalesce(btrim(trigger_event->>'id'),'')=''
      or not public.valid_temporal_pair_0019(
        trigger_event->'eventAt',
        case when (trigger_event->>'eventAt')~'^\d{4}-\d{2}-\d{2}$'
          then '"date"'::jsonb else '"timestamp"'::jsonb end,false
      ) or not public.jsonb_unique_nonempty_text_array_0019(
        trigger_event->'sourceIds',false
      ) or pg_catalog.jsonb_typeof(sources)<>'array'
      or pg_catalog.jsonb_array_length(sources)<2
  then return false; end if;

  for source in select value from pg_catalog.jsonb_array_elements(sources) value loop
    if not public.valid_source_ref_v2_0019(source)
      or source->>'id'=any(source_ids)
    then return false; end if;
    source_ids:=source_ids||source->>'id';
  end loop;
  trigger_source_ids:=array(
    select value#>>'{}' from pg_catalog.jsonb_array_elements(
      trigger_event->'sourceIds'
    ) with ordinality as item(value,ordinal) order by ordinal
  );
  if cardinality(source_ids)<>cardinality(trigger_source_ids)+1
    or not (prior->>'id'=any(source_ids))
    or exists(select 1 from pg_catalog.unnest(trigger_source_ids) id
      where not id=any(source_ids))
    or not exists(select 1 from pg_catalog.jsonb_array_elements(sources) value
      where value->>'id'=prior->>'id' and value->>'provenance'='demo_fixture'
        and value->>'title'='Sample decision record'
        and value->>'sourceClass'='internal_decision_record'
        and value->>'sourceAuthority'='primary'
        and value->>'evidenceRole'='context'
        and value->>'eventAt'=prior->>'occurredAt')
  then return false; end if;

  if not public.jsonb_exact_keys_0019(p_gate_results,array[
      'actionDelta','allPassed','chronology','counterevidence',
      'revisitConditionMapping'
    ]) then return false; end if;
  chronology:=p_gate_results->'chronology';
  revisit:=p_gate_results->'revisitConditionMapping';
  counter:=p_gate_results->'counterevidence';
  action_delta:=p_gate_results->'actionDelta';
  if not public.jsonb_exact_keys_0019(chronology,array[
      'failureReason','passed','priorInteractionAt','priorInteractionId',
      'triggerEventAt','triggerEventId'
    ]) or not public.jsonb_exact_keys_0019(revisit,array[
      'citedSourceIds','failureReason','passed','priorInteractionId',
      'revisitConditionIndex','revisitConditionText','triggerEventId'
    ]) or not public.jsonb_exact_keys_0019(counter,array[
      'citedSourceIds','failureReason','passed','statement'
    ]) or not public.jsonb_exact_keys_0019(action_delta,array[
      'failureReason','passed','priorActions','proposedActions'
    ]) or pg_catalog.jsonb_typeof(p_gate_results->'allPassed')<>'boolean'
      or pg_catalog.jsonb_typeof(chronology->'passed')<>'boolean'
      or pg_catalog.jsonb_typeof(revisit->'passed')<>'boolean'
      or pg_catalog.jsonb_typeof(counter->'passed')<>'boolean'
      or pg_catalog.jsonb_typeof(action_delta->'passed')<>'boolean'
  then return false; end if;

  chronology_passed:=case
    when (trigger_event->>'eventAt')~'^\d{4}-\d{2}-\d{2}$'
      then (prior->>'occurredAt')::timestamptz::date
        < (trigger_event->>'eventAt')::date
    else (prior->>'occurredAt')::timestamptz
      < (trigger_event->>'eventAt')::timestamptz end;
  if chronology->>'priorInteractionId'<>prior->>'id'
    or chronology->>'priorInteractionAt'<>prior->>'occurredAt'
    or chronology->>'triggerEventId'<>trigger_event->>'id'
    or chronology->>'triggerEventAt'<>trigger_event->>'eventAt'
    or (chronology->>'passed')::boolean<>chronology_passed
    or chronology->'failureReason' is distinct from (case when chronology_passed
      then 'null'::jsonb else pg_catalog.to_jsonb(
        'The selected prior interaction must predate the selected trigger event.'::text
      ) end)
  then return false; end if;

  if pg_catalog.jsonb_typeof(revisit->'revisitConditionIndex')<>'number'
    or (revisit->>'revisitConditionIndex')::integer<0
  then return false; end if;
  mapped_condition:=prior#>>array[
    'revisitConditions',(revisit->>'revisitConditionIndex')::integer::text
  ];
  revisit_passed:=revisit->>'priorInteractionId'=prior->>'id'
    and revisit->>'triggerEventId'=trigger_event->>'id'
    and mapped_condition is not null
    and revisit->>'revisitConditionText'=mapped_condition
    and public.jsonb_unique_nonempty_text_array_0019(
      revisit->'citedSourceIds',false
    );
  if revisit_passed then
    for citation in select value#>>'{}' from pg_catalog.jsonb_array_elements(
      revisit->'citedSourceIds'
    ) item(value) loop
      if not citation=any(trigger_source_ids) then revisit_passed:=false; end if;
    end loop;
  end if;
  if (revisit->>'passed')::boolean<>revisit_passed
    or revisit->'failureReason' is distinct from (case when revisit_passed
      then 'null'::jsonb else pg_catalog.to_jsonb(
        'The claimed revisit condition must exactly bind the selected Sample decision record, trigger event, and resolvable trigger citations.'::text
      ) end)
  then return false; end if;

  counter_words:=coalesce(array_length(regexp_split_to_array(
    btrim(counter->>'statement'),'\s+'
  ),1),0);
  counter_passed:=length(btrim(counter->>'statement'))>=20
    and counter_words>=3
    and public.jsonb_unique_nonempty_text_array_0019(
      counter->'citedSourceIds',false
    );
  if counter_passed then
    for citation in select value#>>'{}' from pg_catalog.jsonb_array_elements(
      counter->'citedSourceIds'
    ) item(value) loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(sources) value
        where value->>'id'=citation and value->>'adaptation'='canonical'
          and value->>'evidenceRole'='counterevidence'
          and value#>>'{text,status}' in ('verified_exact','normalized_only')
          and (value#>>'{text,verbatimExcerpt}'=counter->>'statement'
            or value#>>'{text,normalizedStatement}'=counter->>'statement'))
      then counter_passed:=false; end if;
    end loop;
  end if;
  if (counter->>'passed')::boolean<>counter_passed
    or counter->'failureReason' is distinct from (case when counter_passed
      then 'null'::jsonb else pg_catalog.to_jsonb(
        'Counterevidence must be substantive and cite canonical evidence that supports the complete statement.'::text
      ) end)
  then return false; end if;

  expected_actions:=public.expected_belief_actions_0019(
    p_deal_status,p_direction
  );
  prior_actions:=prior->'priorActions';
  if not public.valid_belief_action_list_0019(p_actions)
    or p_actions is distinct from expected_actions
    or not public.valid_belief_action_list_0019(action_delta->'priorActions')
    or action_delta->'priorActions' is distinct from prior_actions
    or action_delta->'proposedActions' is distinct from p_actions
  then return false; end if;
  action_passed:=p_actions is not distinct from expected_actions
    and prior_actions is distinct from p_actions;
  if (action_delta->>'passed')::boolean<>action_passed
    or action_delta->'failureReason' is distinct from (case when action_passed
      then 'null'::jsonb else pg_catalog.to_jsonb(
        'Proposed actions must materially differ from the selected prior action and exactly match the deterministic status-direction policy.'::text
      ) end)
  then return false; end if;
  all_passed:=chronology_passed and revisit_passed
    and counter_passed and action_passed;
  if (p_gate_results->>'allPassed')::boolean<>all_passed then return false; end if;
  qualified:=p_direction in ('positive','mixed','negative')
    and p_confidence in ('medium','high') and all_passed;
  return (p_outcome='belief_revised')=qualified
    and p_recommended_next_move=
      public.belief_action_compatibility_text_0019(p_actions);
exception when others then
  return false;
end;
$$;

alter table public.company_analyses
  add constraint company_analyses_belief_assessment_check check (
    (pg_catalog.num_nonnulls(
      belief_assessment_version,belief_direction,belief_score_breakdown,
      belief_gate_context,belief_gate_results,belief_actions
    )=0)
    or (
      pg_catalog.num_nonnulls(
        belief_assessment_version,belief_direction,belief_score_breakdown,
        belief_gate_context,belief_gate_results,belief_actions
      )=6
      and public.valid_belief_assessment_shape_0019(
        belief_assessment_version,belief_direction,belief_score_breakdown,
        belief_gate_context,belief_gate_results,belief_actions,deal_status,
        outcome,confidence,score,recommended_next_move
      ) is true
    )
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
declare minimum_ordinal integer;
declare maximum_ordinal integer;
begin
  select * into strict snapshot from public.market_evidence_snapshots
  where workspace_id = p_workspace_id and id = p_snapshot_id;
  select count(*)::integer,min(ordinal),max(ordinal),
    array_agg(event_id order by ordinal),
    array_agg(event_id order by event_id collate "C")
  into actual_count,minimum_ordinal,maximum_ordinal,actual_ids,expected_ids
  from public.market_evidence_snapshot_events
  where workspace_id = p_workspace_id and snapshot_id = p_snapshot_id;
  if actual_count <> snapshot.event_count
    or minimum_ordinal is distinct from 0
    or maximum_ordinal is distinct from snapshot.event_count-1
    or actual_ids is distinct from expected_ids
    or exists (
      select 1 from public.market_evidence_snapshot_events as event
      where event.workspace_id = p_workspace_id and event.snapshot_id = p_snapshot_id
        and (event.ordinal < 0 or event.ordinal >= snapshot.event_count
          or not public.evidence_event_in_window_0019(
            event.published_value, event.published_precision,
            snapshot.window_start_at, snapshot.window_end_at, snapshot.window_timezone)
          or not public.market_event_sources_are_verified_0019(event.payload)
          or event.event_id<>event.payload->>'id'
          or event.event_content_fingerprint<>event.payload->>'contentFingerprint'
          or event.published_value<>event.payload->>'publishedAt'
          or event.published_precision<>event.payload->>'publishedAtPrecision')
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
    select public.canonical_jsonb_text_0019(payload)
    from public.market_evidence_snapshot_events
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

create or replace function public.validate_snapshot_parent_deferred_0019()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.validate_snapshot_0019(
    coalesce(new.workspace_id,old.workspace_id),coalesce(new.id,old.id)
  );
  return null;
end;
$$;

create constraint trigger market_evidence_snapshots_validate
after insert or update or delete on public.market_evidence_snapshots
deferrable initially deferred for each row
execute function public.validate_snapshot_parent_deferred_0019();

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
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(events) event(value)
    where not public.market_event_sources_are_verified_0019(value)
  ) then raise exception 'INVALID_MARKET_EVENT_V2'; end if;
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
  ] || array(select public.canonical_jsonb_text_0019(value)
    from jsonb_array_elements(events) value order by value ->> 'id' collate "C"))
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
  if not public.jsonb_exact_keys_0019(
      p_request,array['evidenceRequest','mode','windowDays','workspaceId']
    ) or workspace = '' or run_mode not in ('xtrace','structured')
    or (p_request ->> 'windowDays')::integer <> 14
    or evidence ->> 'schemaVersion' <> 'run-evidence-request-v1'
    or evidence_mode not in ('live','pinned')
    or (
      evidence_mode='live' and not public.jsonb_exact_keys_0019(
        evidence,array['evidenceMode','schemaVersion']
      )
    ) or (
      evidence_mode='pinned' and (
        not public.jsonb_exact_keys_0019(
          evidence,array['evidenceMode','schemaVersion','snapshotId']
        ) or coalesce(btrim(evidence->>'snapshotId'),'')=''
      )
    )
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
declare snapshot public.market_evidence_snapshots%rowtype;
declare actual_count integer;
declare ids_by_ordinal text[];
declare ids_by_name text[];
declare event_fingerprint text;
declare binding_digest text;
declare minimum_ordinal integer;
declare maximum_ordinal integer;
begin
  select * into binding from public.run_evidence_bindings
    where workspace_id=p_workspace_id and run_id=p_run_id;
  if not found then raise exception 'INVALID_RUN_EVIDENCE_BINDING'; end if;
  select * into run from public.scan_runs
    where workspace_id=p_workspace_id and id=p_run_id;
  if not found then raise exception 'INVALID_RUN_EVIDENCE_BINDING'; end if;
  select count(*)::integer,min(ordinal),max(ordinal),
    array_agg(event_id order by ordinal),
    array_agg(event_id order by event_id collate "C")
  into actual_count,minimum_ordinal,maximum_ordinal,ids_by_ordinal,ids_by_name
  from public.run_market_events
    where workspace_id=p_workspace_id and run_id=p_run_id;
  if binding.event_count <> actual_count
    or (actual_count=0 and (
      minimum_ordinal is not null or maximum_ordinal is not null
    )) or (actual_count>0 and (
      minimum_ordinal is distinct from 0
      or maximum_ordinal is distinct from actual_count-1
    )) or ids_by_ordinal is distinct from ids_by_name
    or binding.schema_version <> 'run-evidence-binding-v1'
    or binding.evidence_context_version is distinct from run.evidence_context_version
    or binding.evidence_context_version <> 'run-evidence-context-v1'
    or binding.evidence_context_fingerprint is distinct from run.evidence_context_fingerprint
    or binding.evidence_mode is distinct from run.evidence_mode
    or binding.window_days is distinct from run.window_days
    or binding.anchor_at is distinct from run.evidence_anchor_at
    or binding.window_start_at is distinct from run.evidence_window_start_at
    or binding.window_end_at is distinct from run.evidence_window_end_at
    or binding.window_timezone is distinct from run.evidence_window_timezone
    or binding.snapshot_id is distinct from run.evidence_snapshot_id
    or binding.snapshot_fingerprint is distinct from run.evidence_snapshot_fingerprint
    or exists(select 1 from public.run_market_events event
      where event.workspace_id=p_workspace_id and event.run_id=p_run_id
        and (not public.valid_market_event_v2_0019(event.payload)
          or event.event_id<>event.payload->>'id'
          or event.event_content_fingerprint<>event.payload->>'contentFingerprint'
          or event.published_value<>event.payload->>'publishedAt'
          or event.published_precision<>event.payload->>'publishedAtPrecision'
          or not public.evidence_event_in_window_0019(
            event.published_value,event.published_precision,
            binding.window_start_at,binding.window_end_at,binding.window_timezone)))
  then raise exception 'INVALID_RUN_EVIDENCE_BINDING'; end if;
  if binding.evidence_mode='pinned' then
    select * into strict snapshot from public.market_evidence_snapshots
      where workspace_id=p_workspace_id and id=binding.snapshot_id
        and snapshot_fingerprint=binding.snapshot_fingerprint;
    if binding.display_label is distinct from snapshot.display_label
      or binding.event_count is distinct from snapshot.event_count
      or binding.event_count=0
      or exists(
        select 1 from public.market_evidence_snapshot_events snapshot_event
        full join public.run_market_events run_event
          on run_event.workspace_id=snapshot_event.workspace_id
          and run_event.run_id=p_run_id
          and run_event.ordinal=snapshot_event.ordinal
        where coalesce(snapshot_event.workspace_id,run_event.workspace_id)=p_workspace_id
          and snapshot_event.snapshot_id=binding.snapshot_id
          and (snapshot_event.event_id is distinct from run_event.event_id
            or snapshot_event.event_content_fingerprint
              is distinct from run_event.event_content_fingerprint
            or snapshot_event.published_value is distinct from run_event.published_value
            or snapshot_event.published_precision is distinct from run_event.published_precision
            or snapshot_event.payload is distinct from run_event.payload)
      )
    then raise exception 'INVALID_PINNED_RUN_EVIDENCE_BINDING'; end if;
  elsif binding.evidence_mode='live' then
    if binding.snapshot_id is not null or binding.snapshot_fingerprint is not null
      or binding.display_label is distinct from
        'Live evidence window ending '
          || public.canonical_utc_iso_milliseconds(binding.window_end_at)
    then raise exception 'INVALID_LIVE_RUN_EVIDENCE_BINDING'; end if;
  else raise exception 'INVALID_RUN_EVIDENCE_BINDING'; end if;
  event_fingerprint := public.sha256_length_framed(array['run-event-set-v1'] || coalesce(array(
    select public.canonical_jsonb_text_0019(payload) from public.run_market_events
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

create or replace function public.validate_run_binding_deferred_0019()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.validate_run_binding_0019(
    coalesce(new.workspace_id,old.workspace_id),
    coalesce(new.run_id,old.run_id)
  );
  return null;
end;
$$;

create constraint trigger run_evidence_bindings_validate_0019
after insert or update or delete on public.run_evidence_bindings
deferrable initially deferred for each row
execute function public.validate_run_binding_deferred_0019();

create constraint trigger run_market_events_validate_0019
after insert or update or delete on public.run_market_events
deferrable initially deferred for each row
execute function public.validate_run_binding_deferred_0019();

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
    select public.canonical_jsonb_text_0019(payload)
    from public.market_evidence_snapshot_events
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
declare selected_events jsonb;
begin
  select * into strict run from public.scan_runs where workspace_id=p_workspace_id and id=p_run_id for update;
  if run.evidence_mode <> 'live' then raise exception 'LIVE_BINDING_REQUIRES_LIVE_RUN'; end if;
  if requested <> coalesce((select count(distinct value) from unnest(p_event_ids) value),0)
    or exists(select 1 from unnest(coalesce(p_event_ids,array[]::text[])) value
      where value is null or btrim(value)='')
  then
    raise exception 'DUPLICATE_LIVE_EVENT_ID'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',locked.id,'payload',locked.payload
  ) order by locked.id collate "C"),'[]'::jsonb)
  into selected_events
  from (
    select event.id,event.payload from public.market_events event
    where event.workspace_id=p_workspace_id
      and event.id=any(coalesce(p_event_ids,array[]::text[]))
    order by event.id collate "C" for share
  ) locked;
  resolved:=pg_catalog.jsonb_array_length(selected_events);
  if resolved <> requested then raise exception 'UNKNOWN_OR_OUT_OF_WINDOW_LIVE_EVENT'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(selected_events) item
    where not public.valid_market_event_v2_0019(item->'payload')
      or not public.evidence_event_in_window_0019(
        item#>>'{payload,publishedAt}',item#>>'{payload,publishedAtPrecision}',
        run.evidence_window_start_at,run.evidence_window_end_at,
        run.evidence_window_timezone))
  then raise exception 'UNKNOWN_OR_OUT_OF_WINDOW_LIVE_EVENT'; end if;
  event_set_digest := public.sha256_length_framed(array['run-event-set-v1'] || coalesce(array(
    select public.canonical_jsonb_text_0019(item->'payload')
    from pg_catalog.jsonb_array_elements(selected_events) item
    order by item->>'id' collate "C"),array[]::text[]));
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
    (row_number() over(order by item->>'id' collate "C")-1)::integer,
    item->>'id',item#>>'{payload,contentFingerprint}',
    item#>>'{payload,publishedAt}',item#>>'{payload,publishedAtPrecision}',
    item->'payload'
  from pg_catalog.jsonb_array_elements(selected_events) item;
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
declare old_count integer;
declare new_count integer;
declare evidence_changed boolean;
declare non_evidence_changed boolean;
begin
  if tg_op = 'DELETE' then
    if old.evidence_context_version is not null then
      raise exception 'CURRENT_REPORT_LINEAGE_IS_IMMUTABLE';
    end if;
    return old;
  end if;
  old_count:=pg_catalog.num_nonnulls(
    old.evidence_context_version,old.evidence_mode,old.evidence_window_days,
    old.evidence_anchor_at,old.evidence_window_start_at,old.evidence_window_end_at,
    old.evidence_window_timezone,old.evidence_snapshot_id,old.evidence_snapshot_fingerprint,
    old.evidence_context_fingerprint,old.evidence_display_label,old.evidence_event_count,
    old.evidence_event_set_fingerprint,old.evidence_binding_fingerprint
  );
  new_count:=pg_catalog.num_nonnulls(
    new.evidence_context_version,new.evidence_mode,new.evidence_window_days,
    new.evidence_anchor_at,new.evidence_window_start_at,new.evidence_window_end_at,
    new.evidence_window_timezone,new.evidence_snapshot_id,new.evidence_snapshot_fingerprint,
    new.evidence_context_fingerprint,new.evidence_display_label,new.evidence_event_count,
    new.evidence_event_set_fingerprint,new.evidence_binding_fingerprint
  );
  evidence_changed:=row(old.evidence_context_version,old.evidence_mode,old.evidence_window_days,
      old.evidence_anchor_at,old.evidence_window_start_at,old.evidence_window_end_at,
      old.evidence_window_timezone,old.evidence_snapshot_id,old.evidence_snapshot_fingerprint,
      old.evidence_context_fingerprint,old.evidence_display_label,old.evidence_event_count,
      old.evidence_event_set_fingerprint,old.evidence_binding_fingerprint)
    is distinct from
    row(new.evidence_context_version,new.evidence_mode,new.evidence_window_days,
      new.evidence_anchor_at,new.evidence_window_start_at,new.evidence_window_end_at,
      new.evidence_window_timezone,new.evidence_snapshot_id,new.evidence_snapshot_fingerprint,
      new.evidence_context_fingerprint,new.evidence_display_label,new.evidence_event_count,
      new.evidence_event_set_fingerprint,new.evidence_binding_fingerprint);
  non_evidence_changed:=(pg_catalog.to_jsonb(old)-array[
    'evidence_context_version','evidence_mode','evidence_window_days',
    'evidence_anchor_at','evidence_window_start_at','evidence_window_end_at',
    'evidence_window_timezone','evidence_snapshot_id','evidence_snapshot_fingerprint',
    'evidence_context_fingerprint','evidence_display_label','evidence_event_count',
    'evidence_event_set_fingerprint','evidence_binding_fingerprint'
  ]) is distinct from (pg_catalog.to_jsonb(new)-array[
    'evidence_context_version','evidence_mode','evidence_window_days',
    'evidence_anchor_at','evidence_window_start_at','evidence_window_end_at',
    'evidence_window_timezone','evidence_snapshot_id','evidence_snapshot_fingerprint',
    'evidence_context_fingerprint','evidence_display_label','evidence_event_count',
    'evidence_event_set_fingerprint','evidence_binding_fingerprint'
  ]);
  if old_count=14 and (evidence_changed or non_evidence_changed) then
    raise exception 'CURRENT_REPORT_LINEAGE_IS_IMMUTABLE';
  end if;
  if evidence_changed then
    if old_count<>0 or new_count<>14 or non_evidence_changed
      or new.evidence_context_version <> 'run-evidence-context-v1'
      or pg_catalog.current_setting('vsee.0019_finalizer',true) is distinct from 'on'
      or not exists(select 1 from public.intelligence_reports stored
        where stored.workspace_id=old.workspace_id and stored.id=old.id
          and stored.xmin::text=pg_catalog.pg_current_xact_id()::text)
    then raise exception 'REPORT_EVIDENCE_CONTEXT_IS_IMMUTABLE'; end if;
  elsif old_count=0 and not exists(
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

create trigger intelligence_reports_protect_evidence_0019
before update or delete on public.intelligence_reports for each row
execute function public.protect_report_evidence_0019();

create or replace function public.protect_analysis_assessment_0019()
returns trigger language plpgsql set search_path = '' as $$
declare old_count integer;
declare new_count integer;
declare assessment_changed boolean;
declare non_assessment_changed boolean;
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from public.intelligence_reports report
      where report.workspace_id=old.workspace_id and report.id=old.report_id
        and report.evidence_context_version is not null)
    then raise exception 'CURRENT_ANALYSIS_LINEAGE_IS_IMMUTABLE'; end if;
    return old;
  end if;
  old_count:=pg_catalog.num_nonnulls(
    old.belief_assessment_version,old.belief_direction,
    old.belief_score_breakdown,old.belief_gate_context,
    old.belief_gate_results,old.belief_actions
  );
  new_count:=pg_catalog.num_nonnulls(
    new.belief_assessment_version,new.belief_direction,
    new.belief_score_breakdown,new.belief_gate_context,
    new.belief_gate_results,new.belief_actions
  );
  assessment_changed:=row(old.belief_assessment_version,old.belief_direction,
      old.belief_score_breakdown,old.belief_gate_context,
      old.belief_gate_results,old.belief_actions)
    is distinct from
    row(new.belief_assessment_version,new.belief_direction,
      new.belief_score_breakdown,new.belief_gate_context,
      new.belief_gate_results,new.belief_actions);
  non_assessment_changed:=(pg_catalog.to_jsonb(old)-array[
    'belief_assessment_version','belief_direction','belief_score_breakdown',
    'belief_gate_context','belief_gate_results','belief_actions'
  ]) is distinct from (pg_catalog.to_jsonb(new)-array[
    'belief_assessment_version','belief_direction','belief_score_breakdown',
    'belief_gate_context','belief_gate_results','belief_actions'
  ]);
  if old_count=6 and (assessment_changed or non_assessment_changed) then
    raise exception 'CURRENT_ANALYSIS_LINEAGE_IS_IMMUTABLE';
  end if;
  if assessment_changed then
    if old_count<>0 or new_count<>6 or non_assessment_changed
      or new.belief_assessment_version <> 'belief-change-assessment-v1'
      or pg_catalog.current_setting('vsee.0019_finalizer',true) is distinct from 'on'
      or not exists(select 1 from public.company_analyses stored
        where stored.workspace_id=old.workspace_id and stored.id=old.id
          and stored.xmin::text=pg_catalog.pg_current_xact_id()::text)
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
          and event.event_id=analysis#>>'{beliefGateContext,triggerEvent,id}')
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
declare run public.scan_runs%rowtype;
begin
  select * into run from public.scan_runs
  where workspace_id=workspace and id=run_id for share;
  if not found then raise exception 'REPORT_RUN_NOT_FOUND'; end if;
  if binding_fingerprint is null then
    if pg_catalog.num_nonnulls(
      run.evidence_context_version,run.evidence_mode,run.evidence_anchor_at,
      run.evidence_window_start_at,run.evidence_window_end_at,
      run.evidence_window_timezone,run.evidence_snapshot_id,
      run.evidence_snapshot_fingerprint,run.evidence_context_fingerprint
    ) <> 0 then
      raise exception 'CURRENT_RUN_REQUIRES_EVIDENCE_BINDING';
    end if;
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
create policy scan_runs_registry_owner_0019
  on public.scan_runs for all to vsee_registry_owner
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
    'public.jsonb_exact_keys_0019(jsonb,text[])'::regprocedure,
    'public.canonical_jsonb_text_0019(jsonb)'::regprocedure,
    'public.sha256_canonical_jsonb_0019(jsonb)'::regprocedure,
    'public.jsonb_sorted_unique_text_array_0019(jsonb,boolean,boolean)'::regprocedure,
    'public.valid_temporal_pair_0019(jsonb,jsonb,boolean)'::regprocedure,
    'public.temporal_definitely_before_0019(jsonb,jsonb)'::regprocedure,
    'public.valid_canonical_http_url_0019(jsonb)'::regprocedure,
    'public.valid_source_ref_v2_0019(jsonb)'::regprocedure,
    'public.valid_market_event_v2_0019(jsonb)'::regprocedure,
    'public.market_event_sources_are_verified_0019(jsonb)'::regprocedure,
    'public.valid_belief_action_0019(jsonb)'::regprocedure,
    'public.expected_belief_actions_0019(text,text)'::regprocedure,
    'public.valid_belief_action_list_0019(jsonb)'::regprocedure,
    'public.jsonb_unique_nonempty_text_array_0019(jsonb,boolean)'::regprocedure,
    'public.belief_action_compatibility_text_0019(jsonb)'::regprocedure,
    'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure,
    'public.reject_immutable_row_0019()'::regprocedure,
    'public.reject_immutable_statement_0019()'::regprocedure,
    'public.validate_snapshot_0019(text,text)'::regprocedure,
    'public.validate_snapshot_deferred_0019()'::regprocedure,
    'public.validate_snapshot_parent_deferred_0019()'::regprocedure,
    'public.create_market_evidence_snapshot(jsonb)'::regprocedure,
    'public.create_scan_run_with_evidence_context(jsonb)'::regprocedure,
    'public.validate_run_binding_0019(text,uuid)'::regprocedure,
    'public.validate_run_binding_deferred_0019()'::regprocedure,
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
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_identity
    );
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
grant update(status) on public.scan_runs to vsee_registry_owner;
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

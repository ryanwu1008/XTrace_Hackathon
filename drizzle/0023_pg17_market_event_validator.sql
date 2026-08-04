begin;

set local transaction isolation level read committed;

-- This correction intentionally has a first-apply-only contract. Replaying it
-- after the new immutable fingerprint constraint exists must stop before any
-- catalog mutation instead of silently treating partially matching state as a
-- successful migration.
do $first_apply_only$
begin
  if pg_catalog.to_regprocedure(
      'public.canonical_ecmascript_json_number_0023(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.canonical_ecmascript_jsonb_text_0023(jsonb)'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('public.reasoner_judgments')
        and conname =
          'reasoner_judgments_current_record_fingerprint_0023'
    )
  then
    raise exception 'VSEE_0023_FIRST_APPLY_ONLY' using errcode = '55000';
  end if;
end;
$first_apply_only$;

do $prerequisite$
begin
  if not exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = 'vsee_registry_owner'
        and not rolcanlogin
        and not rolinherit
        and not rolsuper
        and not rolcreaterole
        and not rolcreatedb
        and not rolreplication
        and not rolbypassrls
    )
    or pg_catalog.to_regprocedure(
      'public.valid_market_event_v2_0019(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.create_scan_run_with_evidence_context(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.protect_report_evidence_0019()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.protect_analysis_assessment_0019()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.save_reasoner_judgment_immutable(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.assert_task9_current_finalization(jsonb,text,text,text)'
    ) is null
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'public.valid_market_event_v2_0019(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.create_scan_run_with_evidence_context(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid = any(array[
        'public.protect_report_evidence_0019()'::regprocedure,
        'public.protect_analysis_assessment_0019()'::regprocedure,
        'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure
      ])
        and pg_catalog.pg_get_userbyid(proowner) <> 'vsee_registry_owner'
    )
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.save_reasoner_judgment_immutable(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure
    ) <> 'vsee_registry_owner'
  then
    raise exception 'VSEE_0023_REQUIRES_0019_MARKET_EVENT_VALIDATOR'
      using errcode = '55000';
  end if;
end;
$prerequisite$;

-- A PostgreSQL 17 CREATEROLE migration executor reaches 0023 with only the
-- attested bootstrap-admin grant left by 0019/0020. Temporarily restore the
-- inherited/SET membership needed to replace owner-owned functions, then put
-- the membership and schema ACL back exactly before commit.
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
      and (
        select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor
      )
      and membership.admin_option
      and not membership.inherit_option
      and not membership.set_option
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
        and (
          select rolsuper from pg_catalog.pg_roles
          where oid = membership.grantor
        )
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
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

-- The prerequisite must observe a quiescent immutable judgment registry. This
-- lock conflicts with every INSERT writer and therefore closes the check/use
-- race both for already-committed and in-flight current-format rows.
lock table public.reasoner_judgments in share row exclusive mode;

do $reasoner_judgment_prerequisite$
begin
  if exists (
    select 1
    from public.reasoner_judgments
    where pg_catalog.num_nonnulls(
      judgment_schema_version,
      judgment_record_fingerprint,
      evidence_context_fingerprint,
      evidence_binding_fingerprint
    ) > 0
  ) then
    raise exception 'VSEE_0023_REQUIRES_EMPTY_CURRENT_REASONER_JUDGMENTS'
      using errcode = '55000';
  end if;
end;
$reasoner_judgment_prerequisite$;

-- 0019 double-escaped `\d` inside standard-conforming SQL strings. PostgreSQL
-- therefore looked for a literal backslash instead of an ISO date digit and
-- rejected both timestamp-precision and date-precision publications. Use
-- explicit ASCII digit classes so the persisted SQL is escape-independent.
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
    if p_published_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    then return false; end if;
    publication_instant := p_published_value::timestamptz;
    return publication_instant between p_window_start and p_window_end;
  elsif p_published_precision = 'date' then
    if p_published_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then return false; end if;
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

-- PostgreSQL 17 requires a DISTINCT aggregate's ORDER BY expression to be
-- syntactically present in its argument list. 0019 used `entity_key` as the
-- argument and `entity_key collate "C"` as the ordering expression, so every
-- otherwise-valid event reached the catch-all and failed closed. De-duplicate
-- in a subquery, then perform a non-DISTINCT, byte-stable aggregation.
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
    source_ids := pg_catalog.array_append(source_ids, source->>'id');
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
  select coalesce(
    array_agg(
      distinct_keys.entity_key
      order by distinct_keys.entity_key collate "C"
    ),
    array[]::text[]
  )
  into source_entity_keys
  from (
    select distinct key.entity_key
    from pg_catalog.unnest(source_entity_keys) as key(entity_key)
  ) as distinct_keys;
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

-- Evidence snapshots are immutable once created, so a pinned run only needs a
-- consistent SELECT of the referenced snapshot. PostgreSQL 17 treats FOR SHARE
-- as a row-locking operation and requires UPDATE privilege even when no update
-- is attempted. Keep the fail-closed security-definer boundary and remove only
-- that unnecessary lock instead of widening the immutable registry ACL.
create or replace function public.create_scan_run_with_evidence_context(
  p_request jsonb
)
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
      and (
        evidence_mode = 'live'
        or active.evidence_snapshot_id = evidence ->> 'snapshotId'
      )
    then return next active; return;
    end if;
    raise exception 'ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT'
      using errcode = '55006';
  end if;
  if evidence_mode = 'pinned' then
    snapshot_id := btrim(evidence ->> 'snapshotId');
    select * into strict snapshot from public.market_evidence_snapshots
      where workspace_id = workspace and id = snapshot_id;
    anchor_value := snapshot.anchor_at;
    start_value := snapshot.window_start_at;
    end_value := snapshot.window_end_at;
    timezone_value := snapshot.window_timezone;
    snapshot_fingerprint := snapshot.snapshot_fingerprint;
  else
    anchor_value := pg_catalog.clock_timestamp();
    start_value := anchor_value - interval '14 days';
    end_value := anchor_value;
    timezone_value := 'America/Los_Angeles';
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

-- JavaScript parses JSON numbers as IEEE-754 doubles and JSON.stringify emits
-- the shortest round-trip representation, using fixed notation for exponents
-- -6 through 20. PostgreSQL jsonb preserves decimal scale and expands exponent
-- notation, so jsonb::text cannot be the cross-runtime fingerprint contract.
-- Convert through float8 with the deterministic shortest-output setting, then
-- normalize only ECMAScript's exponent formatting and fixed-notation window.
create or replace function public.canonical_ecmascript_json_number_0023(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
set extra_float_digits = 3
as $$
declare
  float_text text;
  captures text[];
  sign_text text;
  integer_digits text;
  fractional_digits text;
  all_digits text;
  exponent_value integer;
  decimal_position integer;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'number' then
    raise exception 'CANONICAL_JSON_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  begin
    float_text := pg_catalog.to_json(
      (p_value #>> '{}')::double precision
    )::text;
  exception when numeric_value_out_of_range then
    raise exception 'CANONICAL_JSON_NUMBER_OUT_OF_RANGE'
      using errcode = '22003';
  end;
  if float_text in ('0', '-0') then return '0'; end if;
  if pg_catalog.strpos(float_text, 'e') = 0 then return float_text; end if;

  captures := pg_catalog.regexp_match(
    float_text,
    '^(-?)([0-9]+)(?:[.]([0-9]+))?e([+-]?)([0-9]+)$'
  );
  if captures is null then
    raise exception 'CANONICAL_JSON_NUMBER_RENDERING_DRIFT'
      using errcode = '22000';
  end if;
  sign_text := coalesce(captures[1], '');
  integer_digits := captures[2];
  fractional_digits := coalesce(captures[3], '');
  exponent_value := (
    coalesce(nullif(captures[4], '+'), '')
      || captures[5]
  )::integer;

  if exponent_value between -6 and 20 then
    all_digits := integer_digits || fractional_digits;
    decimal_position := pg_catalog.length(integer_digits) + exponent_value;
    if decimal_position <= 0 then
      return sign_text || '0.'
        || pg_catalog.repeat('0', -decimal_position) || all_digits;
    elsif decimal_position >= pg_catalog.length(all_digits) then
      return sign_text || all_digits
        || pg_catalog.repeat(
          '0', decimal_position - pg_catalog.length(all_digits)
        );
    end if;
    return sign_text
      || pg_catalog.substr(all_digits, 1, decimal_position)
      || '.'
      || pg_catalog.substr(all_digits, decimal_position + 1);
  end if;

  return sign_text || integer_digits
    || case when fractional_digits = '' then '' else '.' || fractional_digits end
    || 'e'
    || case when exponent_value >= 0 then '+' else '' end
    || exponent_value::text;
end;
$$;

create or replace function public.canonical_ecmascript_jsonb_text_0023(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  rendered text;
  value_type text := pg_catalog.jsonb_typeof(p_value);
begin
  if value_type = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(key)::text || ':'
        || public.canonical_ecmascript_jsonb_text_0023(value),
      ',' order by key collate "C"
    ), '') || '}'
    into rendered
    from pg_catalog.jsonb_each(p_value) as member(key, value);
    return rendered;
  elsif value_type = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      public.canonical_ecmascript_jsonb_text_0023(value),
      ',' order by ordinal
    ), '') || ']'
    into rendered
    from pg_catalog.jsonb_array_elements(p_value)
      with ordinality as member(value, ordinal);
    return rendered;
  elsif value_type = 'number' then
    return public.canonical_ecmascript_json_number_0023(p_value);
  end if;
  return p_value::text;
end;
$$;

-- Existing current judgments were rejected under a writer-conflicting lock.
-- Every future current-format row, including a writer that had resolved the old
-- function before this DDL, must now carry the exact shared record fingerprint.
alter table public.reasoner_judgments
  add constraint reasoner_judgments_current_record_fingerprint_0023 check (
    judgment_schema_version is null
    or judgment_record_fingerprint = public.sha256_length_framed(array[
      'reasoner-judgment-record-v1',
      fingerprint,
      model,
      coalesce(evidence_context_fingerprint, ''),
      coalesce(evidence_binding_fingerprint, ''),
      public.canonical_ecmascript_jsonb_text_0023(payload)
    ])
  );

-- 0019 fingerprinted PostgreSQL's display-oriented `jsonb::text`, while the
-- application verifies compact UTF-8-key-ordered JSON.stringify output. Use
-- the shared canonical renderer for all newly saved immutable judgments.
create or replace function public.save_reasoner_judgment_immutable(
  p_request jsonb
)
returns setof public.reasoner_judgments
language plpgsql security definer set search_path = '' as $$
declare semantic_key text := p_request->>'fingerprint';
declare record_digest text;
declare existing public.reasoner_judgments%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_request)<>'object'
    or (
      select array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(p_request) key
    ) is distinct from array[
      'evidenceBindingFingerprint','evidenceContextFingerprint',
      'fingerprint','model','payload'
    ]
    or semantic_key !~ '^reasoner-judgment-v3:sha256:[0-9a-f]{64}$'
    or btrim(p_request->>'model')=''
    or (
      (p_request->>'evidenceBindingFingerprint' is null)
      <> (p_request->>'evidenceContextFingerprint' is null)
    )
  then raise exception 'INVALID_REASONER_JUDGMENT_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(semantic_key,0)
  );
  record_digest := public.sha256_length_framed(array[
    'reasoner-judgment-record-v1',semantic_key,p_request->>'model',
    coalesce(p_request->>'evidenceContextFingerprint',''),
    coalesce(p_request->>'evidenceBindingFingerprint',''),
    public.canonical_ecmascript_jsonb_text_0023(p_request->'payload')
  ]);
  select * into existing
  from public.reasoner_judgments
  where fingerprint=semantic_key;
  if found then
    if existing.model<>p_request->>'model'
      or existing.payload<>p_request->'payload'
      or existing.evidence_context_fingerprint
        is distinct from p_request->>'evidenceContextFingerprint'
      or existing.evidence_binding_fingerprint
        is distinct from p_request->>'evidenceBindingFingerprint'
    then
      raise exception 'REASONER_JUDGMENT_COLLISION' using errcode='23505';
    end if;
    return next existing;
    return;
  end if;
  insert into public.reasoner_judgments(
    fingerprint,model,payload,judgment_schema_version,
    judgment_record_fingerprint,evidence_context_fingerprint,
    evidence_binding_fingerprint
  ) values(
    semantic_key,p_request->>'model',p_request->'payload',
    'reasoner-judgment-record-v1',record_digest,
    p_request->>'evidenceContextFingerprint',
    p_request->>'evidenceBindingFingerprint'
  ) returning * into existing;
  return next existing;
end;
$$;

-- The 0019 belief validator had the same PostgreSQL operator-precedence bug as
-- the market-event validator: `text[] || jsonb` was selected before `->>` could
-- produce the source ID text. The catch-all then rejected every otherwise-valid
-- typed assessment. Replace only that accumulation expression and retain the
-- complete deterministic gate, score, direction, and action policy body.
do $belief_assessment_source_ids$
declare
  function_identity regprocedure :=
    'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure;
  definition text;
  rewritten text;
  body_fingerprint text;
  before_owner oid;
  before_security boolean;
  before_acl aclitem[];
  before_config text[];
begin
  select pg_catalog.pg_get_functiondef(oid),
    public.sha256_length_framed(array[prosrc]),
    proowner, prosecdef, proacl, proconfig
  into strict definition, body_fingerprint, before_owner, before_security,
    before_acl, before_config
  from pg_catalog.pg_proc where oid = function_identity;
  if body_fingerprint <>
      'sha256:26dece2f547292fddd1f9e6d453750bb914b7757ccb099f0b66ecff84068f8ad'
    or pg_catalog.strpos(
      definition,
      'source_ids:=source_ids||source->>''id'';'
    ) = 0
    or pg_catalog.strpos(
      definition,
      'source_ids:=pg_catalog.array_append(source_ids,source->>''id'');'
    ) > 0
  then
    raise exception 'VSEE_0023_UNEXPECTED_BELIEF_VALIDATOR_DEFINITION'
      using errcode = '55000';
  end if;
  rewritten := pg_catalog.replace(
    definition,
    'source_ids:=source_ids||source->>''id'';',
    'source_ids:=pg_catalog.array_append(source_ids,source->>''id'');'
  );
  execute rewritten;
  select pg_catalog.pg_get_functiondef(oid),
    public.sha256_length_framed(array[prosrc])
  into strict definition, body_fingerprint
  from pg_catalog.pg_proc
  where oid = function_identity
    and proowner = before_owner
    and prosecdef = before_security
    and proacl is not distinct from before_acl
    and proconfig is not distinct from before_config;
  if not found
    or body_fingerprint <>
      'sha256:1715bc9e7681e5fd6187ff4a01add25b5b5fcf7ad127ba52846e43072330a486'
    or pg_catalog.strpos(
      definition,
      'source_ids:=source_ids||source->>''id'';'
    ) > 0
    or pg_catalog.strpos(
      definition,
      'source_ids:=pg_catalog.array_append(source_ids,source->>''id'');'
    ) = 0
  then
    raise exception 'VSEE_0023_BELIEF_VALIDATOR_REWRITE_FAILED'
      using errcode = '55000';
  end if;
end;
$belief_assessment_source_ids$;

-- Custom PostgreSQL configuration names use identifier rules for every dotted
-- component. `vsee.0019_finalizer` is therefore invalid because its second
-- component starts with a digit. Rewrite the three existing 0019 functions to
-- one legal transaction-local guard name while preserving each function's
-- owner, security mode, arguments, result, trigger binding, and ACL.
do $legal_finalizer_guard$
declare
  function_identity regprocedure;
  definition text;
  rewritten text;
  body_fingerprint text;
  old_fingerprints text[] := array[
    'sha256:c7883b73a37b15448045c0894d66a73e0f03058fa6a9814bd4fb80eb6f321b97',
    'sha256:0ac5b00c89aaff440380649f051b04b8748adb7bbc4e1259eb39f87fa6d73670',
    'sha256:4350e8a5fec848a4381881c003f9eb8dfc5ef3e090588a3fad65baa0f3153c4b'
  ];
  new_fingerprints text[] := array[
    'sha256:d2dc4affdde6f52b24fdb92562c3da43c0ba3cfc2045848352b9e583299c3896',
    'sha256:71f0603a914c73e45d1033cd29240e3b3b14389e0a1e33c27da0caf17c449459',
    'sha256:2cccac9944c6bd2eec1c576c3903acb20728fba651d90c9be5527faeff1dcd3e'
  ];
  function_ordinal integer := 0;
  before_owner oid;
  before_security boolean;
  before_acl aclitem[];
  before_config text[];
begin
  foreach function_identity in array array[
    'public.protect_report_evidence_0019()'::regprocedure,
    'public.protect_analysis_assessment_0019()'::regprocedure,
    'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure
  ]
  loop
    function_ordinal := function_ordinal + 1;
    select pg_catalog.pg_get_functiondef(oid),
      public.sha256_length_framed(array[prosrc]),
      proowner, prosecdef, proacl, proconfig
    into strict definition, body_fingerprint, before_owner, before_security,
      before_acl, before_config
    from pg_catalog.pg_proc where oid = function_identity;
    if body_fingerprint <> old_fingerprints[function_ordinal]
      or pg_catalog.strpos(definition,'vsee.0019_finalizer') = 0
      or pg_catalog.strpos(definition,'vsee.report_finalizer_0019') > 0
    then
      raise exception 'VSEE_0023_UNEXPECTED_FINALIZER_GUARD_DEFINITION'
        using errcode = '55000';
    end if;
    rewritten := pg_catalog.replace(
      definition,
      'vsee.0019_finalizer',
      'vsee.report_finalizer_0019'
    );
    execute rewritten;
    select pg_catalog.pg_get_functiondef(oid),
      public.sha256_length_framed(array[prosrc])
    into strict definition, body_fingerprint
    from pg_catalog.pg_proc
    where oid = function_identity
      and proowner = before_owner
      and prosecdef = before_security
      and proacl is not distinct from before_acl
      and proconfig is not distinct from before_config;
    if not found
      or body_fingerprint <> new_fingerprints[function_ordinal]
      or pg_catalog.strpos(definition,'vsee.0019_finalizer') > 0
      or pg_catalog.strpos(definition,'vsee.report_finalizer_0019') = 0
    then
      raise exception 'VSEE_0023_FINALIZER_GUARD_REWRITE_FAILED'
        using errcode = '55000';
    end if;
  end loop;
end;
$legal_finalizer_guard$;

-- 0022 derived draft missing evidence only from generic Evidence Pack coverage.
-- New finalization also persists company/event-specific unknowns. Bind those
-- typed items to the one finalized CompanyAnalysis that fed this candidate,
-- retain separate internal and reviewed founder-facing labels, and require one
-- canonical list across the version snapshot and every action draft.
do $task9_company_analysis_unknowns$
declare
  function_identity regprocedure :=
    'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure;
  definition text;
  rewritten text;
  body_fingerprint text;
  before_owner oid;
  before_security boolean;
  before_acl aclitem[];
  before_config text[];
begin
  select pg_catalog.pg_get_functiondef(oid),
    public.sha256_length_framed(array[prosrc]),
    proowner, prosecdef, proacl, proconfig
  into strict definition, body_fingerprint, before_owner, before_security,
    before_acl, before_config
  from pg_catalog.pg_proc where oid = function_identity;
  if body_fingerprint <>
    'sha256:646b0dade5ba82747e320ec6eb5dec88c9f6651aa13b20802311a5b7eb8a4b5c'
  then
    raise exception 'VSEE_0023_UNEXPECTED_TASK9_FINALIZER_DEFINITION'
      using errcode = '55000';
  end if;

  rewritten := pg_catalog.replace(
    definition,
$old_task9_declarations$  expected_missing jsonb;
  expected_formats text[];$old_task9_declarations$,
$new_task9_declarations$  expected_missing jsonb;
  generic_missing jsonb;
  semantic_missing jsonb;
  company_analysis_unknowns jsonb;
  authoritative_company_brief jsonb;
  internal_missing text;
  expected_formats text[];$new_task9_declarations$
  );
  rewritten := pg_catalog.replace(
    rewritten,
$old_task9_missing$  select coalesce(jsonb_agg(jsonb_build_object(
    'fieldId', field_id,
    'label', replace(field_id, '_', ' '),
    'reasonCode', 'MISSING_CRITICAL_EVIDENCE',
    'mostLikelyDecisionImpact',
      'Providing accepted evidence may raise or lower the formal decision ceiling.'
  ) order by ordinal), '[]'::jsonb)
  into expected_missing
  from jsonb_array_elements_text(
    coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
  ) with ordinality as missing(field_id, ordinal);$old_task9_missing$,
$new_task9_missing$  begin
    select analysis.company_brief
    into strict authoritative_company_brief
    from public.candidate_runs as candidate
    join public.underwriting_batches as batch
      on batch.workspace_id = candidate.workspace_id
      and batch.id = candidate.batch_id
    join public.intelligence_reports as report
      on report.workspace_id = batch.workspace_id
      and report.run_id = batch.scan_run_id
      and report.analysis_status = 'completed'
    join public.company_analyses as analysis
      on analysis.workspace_id = report.workspace_id
      and analysis.report_id = report.id
      and analysis.run_id = report.run_id
      and analysis.deal_id = candidate.deal_id
    where candidate.workspace_id = p_workspace_id
      and candidate.id = p_candidate_run_id
      and candidate.deal_id = p_deal_id;
  exception when no_data_found or too_many_rows then
    raise exception
      'Task 9 current V2 CompanyAnalysis identity is not authoritative';
  end;
  if pg_catalog.jsonb_typeof(coalesce(
      authoritative_company_brief -> 'structuredFields', '[]'::jsonb
    )) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(
        authoritative_company_brief -> 'structuredFields', '[]'::jsonb
      )) as field(value)
      where field.value ->> 'classification' = 'unknown'
        and (
          not public.jsonb_exact_keys_0019(field.value, array[
            'classification', 'externalLabel', 'fieldId', 'id', 'reason',
            'schemaVersion'
          ])
          or field.value ->> 'schemaVersion' <> 'deal-semantic-field-v1'
          or field.value ->> 'fieldId' <> 'unknowns'
          or field.value ->> 'id'
            !~ '^semantic-field-[a-f0-9]{24}$'
          or coalesce(field.value ->> 'reason', '') = ''
          or btrim(field.value ->> 'reason') <> field.value ->> 'reason'
          or field.value ->> 'reason' ~ E'[\r\n]'
          or coalesce(field.value ->> 'externalLabel', '') = ''
          or btrim(field.value ->> 'externalLabel')
            <> field.value ->> 'externalLabel'
          or field.value ->> 'externalLabel' ~ E'[\r\n]'
        )
    )
  then
    raise exception 'Task 9 current V2 CompanyAnalysis unknown is invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'fieldId', field.value ->> 'id',
    'label', field.value ->> 'reason',
    'externalLabel', field.value ->> 'externalLabel'
  ) order by (field.value ->> 'id') collate "C"), '[]'::jsonb)
  into company_analysis_unknowns
  from pg_catalog.jsonb_array_elements(coalesce(
    authoritative_company_brief -> 'structuredFields', '[]'::jsonb
  )) as field(value)
  where field.value ->> 'classification' = 'unknown';
  if (
      select pg_catalog.count(*) <> pg_catalog.count(distinct item ->> 'fieldId')
      from pg_catalog.jsonb_array_elements(company_analysis_unknowns) item
    )
    or version_snapshot -> 'companyAnalysisUnknowns'
      is distinct from company_analysis_unknowns
  then
    raise exception
      'Task 9 current V2 CompanyAnalysis unknown lineage is invalid';
  end if;

  if pg_catalog.jsonb_typeof(
      coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
    ) <> 'array'
    or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(
        coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
      ) missing(field_id)
      where coalesce(btrim(field_id), '') = ''
    )
    or (
      select pg_catalog.count(*)
        <> pg_catalog.count(distinct field_id)
      from pg_catalog.jsonb_array_elements_text(
        coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
      ) missing(field_id)
    )
  then
    raise exception 'Task 9 current V2 generic missing evidence is invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'fieldId', field_id,
    'label', pg_catalog.replace(field_id, '_', ' '),
    'externalLabel', pg_catalog.replace(field_id, '_', ' '),
    'reasonCode', 'MISSING_CRITICAL_EVIDENCE',
    'mostLikelyDecisionImpact',
      'Providing accepted evidence may raise or lower the formal decision ceiling.'
  ) order by field_id collate "C"), '[]'::jsonb)
  into generic_missing
  from pg_catalog.jsonb_array_elements_text(
    coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
  ) missing(field_id);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'fieldId', item ->> 'fieldId',
    'label', item ->> 'label',
    'externalLabel', item ->> 'externalLabel',
    'reasonCode', 'UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN',
    'mostLikelyDecisionImpact',
      'Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.'
  ) order by (item ->> 'fieldId') collate "C"), '[]'::jsonb)
  into semantic_missing
  from pg_catalog.jsonb_array_elements(company_analysis_unknowns) item;
  select coalesce(pg_catalog.jsonb_agg(item order by
    (item ->> 'fieldId') collate "C"
  ), '[]'::jsonb)
  into expected_missing
  from pg_catalog.jsonb_array_elements(generic_missing || semantic_missing) item;
  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct item ->> 'fieldId')
    from pg_catalog.jsonb_array_elements(expected_missing) item
  ) then
    raise exception 'Task 9 current V2 missing-evidence IDs conflict';
  end if;$new_task9_missing$
  );
  rewritten := pg_catalog.replace(
    rewritten,
$old_task9_labels$  select coalesce(string_agg('- ' || label, E'\n' order by ordinal),
      '- No additional evidence item is currently requested.'),
    coalesce(string_agg(label, '; ' order by ordinal),
      'no saved missing-evidence item')
  into label_bullets, inline_labels
  from jsonb_array_elements(expected_missing) with ordinality as item(value, ordinal)
  cross join lateral (select item.value ->> 'label' as label) as labels;
  if exists (
    select 1 from jsonb_array_elements(expected_missing) item
    where item ->> 'label' ~ E'[\r\n]'
  ) then
    raise exception 'Task 9 current V2 missing-evidence label is unsafe';
  end if;$old_task9_labels$,
$new_task9_labels$  select coalesce(pg_catalog.string_agg(
      '- ' || external_label, E'\n' order by ordinal
    ), '- No additional evidence item is currently requested.'),
    coalesce(pg_catalog.string_agg(
      external_label, '; ' order by ordinal
    ), 'no saved missing-evidence item'),
    coalesce(pg_catalog.string_agg(
      '- ' || internal_label || E'\n  Reason: ' || reason_code
        || E'\n  Likely decision impact: ' || decision_impact,
      E'\n' order by ordinal
    ), 'No missing evidence item was saved.')
  into label_bullets, inline_labels, internal_missing
  from pg_catalog.jsonb_array_elements(expected_missing)
    with ordinality as item(value, ordinal)
  cross join lateral (
    select item.value ->> 'label' as internal_label,
      item.value ->> 'externalLabel' as external_label,
      item.value ->> 'reasonCode' as reason_code,
      item.value ->> 'mostLikelyDecisionImpact' as decision_impact
  ) as labels;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(expected_missing) item
    where coalesce(item ->> 'label', '') = ''
      or item ->> 'label' ~ E'[\r\n]'
      or coalesce(item ->> 'externalLabel', '') = ''
      or item ->> 'externalLabel' ~ E'[\r\n]'
  ) then
    raise exception 'Task 9 current V2 missing-evidence label is unsafe';
  end if;$new_task9_labels$
  );
  rewritten := pg_catalog.replace(
    rewritten,
$old_task9_internal$        if draft ->> 'channel' <> 'internal'
          or draft ->> 'audienceType' <> 'internal'
          or split_part(draft ->> 'body', E'\n', 1)
            <> 'INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY'
        then
          raise exception 'Task 9 current V2 internal draft marker is invalid';
        end if;$old_task9_internal$,
$new_task9_internal$        if draft ->> 'channel' <> 'internal'
          or draft ->> 'audienceType' <> 'internal'
          or split_part(draft ->> 'body', E'\n', 1)
            <> 'INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY'
          or pg_catalog.strpos(
            draft ->> 'body',
            E'\nBlocking or missing evidence\n' || internal_missing
          ) = 0
        then
          raise exception 'Task 9 current V2 internal draft marker is invalid';
        end if;$new_task9_internal$
  );

  if rewritten = definition
    or pg_catalog.strpos(rewritten, $required_task9_token$companyAnalysisUnknowns$required_task9_token$) = 0
    or pg_catalog.strpos(rewritten, $required_task9_token$externalLabel$required_task9_token$) = 0
  then
    raise exception 'VSEE_0023_TASK9_FINALIZER_REWRITE_NOT_APPLIED'
      using errcode = '55000';
  end if;
  execute rewritten;
  select public.sha256_length_framed(array[prosrc])
  into strict body_fingerprint
  from pg_catalog.pg_proc
  where oid = function_identity
    and proowner = before_owner
    and prosecdef = before_security
    and proacl is not distinct from before_acl
    and proconfig is not distinct from before_config;
  if not found
    or body_fingerprint <>
      'sha256:59ba162fae981db88cec61731a7a6b1d89174caa5465e4de71fa3df4cc745233'
  then
    raise exception 'VSEE_0023_TASK9_FINALIZER_REWRITE_FAILED: %',
      body_fingerprint using errcode = '55000';
  end if;
end;
$task9_company_analysis_unknowns$;

alter function public.canonical_ecmascript_json_number_0023(jsonb)
  owner to vsee_registry_owner;
alter function public.canonical_ecmascript_jsonb_text_0023(jsonb)
  owner to vsee_registry_owner;
revoke all on function
  public.canonical_ecmascript_json_number_0023(jsonb),
  public.canonical_ecmascript_jsonb_text_0023(jsonb)
  from public, anon, authenticated, service_role;

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
      and (
        select rolsuper from pg_catalog.pg_roles
        where oid = membership.grantor
      )
      and membership.admin_option
      and not membership.inherit_option
      and not membership.set_option
    )
  ) then
    raise exception 'vsee_registry_owner did not return to its attested state';
  end if;
end;
$registry_owner_finish$;

do $authority_invariant$
begin
  if not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'vsee_registry_owner'
        and not rolcanlogin and not rolinherit and not rolsuper
        and not rolcreaterole and not rolcreatedb and not rolreplication
        and not rolbypassrls
    )
    or pg_catalog.has_schema_privilege(
      'vsee_registry_owner', 'public', 'create'
    )
    or exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where (
        membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
        or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
      ) and not (
        not (select rolsuper from pg_catalog.pg_roles where rolname=current_user)
        and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname=current_user
        )
        and membership.grantor = 10
        and (
          select rolsuper from pg_catalog.pg_roles where oid=membership.grantor
        )
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
      )
    )
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid = any(array[
        'public.canonical_ecmascript_json_number_0023(jsonb)'::regprocedure,
        'public.canonical_ecmascript_jsonb_text_0023(jsonb)'::regprocedure
      ])
        and (
          pg_catalog.pg_get_userbyid(proowner) <> 'vsee_registry_owner'
          or prosecdef
          or not proisstrict
          or provolatile <> 'i'
        )
    )
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid =
        'public.canonical_ecmascript_json_number_0023(jsonb)'::regprocedure
        and proconfig is distinct from array[
          'search_path=""', 'extra_float_digits=3'
        ]::text[]
    )
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid =
        'public.canonical_ecmascript_jsonb_text_0023(jsonb)'::regprocedure
        and proconfig is distinct from array['search_path=""']::text[]
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.reasoner_judgments'::regclass
        and conname =
          'reasoner_judgments_current_record_fingerprint_0023'
        and contype = 'c' and convalidated
    )
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'public.valid_market_event_v2_0019(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.create_scan_run_with_evidence_context(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or pg_catalog.strpos(
      (
        select prosrc from pg_catalog.pg_proc
        where oid =
          'public.save_reasoner_judgment_immutable(jsonb)'::regprocedure
      ),
      'public.canonical_ecmascript_jsonb_text_0023(p_request->''payload'')'
    ) = 0
    or (
      select public.sha256_length_framed(array[prosrc])
      from pg_catalog.pg_proc
      where oid =
        'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure
    ) <>
      'sha256:59ba162fae981db88cec61731a7a6b1d89174caa5465e4de71fa3df4cc745233'
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid = any(array[
        'public.protect_report_evidence_0019()'::regprocedure,
        'public.protect_analysis_assessment_0019()'::regprocedure,
        'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure
      ])
        and pg_catalog.pg_get_userbyid(proowner) <> 'vsee_registry_owner'
    )
    or not (
      select prosecdef
      from pg_catalog.pg_proc
      where oid =
        'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure
    )
    or exists (
      select 1
      from pg_catalog.pg_proc
      where oid = any(array[
        'public.protect_report_evidence_0019()'::regprocedure,
        'public.protect_analysis_assessment_0019()'::regprocedure
      ])
        and prosecdef
    )
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.save_reasoner_judgment_immutable(jsonb)'::regprocedure
    ) <> 'vsee_registry_owner'
    or not (
      select prosecdef
      from pg_catalog.pg_proc
      where oid =
        'public.save_reasoner_judgment_immutable(jsonb)'::regprocedure
    )
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure
    ) <> 'vsee_registry_owner'
    or (
      select prosecdef
      from pg_catalog.pg_proc
      where oid =
        'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure
    )
    or (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid =
        'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)'::regprocedure
    ) <> 'vsee_registry_owner'
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.valid_market_event_v2_0019(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.valid_market_event_v2_0019(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.valid_market_event_v2_0019(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.evidence_event_in_window_0019(text,text,timestamptz,timestamptz,text)',
      'execute'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.create_scan_run_with_evidence_context(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_scan_run_with_evidence_context(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.create_scan_run_with_evidence_context(jsonb)',
      'execute'
    )
    or pg_catalog.has_table_privilege(
      'vsee_registry_owner',
      'public.market_evidence_snapshots',
      'update'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.save_reasoner_judgment_immutable(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_reasoner_judgment_immutable(jsonb)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.save_reasoner_judgment_immutable(jsonb)',
      'execute'
    )
    or pg_catalog.has_table_privilege(
      'vsee_registry_owner',
      'public.reasoner_judgments',
      'update'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)',
      'execute'
    )
    or exists (
      select 1
      from pg_catalog.unnest(array[
        'service_role', 'authenticated', 'anon'
      ]::text[]) as api_role(role_name)
      cross join pg_catalog.unnest(array[
        'public.protect_report_evidence_0019()'::regprocedure,
        'public.protect_analysis_assessment_0019()'::regprocedure,
        'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure,
        'public.canonical_ecmascript_json_number_0023(jsonb)'::regprocedure,
        'public.canonical_ecmascript_jsonb_text_0023(jsonb)'::regprocedure,
        'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure
      ]) as guarded(function_identity)
      where pg_catalog.has_function_privilege(
        api_role.role_name, guarded.function_identity, 'execute'
      )
    )
    or not pg_catalog.has_function_privilege(
      'vsee_underwriting_owner',
      'public.assert_task9_current_finalization(jsonb,text,text,text)',
      'execute'
    )
    or not (
      select prosecdef
      from pg_catalog.pg_proc
      where oid =
        'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure
    )
  then
    raise exception 'VSEE_0023_MARKET_EVENT_VALIDATOR_AUTHORITY_DRIFT'
      using errcode = '55000', detail = (
        select pg_catalog.jsonb_build_object(
          'schemaCreate', pg_catalog.has_schema_privilege(
            'vsee_registry_owner', 'public', 'create'
          ),
          'canonicalFunctions', (
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'identity', oid::regprocedure::text,
              'owner', pg_catalog.pg_get_userbyid(proowner),
              'securityDefiner', prosecdef,
              'strict', proisstrict,
              'volatility', provolatile,
              'config', proconfig,
              'service', pg_catalog.has_function_privilege(
                'service_role', oid, 'execute'
              ),
              'authenticated', pg_catalog.has_function_privilege(
                'authenticated', oid, 'execute'
              ),
              'anon', pg_catalog.has_function_privilege(
                'anon', oid, 'execute'
              )
            ))
            from pg_catalog.pg_proc
            where oid = any(array[
              'public.canonical_ecmascript_json_number_0023(jsonb)'::regprocedure,
              'public.canonical_ecmascript_jsonb_text_0023(jsonb)'::regprocedure
            ])
          ),
          'constraint', (
            select pg_catalog.jsonb_build_object(
              'type', contype, 'validated', convalidated
            )
            from pg_catalog.pg_constraint
            where conrelid = 'public.reasoner_judgments'::regclass
              and conname =
                'reasoner_judgments_current_record_fingerprint_0023'
          ),
          'task9Hash', (
            select public.sha256_length_framed(array[prosrc])
            from pg_catalog.pg_proc
            where oid =
              'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure
          ),
          'task9Privileges', pg_catalog.jsonb_build_object(
            'underwriting', pg_catalog.has_function_privilege(
              'vsee_underwriting_owner',
              'public.assert_task9_current_finalization(jsonb,text,text,text)',
              'execute'
            ),
            'service', pg_catalog.has_function_privilege(
              'service_role',
              'public.assert_task9_current_finalization(jsonb,text,text,text)',
              'execute'
            ),
            'authenticated', pg_catalog.has_function_privilege(
              'authenticated',
              'public.assert_task9_current_finalization(jsonb,text,text,text)',
              'execute'
            ),
            'anon', pg_catalog.has_function_privilege(
              'anon',
              'public.assert_task9_current_finalization(jsonb,text,text,text)',
              'execute'
            )
          )
        )::text
      );
  end if;
end;
$authority_invariant$;

commit;

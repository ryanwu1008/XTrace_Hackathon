-- vsee-production-catalog-manifest
-- Produce the canonical, data-free manifest for VSee-owned baseline objects.
-- This deliberately excludes unrelated Supabase-managed objects in public.
with tracked_relation_names(name) as (
  values
    ('workspaces'),
    ('scan_runs'),
    ('scan_run_steps'),
    ('worker_heartbeats'),
    ('public_request_limits'),
    ('users'),
    ('workspace_members'),
    ('source_documents'),
    ('workspace_documents'),
    ('companies'),
    ('deals'),
    ('source_evidence'),
    ('deal_interactions'),
    ('market_events'),
    ('market_evidence_snapshots'),
    ('market_evidence_snapshot_events'),
    ('run_evidence_bindings'),
    ('run_market_events'),
    ('intelligence_reports'),
    ('xtrace_ingest_jobs'),
    ('xtrace_memory_links'),
    ('company_analyses'),
    ('reasoner_judgments'),
    ('uploaded_documents'),
    ('source_revisions'),
    ('source_revision_annotations'),
    ('deal_source_assignments')
), tracked_function_names(name) as (
  values
    ('take_public_request'),
    ('claim_next_scan_run'),
    ('save_intelligence_report'),
    ('save_intelligence_report_legacy_0009'),
    ('sha256_length_framed'),
    ('canonical_utc_iso_milliseconds'),
    ('source_revision_set_fingerprint'),
    ('get_analysis_eligible_snapshot'),
    ('validate_source_revision_insert'),
    ('reject_immutable_source_registry_mutation'),
    ('create_initial_source_revision'),
    ('append_source_revision'),
    ('annotate_source_revision'),
    ('source_assignment_result'),
    ('confirm_source_assignment'),
    ('reset_intelligence_products')
    ,('evidence_event_in_window_0019')
    ,('reject_immutable_row_0019')
    ,('reject_immutable_statement_0019')
    ,('validate_snapshot_0019')
    ,('validate_snapshot_deferred_0019')
    ,('create_market_evidence_snapshot')
    ,('create_scan_run_with_evidence_context')
    ,('validate_run_binding_0019')
    ,('bind_pinned_run_market_events')
    ,('bind_live_run_market_events')
    ,('save_reasoner_judgment_immutable')
    ,('protect_scan_run_identity_0019')
    ,('protect_report_evidence_0019')
    ,('protect_analysis_assessment_0019')
    ,('save_intelligence_report_legacy_0019')
    ,('finalize_new_report_current_fields_0019')
), restricted_role_names(name) as (
  values
    ('anon'),
    ('authenticated'),
    ('service_role')
), tracked_owner_role_names(name) as (
  values
    ('vsee_registry_owner'),
    ('vsee_underwriting_owner')
), tracked_relations as (
  select relation.*
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  join tracked_relation_names as tracked
    on tracked.name = relation.relname
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
), restricted_roles as (
  select role_record.*
  from pg_catalog.pg_roles as role_record
  join restricted_role_names as restricted
    on restricted.name = role_record.rolname
), deploy_owner as (
  select relation.relowner as oid
  from pg_catalog.pg_class as relation
  where relation.oid = to_regclass('public.workspaces')
), pgcrypto_digest as (
  select
    namespace.oid as schema_oid,
    namespace.nspname as schema_name,
    extension_record.extversion as extension_version
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as function_record
    on function_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and function_record.proname = 'digest'
    and pg_catalog.pg_get_function_identity_arguments(function_record.oid)
      = 'bytea, text'
    and pg_catalog.pg_get_function_result(function_record.oid) = 'bytea'
), pgcrypto_digest_state as (
  select
    count(*)::integer as match_count,
    coalesce(max(schema_oid), 0::oid) as schema_oid,
    coalesce(max(schema_name), '$missing') as schema_name,
    coalesce(max(extension_version), '$missing') as extension_version
  from pgcrypto_digest
), relation_rows as (
  select
    'relation:' || relation.relname as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'relation',
      'name', relation.relname,
      'relkind', relation.relkind,
      'persistence', relation.relpersistence,
      'owner', case
        when relation.relowner = (select oid from deploy_owner)
          then '$migration_executor'
        else pg_catalog.pg_get_userbyid(relation.relowner)
      end,
      'rowSecurity', relation.relrowsecurity,
      'forceRowSecurity', relation.relforcerowsecurity,
      'replicaIdentity', relation.relreplident,
      'acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantor', case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end,
              'grantee', case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            order by
              (case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end) collate "C",
              privilege.privilege_type collate "C",
              (case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end) collate "C",
              privilege.is_grantable
          )
          from pg_catalog.aclexplode(
            coalesce(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )
          ) as privilege
        ),
        '[]'::jsonb
      )
    ) as payload
  from tracked_relations as relation
), column_rows as (
  select
    'column:' || relation.relname || ':'
      || pg_catalog.lpad(attribute.attnum::text, 5, '0') as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'column',
      'relation', relation.relname,
      'number', attribute.attnum,
      'name', attribute.attname,
      'type', pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ),
      'notNull', attribute.attnotnull,
      'identity', attribute.attidentity,
      'generated', attribute.attgenerated,
      'collation', case
        when attribute.attcollation = 0 then null
        else (
          select namespace.nspname || '.' || collation_record.collname
          from pg_catalog.pg_collation as collation_record
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = collation_record.collnamespace
          where collation_record.oid = attribute.attcollation
        )
      end,
      'default', pg_catalog.pg_get_expr(
        default_record.adbin,
        default_record.adrelid
      ),
      'acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantor', case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end,
              'grantee', case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            order by
              (case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end) collate "C",
              privilege.privilege_type collate "C",
              (case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end) collate "C",
              privilege.is_grantable
          )
          from pg_catalog.aclexplode(attribute.attacl) as privilege
        ),
        '[]'::jsonb
      )
    ) as payload
  from tracked_relations as relation
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
  left join pg_catalog.pg_attrdef as default_record
    on default_record.adrelid = attribute.attrelid
    and default_record.adnum = attribute.attnum
  where attribute.attnum > 0
    and not attribute.attisdropped
), constraint_rows as (
  select
    'constraint:' || relation.relname || ':'
      || constraint_record.conname as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'constraint',
      'relation', relation.relname,
      'name', constraint_record.conname,
      'type', constraint_record.contype,
      'definition', pg_catalog.pg_get_constraintdef(
        constraint_record.oid,
        false
      ),
      'deferrable', constraint_record.condeferrable,
      'deferred', constraint_record.condeferred,
      'validated', constraint_record.convalidated
    ) as payload
  from tracked_relations as relation
  join pg_catalog.pg_constraint as constraint_record
    on constraint_record.conrelid = relation.oid
), index_rows as (
  select
    'index:' || relation.relname || ':' || index_relation.relname
      as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'index',
      'relation', relation.relname,
      'name', index_relation.relname,
      'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
      'unique', index_record.indisunique,
      'primary', index_record.indisprimary,
      'exclusion', index_record.indisexclusion,
      'immediate', index_record.indimmediate,
      'valid', index_record.indisvalid,
      'ready', index_record.indisready,
      'live', index_record.indislive,
      'replicaIdentity', index_record.indisreplident
    ) as payload
  from tracked_relations as relation
  join pg_catalog.pg_index as index_record
    on index_record.indrelid = relation.oid
  join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_record.indexrelid
), policy_rows as (
  select
    'policy:' || relation.relname || ':' || policy_record.polname
      as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'policy',
      'relation', relation.relname,
      'name', policy_record.polname,
      'permissive', policy_record.polpermissive,
      'command', policy_record.polcmd,
      'roles', coalesce(
        (
          select pg_catalog.jsonb_agg(
            role_name order by role_name collate "C"
          )
          from (
            select case
              when role_oid = 0 then 'PUBLIC'
              when role_oid = (select oid from deploy_owner)
                then '$migration_executor'
              else pg_catalog.pg_get_userbyid(role_oid)
            end as role_name
            from pg_catalog.unnest(policy_record.polroles) as role_oid
          ) as role_names
        ),
        '[]'::jsonb
      ),
      'using', pg_catalog.pg_get_expr(
        policy_record.polqual,
        policy_record.polrelid
      ),
      'check', pg_catalog.pg_get_expr(
        policy_record.polwithcheck,
        policy_record.polrelid
      )
    ) as payload
  from tracked_relations as relation
  join pg_catalog.pg_policy as policy_record
    on policy_record.polrelid = relation.oid
), trigger_rows as (
  select
    'trigger:' || relation.relname || ':' || trigger_record.tgname
      as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'trigger',
      'relation', relation.relname,
      'name', trigger_record.tgname,
      'enabled', trigger_record.tgenabled,
      'type', trigger_record.tgtype,
      'function', function_namespace.nspname || '.'
        || function_record.proname || '('
        || pg_catalog.pg_get_function_identity_arguments(
          function_record.oid
        ) || ')',
      'definition', pg_catalog.pg_get_triggerdef(
        trigger_record.oid,
        false
      ),
      'constraintOidPresent', trigger_record.tgconstraint <> 0,
      'attributeNumbers', trigger_record.tgattr::text,
      'argumentsHex', pg_catalog.encode(trigger_record.tgargs, 'hex')
    ) as payload
  from tracked_relations as relation
  join pg_catalog.pg_trigger as trigger_record
    on trigger_record.tgrelid = relation.oid
    and not trigger_record.tgisinternal
  join pg_catalog.pg_proc as function_record
    on function_record.oid = trigger_record.tgfoid
  join pg_catalog.pg_namespace as function_namespace
    on function_namespace.oid = function_record.pronamespace
), function_rows as (
  select
    'function:' || function_record.proname || ':'
      || pg_catalog.pg_get_function_identity_arguments(function_record.oid)
      as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'function',
      'name', function_record.proname,
      'identityArguments', pg_catalog.pg_get_function_identity_arguments(
        function_record.oid
      ),
      'result', pg_catalog.pg_get_function_result(function_record.oid),
      'language', language_record.lanname,
      'owner', case
        when function_record.proowner = (select oid from deploy_owner)
          then '$migration_executor'
        else pg_catalog.pg_get_userbyid(function_record.proowner)
      end,
      'kindCode', function_record.prokind,
      'securityDefiner', function_record.prosecdef,
      'leakproof', function_record.proleakproof,
      'volatility', function_record.provolatile,
      'strict', function_record.proisstrict,
      'returnsSet', function_record.proretset,
      'parallel', function_record.proparallel,
      'cost', function_record.procost,
      'rows', function_record.prorows,
      'config', function_record.proconfig,
      'argumentModes', function_record.proargmodes,
      'argumentNames', function_record.proargnames,
      'body', pg_catalog.replace(
        pg_catalog.replace(
          function_record.prosrc,
          pg_catalog.quote_ident(
            (select schema_name from pgcrypto_digest_state)
          ) || '.digest(',
          '$pgcrypto.digest('
        ),
        (select schema_name from pgcrypto_digest_state) || '.digest(',
        '$pgcrypto.digest('
      ),
      'definition', pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.pg_get_functiondef(function_record.oid),
          pg_catalog.quote_ident(
            (select schema_name from pgcrypto_digest_state)
          ) || '.digest(',
          '$pgcrypto.digest('
        ),
        (select schema_name from pgcrypto_digest_state) || '.digest(',
        '$pgcrypto.digest('
      ),
      'binary', function_record.probin,
      'acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantor', case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end,
              'grantee', case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            order by
              (case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end) collate "C",
              privilege.privilege_type collate "C",
              (case
                when privilege.grantor = (select oid from deploy_owner)
                  then '$migration_executor'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end) collate "C",
              privilege.is_grantable
          )
          from pg_catalog.aclexplode(
            coalesce(
              function_record.proacl,
              pg_catalog.acldefault('f', function_record.proowner)
            )
          ) as privilege
        ),
        '[]'::jsonb
      )
    ) as payload
  from pg_catalog.pg_proc as function_record
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_record.pronamespace
  join pg_catalog.pg_language as language_record
    on language_record.oid = function_record.prolang
  join tracked_function_names as tracked
    on tracked.name = function_record.proname
  where namespace.nspname = 'public'
), effective_relation_acl_rows as (
  select
    'effective-relation-acl:' || role_record.rolname || ':'
      || relation.relname as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'effective-relation-acl',
      'role', role_record.rolname,
      'relation', relation.relname,
      'select', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'SELECT'
      ),
      'insert', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'INSERT'
      ),
      'update', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'UPDATE'
      ),
      'delete', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'DELETE'
      ),
      'truncate', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'TRUNCATE'
      ),
      'references', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'REFERENCES'
      ),
      'trigger', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'TRIGGER'
      ),
      'maintain', pg_catalog.has_table_privilege(
        role_record.oid, relation.oid, 'MAINTAIN'
      )
    ) as payload
  from restricted_roles as role_record
  cross join tracked_relations as relation
), effective_column_acl_rows as (
  select
    'effective-column-acl:' || role_record.rolname || ':'
      || relation.relname || ':'
      || pg_catalog.lpad(attribute.attnum::text, 5, '0') as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'effective-column-acl',
      'role', role_record.rolname,
      'relation', relation.relname,
      'column', attribute.attname,
      'select', pg_catalog.has_column_privilege(
        role_record.oid, relation.oid, attribute.attnum, 'SELECT'
      ),
      'insert', pg_catalog.has_column_privilege(
        role_record.oid, relation.oid, attribute.attnum, 'INSERT'
      ),
      'update', pg_catalog.has_column_privilege(
        role_record.oid, relation.oid, attribute.attnum, 'UPDATE'
      ),
      'references', pg_catalog.has_column_privilege(
        role_record.oid, relation.oid, attribute.attnum, 'REFERENCES'
      )
    ) as payload
  from restricted_roles as role_record
  cross join tracked_relations as relation
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relation.oid
    and attribute.attnum > 0
    and not attribute.attisdropped
), effective_function_acl_rows as (
  select
    'effective-function-acl:' || role_record.rolname || ':'
      || function_record.proname || ':'
      || pg_catalog.pg_get_function_identity_arguments(function_record.oid)
      as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'effective-function-acl',
      'role', role_record.rolname,
      'function', function_record.proname,
      'identityArguments', pg_catalog.pg_get_function_identity_arguments(
        function_record.oid
      ),
      'execute', pg_catalog.has_function_privilege(
        role_record.oid, function_record.oid, 'EXECUTE'
      )
    ) as payload
  from restricted_roles as role_record
  cross join pg_catalog.pg_proc as function_record
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function_record.pronamespace
  join tracked_function_names as tracked
    on tracked.name = function_record.proname
  where namespace.nspname = 'public'
), restricted_role_membership_rows as (
  select
    'restricted-role-membership:' || member_role.rolname || ':'
      || granted_role.rolname as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'restricted-role-membership',
      'member', member_role.rolname,
      'grantedRole', granted_role.rolname,
      'adminOption', membership.admin_option,
      'inheritOption', membership.inherit_option,
      'setOption', membership.set_option
    ) as payload
  from pg_catalog.pg_auth_members as membership
  join restricted_roles as member_role
    on member_role.oid = membership.member
  join pg_catalog.pg_roles as granted_role
    on granted_role.oid = membership.roleid
), role_rows as (
  select
    'role:' || role_record.rolname as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'role',
      'name', role_record.rolname,
      'superuser', role_record.rolsuper,
      'inherit', role_record.rolinherit,
      'createRole', role_record.rolcreaterole,
      'createDb', role_record.rolcreatedb,
      'login', role_record.rolcanlogin,
      'replication', role_record.rolreplication,
      'bypassRls', role_record.rolbypassrls,
      'memberships', coalesce(
        (
          select pg_catalog.jsonb_agg(
            membership_record
            order by membership_record::text collate "C"
          )
          from (
            select pg_catalog.jsonb_build_object(
              'grantedRole', case
                when membership.roleid = role_record.oid
                  then role_record.rolname
                when membership.roleid = (select oid from deploy_owner)
                  then '$deploy_owner'
                else granted_role.rolname
              end,
              'member', case
                when membership.member = role_record.oid
                  then role_record.rolname
                when membership.member = (select oid from deploy_owner)
                  then '$deploy_owner'
                else member_role.rolname
              end,
              'grantor', case
                when membership.grantor = 10
                  and grantor_role.rolsuper
                  then '$bootstrap_grantor'
                when membership.grantor = (select oid from deploy_owner)
                  then '$deploy_owner'
                else grantor_role.rolname
              end,
              'adminOption', membership.admin_option,
              'inheritOption', membership.inherit_option,
              'setOption', membership.set_option
            ) as membership_record
            from pg_catalog.pg_auth_members as membership
            join pg_catalog.pg_roles as granted_role
              on granted_role.oid = membership.roleid
            join pg_catalog.pg_roles as member_role
              on member_role.oid = membership.member
            join pg_catalog.pg_roles as grantor_role
              on grantor_role.oid = membership.grantor
            where membership.member = role_record.oid
              or membership.roleid = role_record.oid
          ) as role_memberships
        ),
        '[]'::jsonb
      )
    ) as payload
  from pg_catalog.pg_roles as role_record
  join tracked_owner_role_names as tracked_owner_role
    on tracked_owner_role.name = role_record.rolname
), schema_rows as (
  select
    'schema:public' as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'schema',
      'name', namespace.nspname,
      'owner', case
        when namespace.nspowner = (select oid from deploy_owner)
          or pg_catalog.pg_get_userbyid(namespace.nspowner)
            = 'pg_database_owner'
          then '$schema_owner'
        else pg_catalog.pg_get_userbyid(namespace.nspowner)
      end,
      'ownerSupported',
        namespace.nspowner = (select oid from deploy_owner)
        or pg_catalog.pg_get_userbyid(namespace.nspowner)
          = 'pg_database_owner',
      'acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantor', case
                when privilege.grantor = namespace.nspowner
                  then '$schema_owner'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end,
              'grantee', case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = namespace.nspowner
                  then '$schema_owner'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            order by
              (case
                when privilege.grantee = 0 then 'PUBLIC'
                when privilege.grantee = namespace.nspowner
                  then '$schema_owner'
                else pg_catalog.pg_get_userbyid(privilege.grantee)
              end) collate "C",
              privilege.privilege_type collate "C",
              (case
                when privilege.grantor = namespace.nspowner
                  then '$schema_owner'
                else pg_catalog.pg_get_userbyid(privilege.grantor)
              end) collate "C",
              privilege.is_grantable
          )
          from pg_catalog.aclexplode(
            coalesce(
              namespace.nspacl,
              pg_catalog.acldefault('n', namespace.nspowner)
            )
          ) as privilege
        ),
        '[]'::jsonb
      )
    ) as payload
  from pg_catalog.pg_namespace as namespace
  where namespace.nspname = 'public'
), effective_schema_acl_rows as (
  select
    'effective-schema-acl:' || role_record.rolname || ':public' as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'effective-schema-acl',
      'role', role_record.rolname,
      'schema', 'public',
      'usage', pg_catalog.has_schema_privilege(
        role_record.oid, namespace.oid, 'USAGE'
      ),
      'create', pg_catalog.has_schema_privilege(
        role_record.oid, namespace.oid, 'CREATE'
      )
    ) as payload
  from restricted_roles as role_record
  cross join pg_catalog.pg_namespace as namespace
  where namespace.nspname = 'public'
), manifest_rows as (
  select
    'environment:postgres-major' as sort_key,
    pg_catalog.jsonb_build_object(
      'kind', 'environment',
      'serverVersionNum', current_setting('server_version_num')::integer,
      'postgresMajor',
      current_setting('server_version_num')::integer / 10000,
      'pgcryptoExtensionVersion',
      (select extension_version from pgcrypto_digest_state),
      'pgcryptoDigestMatches',
      (select match_count from pgcrypto_digest_state),
      'pgcryptoDigestSchema', case
        when (select match_count from pgcrypto_digest_state) = 1
          then '$pgcrypto'
        else (select schema_name from pgcrypto_digest_state)
      end,
      'pgcryptoSchemaPublicCreate', exists (
        select 1
        from pg_catalog.pg_namespace as namespace
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner)
          )
        ) as privilege
        where namespace.oid = (
          select schema_oid from pgcrypto_digest_state
        )
          and privilege.grantee = 0
          and privilege.privilege_type = 'CREATE'
      ),
      'pgcryptoSchemaAnonCreate', coalesce(
        (
          select pg_catalog.has_schema_privilege(
            role_record.oid,
            (select schema_oid from pgcrypto_digest_state),
            'CREATE'
          )
          from pg_catalog.pg_roles as role_record
          where role_record.rolname = 'anon'
        ),
        false
      ),
      'pgcryptoSchemaAuthenticatedCreate', coalesce(
        (
          select pg_catalog.has_schema_privilege(
            role_record.oid,
            (select schema_oid from pgcrypto_digest_state),
            'CREATE'
          )
          from pg_catalog.pg_roles as role_record
          where role_record.rolname = 'authenticated'
        ),
        false
      )
    ) as payload
  union all select * from relation_rows
  union all select * from column_rows
  union all select * from constraint_rows
  union all select * from index_rows
  union all select * from policy_rows
  union all select * from trigger_rows
  union all select * from function_rows
  union all select * from effective_relation_acl_rows
  union all select * from effective_column_acl_rows
  union all select * from effective_function_acl_rows
  union all select * from restricted_role_membership_rows
  union all select * from role_rows
  union all select * from schema_rows
  union all select * from effective_schema_acl_rows
)
select coalesce(
  pg_catalog.jsonb_agg(payload order by sort_key collate "C"),
  '[]'::jsonb
)::text
from manifest_rows;

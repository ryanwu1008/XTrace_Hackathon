#!/bin/zsh
set +x
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
libpq_service_renderer="${script_directory}/render-private-libpq-service.mjs"
catalog_manifest="${script_directory}/sql/production-baseline-catalog-manifest.sql"
catalog_hasher="${script_directory}/hash-stdin-sha256.mjs"
catalog_fingerprints="${script_directory}/production-catalog-fingerprints.zsh"
registry_invariants="${script_directory}/sql/production-registry-data-invariants.sql"
evidence_invariants="${script_directory}/sql/production-belief-reversal-evidence-data-invariants.sql"

for required_path in \
  "${repository_root}/drizzle" \
  "$libpq_service_renderer" \
  "$catalog_manifest" \
  "$catalog_hasher" \
  "$catalog_fingerprints" \
  "$registry_invariants" \
  "$evidence_invariants"; do
  if [[ ! -e "$required_path" ]]; then
    print -u2 "Required production migration resource is missing: ${required_path:t}"
    exit 1
  fi
done

source "$catalog_fingerprints"
cd "$repository_root"

if ! DATABASE_URL="$(security find-generic-password -a "$USER" -s "vsee-supabase-db-url" -w)"; then
  print -u2 "Required Keychain service unavailable: vsee-supabase-db-url"
  exit 1
fi

if [[ -z "$DATABASE_URL" ]]; then
  print -u2 "Required Keychain service is empty: vsee-supabase-db-url"
  exit 1
fi

if [[ "$DATABASE_URL" == *$'\n'* || "$DATABASE_URL" == *$'\r'* ]]; then
  print -u2 "Required Keychain service is not a valid single-line connection URI."
  exit 1
fi

libpq_service_directory="$(
  mktemp -d "${TMPDIR:-/tmp}/vsee-production-libpq.XXXXXXXX"
)"
libpq_service_file="${libpq_service_directory}/pg_service.conf"
libpq_password_file="${libpq_service_directory}/pgpass"

cleanup_libpq_service() {
  command rm -f -- "$libpq_service_file" "$libpq_password_file"
  command rmdir -- "$libpq_service_directory" 2>/dev/null || true
}
trap cleanup_libpq_service EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 700 "$libpq_service_directory"
typeset +x DATABASE_URL
if ! print -rn -- "$DATABASE_URL" \
  | node "$libpq_service_renderer" "$libpq_service_file" "$libpq_password_file"; then
  unset DATABASE_URL
  print -u2 "Could not prepare the private database connection configuration."
  exit 1
fi
unset DATABASE_URL
export PGSERVICEFILE="$libpq_service_file"
export PGSERVICE="vsee-production"
export PGPASSFILE="$libpq_password_file"
unset PGPASSWORD

sentinel_sql() {
  case "$1" in
    0009)
      cat <<'SQL'
-- vsee-sentinel: 0009
select
  to_regclass('public.deals') is not null
  and to_regclass('public.companies') is not null
  and to_regclass('public.deal_source_assignments') is not null
  and to_regprocedure(
    'public.confirm_source_assignment(jsonb)'
  ) is not null;
SQL
      ;;
    0010) print -- "-- vsee-sentinel: 0010\nselect to_regclass('public.fund_policy_versions') is not null;" ;;
    0011) print -- "-- vsee-sentinel: 0011\nselect to_regclass('public.underwriting_batches') is not null;" ;;
    0012) print -- "-- vsee-sentinel: 0012\nselect to_regclass('public.source_evidence_items') is not null;" ;;
    0013) print -- "-- vsee-sentinel: 0013\nselect exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.uploaded_documents') and attname = 'confirmation_fingerprint' and not attisdropped);" ;;
    0014) print -- "-- vsee-sentinel: 0014\nselect to_regprocedure('public.replace_action_draft_body(text,text,text)') is not null;" ;;
    0015) print -- "-- vsee-sentinel: 0015\nselect exists (select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.candidate_checkpoints') and conname = 'candidate_checkpoints_stage_check' and pg_catalog.pg_get_constraintdef(oid) like '%framework_catalog%');" ;;
    0016) print -- "-- vsee-sentinel: 0016\nselect to_regclass('public.source_evidence_items') is not null and exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.source_evidence_items') and attname = 'source_id' and attnotnull and not attisdropped);" ;;
    0017) print -- "-- vsee-sentinel: 0017\nselect to_regclass('public.workspace_test_generations') is not null and to_regprocedure('public.reset_test_view(text,text)') is not null;" ;;
    0018) print -- "-- vsee-sentinel: 0018\nselect to_regclass('public.workspace_test_generations') is not null and to_regprocedure('public.reset_test_view(text,text)') is not null and exists (select 1 from pg_catalog.pg_extension as extension_record join pg_catalog.pg_depend as dependency on dependency.refclassid = 'pg_catalog.pg_extension'::regclass and dependency.refobjid = extension_record.oid and dependency.classid = 'pg_catalog.pg_proc'::regclass and dependency.deptype = 'e' join pg_catalog.pg_proc as procedure_record on procedure_record.oid = dependency.objid join pg_catalog.pg_namespace as namespace on namespace.oid = procedure_record.pronamespace where extension_record.extname = 'pgcrypto' and procedure_record.proname = 'digest' and procedure_record.proargtypes = '17 25'::oidvector and pg_catalog.has_schema_privilege(to_regrole('vsee_registry_owner'), namespace.oid, 'USAGE'));" ;;
    0019)
      cat <<'SQL'
-- vsee-sentinel: 0019
with state as (
  select
    array[
      to_regclass('public.market_evidence_snapshots'),
      to_regclass('public.market_evidence_snapshot_events'),
      to_regclass('public.run_evidence_bindings'),
      to_regclass('public.run_market_events')
    ] as relations,
    array[
      to_regprocedure('public.create_market_evidence_snapshot(jsonb)'),
      to_regprocedure('public.create_scan_run_with_evidence_context(jsonb)'),
      to_regprocedure('public.bind_pinned_run_market_events(text,uuid)'),
      to_regprocedure('public.bind_live_run_market_events(text,uuid,text[])'),
      to_regprocedure('public.save_reasoner_judgment_immutable(jsonb)')
    ] as functions
), completeness as (
  select
    array_position(relations, null) is null
      and array_position(functions, null) is null
      and exists (
        select 1 from pg_catalog.pg_indexes
        where schemaname = 'public' and indexname = 'scan_runs_one_active'
          and indexdef like '%WHERE (status = ANY%'
      )
      and (select count(*) from pg_catalog.pg_trigger
        where not tgisinternal and tgname in (
          'market_evidence_snapshot_events_validate',
          'scan_runs_protect_identity_0019',
          'intelligence_reports_protect_evidence_0019',
          'company_analyses_protect_assessment_0019'
        )) = 4
      and (select count(*) from pg_catalog.pg_attribute
        where attrelid = to_regclass('public.scan_runs') and not attisdropped
          and attname in ('evidence_context_version','evidence_mode',
            'evidence_anchor_at','evidence_window_start_at','evidence_window_end_at',
            'evidence_window_timezone','evidence_snapshot_id',
            'evidence_snapshot_fingerprint','evidence_context_fingerprint')) = 9
      and (select count(*) from pg_catalog.pg_attribute
        where attrelid = to_regclass('public.intelligence_reports') and not attisdropped
          and attname like 'evidence_%') >= 14
      and (select count(*) from pg_catalog.pg_attribute
        where attrelid = to_regclass('public.company_analyses') and not attisdropped
          and attname in ('belief_assessment_version','belief_direction',
            'belief_score_breakdown','belief_gate_context','belief_gate_results',
            'belief_actions')) = 6
      and (select count(*) from pg_catalog.pg_attribute
        where attrelid = to_regclass('public.reasoner_judgments') and not attisdropped
          and attname in ('judgment_schema_version','judgment_record_fingerprint',
            'evidence_context_fingerprint','evidence_binding_fingerprint')) = 4
      as complete,
    cardinality(array_remove(relations, null)) = 0
      and cardinality(array_remove(functions, null)) = 0
      and not exists (select 1 from pg_catalog.pg_attribute
        where attrelid = to_regclass('public.scan_runs') and not attisdropped
          and attname = 'evidence_context_version') as absent
  from state
)
select case when complete then true when absent then false else null end
from completeness;
SQL
      ;;
    *) print -u2 "Unknown migration sentinel: $1"; return 1 ;;
  esac
}

inspect_sentinel() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "$(sentinel_sql "$1")"
  )"; then
    print -u2 "Could not verify migration sentinel: $1"
    return 1
  fi
  case "$result" in
    t) SENTINEL_STATE="complete" ;;
    f) SENTINEL_STATE="incomplete" ;;
    *)
      print -u2 "Could not verify migration sentinel: $1"
      return 1
      ;;
  esac
}

inspect_catalog_fingerprint() {
  if ! CATALOG_FINGERPRINT="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "-- vsee-sentinel: 0009
$(<"$catalog_manifest")" \
      | node "$catalog_hasher"
  )"; then
    print -u2 "Could not inspect the exact production catalog."
    return 1
  fi
  if ! CATALOG_VARIANT="$(vsee_catalog_variant "$CATALOG_FINGERPRINT")"; then
    print -u2 "The application-owned production catalog is not a reviewed PostgreSQL 17 state."
    return 1
  fi
}

assert_catalog_stage() {
  local stage="$1"
  if ! inspect_catalog_fingerprint; then
    return 1
  fi
  if ! vsee_catalog_matches_stage "$stage" "$CATALOG_FINGERPRINT"; then
    print -u2 "Catalog mismatch: migration ${stage} does not match the reviewed manifest (${CATALOG_VARIANT})."
    return 1
  fi
}

assert_data_invariants() {
  local stage="$1"
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "-- vsee-sentinel: 0009
$(<"$registry_invariants")"
  )"; then
    print -u2 "Could not verify source-registry data invariants."
    return 1
  fi
  if [[ "$result" != "t" ]]; then
    print -u2 "Source-registry data invariants are not satisfied."
    return 1
  fi
  if [[ "$stage" == "0019" ]]; then
    if ! result="$(
      psql --no-password -v ON_ERROR_STOP=1 -At -c "-- vsee-sentinel: 0019
$(<"$evidence_invariants")"
    )"; then
      print -u2 "Could not verify 0019 evidence-context data invariants."
      return 1
    fi
    if [[ "$result" != "t" ]]; then
      print -u2 "Evidence-context data invariants are not satisfied."
      return 1
    fi
  fi
}

migration_ids=(0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019)
migration_files=(
  ''
  0010_underwriting_references.sql
  0011_underwriting_runs.sql
  0012_source_grounded_underwriting.sql
  0013_confirmed_upload_ingest.sql
  0014_read_api_action_drafts.sql
  0015_framework_catalog_checkpoint.sql
  0016_confirmed_upload_source_evidence_bridge.sql
  0017_public_sandbox_test_generations.sql
  0018_pgcrypto_registry_schema_usage.sql
  0019_belief_reversal_evidence_context.sql
)

first_incomplete_index=0
last_complete_id=''
for index in {1..${#migration_ids}}; do
  migration_id="${migration_ids[$index]}"
  if ! inspect_sentinel "$migration_id"; then
    exit 1
  fi
  if [[ "$SENTINEL_STATE" == "complete" ]]; then
    if (( first_incomplete_index > 0 )); then
      print -u2 "Migration sentinel gap: ${migration_id} is complete after ${migration_ids[$first_incomplete_index]} is incomplete."
      exit 1
    fi
    last_complete_id="$migration_id"
  elif (( first_incomplete_index == 0 )); then
    first_incomplete_index=$index
  fi
done

if [[ "$last_complete_id" == '' ]]; then
  print -u2 "Migration boundary 0009 is incomplete; refusing to apply forward migrations."
  exit 1
fi

if ! assert_catalog_stage "$last_complete_id" || ! assert_data_invariants "$last_complete_id"; then
  exit 1
fi

if (( first_incomplete_index == 0 )); then
  print "All production migrations through 0019 match their reviewed catalog and data invariants."
  exit 0
fi

for index in {$first_incomplete_index..${#migration_ids}}; do
  migration_id="${migration_ids[$index]}"
  migration_file="${repository_root}/drizzle/${migration_files[$index]}"
  if [[ ! -f "$migration_file" ]]; then
    print -u2 "Migration file is missing for ${migration_id}."
    exit 1
  fi

  # Recheck the exact boundary immediately before each mutating transaction.
  if ! assert_catalog_stage "$last_complete_id" || ! assert_data_invariants "$last_complete_id"; then
    exit 1
  fi

  if ! vsee_catalog_stage_is_reviewed "$migration_id"; then
    print -u2 "Migration ${migration_id} has no reviewed terminal catalog fingerprint; refusing mutation."
    exit 1
  fi

  print "Applying migration ${migration_id}."
  psql --no-password -v ON_ERROR_STOP=1 -f "$migration_file"
  if ! inspect_sentinel "$migration_id"; then
    exit 1
  fi
  if [[ "$SENTINEL_STATE" != "complete" ]]; then
    print -u2 "Migration ${migration_id} did not satisfy its sentinel; stopping."
    exit 1
  fi
  if ! assert_catalog_stage "$migration_id" || ! assert_data_invariants "$migration_id"; then
    print -u2 "Migration ${migration_id} did not satisfy its exact postcondition; stopping."
    exit 1
  fi
  last_complete_id="$migration_id"
done

print "Production migrations through 0019 are complete and verified."

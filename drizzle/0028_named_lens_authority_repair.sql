begin;

-- Local/disposable forward migration only. Production remains pinned at 0018.
-- This repair makes the SQL finalizer enforce the same current Named Lens
-- identity, catalog, refresh, and terminal-state authority as the runtime.

grant execute on function
  public.canonical_ecmascript_json_number_0023(jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_semantic_evidence_refs_0028(
  p_evidence_refs jsonb,
  p_judgments jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  reference_value jsonb;
  path_part text;
  semantic_identity text;
  normalized_path jsonb;
  normalized_refs jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_evidence_refs) is distinct from 'array'
    or jsonb_typeof(p_judgments) is distinct from 'array'
  then
    raise exception 'Named Lens semantic evidence inputs must be arrays';
  end if;

  for reference_value in
    select value from jsonb_array_elements(p_evidence_refs)
  loop
    normalized_path := '[]'::jsonb;
    for path_part in
      select value
      from jsonb_array_elements_text(reference_value -> 'resolutionPath')
    loop
      semantic_identity := null;
      select
        'formal_framework:' || (judgment ->> 'frameworkCardId')
          || '@' || (judgment ->> 'frameworkVersion')
      into semantic_identity
      from jsonb_array_elements(p_judgments) judgment
      where not (judgment ? 'frameworkMetadata')
        and judgment ->> 'frameworkVersion' = '1'
        and judgment ->> 'frameworkCardId' in (
          'framework_card_synthetic_1_v1',
          'framework_card_synthetic_2_v1',
          'framework_card_synthetic_3_v1',
          'framework_card_synthetic_4_v1',
          'framework_card_synthetic_5_v1',
          'framework_card_synthetic_6_v1',
          'framework_card_synthetic_7_v1',
          'framework_card_synthetic_8_v1'
        )
        and judgment ->> 'id' = path_part
      limit 1;

      if semantic_identity is null
        and path_part like 'framework_judgment:%'
      then
        select
          'formal_framework:' || (judgment ->> 'frameworkCardId')
            || '@' || (judgment ->> 'frameworkVersion')
        into semantic_identity
        from jsonb_array_elements(p_judgments) judgment
        where not (judgment ? 'frameworkMetadata')
          and judgment ->> 'frameworkVersion' = '1'
          and judgment ->> 'frameworkCardId' in (
            'framework_card_synthetic_1_v1',
            'framework_card_synthetic_2_v1',
            'framework_card_synthetic_3_v1',
            'framework_card_synthetic_4_v1',
            'framework_card_synthetic_5_v1',
            'framework_card_synthetic_6_v1',
            'framework_card_synthetic_7_v1',
            'framework_card_synthetic_8_v1'
          )
          and judgment ->> 'id' = substring(
            path_part from length('framework_judgment:') + 1
          )
        limit 1;
        if semantic_identity is not null then
          semantic_identity := 'framework_judgment_ref:'
            || semantic_identity;
        end if;
      end if;

      normalized_path := normalized_path || jsonb_build_array(
        coalesce(semantic_identity, path_part)
      );
    end loop;
    normalized_refs := normalized_refs || jsonb_build_array(
      jsonb_set(reference_value, '{resolutionPath}', normalized_path, false)
    );
  end loop;
  return normalized_refs;
end;
$$;
alter function public.named_lens_semantic_evidence_refs_0028(jsonb, jsonb)
  owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_semantic_evidence_refs_0028(jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_semantic_evidence_refs_0028(jsonb, jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_projection_fingerprint_0028(
  p_projection jsonb,
  p_judgments jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select public.named_lens_segment_fingerprint_0027(
    jsonb_build_object(
      'kind', 'decision-critical-evidence-projection-v1',
      'evidenceRefs', public.named_lens_semantic_evidence_refs_0028(
        p_projection -> 'evidenceRefs', p_judgments
      )
    )
  )
$$;
alter function public.named_lens_projection_fingerprint_0028(jsonb, jsonb)
  owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_projection_fingerprint_0028(jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_projection_fingerprint_0028(jsonb, jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_final_dispositions_fingerprint_0028(
  p_projection jsonb,
  p_dispositions jsonb,
  p_passages jsonb,
  p_judgments jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  disposition_value jsonb;
  passage_value jsonb;
  semantic_passage jsonb;
  semantic_disposition jsonb;
  semantic_dispositions jsonb := '[]'::jsonb;
  ordered_dispositions jsonb;
begin
  for disposition_value in
    select value from jsonb_array_elements(p_dispositions)
  loop
    passage_value := null;
    if jsonb_typeof(disposition_value -> 'judgmentId') = 'string' then
      select value into passage_value
      from jsonb_array_elements(p_passages)
      where value ->> 'judgmentId' = disposition_value ->> 'judgmentId'
      limit 1;
    end if;
    semantic_passage := case
      when passage_value is null then null
      else jsonb_build_object(
        'schemaVersion', passage_value -> 'schemaVersion',
        'frameworkCardId', passage_value -> 'frameworkCardId',
        'frameworkVersion', passage_value -> 'frameworkVersion',
        'decisionQuestionCode', passage_value -> 'decisionQuestionCode',
        'evidenceDomainCodes', passage_value -> 'evidenceDomainCodes',
        'premise', passage_value -> 'premise',
        'caseApplication', passage_value -> 'caseApplication',
        'countercase', passage_value -> 'countercase',
        'unknownBoundary', passage_value -> 'unknownBoundary',
        'conditionalConclusion', passage_value -> 'conditionalConclusion',
        'advisoryContract', passage_value -> 'advisoryContract',
        'selectionBasisEvidenceIds',
          passage_value -> 'selectionBasisEvidenceIds',
        'wordCount', passage_value -> 'wordCount',
        'generatorVersion', passage_value -> 'generatorVersion'
      )
    end;
    semantic_disposition := jsonb_build_object(
      'frameworkCardId', disposition_value -> 'frameworkCardId',
      'frameworkVersion', disposition_value -> 'frameworkVersion',
      'disposition', disposition_value -> 'disposition',
      'selectedPosition', disposition_value -> 'selectedPosition',
      'priorityTier', disposition_value -> 'priorityTier',
      'reasonCodes', disposition_value -> 'reasonCodes',
      'decisionQuestionCode', disposition_value -> 'decisionQuestionCode',
      'stance', disposition_value -> 'stance',
      'advisoryPosture', disposition_value -> 'advisoryPosture',
      'selectionBasisEvidenceIds',
        disposition_value -> 'selectionBasisEvidenceIds',
      'criticalEvidence', public.named_lens_semantic_evidence_refs_0028(
        disposition_value -> 'criticalEvidence', p_judgments
      ),
      'passage', semantic_passage
    );
    semantic_dispositions := semantic_dispositions
      || jsonb_build_array(semantic_disposition);
  end loop;

  select coalesce(
    jsonb_agg(value order by
      public.named_lens_segment_fingerprint_0027(value) collate "C"),
    '[]'::jsonb
  ) into ordered_dispositions
  from jsonb_array_elements(semantic_dispositions);

  return public.named_lens_segment_fingerprint_0027(
    jsonb_build_object(
      'kind', 'named-lens-final-dispositions-v1',
      'projection', public.named_lens_semantic_evidence_refs_0028(
        p_projection -> 'evidenceRefs', p_judgments
      ),
      'dispositions', ordered_dispositions
    )
  );
end;
$$;
alter function public.named_lens_final_dispositions_fingerprint_0028(
  jsonb, jsonb, jsonb, jsonb
) owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_final_dispositions_fingerprint_0028(
    jsonb, jsonb, jsonb, jsonb
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_final_dispositions_fingerprint_0028(
    jsonb, jsonb, jsonb, jsonb
  )
to vsee_underwriting_owner;

create or replace function public.named_lens_presentation_fingerprint_0028(
  p_presentation jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  semantic_citations jsonb;
begin
  select coalesce(
    jsonb_agg(value - 'judgmentId' order by
      public.named_lens_segment_fingerprint_0027(
        value - 'judgmentId'
      ) collate "C"),
    '[]'::jsonb
  ) into semantic_citations
  from jsonb_array_elements(p_presentation -> 'segmentCitations');

  return public.named_lens_segment_fingerprint_0027(
    jsonb_build_object(
      'kind', 'named-lens-presentation-v1',
      'schemaVersion', p_presentation -> 'schemaVersion',
      'rendererVersion', p_presentation -> 'rendererVersion',
      'synthesis', jsonb_build_object(
        'branch', p_presentation #> '{synthesis,branch}',
        'text', p_presentation #> '{synthesis,text}',
        'evidenceItemIds',
          p_presentation #> '{synthesis,evidenceItemIds}',
        'judgmentCount', jsonb_array_length(
          p_presentation #> '{synthesis,judgmentIds}'
        )
      ),
      'segmentCitations', semantic_citations,
      'firstScreenProjectionRefs', jsonb_build_object(
        'decisionEvidenceItemIds', p_presentation
          #> '{firstScreenProjectionRefs,decisionEvidenceItemIds}',
        'selectedJudgmentCount', jsonb_array_length(
          p_presentation
            #> '{firstScreenProjectionRefs,selectedJudgmentIds}'
        )
      )
    )
  );
end;
$$;
alter function public.named_lens_presentation_fingerprint_0028(jsonb)
  owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_presentation_fingerprint_0028(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_presentation_fingerprint_0028(jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_typed_abstention_0028(
  p_judgment jsonb,
  p_evidence_pack jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  with evidence_ids as (
    select item ->> 'id' as id
    from jsonb_array_elements(p_evidence_pack -> 'facts') item
    union all
    select item ->> 'id' as id
    from jsonb_array_elements(p_evidence_pack -> 'assumptions') item
  ), expected_unused as (
    select coalesce(jsonb_agg(id order by id collate "C"), '[]'::jsonb)
      as value
    from evidence_ids
  )
  select
    p_judgment ->> 'applicability' = 'applicable'
    and p_judgment ->> 'conclusion' = 'abstain'
    and p_judgment -> 'supportEvidenceItemIds' = '[]'::jsonb
    and p_judgment -> 'counterEvidenceItemIds' = '[]'::jsonb
    and p_judgment -> 'unusedEvidenceItemIds'
      = (select value from expected_unused)
    and p_judgment -> 'strongestSupport' = 'null'::jsonb
    and p_judgment -> 'strongestCounterargument' = 'null'::jsonb
    and p_judgment -> 'confidence' = jsonb_build_object(
      'sourceReliability', 'low',
      'evidenceStrength', 'low',
      'evidenceCoverage', 'low',
      'applicability', 'low',
      'judgment', 'low'
    )
    and p_judgment #>> '{counterevidenceBoundary,kind}'
      = 'no_candidate_local_counterevidence'
    and jsonb_typeof(
      p_judgment #> '{counterevidenceBoundary,evidenceRequestRefs}'
    ) = 'array'
    and jsonb_array_length(
      p_judgment #> '{counterevidenceBoundary,evidenceRequestRefs}'
    ) > 0
$$;
alter function public.named_lens_typed_abstention_0028(jsonb, jsonb)
  owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_typed_abstention_0028(jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_typed_abstention_0028(jsonb, jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_first_screen_projection_ids_0028(
  p_projection jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  reference_value jsonb;
  reference_source_revision_ids text[];
  selected_ids text[] := array[]::text[];
  selected_source_revision_ids text[] := array[]::text[];
begin
  if jsonb_typeof(p_projection -> 'evidenceRefs') is distinct from 'array'
  then
    raise exception 'Named Lens first-screen projection must contain evidence refs';
  end if;

  for reference_value in
    select evidence.value
    from jsonb_array_elements(p_projection -> 'evidenceRefs') evidence(value)
    order by (
      select min(case origin.value ->> 'kind'
        when 'blocking_evidence' then 0
        when 'fired_rule' then 1
        when 'valuation_evaluation' then 2
        when 'return_calculation' then 2
        when 'calculation' then 2
        when 'scenario_input' then 2
        when 'revisit_gate' then 3
        when 'counterevidence_gate' then 4
        when 'action_delta_gate' then 5
        when 'market_event' then 6
        when 'chronology_gate' then 7
        when 'prior_record' then 8
        when 'xtrace_memory' then 9
        when 'source_revision' then 9
        else 2147483647
      end)
      from jsonb_array_elements(evidence.value -> 'originRefs') origin(value)
    ), evidence.value ->> 'evidencePackItemId' collate "C"
  loop
    select coalesce(
      array_agg(origin.value ->> 'id' order by origin.value ->> 'id' collate "C"),
      array[]::text[]
    ) into reference_source_revision_ids
    from jsonb_array_elements(reference_value -> 'originRefs') origin(value)
    where origin.value ->> 'kind' = 'source_revision';

    if reference_source_revision_ids && selected_source_revision_ids then
      continue;
    end if;
    selected_ids := array_append(
      selected_ids, reference_value ->> 'evidencePackItemId'
    );
    selected_source_revision_ids := array_cat(
      selected_source_revision_ids, reference_source_revision_ids
    );
    exit when cardinality(selected_ids) = 3;
  end loop;

  return (
    select coalesce(jsonb_agg(item_id order by item_id collate "C"), '[]'::jsonb)
    from unnest(selected_ids) item_id
  );
end;
$$;
alter function public.named_lens_first_screen_projection_ids_0028(jsonb)
  owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_first_screen_projection_ids_0028(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_first_screen_projection_ids_0028(jsonb)
to vsee_underwriting_owner;

create or replace function public.named_lens_presentation_authoritative_0028(
  p_presentation jsonb,
  p_passages jsonb,
  p_dispositions jsonb,
  p_decision jsonb,
  p_projection jsonb,
  p_evidence_pack jsonb,
  p_workspace_id text,
  p_candidate_run_id text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  expected_first_screen_ids jsonb;
  compatibility_decision jsonb;
begin
  expected_first_screen_ids :=
    public.named_lens_first_screen_projection_ids_0028(p_projection);
  if p_presentation #> '{firstScreenProjectionRefs,decisionEvidenceItemIds}'
      is distinct from expected_first_screen_ids
  then
    return false;
  end if;

  -- The 0027 validator still derives first-screen evidence only from direct
  -- DecisionResult Fact/Assumption refs. Preserve all of its identity,
  -- selection, synthesis, and citation checks while supplying the exact
  -- projection-derived set as a validation-only DecisionResult authority.
  compatibility_decision := jsonb_set(
    p_decision,
    '{blockingEvidenceItemIds}',
    expected_first_screen_ids,
    true
  );
  return public.named_lens_presentation_authoritative_0027(
    p_presentation,
    p_passages,
    p_dispositions,
    compatibility_decision,
    p_evidence_pack,
    p_workspace_id,
    p_candidate_run_id
  );
exception when others then
  return false;
end;
$$;
alter function public.named_lens_presentation_authoritative_0028(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text
) owner to vsee_underwriting_owner;
revoke all on function
  public.named_lens_presentation_authoritative_0028(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.named_lens_presentation_authoritative_0028(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text
  )
to vsee_underwriting_owner;

create or replace function public.assert_named_lens_presentation_finalization_0028(
  p_payload jsonb,
  p_workspace_id text,
  p_candidate_run_id text,
  p_deal_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  catalog jsonb := p_payload -> 'namedLensCatalogConsiderations';
  projection jsonb := p_payload -> 'decisionCriticalEvidenceProjection';
  attempt_refs jsonb := p_payload -> 'namedLensAttemptRefs';
  dispositions jsonb := p_payload -> 'namedLensDispositions';
  passages jsonb := p_payload -> 'namedLensPassages';
  presentation jsonb := p_payload -> 'namedLensPresentation';
  terminal_status text := btrim(p_payload ->> 'terminalStatus');
  terminal_reasons jsonb := p_payload -> 'terminalReasonCodes';
  evidence_pack jsonb := p_payload -> 'evidencePack';
  judgments jsonb := p_payload -> 'judgments';
  catalog_checkpoint jsonb;
  catalog_checkpoint_input_fingerprint text;
  catalog_checkpoint_output_fingerprint text;
  eligible_count integer;
  passage_count integer;
  unavailable_count integer;
  eligible_unavailable_count integer;
  projection_unavailable boolean;
  selected_count integer;
  consideration_value jsonb;
  disposition_value jsonb;
  passage_value jsonb;
  segment_value jsonb;
  segment_kind text;
  segment_ordinal integer;
  catalog_ordinal_value bigint;
begin
  if jsonb_typeof(version_snapshot) is distinct from 'object'
    or jsonb_typeof(catalog) is distinct from 'array'
    or jsonb_typeof(projection) is distinct from 'object'
    or jsonb_typeof(attempt_refs) is distinct from 'array'
    or jsonb_typeof(dispositions) is distinct from 'array'
    or jsonb_typeof(passages) is distinct from 'array'
    or jsonb_typeof(presentation) is distinct from 'object'
    or jsonb_typeof(terminal_reasons) is distinct from 'array'
    or jsonb_typeof(evidence_pack) is distinct from 'object'
    or jsonb_typeof(judgments) is distinct from 'array'
    or terminal_status not in ('completed', 'partial')
  then
    raise exception 'Current Named Lens finalization contract is incomplete';
  end if;

  if version_snapshot ->> 'namedLensSelectionPolicyVersion'
      is distinct from 'named-lens-selection-v1'
    or version_snapshot ->> 'namedLensPassageSchemaVersion'
      is distinct from 'named-lens-passage-v1'
    or version_snapshot ->> 'namedLensGeneratorVersion'
      is distinct from 'named-lens-generator-v1'
    or version_snapshot ->> 'underwritingPresentationSchemaVersion'
      is distinct from 'decision-first-named-lens-v1'
    or version_snapshot ->> 'decisionTaxonomyVersion'
      is distinct from 'named-lens-decision-taxonomy-v1'
    or version_snapshot ->> 'decisionTaxonomyDigest'
      is distinct from
        'sha256:e080f1b6c600f79b03a1212f5cd4999bb7ec488c0fafe12ad7f9d5a76e72119a'
    or jsonb_typeof(version_snapshot -> 'frameworkCatalogVersion')
      is distinct from 'string'
    or btrim(version_snapshot ->> 'frameworkCatalogVersion') = ''
    or version_snapshot ->> 'frameworkCatalogFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'frameworkCorpusDigest'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'criticalEvidenceProjectionFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'finalDispositionsFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'presentationFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or not (version_snapshot ? 'refreshNonce')
    or jsonb_typeof(version_snapshot -> 'refreshNonce')
      not in ('null', 'string')
  then
    raise exception
      'Current Named Lens identity versions and fingerprints are incomplete';
  end if;

  select checkpoint.output_payload, checkpoint.input_fingerprint,
    checkpoint.output_fingerprint
  into catalog_checkpoint, catalog_checkpoint_input_fingerprint,
    catalog_checkpoint_output_fingerprint
  from public.candidate_checkpoints checkpoint
  where checkpoint.workspace_id = p_workspace_id
    and checkpoint.candidate_run_id = p_candidate_run_id
    and checkpoint.stage = 'framework_catalog'
    and checkpoint.status = 'completed';
  if not found
    or catalog_checkpoint_input_fingerprint
      !~ '^sha256:[0-9a-f]{64}$'
    or catalog_checkpoint_output_fingerprint is distinct from
      public.named_lens_segment_fingerprint_0027(jsonb_build_object(
        'stage', 'framework_catalog',
        'inputFingerprint', catalog_checkpoint_input_fingerprint,
        'result', catalog_checkpoint
      ))
    or catalog_checkpoint is distinct from jsonb_build_object(
      'catalogVersion', version_snapshot ->> 'frameworkCatalogVersion',
      'catalogFingerprint',
        version_snapshot ->> 'frameworkCatalogFingerprint',
      'corpusDigest', version_snapshot ->> 'frameworkCorpusDigest'
    )
  then
    raise exception
      'Framework catalog identity must match the completed catalog checkpoint';
  end if;

  if public.named_lens_local_identity_0027(
      projection, p_workspace_id, p_candidate_run_id
    ) is distinct from true
    or public.named_lens_local_identity_0027(
      presentation, p_workspace_id, p_candidate_run_id
    ) is distinct from true
    or version_snapshot ->> 'criticalEvidenceProjectionFingerprint'
      is distinct from projection ->> 'fingerprint'
    or projection ->> 'fingerprint' is distinct from
      public.named_lens_projection_fingerprint_0028(
        projection, judgments
      )
  then
    raise exception
      'Decision-critical projection identity or semantic fingerprint is not authoritative';
  end if;
  if jsonb_typeof(projection -> 'id') is distinct from 'string'
    or btrim(projection ->> 'id') = ''
    or projection ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(projection -> 'evidenceRefs') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(projection -> 'evidenceRefs') evidence
      where jsonb_typeof(evidence) is distinct from 'object'
        or jsonb_typeof(evidence -> 'evidencePackItemId')
          is distinct from 'string'
        or btrim(evidence ->> 'evidencePackItemId') = ''
        or btrim(evidence ->> 'evidencePackItemId') is distinct from
          evidence ->> 'evidencePackItemId'
        or evidence ->> 'classification' not in ('fact', 'assumption')
        or jsonb_typeof(evidence -> 'originRefs') is distinct from 'array'
        or jsonb_array_length(evidence -> 'originRefs') = 0
        or exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(evidence -> 'originRefs') = 'array'
                then evidence -> 'originRefs'
              else '[]'::jsonb
            end
          ) with ordinality origin_ref(value, ordinal)
          where jsonb_typeof(origin_ref.value) is distinct from 'object'
            or origin_ref.value ->> 'kind' not in (
              'market_event', 'source_revision', 'xtrace_memory',
              'prior_record', 'chronology_gate', 'revisit_gate',
              'counterevidence_gate', 'action_delta_gate', 'fired_rule',
              'blocking_evidence', 'scenario_input', 'calculation',
              'valuation_evaluation', 'return_calculation'
            )
            or jsonb_typeof(origin_ref.value -> 'id')
              is distinct from 'string'
            or btrim(origin_ref.value ->> 'id') = ''
            or btrim(origin_ref.value ->> 'id') is distinct from
              origin_ref.value ->> 'id'
            or (
              origin_ref.ordinal > 1
              and concat(
                origin_ref.value ->> 'kind', E'\u0001',
                origin_ref.value ->> 'id'
              ) collate "C" <= concat(
                (evidence -> 'originRefs'
                  -> (origin_ref.ordinal::integer - 2)) ->> 'kind',
                E'\u0001',
                (evidence -> 'originRefs'
                  -> (origin_ref.ordinal::integer - 2)) ->> 'id'
              ) collate "C"
            )
        )
        or jsonb_typeof(evidence -> 'reasonCodes') is distinct from 'array'
        or jsonb_array_length(evidence -> 'reasonCodes') = 0
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(evidence -> 'reasonCodes') = 'array'
                then evidence -> 'reasonCodes'
              else '[]'::jsonb
            end
          ) with ordinality reason(value, ordinal)
          where btrim(reason.value) = ''
            or btrim(reason.value) is distinct from reason.value
            or (
              reason.ordinal > 1
              and reason.value collate "C" <=
                (evidence -> 'reasonCodes'
                  ->> (reason.ordinal::integer - 2)) collate "C"
            )
        )
        or jsonb_typeof(evidence -> 'resolutionPath') is distinct from 'array'
        or jsonb_array_length(evidence -> 'resolutionPath') = 0
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(evidence -> 'resolutionPath') = 'array'
                then evidence -> 'resolutionPath'
              else '[]'::jsonb
            end
          ) path_part
          where btrim(path_part) = ''
            or btrim(path_part) is distinct from path_part
        )
        or (
          select count(*)
          from jsonb_array_elements(
            case evidence ->> 'classification'
              when 'fact' then evidence_pack -> 'facts'
              else evidence_pack -> 'assumptions'
            end
          ) pack_item
          where pack_item ->> 'id' = evidence ->> 'evidencePackItemId'
        ) <> 1
    )
    or (
      select count(*) <> count(distinct
        evidence ->> 'evidencePackItemId')
      from jsonb_array_elements(projection -> 'evidenceRefs') evidence
    )
  then
    raise exception
      'Decision-critical projection is not candidate-local or authoritative';
  end if;

  if jsonb_array_length(catalog) <> jsonb_array_length(dispositions)
    or (
      select count(*) <> count(distinct
        item ->> 'judgmentOrCatalogCandidateId')
      from jsonb_array_elements(catalog) item
    )
    or (
      select count(*) <> count(distinct
        item ->> 'judgmentOrCatalogCandidateId')
      from jsonb_array_elements(dispositions) item
    )
    or exists (
      select 1
      from jsonb_array_elements(catalog) with ordinality item(value, ordinal)
      where public.named_lens_local_identity_0027(
          item.value, p_workspace_id, p_candidate_run_id
        ) is distinct from true
        or jsonb_typeof(item.value -> 'judgmentOrCatalogCandidateId')
          is distinct from 'string'
        or btrim(item.value ->> 'judgmentOrCatalogCandidateId') = ''
        or jsonb_typeof(item.value -> 'frameworkCardId')
          is distinct from 'string'
        or btrim(item.value ->> 'frameworkCardId') = ''
        or jsonb_typeof(item.value -> 'frameworkVersion')
          is distinct from 'string'
        or btrim(item.value ->> 'frameworkVersion') = ''
        or item.value ->> 'initialDisposition' not in (
          'judgment_eligible', 'context_inapplicable', 'ineligible',
          'abstained', 'unavailable'
        )
        or jsonb_typeof(item.value -> 'reasonCodes')
          is distinct from 'array'
        or jsonb_array_length(item.value -> 'reasonCodes') = 0
        or item.value ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
        or (
          item.ordinal > 1
          and item.value ->> 'judgmentOrCatalogCandidateId'
            <= (catalog -> (item.ordinal::integer - 2))
              ->> 'judgmentOrCatalogCandidateId' collate "C"
        )
        or (
          select count(*)
          from jsonb_array_elements(dispositions) disposition
          where disposition ->> 'judgmentOrCatalogCandidateId'
              = item.value ->> 'judgmentOrCatalogCandidateId'
            and disposition ->> 'judgmentId'
              is not distinct from item.value ->> 'judgmentId'
            and disposition ->> 'frameworkCardId'
              = item.value ->> 'frameworkCardId'
            and disposition ->> 'frameworkVersion'
              = item.value ->> 'frameworkVersion'
        ) <> 1
    )
  then
    raise exception
      'Every current Framework catalog candidate requires exactly one disposition';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dispositions) disposition
    where public.named_lens_local_identity_0027(
        disposition, p_workspace_id, p_candidate_run_id
      ) is distinct from true
      or disposition ->> 'disposition' not in (
        'context_inapplicable', 'ineligible', 'abstained', 'unavailable',
        'withheld', 'selected_main', 'appendix_only'
      )
      or disposition ->> 'fingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or disposition ->> 'selectionPolicyVersion'
        is distinct from 'named-lens-selection-v1'
      or disposition ->> 'decisionCriticalEvidenceProjectionId'
        is distinct from projection ->> 'id'
      or disposition ->> 'decisionCriticalEvidenceProjectionFingerprint'
        is distinct from projection ->> 'fingerprint'
      or jsonb_typeof(disposition -> 'reasonCodes')
        is distinct from 'array'
      or jsonb_array_length(disposition -> 'reasonCodes') = 0
      or jsonb_typeof(disposition -> 'selectionBasisEvidenceIds')
        is distinct from 'array'
      or jsonb_typeof(disposition -> 'criticalEvidence')
        is distinct from 'array'
  ) then
    raise exception
      'Every current Named Lens disposition must be candidate-local and projection fingerprint-bound';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dispositions) disposition
    cross join lateral jsonb_array_elements(
      disposition -> 'criticalEvidence'
    ) critical_evidence
    where jsonb_typeof(critical_evidence) is distinct from 'object'
      or jsonb_typeof(critical_evidence -> 'evidencePackItemId')
        is distinct from 'string'
      or btrim(critical_evidence ->> 'evidencePackItemId') = ''
      or critical_evidence ->> 'classification' not in (
        'fact', 'assumption'
      )
      or (
        select count(*)
        from jsonb_array_elements(projection -> 'evidenceRefs') projected
        where projected = critical_evidence
      ) <> 1
  ) or exists (
    select 1
    from jsonb_array_elements(dispositions) disposition
    cross join lateral jsonb_array_elements_text(
      disposition -> 'selectionBasisEvidenceIds'
    ) basis(evidence_id)
    where btrim(basis.evidence_id) = ''
      or (
        select count(*)
        from jsonb_array_elements(
          disposition -> 'criticalEvidence'
        ) critical_evidence
        where critical_evidence ->> 'evidencePackItemId'
          = basis.evidence_id
      ) <> 1
  ) or exists (
    select 1
    from jsonb_array_elements(dispositions) disposition
    cross join lateral jsonb_array_elements_text(
      disposition -> 'selectionBasisEvidenceIds'
    ) basis(evidence_id)
    where (
        select count(*)
        from jsonb_array_elements(judgments) judgment
        where judgment ->> 'id' = disposition ->> 'judgmentId'
          and basis.evidence_id in (
            select jsonb_array_elements_text(
              coalesce(judgment -> 'supportEvidenceItemIds', '[]'::jsonb)
            )
            union all
            select jsonb_array_elements_text(
              coalesce(judgment -> 'counterEvidenceItemIds', '[]'::jsonb)
            )
          )
      ) <> 1
  ) then
    raise exception
      'Every disposition evidence reference must resolve exactly to its authoritative projection and selection basis';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(catalog) consideration
    join jsonb_array_elements(dispositions) disposition
      on disposition ->> 'judgmentOrCatalogCandidateId'
        = consideration ->> 'judgmentOrCatalogCandidateId'
    where (
      consideration ->> 'initialDisposition' = 'judgment_eligible'
      and (
        disposition ->> 'disposition' not in (
          'selected_main', 'appendix_only', 'withheld', 'unavailable'
        )
        or (
          select count(*)
          from jsonb_array_elements(judgments) judgment
          where judgment ->> 'id' = consideration ->> 'judgmentId'
            and judgment ->> 'id'
              = consideration ->> 'judgmentOrCatalogCandidateId'
            and judgment ->> 'frameworkCardId'
              = consideration ->> 'frameworkCardId'
            and judgment ->> 'frameworkVersion'
              = consideration ->> 'frameworkVersion'
            and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
            and judgment ->> 'applicability' = 'applicable'
            and judgment ->> 'conclusion' in (
              'supportive', 'mixed', 'negative'
            )
        ) <> 1
      )
    ) or (
      consideration ->> 'initialDisposition' = 'context_inapplicable'
      and (
        consideration -> 'judgmentId' <> 'null'::jsonb
        or disposition ->> 'disposition' <> 'context_inapplicable'
        or (
          select count(*)
          from jsonb_array_elements(judgments) judgment
          where judgment ->> 'id'
              = consideration ->> 'judgmentOrCatalogCandidateId'
            and judgment ->> 'frameworkCardId'
              = consideration ->> 'frameworkCardId'
            and judgment ->> 'frameworkVersion'
              = consideration ->> 'frameworkVersion'
            and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
            and (
              judgment ->> 'applicability' = 'not_applicable'
              or judgment #>> '{frameworkMetadata,applicable}' = 'false'
            )
        ) <> 1
      )
    ) or (
      consideration ->> 'initialDisposition' = 'ineligible'
      and (
        consideration -> 'judgmentId' <> 'null'::jsonb
        or disposition ->> 'disposition' <> 'ineligible'
      )
    ) or (
      consideration ->> 'initialDisposition' = 'abstained'
      and (
        disposition ->> 'disposition' <> 'abstained'
        or (
          select count(*)
          from jsonb_array_elements(judgments) judgment
          where judgment ->> 'id' = consideration ->> 'judgmentId'
            and judgment ->> 'id'
              = consideration ->> 'judgmentOrCatalogCandidateId'
            and judgment ->> 'frameworkCardId'
              = consideration ->> 'frameworkCardId'
            and judgment ->> 'frameworkVersion'
              = consideration ->> 'frameworkVersion'
            and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
            and public.named_lens_typed_abstention_0028(
              judgment, evidence_pack
            )
        ) <> 1
      )
    ) or (
      consideration ->> 'initialDisposition' = 'unavailable'
      and (
        disposition ->> 'disposition' <> 'unavailable'
        or (
          jsonb_typeof(consideration -> 'judgmentId') = 'string'
          and (
            select count(*)
            from jsonb_array_elements(judgments) judgment
            where judgment ->> 'id' = consideration ->> 'judgmentId'
              and judgment ->> 'id'
                = consideration ->> 'judgmentOrCatalogCandidateId'
              and judgment ->> 'frameworkCardId'
                = consideration ->> 'frameworkCardId'
              and judgment ->> 'frameworkVersion'
                = consideration ->> 'frameworkVersion'
              and jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
              and judgment ->> 'applicability' = 'unavailable'
              and judgment ->> 'conclusion' = 'abstain'
          ) <> 1
        )
      )
    )
  ) then
    raise exception
      'Framework catalog disposition taxonomy or typed abstention is not authoritative';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(judgments) judgment
    where jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
      and (
        select count(*)
        from jsonb_array_elements(catalog) consideration
        where consideration ->> 'judgmentOrCatalogCandidateId'
            = judgment ->> 'id'
          and consideration ->> 'frameworkCardId'
            = judgment ->> 'frameworkCardId'
          and consideration ->> 'frameworkVersion'
            = judgment ->> 'frameworkVersion'
      ) <> 1
  ) then
    raise exception
      'Every persisted advisory judgment requires one catalog disposition';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(judgments) judgment
    where jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
      and judgment ->> 'applicability' = 'applicable'
      and judgment ->> 'conclusion' in (
        'supportive', 'mixed', 'negative'
      )
      and (
        select count(*)
        from jsonb_array_elements(catalog) consideration
        where consideration ->> 'initialDisposition'
            = 'judgment_eligible'
          and consideration ->> 'judgmentOrCatalogCandidateId'
            = judgment ->> 'id'
          and consideration ->> 'judgmentId' = judgment ->> 'id'
          and consideration ->> 'frameworkCardId'
            = judgment ->> 'frameworkCardId'
          and consideration ->> 'frameworkVersion'
            = judgment ->> 'frameworkVersion'
      ) <> 1
  ) then
    raise exception
      'Applicable advisory judgments must map all-and-only to judgment-eligible catalog candidates';
  end if;

  select count(*)::integer into selected_count
  from jsonb_array_elements(dispositions) disposition
  where disposition ->> 'disposition' = 'selected_main';
  if selected_count > 6
    or exists (
      select 1
      from jsonb_array_elements(dispositions) disposition
      where disposition ->> 'disposition' = 'selected_main'
        and (
          disposition ->> 'selectedPosition' !~ '^[1-6]$'
          or (disposition ->> 'selectedPosition')::integer > 6
        )
    )
  then
    raise exception 'Selected Named Lens positions must be one through six';
  end if;
  if (
      select coalesce(array_agg(position order by position), '{}'::integer[])
      from (
        select (disposition ->> 'selectedPosition')::integer as position
        from jsonb_array_elements(dispositions) disposition
        where disposition ->> 'disposition' = 'selected_main'
      ) selected
    ) <> (
      select coalesce(array_agg(position), '{}'::integer[])
      from generate_series(1, selected_count) position
    )
  then
    raise exception
      'Selected Named Lens positions must be unique and contiguous from one';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(dispositions) disposition
    where (
      disposition ->> 'disposition' in ('selected_main', 'appendix_only')
      and (
        disposition ->> 'passageFingerprint'
          !~ '^sha256:[0-9a-f]{64}$'
        or nullif(btrim(disposition ->> 'judgmentId'), '') is null
        or (
          select count(*)
          from jsonb_array_elements(passages) passage
          where passage ->> 'judgmentId'
              = disposition ->> 'judgmentId'
            and passage ->> 'fingerprint'
              = disposition ->> 'passageFingerprint'
        ) <> 1
      )
    ) or (
      disposition ->> 'disposition' not in (
        'selected_main', 'appendix_only'
      )
      and (
        disposition -> 'passageFingerprint' <> 'null'::jsonb
        or disposition -> 'selectedPosition' <> 'null'::jsonb
      )
    )
  ) or exists (
    select 1
    from jsonb_array_elements(passages) passage
    where (
      select count(*)
      from jsonb_array_elements(dispositions) disposition
      where disposition ->> 'judgmentId' = passage ->> 'judgmentId'
        and disposition ->> 'passageFingerprint'
          = passage ->> 'fingerprint'
        and disposition ->> 'disposition' in (
          'selected_main', 'appendix_only'
        )
    ) <> 1
  ) then
    raise exception
      'Every publishable disposition and passage must share one passage fingerprint';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(passages) passage
    where not exists (
      select 1
      from jsonb_array_elements(catalog) consideration
      where consideration ->> 'judgmentId' = passage ->> 'judgmentId'
        and consideration ->> 'initialDisposition' = 'judgment_eligible'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(passages) passage
    where public.named_lens_passage_authoritative_0027(
      passage, judgments, dispositions, projection, evidence_pack,
      p_workspace_id, p_candidate_run_id
    ) is distinct from true
  ) then
    raise exception
      'Every candidate-local passage requires five grounded segments and one judgment-eligible catalog candidate';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(passages) passage
    cross join lateral (
      select coalesce(pg_catalog.sum(
        pg_catalog.regexp_count(
          pg_catalog.translate(
            segment.text,
            U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
            pg_catalog.repeat(' ', 25)
          ),
          '[^ ]+'
        )
      ), 0::bigint)::integer as actual_word_count
      from (values
        (passage #>> '{premise,text}'),
        (passage #>> '{caseApplication,text}'),
        (passage #>> '{countercase,text}'),
        (passage #>> '{unknownBoundary,text}'),
        (passage #>> '{conditionalConclusion,text}')
      ) segment(text)
    ) counted
    where counted.actual_word_count not between 180 and 260
      or case
        when pg_catalog.jsonb_typeof(passage -> 'wordCount')
            is distinct from 'number'
          or passage ->> 'wordCount' !~ '^[0-9]+$'
          then true
        else (passage ->> 'wordCount')::numeric
          <> counted.actual_word_count
      end
  ) then
    raise exception
      'Named Lens passage word count must exactly match five segments and remain between 180 and 260 words';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(attempt_refs) reference
    where jsonb_typeof(reference) is distinct from 'object'
      or jsonb_typeof(reference -> 'judgmentOrCatalogCandidateId')
        is distinct from 'string'
      or btrim(reference ->> 'judgmentOrCatalogCandidateId') = ''
      or jsonb_typeof(reference -> 'logicalPassageId')
        is distinct from 'string'
      or btrim(reference ->> 'logicalPassageId') = ''
      or jsonb_typeof(reference -> 'attemptNumber') is distinct from 'number'
      or reference ->> 'attemptNumber' !~ '^[1-9][0-9]*$'
      or reference ->> 'attemptFingerprint' !~ '^sha256:[0-9a-f]{64}$'
      or (
        select count(*)
        from jsonb_array_elements(catalog) consideration
        join jsonb_array_elements(dispositions) disposition
          on disposition ->> 'judgmentOrCatalogCandidateId'
            = consideration ->> 'judgmentOrCatalogCandidateId'
        where consideration ->> 'judgmentOrCatalogCandidateId'
          = reference ->> 'judgmentOrCatalogCandidateId'
      ) <> 1
  ) or (
    select count(*) <> count(distinct concat_ws(
      E'\u0001',
      reference ->> 'judgmentOrCatalogCandidateId',
      reference ->> 'logicalPassageId',
      reference ->> 'attemptNumber',
      reference ->> 'attemptFingerprint'
    ))
    from jsonb_array_elements(attempt_refs) reference
  ) then
    raise exception
      'Every provider attempt ref must be typed, unique, and catalog-authorized';
  end if;

  if (
      select count(*)
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and event.event_status = 'reserved'
    ) <> jsonb_array_length(attempt_refs)
    or (
      select count(*)
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and event.event_status in ('completed', 'failed', 'aborted')
    ) <> jsonb_array_length(attempt_refs)
    or exists (
      select 1
      from jsonb_array_elements(attempt_refs) reference
      where (
        select count(*)
        from public.named_lens_passage_attempt_events event
        where event.workspace_id = p_workspace_id
          and event.candidate_run_id = p_candidate_run_id
          and event.judgment_or_catalog_candidate_id
            = reference ->> 'judgmentOrCatalogCandidateId'
          and event.logical_passage_id = reference ->> 'logicalPassageId'
          and event.attempt_no
            = (reference ->> 'attemptNumber')::integer
          and event.attempt_fingerprint
            = reference ->> 'attemptFingerprint'
      ) <> 2
    )
    or exists (
      select 1
      from public.named_lens_passage_attempt_events event
      where event.workspace_id = p_workspace_id
        and event.candidate_run_id = p_candidate_run_id
        and (
          select count(*)
          from jsonb_array_elements(catalog) consideration
          join jsonb_array_elements(dispositions) disposition
            on disposition ->> 'judgmentOrCatalogCandidateId'
              = consideration ->> 'judgmentOrCatalogCandidateId'
          where consideration ->> 'judgmentOrCatalogCandidateId'
            = event.judgment_or_catalog_candidate_id
        ) <> 1
    )
    or exists (
      select 1
      from jsonb_array_elements(catalog) consideration
      where consideration ->> 'initialDisposition' in (
        'judgment_eligible', 'abstained', 'unavailable'
      )
        and not exists (
          select 1
          from public.named_lens_passage_attempt_events event
          where event.workspace_id = p_workspace_id
            and event.candidate_run_id = p_candidate_run_id
            and event.judgment_or_catalog_candidate_id
              = consideration ->> 'judgmentOrCatalogCandidateId'
            and event.event_status in ('completed', 'failed', 'aborted')
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(catalog) consideration
      where consideration ->> 'initialDisposition' = 'abstained'
        and not exists (
          select 1
          from public.named_lens_passage_attempt_events event
          where event.workspace_id = p_workspace_id
            and event.candidate_run_id = p_candidate_run_id
            and event.judgment_or_catalog_candidate_id
              = consideration ->> 'judgmentOrCatalogCandidateId'
            and event.event_status = 'completed'
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(dispositions) disposition
      where disposition ->> 'disposition' in (
        'selected_main', 'appendix_only'
      )
        and not exists (
          select 1
          from public.named_lens_passage_attempt_events event
          where event.workspace_id = p_workspace_id
            and event.candidate_run_id = p_candidate_run_id
            and event.judgment_or_catalog_candidate_id
              = disposition ->> 'judgmentOrCatalogCandidateId'
            and event.event_status = 'completed'
        )
    )
  then
    raise exception
      'Finalization requires exact settled provider-attempt audit coverage';
  end if;

  perform 1
  from public.candidate_runs candidate
  join public.underwriting_batches batch
    on batch.workspace_id = candidate.workspace_id
    and batch.id = candidate.batch_id
  join public.intelligence_reports report
    on report.workspace_id = batch.workspace_id
    and report.run_id = batch.scan_run_id
    and report.id = btrim(p_payload ->> 'underwritingPresentationReportId')
    and report.analysis_status = 'completed'
  join public.company_analyses analysis
    on analysis.workspace_id = report.workspace_id
    and analysis.report_id = report.id
    and analysis.run_id = report.run_id
    and analysis.deal_id = candidate.deal_id
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_candidate_run_id
    and candidate.deal_id = p_deal_id;
  if not found then
    raise exception
      'Underwriting presentation report identity is not authoritative';
  end if;
  if public.named_lens_presentation_authoritative_0028(
    presentation, passages, dispositions, p_payload -> 'decision',
    projection, evidence_pack, p_workspace_id, p_candidate_run_id
  ) is distinct from true
  then
    raise exception
      'Underwriting presentation identity, selections, synthesis, or segment citations are not authoritative';
  end if;

  select count(*)::integer into eligible_count
  from jsonb_array_elements(catalog) consideration
  where consideration ->> 'initialDisposition' = 'judgment_eligible';
  select jsonb_array_length(passages) into passage_count;
  select count(*)::integer into unavailable_count
  from jsonb_array_elements(dispositions) disposition
  where disposition ->> 'disposition' in ('unavailable', 'withheld');
  select count(*)::integer into eligible_unavailable_count
  from jsonb_array_elements(catalog) consideration
  join jsonb_array_elements(dispositions) disposition
    on disposition ->> 'judgmentOrCatalogCandidateId'
      = consideration ->> 'judgmentOrCatalogCandidateId'
  where consideration ->> 'initialDisposition' = 'judgment_eligible'
    and disposition ->> 'disposition' in ('unavailable', 'withheld');

  projection_unavailable :=
    projection -> 'evidenceRefs' = '[]'::jsonb
    and terminal_reasons is distinct from null
    and terminal_reasons = jsonb_build_array(
      'decision_critical_evidence_projection_unavailable'
    )
    and passage_count = 0
    and not exists (
      select 1
      from jsonb_array_elements(catalog) consideration
      join jsonb_array_elements(dispositions) disposition
        on disposition ->> 'judgmentOrCatalogCandidateId'
          = consideration ->> 'judgmentOrCatalogCandidateId'
      where consideration ->> 'initialDisposition' = 'judgment_eligible'
        and (
          disposition ->> 'disposition' <> 'withheld'
          or disposition -> 'reasonCodes' is distinct from
            jsonb_build_array(
              'DECISION_CRITICAL_EVIDENCE_PROJECTION_UNAVAILABLE'
            )
        )
    );

  if terminal_status = 'completed' then
    if unavailable_count <> 0
      or passage_count <> eligible_count
      or (
        passage_count < 4
        and (
          eligible_count >= 4
          or terminal_reasons is distinct from
            jsonb_build_array('limited_framework_coverage')
        )
      )
      or (
        passage_count >= 4
        and jsonb_array_length(terminal_reasons) <> 0
      )
    then
      raise exception
        'Completed Named Lens coverage is not genuinely limited or complete';
    end if;
  elsif (unavailable_count = 0 and not projection_unavailable)
    or jsonb_array_length(terminal_reasons) = 0
  then
    raise exception
      'Partial Named Lens coverage requires an unavailable or withheld disposition and canonical terminal reasons';
  end if;

  if (
    select count(*) <> count(distinct reason)
    from jsonb_array_elements_text(terminal_reasons) reason
  ) or exists (
    select 1
    from jsonb_array_elements_text(terminal_reasons) with ordinality
      reason(value, ordinal)
    where btrim(reason.value) = ''
      or (
        reason.ordinal > 1
        and reason.value <=
          (terminal_reasons ->> (reason.ordinal::integer - 2)) collate "C"
      )
  ) then
    raise exception 'Named Lens terminal reasons must be unique and UTF-8 sorted';
  end if;

  if version_snapshot ->> 'finalDispositionsFingerprint'
      is distinct from public.named_lens_final_dispositions_fingerprint_0028(
        projection, dispositions, passages, judgments
      )
    or version_snapshot ->> 'presentationFingerprint'
      is distinct from presentation ->> 'fingerprint'
    or presentation ->> 'fingerprint' is distinct from
      public.named_lens_presentation_fingerprint_0028(presentation)
  then
    raise exception
      'Named Lens dispositions or presentation semantic fingerprint is not authoritative';
  end if;

  insert into public.decision_critical_evidence_projections (
    workspace_id, candidate_run_id, deal_id, projection_id,
    payload_fingerprint, payload
  ) values (
    p_workspace_id, p_candidate_run_id, p_deal_id,
    projection ->> 'id', projection ->> 'fingerprint', projection
  );

  for consideration_value, catalog_ordinal_value in
    select value, ordinality
    from jsonb_array_elements(catalog) with ordinality
  loop
    select value into strict disposition_value
    from jsonb_array_elements(dispositions)
    where value ->> 'judgmentOrCatalogCandidateId'
      = consideration_value ->> 'judgmentOrCatalogCandidateId';
    insert into public.named_lens_dispositions (
      workspace_id, candidate_run_id, deal_id, catalog_ordinal,
      judgment_or_catalog_candidate_id, judgment_id, disposition,
      selected_position, passage_fingerprint, projection_id,
      projection_fingerprint, payload_fingerprint,
      catalog_consideration_fingerprint, catalog_consideration, payload
    ) values (
      p_workspace_id, p_candidate_run_id, p_deal_id,
      catalog_ordinal_value,
      disposition_value ->> 'judgmentOrCatalogCandidateId',
      nullif(disposition_value ->> 'judgmentId', ''),
      disposition_value ->> 'disposition',
      (disposition_value ->> 'selectedPosition')::integer,
      nullif(disposition_value ->> 'passageFingerprint', ''),
      projection ->> 'id', projection ->> 'fingerprint',
      disposition_value ->> 'fingerprint',
      consideration_value ->> 'fingerprint',
      consideration_value, disposition_value
    );
  end loop;

  for passage_value in select value from jsonb_array_elements(passages)
  loop
    insert into public.named_lens_passages (
      workspace_id, candidate_run_id, deal_id, judgment_id,
      passage_fingerprint, payload
    ) values (
      p_workspace_id, p_candidate_run_id, p_deal_id,
      passage_value ->> 'judgmentId', passage_value ->> 'fingerprint',
      passage_value
    );
    segment_ordinal := 0;
    foreach segment_kind in array array[
      'premise', 'caseApplication', 'countercase',
      'unknownBoundary', 'conditionalConclusion'
    ]
    loop
      segment_ordinal := segment_ordinal + 1;
      segment_value := passage_value -> segment_kind;
      insert into public.named_lens_passage_segments (
        workspace_id, candidate_run_id, deal_id, judgment_id,
        segment_ordinal, segment_kind, payload_fingerprint, payload
      ) values (
        p_workspace_id, p_candidate_run_id, p_deal_id,
        passage_value ->> 'judgmentId', segment_ordinal,
        case segment_kind
          when 'caseApplication' then 'case_application'
          when 'unknownBoundary' then 'unknown_boundary'
          when 'conditionalConclusion' then 'conditional_conclusion'
          else segment_kind
        end,
        public.named_lens_segment_fingerprint_0027(segment_value),
        segment_value
      );
    end loop;
  end loop;

  insert into public.underwriting_presentations (
    workspace_id, candidate_run_id, deal_id, report_id,
    presentation_fingerprint, payload
  ) values (
    p_workspace_id, p_candidate_run_id, p_deal_id,
    btrim(p_payload ->> 'underwritingPresentationReportId'),
    presentation ->> 'fingerprint', presentation
  );
end;
$$;
alter function public.assert_named_lens_presentation_finalization_0028(
  jsonb, text, text, text
) owner to vsee_underwriting_owner;
revoke all on function
  public.assert_named_lens_presentation_finalization_0028(
    jsonb, text, text, text
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.assert_named_lens_presentation_finalization_0028(
    jsonb, text, text, text
  )
to vsee_underwriting_owner;

create or replace function public.finalize_or_reuse_candidate_underwriting(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  owning_batch public.underwriting_batches%rowtype;
  reusable public.candidate_runs%rowtype;
  finalized jsonb;
  target_fingerprint text := btrim(
    p_payload ->> 'candidateAnalysisFingerprint'
  );
  build_input_fingerprint text := btrim(
    p_payload ->> 'evidencePackBuildInputFingerprint'
  );
  evidence_pack jsonb := p_payload -> 'evidencePack';
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  task9_compatible_payload jsonb;
  terminal_status text;
  terminal_reasons jsonb;
begin
  select * into target
  from public.candidate_runs
  where id = btrim(p_payload ->> 'candidateRunId')
  for update;
  if not found
    or target.status <> 'running'
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception 'Candidate finalization lease does not match';
  end if;
  select * into owning_batch
  from public.underwriting_batches batch
  where batch.workspace_id = target.workspace_id
    and batch.id = target.batch_id
  for key share;
  if not found then
    raise exception 'Candidate batch does not exist';
  end if;
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'A canonical candidate fingerprint is required';
  end if;

  if owning_batch.force_refresh then
    if jsonb_typeof(version_snapshot) is distinct from 'object'
      or jsonb_typeof(version_snapshot -> 'refreshNonce')
        is distinct from 'string'
      or version_snapshot ->> 'refreshNonce'
        is distinct from owning_batch.refresh_nonce
    then
      raise exception
        'Force-refresh finalization requires the exact persisted refresh identity';
    end if;
  elsif jsonb_typeof(version_snapshot) = 'object'
    and version_snapshot ? 'refreshNonce'
    and jsonb_typeof(version_snapshot -> 'refreshNonce') <> 'null'
  then
    raise exception
      'Ordinary finalization cannot carry a refresh identity';
  end if;

  if not owning_batch.force_refresh then
    select source.* into reusable
    from public.candidate_runs source
    where source.workspace_id = target.workspace_id
      and source.id = target.rerun_of_id
      and source.deal_id = target.deal_id
      and source.status in ('completed', 'partial')
      and source.candidate_analysis_fingerprint = target_fingerprint
      and source.artifact_source_candidate_run_id is null
    for key share;
    if found then
      update public.candidate_runs
      set status = reusable.status,
          candidate_analysis_fingerprint = target_fingerprint,
          artifact_source_candidate_run_id = reusable.id,
          unavailable_reason_codes = reusable.unavailable_reason_codes,
          public_failure_reason = reusable.public_failure_reason,
          finalized_at = now(), worker_id = null, lease_token = null,
          lease_expires_at = null
      where workspace_id = target.workspace_id and id = target.id
      returning * into target;
      perform public.refresh_underwriting_batch_status(target.batch_id);
      return jsonb_build_object(
        'id', target.id, 'batchId', target.batch_id,
        'workspaceId', target.workspace_id, 'dealId', target.deal_id,
        'status', target.status,
        'candidateAnalysisFingerprint',
          target.candidate_analysis_fingerprint,
        'rerunOfId', target.rerun_of_id,
        'createdAt', public.canonical_utc_iso_milliseconds(
          target.created_at
        ),
        'finalizedAt', public.canonical_utc_iso_milliseconds(
          target.finalized_at
        )
      );
    end if;
  end if;

  if build_input_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(evidence_pack) <> 'object'
    or btrim(coalesce(evidence_pack ->> 'id', '')) = ''
    or evidence_pack ->> 'workspaceId' <> target.workspace_id
    or nullif(btrim(evidence_pack ->> 'dealId'), '')
      is distinct from target.deal_id
  then
    raise exception
      'Non-reuse finalization requires an immutable Evidence Pack build';
  end if;
  perform 1
  from public.evidence_pack_builds build
  where build.workspace_id = target.workspace_id
    and build.input_fingerprint = build_input_fingerprint
    and build.pack_id = evidence_pack ->> 'id'
    and build.pack_payload = evidence_pack
  for key share;
  if not found then
    raise exception
      'Non-reuse finalization requires the exact immutable Evidence Pack build';
  end if;

  if jsonb_typeof(version_snapshot) is distinct from 'object'
    or version_snapshot ->> 'namedLensSelectionPolicyVersion'
      is distinct from 'named-lens-selection-v1'
    or version_snapshot ->> 'namedLensPassageSchemaVersion'
      is distinct from 'named-lens-passage-v1'
    or version_snapshot ->> 'namedLensGeneratorVersion'
      is distinct from 'named-lens-generator-v1'
    or version_snapshot ->> 'underwritingPresentationSchemaVersion'
      is distinct from 'decision-first-named-lens-v1'
    or version_snapshot ->> 'decisionTaxonomyVersion'
      is distinct from 'named-lens-decision-taxonomy-v1'
    or jsonb_typeof(version_snapshot -> 'frameworkCatalogVersion')
      is distinct from 'string'
    or version_snapshot ->> 'frameworkCatalogFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'frameworkCorpusDigest'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'decisionTaxonomyDigest'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'criticalEvidenceProjectionFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'finalDispositionsFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or version_snapshot ->> 'presentationFingerprint'
      !~ '^sha256:[0-9a-f]{64}$'
    or not (version_snapshot ? 'refreshNonce')
  then
    raise exception
      'Current writes require the complete Named Lens identity checkpoint';
  end if;

  -- Task 9 predates typed Named Lens abstention and rejects an otherwise
  -- fully bounded applicable advisory judgment whose conclusion is abstain.
  -- Preserve every judgment field for its legacy authority checks while
  -- projecting only that advisory applicability to its equivalent legacy
  -- unavailable state. The original payload is then checked by the stricter
  -- 0028 typed-abstention and provider-attempt authority below.
  select jsonb_set(
    p_payload,
    '{judgments}',
    coalesce(jsonb_agg(
      case
        when jsonb_typeof(judgment -> 'frameworkMetadata') = 'object'
          and judgment ->> 'applicability' = 'applicable'
          and judgment ->> 'conclusion' = 'abstain'
        then jsonb_set(
          judgment, '{applicability}', to_jsonb('unavailable'::text), false
        )
        else judgment
      end
      order by ordinal
    ), '[]'::jsonb),
    false
  ) into task9_compatible_payload
  from jsonb_array_elements(p_payload -> 'judgments')
    with ordinality item(judgment, ordinal);
  perform public.assert_task9_current_finalization(
    task9_compatible_payload, target.workspace_id, target.id, target.deal_id
  );
  perform public.assert_named_lens_presentation_finalization_0028(
    p_payload, target.workspace_id, target.id, target.deal_id
  );

  finalized := public.finalize_candidate_underwriting(p_payload);
  terminal_status := p_payload ->> 'terminalStatus';
  terminal_reasons := p_payload -> 'terminalReasonCodes';
  update public.candidate_runs
  set status = terminal_status,
      unavailable_reason_codes = terminal_reasons,
      public_failure_reason = null
  where workspace_id = target.workspace_id and id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);
  finalized := jsonb_build_object(
    'id', target.id, 'batchId', target.batch_id,
    'workspaceId', target.workspace_id, 'dealId', target.deal_id,
    'status', target.status,
    'candidateAnalysisFingerprint', target.candidate_analysis_fingerprint,
    'rerunOfId', target.rerun_of_id,
    'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
    'finalizedAt', public.canonical_utc_iso_milliseconds(target.finalized_at)
  );
  return finalized;
end;
$$;
alter function public.finalize_or_reuse_candidate_underwriting(jsonb)
  owner to vsee_underwriting_owner;
revoke all on function public.finalize_or_reuse_candidate_underwriting(jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_or_reuse_candidate_underwriting(jsonb)
  to service_role;

commit;

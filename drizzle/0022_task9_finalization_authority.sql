begin;

select public.prepare_isolated_owner_0021(
  'vsee_underwriting_owner', true
);

create or replace function public.assert_task9_current_finalization(
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
  evidence_pack jsonb := p_payload -> 'evidencePack';
  coverage jsonb := p_payload -> 'evidencePack' -> 'coverage';
  context_snapshot jsonb := p_payload -> 'context';
  scenario_model jsonb := p_payload -> 'scenarioModel';
  valuation jsonb := p_payload -> 'valuation';
  decision_result jsonb := p_payload -> 'decision';
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  expected_actions jsonb;
  expected_missing jsonb;
  expected_formats text[];
  action_kinds text[];
  actual_formula_versions jsonb;
  draft jsonb;
  judgment jsonb;
  calculation jsonb;
  input_ref jsonb;
  source_item jsonb;
  input_ordinal bigint;
  scenario jsonb;
  scenario_input jsonb;
  label_bullets text;
  inline_labels text;
  expected_body text;
  compact_body text;
  persisted_deal_status text;
  fund_policy_values jsonb;
  valuation_scalar text;
  valuation_field text;
  valuation_formula text;
  valuation_output_field text;
  output_field text;
  input_numbers numeric[];
  expected_number numeric;
  first_dependency numeric;
  second_dependency numeric;
  expected_dependency_suffixes text[];
  expected_unit text;
  expected_currency text;
  expected_period text;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(evidence_pack) <> 'object'
    or jsonb_typeof(coverage) <> 'object'
    or jsonb_typeof(context_snapshot) <> 'object'
    or jsonb_typeof(scenario_model) <> 'object'
    or jsonb_typeof(p_payload -> 'calculations') <> 'array'
    or jsonb_typeof(p_payload -> 'calculationClaimEdges') <> 'array'
    or jsonb_typeof(p_payload -> 'judgments') <> 'array'
    or jsonb_typeof(p_payload -> 'disagreements') <> 'array'
    or jsonb_typeof(valuation) <> 'object'
    or jsonb_typeof(decision_result) <> 'object'
    or jsonb_typeof(p_payload -> 'actionDrafts') <> 'array'
    or jsonb_typeof(version_snapshot) <> 'object'
  then
    raise exception 'Task 9 current V2 artifact set is incomplete';
  end if;

  select deal.status into persisted_deal_status
  from public.deals as deal
  where deal.workspace_id = p_workspace_id and deal.id = p_deal_id;
  if not found then
    raise exception 'Task 9 current V2 Deal identity is not authoritative';
  end if;
  select policy.values into fund_policy_values
  from public.fund_policy_versions policy
  where policy.workspace_id = p_workspace_id
    and policy.id = version_snapshot ->> 'fundPolicyId';
  if not found then
    raise exception 'Task 9 current V2 Fund Policy identity is not authoritative';
  end if;

  if context_snapshot ->> 'analysisMode' not in ('full', 'core_only')
    or version_snapshot ->> 'actionPolicyVersion'
      <> 'belief-action-policy-v1'
    or version_snapshot ->> 'draftPolicyVersion'
      <> 'status-safe-action-draft-v2'
    or version_snapshot ->> 'semanticContextAssumptionPolicyVersion'
      <> 'belief-reversal-demo-context-v1'
    or version_snapshot ->> 'semanticContextMappingVersion'
      <> 'belief-reversal-reviewed-context-mapping-v1'
    or version_snapshot ->> 'routerVersion' <> 'context-router-v2'
    or version_snapshot ->> 'dealStatus' is distinct from persisted_deal_status
    or version_snapshot ->> 'analysisMode'
      is distinct from context_snapshot ->> 'analysisMode'
    or version_snapshot ->> 'contextVersion'
      is distinct from context_snapshot ->> 'contextVersion'
    or version_snapshot ->> 'geography'
      is distinct from context_snapshot ->> 'geography'
    or version_snapshot ->> 'benchmarkCompatibility'
      is distinct from context_snapshot ->> 'benchmarkCompatibility'
    or version_snapshot -> 'benchmarkPackId'
      is distinct from context_snapshot -> 'benchmarkPackId'
    or context_snapshot ->> 'asOfDate'
      is distinct from evidence_pack ->> 'asOfDate'
    or scenario_model ->> 'formulaPolicyVersion'
      is distinct from context_snapshot ->> 'valuationMethodPolicyId'
  then
    raise exception 'Task 9 current V2 context, router, or belief identity is invalid';
  end if;

  if (
      context_snapshot ->> 'geography' = 'unavailable'
      and (
        context_snapshot ->> 'analysisMode' <> 'core_only'
        or context_snapshot -> 'benchmarkPackId' <> 'null'::jsonb
        or context_snapshot ->> 'benchmarkCompatibility' <> 'unavailable'
      )
    ) or (
      context_snapshot ->> 'analysisMode' = 'full'
      and (
        context_snapshot ->> 'geography' <> 'us'
        or context_snapshot -> 'benchmarkPackId' = 'null'::jsonb
        or context_snapshot ->> 'benchmarkCompatibility'
          not in ('exact', 'broad_compatible')
      )
    ) or (
      context_snapshot ->> 'geography' <> 'us'
      and (
        context_snapshot -> 'benchmarkPackId' <> 'null'::jsonb
        or context_snapshot ->> 'benchmarkCompatibility' <> 'unavailable'
      )
    )
  then
    raise exception 'Task 9 current V2 context routing is invalid';
  end if;

  if (
      version_snapshot -> 'benchmarkPackId' = 'null'::jsonb
      or version_snapshot -> 'benchmarkEntryId' = 'null'::jsonb
      or version_snapshot -> 'benchmarkDefinitionFingerprint' = 'null'::jsonb
    ) <> (
      version_snapshot -> 'benchmarkPackId' = 'null'::jsonb
      and version_snapshot -> 'benchmarkEntryId' = 'null'::jsonb
      and version_snapshot -> 'benchmarkDefinitionFingerprint' = 'null'::jsonb
    )
  then
    raise exception 'Task 9 current V2 benchmark identity is incomplete';
  end if;

  action_kinds := case
    when persisted_deal_status in ('screening', 'watchlist', 'evaluating') then
      case version_snapshot ->> 'beliefDirection'
        when 'positive' then array['advance_diligence']
        when 'mixed' then array['continue_monitoring']
        when 'negative' then array['deprioritize']
        when 'none' then array['no_new_action']
        when 'unavailable' then array['review_analysis_failure']
        else null
      end
    when persisted_deal_status = 'passed' then
      case version_snapshot ->> 'beliefDirection'
        when 'positive' then array['reopen_diligence']
        when 'mixed' then array['continue_monitoring']
        when 'negative' then array['deprioritize']
        when 'none' then array['no_new_action']
        when 'unavailable' then array['review_analysis_failure']
        else null
      end
    when persisted_deal_status = 'invested' then
      case version_snapshot ->> 'beliefDirection'
        when 'positive' then array['evaluate_follow_on']
        when 'mixed' then array['continue_monitoring']
        when 'negative' then array['pause_follow_on', 'portfolio_risk_review']
        when 'none' then array['no_new_action']
        when 'unavailable' then array['review_analysis_failure']
        else null
      end
    else null
  end;
  if action_kinds is null then
    raise exception 'Task 9 current V2 belief direction is invalid';
  end if;
  select jsonb_agg(jsonb_build_object(
    'kind', kind,
    'scope', case
      when kind = 'review_analysis_failure' then 'analysis'
      when kind in (
        'evaluate_follow_on', 'pause_follow_on', 'portfolio_risk_review'
      ) then 'portfolio'
      else 'deal'
    end,
    'priority', case
      when kind in ('pause_follow_on', 'portfolio_risk_review') then 'high'
      else 'standard'
    end,
    'visibility', 'internal_only'
  ) order by ordinal)
  into expected_actions
  from unnest(action_kinds) with ordinality as action(kind, ordinal);
  if version_snapshot -> 'canonicalActions' is distinct from expected_actions then
    raise exception 'Task 9 current V2 canonical action identity is invalid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fieldId', field_id,
    'label', replace(field_id, '_', ' '),
    'reasonCode', 'MISSING_CRITICAL_EVIDENCE',
    'mostLikelyDecisionImpact',
      'Providing accepted evidence may raise or lower the formal decision ceiling.'
  ) order by ordinal), '[]'::jsonb)
  into expected_missing
  from jsonb_array_elements_text(
    coalesce(coverage -> 'missingFieldIds', '[]'::jsonb)
  ) with ordinality as missing(field_id, ordinal);
  expected_formats := case
    when action_kinds && array['advance_diligence', 'reopen_diligence'] then
      array['internal_memo', 'founder_email', 'founder_sms',
        'founder_linkedin', 'diligence_request']
    when action_kinds && array['evaluate_follow_on'] then
      array['internal_memo', 'founder_email', 'diligence_request']
    else array['internal_memo']
  end;
  if jsonb_array_length(p_payload -> 'actionDrafts')
      <> cardinality(expected_formats)
    or exists (
      select 1 from unnest(expected_formats) as expected(format)
      where (
        select count(*) from jsonb_array_elements(p_payload -> 'actionDrafts') d
        where d ->> 'format' = expected.format
      ) <> 1
    )
  then
    raise exception 'Task 9 current V2 status-safe draft matrix is invalid';
  end if;

  select coalesce(string_agg('- ' || label, E'\n' order by ordinal),
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
  end if;

  for draft in select value from jsonb_array_elements(p_payload -> 'actionDrafts')
  loop
    if draft ->> 'schemaVersion' <> 'action-draft-v2'
      or draft ->> 'safety' <> 'status_safe'
      or draft ->> 'deliveryMode' <> 'draft_only'
      or draft ->> 'draftPolicyVersion' <> 'status-safe-action-draft-v2'
      or draft ->> 'actionPolicyVersion' <> 'belief-action-policy-v1'
      or draft ->> 'workspaceId' is distinct from p_workspace_id
      or draft ->> 'candidateRunId' is distinct from p_candidate_run_id
      or draft ->> 'dealStatus' is distinct from persisted_deal_status
      or draft ->> 'beliefDirection'
        is distinct from version_snapshot ->> 'beliefDirection'
      or draft -> 'actions' is distinct from expected_actions
      or draft -> 'missingEvidence' is distinct from expected_missing
    then
      raise exception 'Task 9 current V2 status-safe draft identity is invalid';
    end if;
    expected_body := null;
    compact_body := null;
    case draft ->> 'format'
      when 'internal_memo' then
        if draft ->> 'channel' <> 'internal'
          or draft ->> 'audienceType' <> 'internal'
          or split_part(draft ->> 'body', E'\n', 1)
            <> 'INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY'
        then
          raise exception 'Task 9 current V2 internal draft marker is invalid';
        end if;
      when 'founder_email' then
        expected_body := array_to_string(array[
          'Subject: Draft evidence follow-up',
          '',
          'DRAFT ONLY — NOT SENT',
          'Please share the following current evidence for review:',
          label_bullets,
          'This draft is limited to evidence collection and neutral sharing instructions.'
        ], E'\n');
        compact_body := array_to_string(array[
          'DRAFT ONLY — NOT SENT',
          'Please share the following current evidence for review:',
          label_bullets,
          'This draft is limited to evidence collection and neutral sharing instructions.'
        ], E'\n');
        if draft ->> 'channel' <> 'email'
          or draft ->> 'audienceType' <> 'founder'
          or draft ->> 'body' not in (expected_body, compact_body)
        then raise exception 'Task 9 current V2 external neutral template is invalid';
        end if;
      when 'founder_sms' then
        expected_body := 'DRAFT ONLY — NOT SENT. Please share current evidence for review: '
          || inline_labels || '.';
        if draft ->> 'channel' <> 'sms'
          or draft ->> 'audienceType' <> 'founder'
          or draft ->> 'body' <> expected_body
        then raise exception 'Task 9 current V2 external neutral template is invalid';
        end if;
      when 'founder_linkedin' then
        expected_body := 'DRAFT ONLY — NOT SENT' || E'\n'
          || 'Please share the following current evidence for review:' || E'\n'
          || label_bullets;
        if draft ->> 'channel' <> 'linkedin'
          or draft ->> 'audienceType' <> 'founder'
          or draft ->> 'body' <> expected_body
        then raise exception 'Task 9 current V2 external neutral template is invalid';
        end if;
      when 'diligence_request' then
        expected_body :=
          'DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT'
          || E'\n\n'
          || 'Please share the following current evidence for review:' || E'\n'
          || label_bullets || E'\n'
          || 'Please use a secure sharing method approved by your organization.';
        if draft ->> 'channel' <> 'email'
          or draft ->> 'audienceType' <> 'founder'
          or draft ->> 'body' <> expected_body
        then raise exception 'Task 9 current V2 external neutral template is invalid';
        end if;
      else raise exception 'Task 9 current V2 draft format is invalid';
    end case;
  end loop;

  if jsonb_array_length(scenario_model -> 'scenarios') <> 3
    or exists (
      select 1 from unnest(array['bear', 'base', 'bull']) name
      where (
        select count(*) from jsonb_array_elements(scenario_model -> 'scenarios') s
        where s ->> 'name' = name
      ) <> 1
    )
  then
    raise exception 'Task 9 current V2 scenario set is invalid';
  end if;
  for scenario in select value from jsonb_array_elements(scenario_model -> 'scenarios')
  loop
    if jsonb_typeof(scenario -> 'inputs') <> 'array'
      or jsonb_array_length(scenario -> 'inputs') <> 17
      or (
        select count(distinct item ->> 'field')
        from jsonb_array_elements(scenario -> 'inputs') item
        where item ->> 'field' = any(array[
          'revenue_path','arr_path','growth','gross_margin',
          'contribution_margin','operating_expenses','burn','cash','runway',
          'future_financing','future_dilution','exit_timing','exit_method',
          'exit_multiple','success_conditions','failure_conditions','probability'
        ]) and item ->> 'scenario' = scenario ->> 'name'
      ) <> 17
    then
      raise exception 'Task 9 current V2 scenario matrix is invalid';
    end if;
    for scenario_input in select value from jsonb_array_elements(scenario -> 'inputs')
    loop
      if (
          scenario_input -> 'value' = 'null'::jsonb
          and (
            scenario_input -> 'evidenceItemId' <> 'null'::jsonb
            or scenario_input -> 'assumptionItemId' <> 'null'::jsonb
            or nullif(btrim(scenario_input ->> 'unavailableReason'), '') is null
          )
        ) or (
          scenario_input -> 'value' <> 'null'::jsonb
          and (
            ((scenario_input -> 'evidenceItemId' <> 'null'::jsonb)::integer
              + (scenario_input -> 'assumptionItemId' <> 'null'::jsonb)::integer) <> 1
            or scenario_input -> 'unavailableReason' <> 'null'::jsonb
          )
        ) or (
          scenario_input -> 'evidenceItemId' <> 'null'::jsonb
          and not exists (
            select 1 from jsonb_array_elements(evidence_pack -> 'facts') fact
            where fact ->> 'id' = scenario_input ->> 'evidenceItemId'
          )
        ) or (
          scenario_input -> 'assumptionItemId' <> 'null'::jsonb
          and not exists (
            select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') assumption
            where assumption ->> 'id' = scenario_input ->> 'assumptionItemId'
          )
        )
      then
        raise exception 'Task 9 current V2 scenario lineage is invalid';
      end if;
    end loop;
  end loop;

  for calculation in
    select value from jsonb_array_elements(p_payload -> 'calculations')
  loop
    if calculation ->> 'status' <> 'completed'
      or calculation ->> 'formulaVersion' <> '1'
      or calculation ->> 'output' !~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
      or calculation ->> 'id' not like (
        'calculation:valuation:' || (evidence_pack ->> 'id') || ':'
          || (calculation ->> 'formulaId') || ':%'
      )
    then
      raise exception 'Task 9 current V2 authorized Calculation shape is invalid';
    end if;
    output_field := regexp_replace(calculation ->> 'id', '^.*:', '');
    for input_ref, input_ordinal in
      select value, ordinality
      from jsonb_array_elements(calculation -> 'inputRefs') with ordinality
    loop
      source_item := null;
      if input_ref ->> 'type' = 'fact' then
        select fact into source_item
        from jsonb_array_elements(evidence_pack -> 'facts') fact
        where fact ->> 'id' = input_ref ->> 'itemId';
        if source_item is null
          or source_item ->> 'value' is distinct from input_ref ->> 'value'
        then
          raise exception 'Task 9 Calculation Fact input value is not authoritative';
        end if;
      elsif input_ref ->> 'type' in ('assumption', 'benchmark') then
        select assumption into source_item
        from jsonb_array_elements(evidence_pack -> 'assumptions') assumption
        where assumption ->> 'id' = input_ref ->> 'itemId';
        if source_item is null
          or source_item ->> 'value' is distinct from input_ref ->> 'value'
          or (
            input_ref ->> 'type' = 'benchmark'
            and (
              source_item ->> 'provenanceOrigin' <> 'benchmark'
              or source_item -> 'inputRefIds'
                is distinct from jsonb_build_array(
                  version_snapshot ->> 'benchmarkPackId'
                )
            )
          )
        then
          raise exception 'Task 9 Calculation Assumption input value is not authoritative';
        end if;
      elsif input_ref ->> 'type' <> 'policy' then
        raise exception 'Task 9 Calculation input type is not authorized';
      end if;
    end loop;

    if calculation ->> 'formulaId' = 'market_comps_v1' then
      if output_field in ('bear_valuation', 'base_valuation', 'bull_valuation')
        and (
          jsonb_array_length(calculation -> 'inputRefs') <> 3
          or calculation -> 'inputRefs' -> 0 ->> 'type' <> 'benchmark'
          or calculation -> 'inputRefs' -> 1 ->> 'type' <> 'benchmark'
          or calculation -> 'inputRefs' -> 2 ->> 'type' <> 'assumption'
          or not exists (
            select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
            where a ->> 'id' = calculation -> 'inputRefs' -> 0 ->> 'itemId'
              and a ->> 'field' = 'compatible_benchmark_value'
              and a ->> 'scenario' = 'all'
              and a ->> 'provenanceOrigin' = 'benchmark'
          )
          or not exists (
            select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
            where a ->> 'id' = calculation -> 'inputRefs' -> 1 ->> 'itemId'
              and a ->> 'field' = 'compatible_benchmark_stale_after'
              and a ->> 'scenario' = 'all'
              and a ->> 'provenanceOrigin' = 'benchmark'
          )
          or not exists (
            select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
            where a ->> 'id' = calculation -> 'inputRefs' -> 2 ->> 'itemId'
              and a ->> 'field' = 'scenario_price_multiplier'
              and a ->> 'scenario' = split_part(output_field, '_', 1)
              and a ->> 'provenanceOrigin' = 'recommended_policy'
              and a -> 'inputRefIds' = jsonb_build_array(
                version_snapshot ->> 'fundPolicyId'
              )
          )
        )
      then
        raise exception 'Task 9 market scenario Calculation input order is invalid';
      elsif output_field = 'pricing_premium' and (
        jsonb_array_length(calculation -> 'inputRefs') <> 3
        or calculation -> 'inputRefs' -> 0 ->> 'type' <> 'fact'
        or calculation -> 'inputRefs' -> 1 ->> 'type' <> 'benchmark'
        or calculation -> 'inputRefs' -> 2 ->> 'type' <> 'benchmark'
        or not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'facts') f
          where f ->> 'id' = calculation -> 'inputRefs' -> 0 ->> 'itemId'
            and f ->> 'field' = 'reported_valuation'
            and (f ->> 'acceptedForGate')::boolean
        )
        or not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
          where a ->> 'id' = calculation -> 'inputRefs' -> 1 ->> 'itemId'
            and a ->> 'field' = 'compatible_benchmark_value'
            and a ->> 'scenario' = 'all'
            and a ->> 'provenanceOrigin' = 'benchmark'
            and a -> 'inputRefIds' = jsonb_build_array(
              version_snapshot ->> 'benchmarkPackId'
            )
        )
        or not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
          where a ->> 'id' = calculation -> 'inputRefs' -> 2 ->> 'itemId'
            and a ->> 'field' = 'compatible_benchmark_stale_after'
            and a ->> 'scenario' = 'all'
            and a ->> 'provenanceOrigin' = 'benchmark'
            and a -> 'inputRefIds' = jsonb_build_array(
              version_snapshot ->> 'benchmarkPackId'
            )
        )
      ) then
        raise exception 'Task 9 pricing-premium Calculation input order is invalid';
      end if;
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1' then
      if output_field = 'exit_equity_value' and not (
        jsonb_array_length(calculation -> 'inputRefs') = 2
        and exists (
          select 1
          from jsonb_array_elements(scenario_model -> 'scenarios') s,
            jsonb_array_elements(s -> 'inputs') scenario_value
          where s ->> 'name' = 'base'
            and scenario_value ->> 'field' = 'arr_path'
            and scenario_value ->> 'value'
              = calculation -> 'inputRefs' -> 0 ->> 'value'
            and (
              (
                calculation -> 'inputRefs' -> 0 ->> 'type' = 'fact'
                and scenario_value ->> 'evidenceItemId'
                  = calculation -> 'inputRefs' -> 0 ->> 'itemId'
              ) or (
                calculation -> 'inputRefs' -> 0 ->> 'type' = 'assumption'
                and scenario_value ->> 'assumptionItemId'
                  = calculation -> 'inputRefs' -> 0 ->> 'itemId'
              )
            )
        )
        and exists (
          select 1
          from jsonb_array_elements(scenario_model -> 'scenarios') s,
            jsonb_array_elements(s -> 'inputs') scenario_value
          where s ->> 'name' = 'base'
            and scenario_value ->> 'field' = 'exit_multiple'
            and scenario_value ->> 'value'
              = calculation -> 'inputRefs' -> 1 ->> 'value'
            and (
              (
                calculation -> 'inputRefs' -> 1 ->> 'type' = 'fact'
                and scenario_value ->> 'evidenceItemId'
                  = calculation -> 'inputRefs' -> 1 ->> 'itemId'
              ) or (
                calculation -> 'inputRefs' -> 1 ->> 'type' = 'assumption'
                and scenario_value ->> 'assumptionItemId'
                  = calculation -> 'inputRefs' -> 1 ->> 'itemId'
              )
            )
        )
      ) then
        raise exception 'Task 9 venture Calculation scenario inputs are invalid';
      elsif output_field = 'required_exit_proceeds' and not (
        jsonb_array_length(calculation -> 'inputRefs') = 2
        and calculation -> 'inputRefs' -> 0 ->> 'itemId'
          = 'policy:initialCheckMax'
        and calculation -> 'inputRefs' -> 1 ->> 'itemId'
          = ('policy:returnTargets.' || (context_snapshot ->> 'stage')
            || '.grossMoic')
      ) then
        raise exception 'Task 9 venture Calculation policy inputs are invalid';
      elsif output_field = 'required_post_dilution_ownership'
        and jsonb_array_length(calculation -> 'inputRefs') <> 0
      then raise exception 'Task 9 venture derived Calculation input is invalid';
      elsif output_field = 'required_initial_ownership' and not (
        jsonb_array_length(calculation -> 'inputRefs') = 1
        and calculation -> 'inputRefs' -> 0 ->> 'itemId'
          = 'policy:acceptableFutureDilution'
      ) then raise exception 'Task 9 venture dilution input is invalid';
      elsif output_field in (
        'maximum_acceptable_post_money', 'maximum_acceptable_pre_money'
      ) and not (
        jsonb_array_length(calculation -> 'inputRefs') = 1
        and calculation -> 'inputRefs' -> 0 ->> 'itemId'
          = 'policy:initialCheckMax'
      ) then raise exception 'Task 9 venture investment input is invalid';
      end if;
    elsif calculation ->> 'formulaId' = 'simple_pre_post_ownership_v1' then
      if jsonb_array_length(calculation -> 'inputRefs') <> 2
        or calculation -> 'inputRefs' -> 0 ->> 'itemId'
          <> 'policy:initialCheckMax'
        or not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'facts') f
          where f ->> 'id' = calculation -> 'inputRefs' -> 1 ->> 'itemId'
            and f ->> 'field' = 'reported_valuation'
            and (f ->> 'acceptedForGate')::boolean
        )
      then raise exception 'Task 9 ownership Calculation inputs are invalid';
      end if;
    elsif calculation ->> 'formulaId' = 'future_dilution_v1' then
      if jsonb_array_length(calculation -> 'inputRefs') <> 1
        or calculation -> 'inputRefs' -> 0 ->> 'itemId'
          <> 'policy:acceptableFutureDilution'
      then raise exception 'Task 9 future-dilution Calculation input is invalid';
      end if;
    elsif calculation ->> 'formulaId' = 'gross_deal_moic_v1' then
      if output_field = 'exit_proceeds'
        and jsonb_array_length(calculation -> 'inputRefs') <> 0
      then raise exception 'Task 9 exit-proceeds Calculation input is invalid';
      elsif output_field = 'gross_moic' and not (
        jsonb_array_length(calculation -> 'inputRefs') = 1
        and calculation -> 'inputRefs' -> 0 ->> 'itemId'
          = 'policy:initialCheckMax'
      ) then raise exception 'Task 9 gross-MOIC Calculation input is invalid';
      end if;
    elsif calculation ->> 'formulaId' = 'annualized_gross_irr_v1' then
      if output_field <> 'gross_irr'
        or jsonb_array_length(calculation -> 'inputRefs') <> 1
        or calculation -> 'inputRefs' -> 0 ->> 'itemId'
          <> ('policy:returnTargets.' || (context_snapshot ->> 'stage')
            || '.horizonYears')
      then raise exception 'Task 9 gross-IRR Calculation input is invalid';
      end if;
    end if;

    expected_dependency_suffixes := case
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        and output_field = 'required_post_dilution_ownership'
      then array[
        'venture_return_method_v1:required_exit_proceeds',
        'venture_return_method_v1:exit_equity_value'
      ]
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        and output_field = 'required_initial_ownership'
      then array['venture_return_method_v1:required_post_dilution_ownership']
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        and output_field = 'maximum_acceptable_post_money'
      then array['venture_return_method_v1:required_initial_ownership']
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        and output_field = 'maximum_acceptable_pre_money'
      then array['venture_return_method_v1:maximum_acceptable_post_money']
      when calculation ->> 'formulaId' = 'future_dilution_v1'
      then array['simple_pre_post_ownership_v1:initial_ownership']
      when calculation ->> 'formulaId' = 'gross_deal_moic_v1'
        and output_field = 'exit_proceeds'
      then array[
        'venture_return_method_v1:exit_equity_value',
        'future_dilution_v1:post_dilution_ownership'
      ]
      when calculation ->> 'formulaId' = 'gross_deal_moic_v1'
        and output_field = 'gross_moic'
      then array['gross_deal_moic_v1:exit_proceeds']
      when calculation ->> 'formulaId' = 'annualized_gross_irr_v1'
      then array['gross_deal_moic_v1:gross_moic']
      else array[]::text[]
    end;
    if (
        select count(*)
        from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
        where edge ->> 'claimItemId' = calculation ->> 'id'
      ) <> cardinality(expected_dependency_suffixes)
      or exists (
        select 1 from unnest(expected_dependency_suffixes) suffix
        where (
          select count(*)
          from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
          where edge ->> 'claimItemId' = calculation ->> 'id'
            and edge ->> 'dependencyType' = 'calculation'
            and edge ->> 'dependencyItemId' =
              'calculation:valuation:' || (evidence_pack ->> 'id') || ':'
                || suffix
        ) <> 1
      )
    then
      raise exception 'Task 9 Calculation dependency graph is not exact';
    end if;

    expected_unit := case
      when calculation ->> 'formulaId' = 'market_comps_v1'
        and output_field <> 'pricing_premium' then 'currency'
      when calculation ->> 'formulaId' = 'market_comps_v1' then 'decimal'
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        and output_field in (
          'exit_equity_value', 'required_exit_proceeds',
          'maximum_acceptable_post_money', 'maximum_acceptable_pre_money'
        ) then 'currency'
      when calculation ->> 'formulaId' = 'venture_return_method_v1'
        then 'decimal'
      when calculation ->> 'formulaId' = 'simple_pre_post_ownership_v1'
        and output_field = 'post_money' then 'currency'
      when calculation ->> 'formulaId' in (
        'simple_pre_post_ownership_v1', 'future_dilution_v1',
        'annualized_gross_irr_v1'
      ) then 'decimal'
      when calculation ->> 'formulaId' = 'gross_deal_moic_v1'
        and output_field = 'exit_proceeds' then 'currency'
      when calculation ->> 'formulaId' = 'gross_deal_moic_v1'
        then 'multiple'
      else null
    end;
    expected_currency := case
      when expected_unit <> 'currency' then null
      when calculation ->> 'formulaId' = 'market_comps_v1' then (
        select assumption ->> 'unit'
        from jsonb_array_elements(evidence_pack -> 'assumptions') assumption
        where assumption ->> 'id'
          = calculation -> 'inputRefs' -> 0 ->> 'itemId'
      )
      else fund_policy_values ->> 'baseCurrency'
    end;
    expected_period := case
      when calculation ->> 'formulaId' = 'market_comps_v1'
        and output_field in ('bear_valuation', 'base_valuation', 'bull_valuation')
      then split_part(output_field, '_', 1)
      when calculation ->> 'formulaId' = 'annualized_gross_irr_v1'
      then calculation -> 'inputRefs' -> 0 ->> 'value'
      else null
    end;
    if expected_unit is null
      or calculation ->> 'analysisType' <> 'calculation'
      or calculation ->> 'roundingPolicy' <> 'half_even_display_only'
      or nullif(btrim(calculation ->> 'computedAt'), '') is null
      or calculation ->> 'computedAt'
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(?:Z|[+-][0-9]{2}:[0-9]{2})$'
      or calculation ->> 'unit' is distinct from expected_unit
      or calculation ->> 'currency' is distinct from expected_currency
      or calculation ->> 'period' is distinct from expected_period
    then
      raise exception 'Task 9 Calculation output metadata is invalid';
    end if;

    select array_agg((ref_value ->> 'value')::numeric order by ordinal)
    into input_numbers
    from jsonb_array_elements(calculation -> 'inputRefs')
      with ordinality as refs(ref_value, ordinal)
    where ref_value ->> 'value'
      ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$';
    expected_number := null;
    first_dependency := null;
    second_dependency := null;

    if calculation ->> 'formulaId' = 'market_comps_v1'
      and output_field in ('bear_valuation', 'base_valuation', 'bull_valuation')
      and cardinality(input_numbers) >= 2
    then
      expected_number := input_numbers[1]
        * input_numbers[cardinality(input_numbers)];
    elsif calculation ->> 'formulaId' = 'market_comps_v1'
      and output_field = 'pricing_premium'
      and cardinality(input_numbers) >= 2
    then
      expected_number := input_numbers[1] / input_numbers[2] - 1;
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1'
      and output_field in ('exit_equity_value', 'required_exit_proceeds')
      and cardinality(input_numbers) = 2
    then
      expected_number := input_numbers[1] * input_numbers[2];
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1'
      and output_field = 'required_post_dilution_ownership'
    then
      select max(case when dependency ->> 'id' like '%:required_exit_proceeds'
          then (dependency ->> 'output')::numeric end),
        max(case when dependency ->> 'id' like '%:exit_equity_value'
          then (dependency ->> 'output')::numeric end)
      into first_dependency, second_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id';
      if first_dependency is not null and second_dependency is not null then
        expected_number := first_dependency / second_dependency;
      end if;
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1'
      and output_field = 'required_initial_ownership'
      and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:required_post_dilution_ownership';
      expected_number := first_dependency / (1 - input_numbers[1]);
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1'
      and output_field = 'maximum_acceptable_post_money'
      and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:required_initial_ownership';
      expected_number := input_numbers[1] / first_dependency;
    elsif calculation ->> 'formulaId' = 'venture_return_method_v1'
      and output_field = 'maximum_acceptable_pre_money'
      and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:maximum_acceptable_post_money';
      expected_number := first_dependency - input_numbers[1];
    elsif calculation ->> 'formulaId' = 'simple_pre_post_ownership_v1'
      and output_field = 'post_money' and cardinality(input_numbers) = 2
    then
      expected_number := input_numbers[1] + input_numbers[2];
    elsif calculation ->> 'formulaId' = 'simple_pre_post_ownership_v1'
      and output_field = 'initial_ownership' and cardinality(input_numbers) = 2
    then
      expected_number := input_numbers[1]
        / (input_numbers[1] + input_numbers[2]);
    elsif calculation ->> 'formulaId' = 'future_dilution_v1'
      and output_field = 'post_dilution_ownership'
      and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:initial_ownership';
      expected_number := first_dependency * (1 - input_numbers[1]);
    elsif calculation ->> 'formulaId' = 'gross_deal_moic_v1'
      and output_field = 'exit_proceeds'
    then
      select max(case when dependency ->> 'id' like '%:exit_equity_value'
          then (dependency ->> 'output')::numeric end),
        max(case when dependency ->> 'id' like '%:post_dilution_ownership'
          then (dependency ->> 'output')::numeric end)
      into first_dependency, second_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id';
      expected_number := first_dependency * second_dependency;
    elsif calculation ->> 'formulaId' = 'gross_deal_moic_v1'
      and output_field = 'gross_moic' and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:exit_proceeds';
      expected_number := first_dependency / input_numbers[1];
    elsif calculation ->> 'formulaId' = 'annualized_gross_irr_v1'
      and output_field = 'gross_irr' and cardinality(input_numbers) = 1
    then
      select (dependency ->> 'output')::numeric
      into first_dependency
      from jsonb_array_elements(p_payload -> 'calculationClaimEdges') edge
      join jsonb_array_elements(p_payload -> 'calculations') dependency
        on dependency ->> 'id' = edge ->> 'dependencyItemId'
      where edge ->> 'claimItemId' = calculation ->> 'id'
        and dependency ->> 'id' like '%:gross_moic';
      expected_number := power(first_dependency, 1 / input_numbers[1]) - 1;
    end if;

    if expected_number is null
      or abs((calculation ->> 'output')::numeric - expected_number)
        > greatest(1, abs(expected_number)) * 1e-18::numeric
    then
      raise exception 'Task 9 authorized Calculation output failed recomputation';
    end if;
  end loop;

  select coalesce(jsonb_agg(formula_version order by formula_version), '[]'::jsonb)
  into actual_formula_versions
  from (
    select distinct (calc_row ->> 'formulaId') || '@'
      || (calc_row ->> 'formulaVersion') as formula_version
    from jsonb_array_elements(p_payload -> 'calculations') calc_row
  ) versions;
  if version_snapshot -> 'formulaVersions' is distinct from actual_formula_versions then
    raise exception 'Task 9 current V2 calculation formula lineage is invalid';
  end if;
  if valuation -> 'currentAsk' <> 'null'::jsonb
    and not exists (
      select 1 from jsonb_array_elements(evidence_pack -> 'facts') fact
      where fact ->> 'field' = 'reported_valuation'
        and (fact ->> 'acceptedForGate')::boolean
        and fact ->> 'value' = valuation ->> 'currentAsk'
    )
  then
    raise exception 'Task 9 current V2 valuation Fact lineage is invalid';
  end if;
  foreach valuation_scalar in array array[
    valuation ->> 'maximumAcceptablePreMoney',
    valuation ->> 'initialOwnership', valuation ->> 'postDilutionOwnership',
    valuation ->> 'grossMoic', valuation ->> 'grossIrr',
    valuation ->> 'pricingPremium'
  ]
  loop
    if valuation_scalar is not null and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'calculations') calc_row
      where calc_row ->> 'id' in (
        select jsonb_array_elements_text(valuation -> 'calculationIds')
      ) and calc_row ->> 'status' = 'completed'
        and calc_row ->> 'output' = valuation_scalar
    ) then
      raise exception 'Task 9 current V2 valuation Calculation lineage is invalid';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(valuation -> 'scenarios') result
    where result -> 'valuation' <> 'null'::jsonb and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'calculations') calc_row
      where calc_row ->> 'id' in (
        select jsonb_array_elements_text(result -> 'calculationIds')
      ) and calc_row ->> 'status' = 'completed'
        and calc_row ->> 'formulaId' = 'market_comps_v1'
        and calc_row ->> 'id' like (
          '%:' || (result ->> 'name') || '_valuation'
        )
        and calc_row ->> 'output' = result ->> 'valuation'
    )
  ) then
    raise exception 'Task 9 current V2 scenario valuation lineage is invalid';
  end if;
  if jsonb_array_length(valuation -> 'scenarios') <> 3
    or exists (
      select 1 from unnest(array['bear', 'base', 'bull']) scenario_name
      where (
        select count(*) from jsonb_array_elements(valuation -> 'scenarios') s
        where s ->> 'name' = scenario_name
      ) <> 1
    )
    or exists (
      select 1 from jsonb_array_elements(valuation -> 'scenarios') result
      where (
        result -> 'valuation' = 'null'::jsonb
        and jsonb_array_length(result -> 'calculationIds') <> 0
      ) or (
        result -> 'valuation' <> 'null'::jsonb
        and (
          jsonb_array_length(result -> 'calculationIds') <> 1
          or result -> 'calculationIds' ->> 0 is distinct from (
            'calculation:valuation:' || (evidence_pack ->> 'id')
              || ':market_comps_v1:' || (result ->> 'name') || '_valuation'
          )
        )
      )
    )
  then
    raise exception 'Task 9 valuation scenario matrix is ambiguous';
  end if;
  if (
      select count(*) from jsonb_array_elements_text(
        valuation -> 'calculationIds'
      ) calculation_id
    ) <> (
      select count(distinct calculation_id)
      from jsonb_array_elements_text(
        valuation -> 'calculationIds'
      ) calculation_id
    ) or exists (
      select 1 from jsonb_array_elements_text(
        valuation -> 'calculationIds'
      ) calculation_id
      where not exists (
        select 1 from jsonb_array_elements(p_payload -> 'calculations') c
        where c ->> 'id' = calculation_id
      )
    ) or exists (
      select 1 from jsonb_array_elements(valuation -> 'scenarios') result,
        jsonb_array_elements_text(result -> 'calculationIds') calculation_id
      where not (valuation -> 'calculationIds' ? calculation_id)
        or not exists (
          select 1 from jsonb_array_elements(p_payload -> 'calculations') c
          where c ->> 'id' = calculation_id
        )
    )
  then
    raise exception 'Task 9 valuation Calculation reference is dangling';
  end if;
  for valuation_field, valuation_formula, valuation_output_field in
    select * from (values
      ('maximumAcceptablePreMoney', 'venture_return_method_v1',
        'maximum_acceptable_pre_money'),
      ('initialOwnership', 'simple_pre_post_ownership_v1',
        'initial_ownership'),
      ('postDilutionOwnership', 'future_dilution_v1',
        'post_dilution_ownership'),
      ('grossMoic', 'gross_deal_moic_v1', 'gross_moic'),
      ('grossIrr', 'annualized_gross_irr_v1', 'gross_irr'),
      ('pricingPremium', 'market_comps_v1', 'pricing_premium')
    ) as binding(field_name, formula_id, output_name)
  loop
    valuation_scalar := valuation ->> valuation_field;
    if valuation_scalar is not null and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'calculations') calc_row
      where calc_row ->> 'id' in (
        select jsonb_array_elements_text(valuation -> 'calculationIds')
      ) and calc_row ->> 'formulaId' = valuation_formula
        and calc_row ->> 'id' like ('%:' || valuation_output_field)
        and calc_row ->> 'output' = valuation_scalar
    ) then
      raise exception 'Task 9 valuation field has the wrong Calculation lineage';
    end if;
  end loop;

  if (
      not coalesce((coverage ->> 'minimumModelInputsComplete')::boolean, false)
      or coverage ->> 'underwritingStatus' = 'unavailable'
      or (
        context_snapshot ->> 'analysisMode' = 'core_only'
        and context_snapshot ->> 'geography' = 'unavailable'
      )
    ) and (
      decision_result ->> 'companyQuality' <> 'unavailable'
      or decision_result ->> 'priceAttractiveness' <> 'unavailable'
      or decision_result ->> 'fundFit' <> 'unavailable'
      or decision_result -> 'decision' <> 'null'::jsonb
      or decision_result -> 'decisionCeiling' <> 'null'::jsonb
      or coalesce((decision_result ->> 'hardVeto')::boolean, true)
      or decision_result ->> 'confidence' <> 'low'
    )
  then
    raise exception 'Task 9 unavailable terminal decision is invalid';
  end if;

  if context_snapshot ->> 'analysisMode' = 'core_only'
    and context_snapshot ->> 'geography' = 'unavailable'
    and (
      valuation ->> 'status' <> 'unavailable'
      or jsonb_array_length(p_payload -> 'calculations') <> 0
      or jsonb_array_length(p_payload -> 'calculationClaimEdges') <> 0
      or jsonb_array_length(valuation -> 'calculationIds') <> 0
      or valuation -> 'currentAsk' <> 'null'::jsonb
      or valuation -> 'maximumAcceptablePreMoney' <> 'null'::jsonb
      or valuation -> 'initialOwnership' <> 'null'::jsonb
      or valuation -> 'postDilutionOwnership' <> 'null'::jsonb
      or valuation -> 'grossMoic' <> 'null'::jsonb
      or valuation -> 'grossIrr' <> 'null'::jsonb
      or valuation -> 'pricingPremium' <> 'null'::jsonb
      or exists (
        select 1 from jsonb_array_elements(valuation -> 'scenarios') result
        where result -> 'valuation' <> 'null'::jsonb
          or jsonb_array_length(result -> 'calculationIds') <> 0
      )
    )
  then
    raise exception 'Task 9 unavailable terminal valuation is invalid';
  end if;

  if context_snapshot ->> 'analysisMode' = 'core_only' then
    if coverage ->> 'decisionCeiling' = 'Invest Candidate'
      or decision_result ->> 'decision' = 'Invest Candidate'
      or decision_result ->> 'decisionCeiling' = 'Invest Candidate'
    then
      raise exception 'Task 9 Core-only decision exceeds the terminal ceiling';
    end if;
    if coalesce((coverage ->> 'minimumModelInputsComplete')::boolean, false)
      and not (coverage -> 'reasonCodes' ? 'CORE_ONLY_ANALYSIS_CEILING')
    then
      raise exception 'Task 9 Core-only coverage ceiling reason is missing';
    end if;
  end if;

  if (
    select count(*) from jsonb_array_elements(p_payload -> 'judgments') j
    where not (j ? 'frameworkMetadata')
  ) <> 8 or exists (
    select 1 from generate_series(1, 8) ordinal
    where (
      select count(*) from jsonb_array_elements(p_payload -> 'judgments') j
      where not (j ? 'frameworkMetadata')
        and j ->> 'frameworkCardId'
          = 'framework_card_synthetic_' || ordinal || '_v1'
        and j ->> 'frameworkVersion' = '1'
    ) <> 1
  ) then
    raise exception 'Task 9 current V2 formal framework catalog is invalid';
  end if;

  for judgment in
    select value from jsonb_array_elements(p_payload -> 'judgments') item
  loop
    if (
        select count(*)
        from (
          select jsonb_array_elements_text(
            judgment -> 'supportEvidenceItemIds'
          ) as evidence_id
          union all
          select jsonb_array_elements_text(
            judgment -> 'counterEvidenceItemIds'
          )
          union all
          select jsonb_array_elements_text(
            judgment -> 'unusedEvidenceItemIds'
          )
        ) partition_items
      ) <> (
        jsonb_array_length(evidence_pack -> 'facts')
        + jsonb_array_length(evidence_pack -> 'assumptions')
        + case when judgment ->> 'frameworkCardId'
            = 'framework_card_synthetic_8_v1'
          then jsonb_array_length(p_payload -> 'calculations') else 0 end
      ) or (
        select count(distinct evidence_id)
        from (
          select jsonb_array_elements_text(
            judgment -> 'supportEvidenceItemIds'
          ) as evidence_id
          union all
          select jsonb_array_elements_text(
            judgment -> 'counterEvidenceItemIds'
          )
          union all
          select jsonb_array_elements_text(
            judgment -> 'unusedEvidenceItemIds'
          )
        ) partition_items
      ) <> (
        jsonb_array_length(evidence_pack -> 'facts')
        + jsonb_array_length(evidence_pack -> 'assumptions')
        + case when judgment ->> 'frameworkCardId'
            = 'framework_card_synthetic_8_v1'
          then jsonb_array_length(p_payload -> 'calculations') else 0 end
      ) or exists (
        select 1
        from (
          select jsonb_array_elements_text(
            judgment -> 'supportEvidenceItemIds'
          ) as evidence_id
          union all
          select jsonb_array_elements_text(
            judgment -> 'counterEvidenceItemIds'
          )
          union all
          select jsonb_array_elements_text(
            judgment -> 'unusedEvidenceItemIds'
          )
        ) partition_items
        where not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'facts') fact
          where fact ->> 'id' = partition_items.evidence_id
        ) and not exists (
          select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
          where a ->> 'id' = partition_items.evidence_id
        ) and not (
          judgment ->> 'frameworkCardId' = 'framework_card_synthetic_8_v1'
          and exists (
            select 1 from jsonb_array_elements(p_payload -> 'calculations') c
            where c ->> 'id' = partition_items.evidence_id
          )
        )
      )
    then
      raise exception 'Task 9 formal framework evidence partition is invalid';
    end if;

    if (
        judgment ->> 'applicability' <> 'applicable'
        and (
          judgment ->> 'conclusion' <> 'abstain'
          or jsonb_array_length(judgment -> 'supportEvidenceItemIds') <> 0
          or jsonb_array_length(judgment -> 'counterEvidenceItemIds') <> 0
          or judgment -> 'strongestSupport' <> 'null'::jsonb
          or judgment -> 'strongestCounterargument' <> 'null'::jsonb
          or judgment -> 'confidence' is distinct from jsonb_build_object(
            'sourceReliability','low','evidenceStrength','low',
            'evidenceCoverage','low','applicability','low','judgment','low'
          )
        )
      ) or (
        judgment ->> 'applicability' = 'applicable'
        and (
          judgment ->> 'conclusion' = 'abstain'
          or jsonb_array_length(judgment -> 'supportEvidenceItemIds') = 0
          or jsonb_array_length(judgment -> 'counterEvidenceItemIds') = 0
          or judgment -> 'strongestSupport' = 'null'::jsonb
          or judgment -> 'strongestCounterargument' = 'null'::jsonb
        )
      ) or judgment ->> 'conclusion' not in (
        'supportive', 'mixed', 'negative', 'abstain'
      ) or judgment ->> 'applicability' not in (
        'applicable', 'not_applicable', 'unavailable'
      ) or (
        select count(*) from jsonb_object_keys(judgment -> 'confidence')
      ) <> 5
      or exists (
        select 1 from jsonb_each_text(judgment -> 'confidence') confidence
        where confidence.value not in ('low', 'medium', 'high')
      )
    then
      raise exception 'Task 9 formal framework conclusion or confidence is invalid';
    end if;

    if jsonb_array_length(judgment -> 'claimEdges')
        <> jsonb_array_length(judgment -> 'supportEvidenceItemIds')
          + jsonb_array_length(judgment -> 'counterEvidenceItemIds') + 1
      or (
        select count(*) from jsonb_array_elements(judgment -> 'claimEdges') e
        where e ->> 'claimItemId' = judgment ->> 'id'
          and e ->> 'dependencyType' = 'framework_ref'
          and e ->> 'dependencyItemId' = judgment ->> 'frameworkCardId'
      ) <> 1
      or exists (
        select 1 from (
          select jsonb_array_elements_text(
            judgment -> 'supportEvidenceItemIds'
          ) as evidence_id
          union all
          select jsonb_array_elements_text(
            judgment -> 'counterEvidenceItemIds'
          )
        ) used
        where (
          select count(*) from jsonb_array_elements(judgment -> 'claimEdges') e
          where e ->> 'claimItemId' = judgment ->> 'id'
            and e ->> 'dependencyItemId' = used.evidence_id
            and e ->> 'dependencyType' = case
              when exists (
                select 1 from jsonb_array_elements(evidence_pack -> 'facts') f
                where f ->> 'id' = used.evidence_id
              ) then 'fact'
              when exists (
                select 1 from jsonb_array_elements(
                  evidence_pack -> 'assumptions'
                ) a where a ->> 'id' = used.evidence_id
              ) then 'assumption'
              else 'calculation'
            end
        ) <> 1
      )
    then
      raise exception 'Task 9 formal framework claim-edge lineage is invalid';
    end if;
  end loop;

  if (
      select count(*) from jsonb_array_elements(p_payload -> 'disagreements') d
    ) <> (
      select count(distinct d ->> 'id')
      from jsonb_array_elements(p_payload -> 'disagreements') d
    ) or exists (
      select 1 from jsonb_array_elements(p_payload -> 'disagreements') d
      where (
        select count(*) from jsonb_object_keys(d)
      ) <> 6
        or nullif(btrim(d ->> 'id'), '') is null
        or nullif(btrim(d ->> 'leftJudgmentId'), '') is null
        or nullif(btrim(d ->> 'rightJudgmentId'), '') is null
        or d ->> 'leftJudgmentId' = d ->> 'rightJudgmentId'
        or d ->> 'topic' not in (
          'growth_vs_revenue_quality', 'fde_moat_vs_services_burden',
          'tam_vs_willingness_to_pay', 'company_quality_vs_price',
          'contrarian_insight_vs_adoption',
          'independent_framework_conflict'
        )
        or nullif(btrim(d ->> 'explanation'), '') is null
        or jsonb_typeof(d -> 'evidenceItemIds') <> 'array'
        or not exists (
          select 1 from jsonb_array_elements(p_payload -> 'judgments') j
          where j ->> 'id' = d ->> 'leftJudgmentId'
        )
        or not exists (
          select 1 from jsonb_array_elements(p_payload -> 'judgments') j
          where j ->> 'id' = d ->> 'rightJudgmentId'
        )
        or exists (
          select 1 from jsonb_array_elements_text(d -> 'evidenceItemIds') id
          where nullif(btrim(id), '') is null
            or not exists (
              select 1 from jsonb_array_elements(evidence_pack -> 'facts') f
              where f ->> 'id' = id
            ) and not exists (
              select 1 from jsonb_array_elements(evidence_pack -> 'assumptions') a
              where a ->> 'id' = id
            ) and not exists (
              select 1 from jsonb_array_elements(p_payload -> 'calculations') c
              where c ->> 'id' = id
            )
        )
    ) or exists (
      select 1
      from jsonb_array_elements(p_payload -> 'disagreements') left_d,
        jsonb_array_elements(p_payload -> 'disagreements') right_d
      where left_d ->> 'id' < right_d ->> 'id'
        and left_d ->> 'leftJudgmentId' = right_d ->> 'leftJudgmentId'
        and left_d ->> 'rightJudgmentId' = right_d ->> 'rightJudgmentId'
        and left_d ->> 'topic' = right_d ->> 'topic'
    )
  then
    raise exception 'Task 9 framework disagreement shape or lineage is invalid';
  end if;

  if context_snapshot ->> 'analysisMode' = 'core_only'
    and context_snapshot ->> 'geography' = 'unavailable'
  then
    if jsonb_array_length(p_payload -> 'disagreements') <> 0 then
      raise exception 'Task 9 unavailable terminal disagreement set is invalid';
    end if;
    for judgment in select value from jsonb_array_elements(p_payload -> 'judgments')
    loop
      if judgment ->> 'applicability' <> 'unavailable'
        or judgment ->> 'conclusion' <> 'abstain'
        or jsonb_array_length(judgment -> 'supportEvidenceItemIds') <> 0
        or jsonb_array_length(judgment -> 'counterEvidenceItemIds') <> 0
        or judgment -> 'strongestSupport' <> 'null'::jsonb
        or judgment -> 'strongestCounterargument' <> 'null'::jsonb
        or judgment -> 'unusedEvidenceItemIds' is distinct from (
          select coalesce(jsonb_agg(evidence_id order by evidence_id), '[]'::jsonb)
          from (
            select fact ->> 'id' as evidence_id
            from jsonb_array_elements(evidence_pack -> 'facts') fact
            union
            select assumption ->> 'id' as evidence_id
            from jsonb_array_elements(evidence_pack -> 'assumptions') assumption
          ) evidence
        )
        or not exists (
          select 1 from jsonb_array_elements_text(judgment -> 'limitations') item
          where item ~* 'geograph|core-only'
        )
        or judgment -> 'confidence' is distinct from jsonb_build_object(
          'sourceReliability','low','evidenceStrength','low',
          'evidenceCoverage','low','applicability','low','judgment','low'
        )
        or jsonb_array_length(judgment -> 'claimEdges') <> 1
        or judgment -> 'claimEdges' -> 0 is distinct from jsonb_build_object(
          'claimItemId', judgment ->> 'id',
          'dependencyItemId', judgment ->> 'frameworkCardId',
          'dependencyType', 'framework_ref'
        )
      then
        raise exception 'Task 9 unavailable terminal framework abstention is invalid';
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.assert_task9_current_finalization(
  jsonb, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.assert_task9_current_finalization(
  jsonb, text, text, text
) to vsee_underwriting_owner;

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
  reusable public.candidate_runs%rowtype;
  target_fingerprint text := btrim(
    p_payload ->> 'candidateAnalysisFingerprint'
  );
  build_input_fingerprint text := btrim(
    p_payload ->> 'evidencePackBuildInputFingerprint'
  );
  evidence_pack jsonb := p_payload -> 'evidencePack';
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
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'A canonical candidate fingerprint is required';
  end if;

  select source.* into reusable
  from public.candidate_runs as source
  where source.workspace_id = target.workspace_id
    and source.id = target.rerun_of_id
    and source.deal_id = target.deal_id
    and source.status = 'completed'
    and source.candidate_analysis_fingerprint = target_fingerprint
    and source.artifact_source_candidate_run_id is null
  for key share;

  if found then
    update public.candidate_runs
    set status = 'completed',
        candidate_analysis_fingerprint = target_fingerprint,
        artifact_source_candidate_run_id = reusable.id,
        finalized_at = now(),
        worker_id = null,
        lease_token = null,
        lease_expires_at = null
    where workspace_id = target.workspace_id
      and id = target.id
    returning * into target;
    perform public.refresh_underwriting_batch_status(target.batch_id);
    return jsonb_build_object(
      'id', target.id,
      'batchId', target.batch_id,
      'workspaceId', target.workspace_id,
      'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint', target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', public.canonical_utc_iso_milliseconds(target.finalized_at)
    );
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
  from public.evidence_pack_builds as build
  where build.workspace_id = target.workspace_id
    and build.input_fingerprint = build_input_fingerprint
    and build.pack_id = evidence_pack ->> 'id'
    and build.pack_payload = evidence_pack
  for key share;
  if not found then
    raise exception
      'Non-reuse finalization requires the exact immutable Evidence Pack build';
  end if;

  perform public.assert_task9_current_finalization(
    p_payload, target.workspace_id, target.id, target.deal_id
  );
  return public.finalize_candidate_underwriting(p_payload);
end;
$$;

revoke all on function public.finalize_or_reuse_candidate_underwriting(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.finalize_or_reuse_candidate_underwriting(jsonb)
  to service_role;
revoke all on function public.finalize_candidate_underwriting(jsonb)
  from service_role;

select public.finish_isolated_owner_0021(
  'vsee_underwriting_owner', true
);

commit;

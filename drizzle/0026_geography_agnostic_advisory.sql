begin;

-- Task 9 correctly kept valuation, benchmark, and the deterministic formal
-- decision fail-closed when Deal geography is unavailable. Its final special
-- case was broader than that contract, however: it also forced every audited
-- zero-weight named advisory judgment to abstain, including Cards whose
-- immutable applicability explicitly says `all` geographies. The generic
-- judgment and disagreement validators immediately above this special case
-- already validate evidence partitions, confidence, claim edges, and exact
-- judgment identities. Narrow only the final core-only assertion to the eight
-- formal product-owned lenses. Named advisory Cards remain controlled by their
-- audited four-dimensional applicability and still cannot affect the formal
-- decision.
do $geography_agnostic_advisory_0026$
declare
  function_identity regprocedure :=
    'public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure;
  definition text;
  without_disagreement_ban text;
  rewritten text;
  disagreement_fragment text :=
    '    if jsonb_array_length(p_payload -> ''disagreements'') <> 0 then' || chr(10)
    || '      raise exception ''Task 9 unavailable terminal disagreement set is invalid'';' || chr(10)
    || '    end if;' || chr(10);
  broad_loop_fragment text :=
    '    for judgment in select value from jsonb_array_elements(p_payload -> ''judgments'')' || chr(10)
    || '    loop';
  core_loop_fragment text :=
    '    for judgment in' || chr(10)
    || '      select value' || chr(10)
    || '      from jsonb_array_elements(p_payload -> ''judgments'')' || chr(10)
    || '      where not (value ? ''frameworkMetadata'')' || chr(10)
    || '    loop';
begin
  select pg_catalog.pg_get_functiondef(function_identity)
  into strict definition;
  without_disagreement_ban := pg_catalog.replace(
    definition,
    disagreement_fragment,
    ''
  );
  if without_disagreement_ban = definition then
    raise exception 'VSEE_0026_DISAGREEMENT_REWRITE_FAILED'
      using errcode = '55000';
  end if;
  rewritten := pg_catalog.replace(
    without_disagreement_ban,
    broad_loop_fragment,
    core_loop_fragment
  );
  if rewritten = without_disagreement_ban
    or pg_catalog.strpos(
      rewritten,
      'Task 9 unavailable terminal disagreement set is invalid'
    ) <> 0
    or pg_catalog.strpos(
      rewritten,
      'where not (value ? ''frameworkMetadata'')'
    ) = 0
  then
    raise exception 'VSEE_0026_FORMAL_LENS_BOUNDARY_REWRITE_FAILED'
      using errcode = '55000';
  end if;
  execute rewritten;
end;
$geography_agnostic_advisory_0026$;

commit;

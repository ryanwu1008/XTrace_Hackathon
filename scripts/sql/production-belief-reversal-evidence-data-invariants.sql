-- Read-only invariants for the complete 0019 evidence-context stage.
-- The guarded launchers execute this file only after the full 0019 sentinel;
-- pre-0019 catalogs must never parse or reference these relations.
select
  not exists (
    select 1
    from public.market_evidence_snapshots as snapshot
    left join lateral (
      select
        count(*)::integer as child_count,
        array_agg(event.ordinal order by event.ordinal) as ordinals,
        bool_and(
          event.payload ->> 'id' = event.event_id
          and event.payload ->> 'contentFingerprint'
            = event.event_content_fingerprint
          and event.payload ->> 'publishedAt' = event.published_value
          and event.payload ->> 'publishedAtPrecision'
            = event.published_precision
          and public.evidence_event_in_window_0019(
            event.published_value,
            event.published_precision,
            snapshot.window_start_at,
            snapshot.window_end_at,
            snapshot.window_timezone
          )
        ) as payloads_valid
      from public.market_evidence_snapshot_events as event
      where event.workspace_id = snapshot.workspace_id
        and event.snapshot_id = snapshot.id
    ) as children on true
    where children.child_count <> snapshot.event_count
      or children.ordinals is distinct from (
        select array_agg(value)
        from generate_series(0, snapshot.event_count - 1) as value
      )
      or children.payloads_valid is distinct from true
  )
  and not exists (
    select 1
    from public.run_evidence_bindings as binding
    join public.scan_runs as run
      on run.workspace_id = binding.workspace_id
      and run.id = binding.run_id
    left join lateral (
      select
        count(*)::integer as child_count,
        array_agg(event.ordinal order by event.ordinal) as ordinals,
        bool_and(
          event.payload ->> 'id' = event.event_id
          and event.payload ->> 'contentFingerprint'
            = event.event_content_fingerprint
          and event.payload ->> 'publishedAt' = event.published_value
          and event.payload ->> 'publishedAtPrecision'
            = event.published_precision
        ) as payloads_valid
      from public.run_market_events as event
      where event.workspace_id = binding.workspace_id
        and event.run_id = binding.run_id
    ) as children on true
    where binding.evidence_context_fingerprint
        <> run.evidence_context_fingerprint
      or binding.evidence_mode <> run.evidence_mode
      or binding.snapshot_id is distinct from run.evidence_snapshot_id
      or binding.snapshot_fingerprint
        is distinct from run.evidence_snapshot_fingerprint
      or children.child_count <> binding.event_count
      or children.ordinals is distinct from (
        select array_agg(value)
        from generate_series(0, binding.event_count - 1) as value
      )
      or (
        binding.event_count > 0
        and children.payloads_valid is distinct from true
      )
  )
  and not exists (
    select 1
    from public.intelligence_reports as report
    left join public.run_evidence_bindings as binding
      on binding.workspace_id = report.workspace_id
      and binding.run_id = report.run_id
      and binding.binding_fingerprint = report.evidence_binding_fingerprint
    where report.evidence_context_version is not null
      and (
        binding.run_id is null
        or report.evidence_context_fingerprint
          <> binding.evidence_context_fingerprint
        or report.evidence_event_set_fingerprint
          <> binding.event_set_fingerprint
        or report.evidence_event_count <> binding.event_count
      )
  )
  and not exists (
    select 1
    from public.company_analyses as analysis
    join public.intelligence_reports as report
      on report.workspace_id = analysis.workspace_id
      and report.id = analysis.report_id
    left join public.deals as deal
      on deal.workspace_id = analysis.workspace_id
      and deal.id = analysis.deal_id
    where analysis.belief_assessment_version is not null
      and (
        report.evidence_context_version is null
        or deal.id is null
        or deal.status <> analysis.deal_status
      )
  );

-- Migration 0001: Rename "beat" → "step", "canvas_key" → "phase_key", value "analyse" → "draft"
--
-- Context: Internal vocabulary cleanup. The product hierarchy is Phase → Step
-- (formerly Canvas → Beat). The step name "analyse" inside the phase named
-- "analysis" was a tongue-twister; renamed to "draft" to match the actual
-- artefact (analysis_drafts table).
--
-- URL paths (/api/sub-step/...) and the table name (sub_steps) deliberately
-- stay — renaming them would force URL/migration churn for marginal gain.
--
-- Apply order matters: rename columns FIRST, then update values. Code deploy
-- must follow this migration; old code with new schema will break on
-- column-name mismatch.
--
-- Rollback (if needed):
--   UPDATE sub_steps SET step = 'analyse' WHERE step = 'draft';
--   ALTER TABLE sub_steps RENAME COLUMN step TO beat;
--   ALTER TABLE sub_steps RENAME COLUMN phase_key TO canvas_key;
--   ALTER TABLE record_segments RENAME COLUMN phase_key TO canvas_key;
--   ALTER TABLE record_notes RENAME COLUMN source_phase TO source_canvas;
--   ALTER INDEX idx_sub_steps_user_phase RENAME TO idx_sub_steps_user_canvas;

BEGIN;

-- 1. Rename columns on sub_steps
ALTER TABLE sub_steps RENAME COLUMN beat TO step;
ALTER TABLE sub_steps RENAME COLUMN canvas_key TO phase_key;

-- 2. Rename column on record_segments (also keyed by canvas)
ALTER TABLE record_segments RENAME COLUMN canvas_key TO phase_key;

-- 3. Rename the source-phase column on record_notes
ALTER TABLE record_notes RENAME COLUMN source_canvas TO source_phase;

-- 4. Rename the sub_steps index that referenced canvas_key
ALTER INDEX idx_sub_steps_user_canvas RENAME TO idx_sub_steps_user_phase;

-- 5. Migrate the value: the "analyse" step is now called "draft"
UPDATE sub_steps SET step = 'draft' WHERE step = 'analyse';

COMMIT;

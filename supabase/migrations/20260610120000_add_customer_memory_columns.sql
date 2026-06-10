-- Add customer memory columns to conversation_state.
-- These persist across sessions so the LLM remembers budget, preferences, and context.
ALTER TABLE conversation_state
  ADD COLUMN IF NOT EXISTS budget integer,
  ADD COLUMN IF NOT EXISTS preferred_brands text,
  ADD COLUMN IF NOT EXISTS usage_type text,
  ADD COLUMN IF NOT EXISTS last_summary text;

-- Add free-text condition notes to bikes.
-- Owner fills this in when listing a bike (e.g. "New tyres, recently serviced, all papers clear").
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS condition_notes text;

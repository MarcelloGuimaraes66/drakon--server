ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS input_type TEXT;

UPDATE camera_algorithms
SET input_type = 'video'
WHERE input_type IS NULL
   OR BTRIM(input_type) = ''
   OR LOWER(BTRIM(input_type)) NOT IN ('video', 'image');

ALTER TABLE camera_algorithms
  ALTER COLUMN input_type SET DEFAULT 'video';

ALTER TABLE camera_algorithms
  ALTER COLUMN input_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'camera_algorithms_input_type_chk'
  ) THEN
    ALTER TABLE camera_algorithms
      ADD CONSTRAINT camera_algorithms_input_type_chk
      CHECK (input_type IN ('video', 'image'));
  END IF;
END $$;

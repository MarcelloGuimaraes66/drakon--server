ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS direct_capture_on_motion_only INTEGER NOT NULL DEFAULT 0;

ALTER TABLE camera_algorithms
  ALTER COLUMN only_capture_on_motion SET DEFAULT 0;

UPDATE camera_algorithms
   SET only_capture_on_motion = 0
 WHERE COALESCE(only_capture_on_motion, 0) <> 0
   AND camera_id IN (
     SELECT id
       FROM cameras
      WHERE COALESCE(direct_capture_on_motion_only, 0) = 0
   );

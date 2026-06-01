ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS thumbnail_filename TEXT;

ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS thumbnail_width INTEGER;

ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS thumbnail_height INTEGER;

ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS duration_seconds REAL;

ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS preview_frame_seconds REAL;

CREATE TABLE IF NOT EXISTS hub_items_cache (
  hub_item_id INTEGER PRIMARY KEY,
  item_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  current_version_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  remote_updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_item_tags_cache (
  hub_item_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (hub_item_id, tag)
);

CREATE TABLE IF NOT EXISTS hub_sync_state (
  sync_key TEXT PRIMARY KEY,
  last_cursor TEXT,
  last_sync_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_hub_items_cache_type_status_updated
  ON hub_items_cache(item_type, status, remote_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_items_cache_slug
  ON hub_items_cache(slug);
CREATE INDEX IF NOT EXISTS idx_hub_item_tags_cache_tag_item
  ON hub_item_tags_cache(tag, hub_item_id);

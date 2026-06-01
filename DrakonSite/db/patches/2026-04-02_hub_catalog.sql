CREATE TABLE IF NOT EXISTS hub_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'public',
  current_version_id INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hub_item_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  changelog TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hub_item_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  install_target TEXT NOT NULL,
  target_ref_json TEXT,
  created_entity_type TEXT,
  created_entity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hub_item_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  asset_type TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hub_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  version_id INTEGER,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_versions_item_version
  ON hub_item_versions(item_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_versions_item_hash
  ON hub_item_versions(item_id, snapshot_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_tags_item_tag
  ON hub_item_tags(item_id, tag);
CREATE INDEX IF NOT EXISTS idx_hub_item_tags_tag_item
  ON hub_item_tags(tag, item_id);
CREATE INDEX IF NOT EXISTS idx_hub_items_type_status_updated
  ON hub_items(item_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_items_owner_type_updated
  ON hub_items(owner_user_id, item_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_downloads_user_item_created
  ON hub_downloads(user_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_downloads_item_created
  ON hub_downloads(item_id, created_at DESC);

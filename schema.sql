DROP TABLE IF EXISTS memorial;
DROP TABLE IF EXISTS memorial_fts;

CREATE TABLE memorial (
    id TEXT PRIMARY KEY,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT NOT NULL,
    rank TEXT,
    date_of_birth TEXT,
    date_of_death TEXT,
    service_history TEXT NOT NULL,
    photo_url TEXT
);

-- Create a dedicated search index for fast text matching
CREATE VIRTUAL TABLE memorial_fts USING fts5(
    id UNINDEXED, 
    last_name, 
    first_name, 
    middle_name, 
    content='memorial'
);

-- Automate keeping the search index in sync with the main table
CREATE TRIGGER memorial_ai AFTER INSERT ON memorial BEGIN
  INSERT INTO memorial_fts(rowid, id, last_name, first_name, middle_name) 
  VALUES (new.rowid, new.id, new.last_name, new.first_name, new.middle_name);
END;

CREATE TRIGGER memorial_ad AFTER DELETE ON memorial BEGIN
  INSERT INTO memorial_fts(memorial_fts, rowid, id, last_name, first_name, middle_name) 
  VALUES('delete', old.rowid, old.id, old.last_name, old.first_name, old.middle_name);
END;

CREATE TRIGGER memorial_au AFTER UPDATE ON memorial BEGIN
  INSERT INTO memorial_fts(memorial_fts, rowid, id, last_name, first_name, middle_name) 
  VALUES('delete', old.rowid, old.id, old.last_name, old.first_name, old.middle_name);
  INSERT INTO memorial_fts(rowid, id, last_name, first_name, middle_name) 
  VALUES (new.rowid, new.id, new.last_name, new.first_name, new.middle_name);
END;

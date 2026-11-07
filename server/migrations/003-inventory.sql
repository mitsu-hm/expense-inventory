CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), space TEXT NOT NULL CHECK(space IN ('real','demo')),
 name TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', payment_terms TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_names ON suppliers(user_id,space,lower(name));
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),space TEXT NOT NULL CHECK(space IN ('real','demo')),
 name TEXT NOT NULL,product_type TEXT NOT NULL,brand TEXT NOT NULL,flavour TEXT NOT NULL DEFAULT '',pack_size TEXT NOT NULL,unit TEXT NOT NULL,
 supplier_id TEXT NOT NULL REFERENCES suppliers(id),unit_price TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_suppliers (product_id TEXT NOT NULL REFERENCES products(id),supplier_id TEXT NOT NULL REFERENCES suppliers(id),PRIMARY KEY(product_id,supplier_id));
CREATE TABLE IF NOT EXISTS purchases (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),space TEXT NOT NULL CHECK(space IN ('real','demo')),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id),ordered_date TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(user_id,space,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_references ON purchases(user_id,space,supplier_id,lower(reference)) WHERE reference<>'';
CREATE TABLE IF NOT EXISTS purchase_lines (
 id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchases(id),product_id TEXT NOT NULL REFERENCES products(id),quantity TEXT NOT NULL,received_quantity TEXT NOT NULL DEFAULT '0',
 unit_price TEXT NOT NULL,tax_rate TEXT,pack_size TEXT NOT NULL,unit TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_receipts (
 id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchases(id),user_id TEXT NOT NULL REFERENCES users(id),space TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,received_at INTEGER NOT NULL,
 UNIQUE(user_id,space,request_key)
);
CREATE TABLE IF NOT EXISTS receipt_lines (receipt_id TEXT NOT NULL REFERENCES stock_receipts(id),purchase_line_id TEXT NOT NULL REFERENCES purchase_lines(id),quantity TEXT NOT NULL,PRIMARY KEY(receipt_id,purchase_line_id));
CREATE TABLE IF NOT EXISTS demo_inventory_seeds (user_id TEXT PRIMARY KEY REFERENCES users(id),seeded_at INTEGER NOT NULL);

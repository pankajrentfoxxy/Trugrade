-- Step 6 allows up to four files per document type (GST certificate, PAN, etc.).
ALTER TABLE kyc.document_type_rule ALTER COLUMN max_files SET DEFAULT 4;
UPDATE kyc.document_type_rule SET max_files = 4 WHERE max_files < 4;

-- Run once in Supabase > SQL Editor. First create a PUBLIC bucket named "files".
-- Hardening: cap file size and block page/script types at the bucket level (adjust 52428800 = 50MB to your plan).
update storage.buckets set file_size_limit = 52428800 where id = 'files';

-- Upload and delete only. NO select policy, so nobody can list the bucket; files are reachable only by their
-- unguessable link (random 32-hex folder name). Public-bucket downloads do not need a select policy.
drop policy if exists "qs read" on storage.objects;
drop policy if exists "qs upload" on storage.objects;
drop policy if exists "qs delete" on storage.objects;
create policy "qs upload" on storage.objects for insert to anon
  with check (bucket_id = 'files' and name ~ '^[0-9a-f]{32}/[A-Za-z0-9._-]{1,200}$');
create policy "qs delete" on storage.objects for delete to anon
  using (bucket_id = 'files' and name ~ '^[0-9a-f]{32}/');

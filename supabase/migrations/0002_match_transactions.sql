-- Semantic search function untuk transactions.
-- Prasyarat: migration 0001 sudah dijalankan (tabel transactions + extension vector).
-- Jalankan via SQL Editor setelah 0001.

-- ---------------------------------------------------------------
-- Index HNSW di kolom embedding
-- Index ini bikin nearest-neighbor search cepat. Pakai operator
-- cosine distance (vector_cosine_ops) supaya match dengan `<=>`
-- di function di bawah.
-- ---------------------------------------------------------------
create index if not exists transactions_embedding_idx
  on public.transactions
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------
-- Function: match_transactions
-- Cari transaksi yang vector embedding-nya paling dekat dengan
-- query_embedding (vector dari pertanyaan/teks user).
--
-- Argumen:
--   query_embedding   : vector 768 dim dari teks query
--   match_threshold   : skor similarity minimum (0..1). Skor di
--                       bawah threshold akan di-filter keluar.
--   match_count       : maksimal baris yang dikembalikan
--
-- Kembali: kolom-kolom transactions + similarity (1 - cosine_distance).
--
-- Catatan: `<=>` adalah cosine distance dari pgvector. Untuk vector
-- yang dinormalisasi (kebanyakan embedding model output sudah
-- ternormalisasi), 1 - distance ≈ cosine similarity (range 0..1).
-- ---------------------------------------------------------------
create or replace function public.match_transactions (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id          uuid,
  type        text,
  category    text,
  amount      numeric,
  description text,
  date        date,
  user_id     uuid,
  similarity  float
)
language sql stable
as $$
  select
    transactions.id,
    transactions.type,
    transactions.category,
    transactions.amount,
    transactions.description,
    transactions.date,
    transactions.user_id,
    1 - (transactions.embedding <=> query_embedding) as similarity
  from public.transactions
  where transactions.embedding is not null
    and 1 - (transactions.embedding <=> query_embedding) > match_threshold
  order by transactions.embedding <=> query_embedding asc
  limit match_count;
$$;

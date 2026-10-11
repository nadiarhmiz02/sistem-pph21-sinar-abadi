-- Jalankan seluruh isi file ini di Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS jabatan (
  id BIGSERIAL PRIMARY KEY,
  nama_jabatan TEXT UNIQUE NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('staff','supervisor','manajer')),
  gaji_pokok_default NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gaji_pokok_default >= 0),
  tunjangan_jabatan_default NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tunjangan_jabatan_default >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS karyawan (
  id BIGSERIAL PRIMARY KEY,
  nik TEXT UNIQUE NOT NULL CHECK (char_length(nik) BETWEEN 8 AND 20),
  npwp TEXT CHECK (npwp IS NULL OR npwp ~ '^[0-9]{15,16}$'),
  nama_lengkap TEXT NOT NULL,
  status_ptkp TEXT NOT NULL CHECK (status_ptkp IN ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
  status_kepegawaian TEXT NOT NULL CHECK (status_kepegawaian IN ('pegawai_tetap','pegawai_tidak_tetap','bukan_pegawai')),
  jabatan_id BIGINT REFERENCES jabatan(id) ON DELETE SET NULL,
  tanggal_masuk DATE NOT NULL,
  status_aktif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_gaji_bulanan (
  id BIGSERIAL PRIMARY KEY,
  karyawan_id BIGINT NOT NULL REFERENCES karyawan(id) ON DELETE CASCADE,
  periode_bulan INT NOT NULL CHECK (periode_bulan BETWEEN 1 AND 12),
  periode_tahun INT NOT NULL CHECK (periode_tahun BETWEEN 2020 AND 2100),
  gaji_pokok NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gaji_pokok >= 0),
  tunjangan_tetap NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tunjangan_tetap >= 0),
  tunjangan_tidak_tetap NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tunjangan_tidak_tetap >= 0),
  potongan_bpjs_kesehatan NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (potongan_bpjs_kesehatan >= 0),
  potongan_bpjs_jht NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (potongan_bpjs_jht >= 0),
  potongan_bpjs_jp NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (potongan_bpjs_jp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (karyawan_id, periode_bulan, periode_tahun)
);

CREATE TABLE IF NOT EXISTS perhitungan_pph21 (
  id BIGSERIAL PRIMARY KEY,
  gaji_id BIGINT NOT NULL REFERENCES data_gaji_bulanan(id) ON DELETE CASCADE,
  karyawan_id BIGINT NOT NULL REFERENCES karyawan(id) ON DELETE CASCADE,
  periode_bulan INT NOT NULL CHECK (periode_bulan BETWEEN 1 AND 12),
  periode_tahun INT NOT NULL CHECK (periode_tahun BETWEEN 2020 AND 2100),
  penghasilan_bruto NUMERIC(15,2) NOT NULL CHECK (penghasilan_bruto >= 0),
  kategori_ter TEXT NOT NULL CHECK (kategori_ter IN ('A','B','C')),
  tarif_ter NUMERIC(6,4) NOT NULL CHECK (tarif_ter BETWEEN 0 AND 1),
  pph21_normal NUMERIC(15,2) NOT NULL CHECK (pph21_normal >= 0),
  pph21_terutang NUMERIC(15,2) NOT NULL CHECK (pph21_terutang >= 0),
  status_pembayaran TEXT NOT NULL DEFAULT 'belum' CHECK (status_pembayaran IN ('belum','sudah')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gaji_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')) DEFAULT 'staff',
  nama TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE perhitungan_pph21 ADD COLUMN IF NOT EXISTS nomor_slip TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_perhitungan_nomor_slip ON perhitungan_pph21(nomor_slip) WHERE nomor_slip IS NOT NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jabatan_set_updated_at ON jabatan;
CREATE TRIGGER jabatan_set_updated_at BEFORE UPDATE ON jabatan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS karyawan_set_updated_at ON karyawan;
CREATE TRIGGER karyawan_set_updated_at BEFORE UPDATE ON karyawan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS data_gaji_bulanan_set_updated_at ON data_gaji_bulanan;
CREATE TRIGGER data_gaji_bulanan_set_updated_at BEFORE UPDATE ON data_gaji_bulanan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS perhitungan_pph21_set_updated_at ON perhitungan_pph21;
CREATE TRIGGER perhitungan_pph21_set_updated_at BEFORE UPDATE ON perhitungan_pph21 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS profiles_set_updated_at ON profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO jabatan (nama_jabatan, level, gaji_pokok_default, tunjangan_jabatan_default) VALUES
  ('Staff Admin','staff',4500000,300000),
  ('Sales','staff',4200000,500000),
  ('Staf Gudang','staff',4000000,250000),
  ('Driver','staff',3800000,200000),
  ('Supervisor','supervisor',7500000,800000),
  ('Manajer','manajer',12000000,1500000)
ON CONFLICT (nama_jabatan) DO UPDATE SET
  level = EXCLUDED.level,
  gaji_pokok_default = EXCLUDED.gaji_pokok_default,
  tunjangan_jabatan_default = EXCLUDED.tunjangan_jabatan_default;

CREATE INDEX IF NOT EXISTS idx_karyawan_jabatan_id ON karyawan(jabatan_id);
CREATE INDEX IF NOT EXISTS idx_gaji_periode ON data_gaji_bulanan(periode_tahun, periode_bulan);
CREATE INDEX IF NOT EXISTS idx_pph21_periode ON perhitungan_pph21(periode_tahun, periode_bulan);

ALTER TABLE jabatan ENABLE ROW LEVEL SECURITY;
ALTER TABLE karyawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gaji_bulanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE perhitungan_pph21 ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

DROP POLICY IF EXISTS "allow all" ON jabatan;
DROP POLICY IF EXISTS "authenticated read" ON jabatan;
DROP POLICY IF EXISTS "admin insert" ON jabatan;
DROP POLICY IF EXISTS "admin update" ON jabatan;
DROP POLICY IF EXISTS "admin delete" ON jabatan;
CREATE POLICY "authenticated read" ON jabatan FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin insert" ON jabatan FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin update" ON jabatan FOR UPDATE TO authenticated USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin delete" ON jabatan FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "allow all" ON karyawan;
DROP POLICY IF EXISTS "authenticated read" ON karyawan;
DROP POLICY IF EXISTS "admin insert" ON karyawan;
DROP POLICY IF EXISTS "admin update" ON karyawan;
DROP POLICY IF EXISTS "admin delete" ON karyawan;
CREATE POLICY "authenticated read" ON karyawan FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin insert" ON karyawan FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin update" ON karyawan FOR UPDATE TO authenticated USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin delete" ON karyawan FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "allow all" ON data_gaji_bulanan;
DROP POLICY IF EXISTS "authenticated read" ON data_gaji_bulanan;
DROP POLICY IF EXISTS "admin insert" ON data_gaji_bulanan;
DROP POLICY IF EXISTS "admin update" ON data_gaji_bulanan;
DROP POLICY IF EXISTS "admin delete" ON data_gaji_bulanan;
CREATE POLICY "authenticated read" ON data_gaji_bulanan FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin insert" ON data_gaji_bulanan FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin update" ON data_gaji_bulanan FOR UPDATE TO authenticated USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin delete" ON data_gaji_bulanan FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "allow all" ON perhitungan_pph21;
DROP POLICY IF EXISTS "authenticated read" ON perhitungan_pph21;
DROP POLICY IF EXISTS "admin insert" ON perhitungan_pph21;
DROP POLICY IF EXISTS "admin update" ON perhitungan_pph21;
DROP POLICY IF EXISTS "admin delete" ON perhitungan_pph21;
CREATE POLICY "authenticated read" ON perhitungan_pph21 FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin insert" ON perhitungan_pph21 FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin update" ON perhitungan_pph21 FOR UPDATE TO authenticated USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "admin delete" ON perhitungan_pph21 FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "allow all" ON profiles;
DROP POLICY IF EXISTS "profile read own or admin" ON profiles;
DROP POLICY IF EXISTS "admin manage profiles" ON profiles;
CREATE POLICY "profile read own or admin" ON profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.current_user_role() = 'admin');
CREATE POLICY "admin manage profiles" ON profiles FOR ALL TO authenticated USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');

-- ============ TABEL PROFILES (untuk role user) ============
-- Migrasi mempertahankan kolom `nama` yang telah dipakai oleh schema sebelumnya.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nama_lengkap TEXT;

UPDATE public.profiles AS profile
SET email = COALESCE(profile.email, auth_user.email, ''),
    nama_lengkap = COALESCE(profile.nama_lengkap, NULLIF(profile.nama, ''), 'User Baru')
FROM auth.users AS auth_user
WHERE auth_user.id = profile.id;

ALTER TABLE public.profiles ALTER COLUMN email SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN nama_lengkap SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'staff';
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "allow all" ON public.profiles;
DROP POLICY IF EXISTS "profile read own or admin" ON public.profiles;
DROP POLICY IF EXISTS "admin manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "user can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "user can update own profile" ON public.profiles;

CREATE POLICY "user can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "admin can read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');

CREATE POLICY "user can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Column privileges ensure a user cannot promote their own role through this policy.
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (email, nama_lengkap) ON public.profiles TO authenticated;

-- ============ TRIGGER AUTO-CREATE PROFILE SAAT SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_name TEXT;
BEGIN
  profile_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'nama_lengkap', ''), 'User Baru');
  INSERT INTO public.profiles (id, email, nama_lengkap, nama, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), profile_name, profile_name, 'staff')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        nama_lengkap = EXCLUDED.nama_lengkap,
        nama = EXCLUDED.nama;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

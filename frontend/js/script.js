const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const digitsFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let positions = [];
let employees = [];
let payrolls = [];
let historyRows = [];
let historyPage = 1;
let historyPages = 1;
const historyLimit = 10;
let chartInstance = null;
let pending = 0;
let authListenerRegistered = false;
let roleRefreshTimer = null;
let currentUserRole = 'staff';

function setLoginVisibility(isVisible) {
  const modal = document.querySelector('#modal-login');
  modal.classList.toggle('hidden', !isVisible);
  modal.setAttribute('aria-hidden', String(!isVisible));
  document.body.classList.toggle('auth-locked', isVisible);
  document.querySelectorAll('.sidebar, .main').forEach((element) => { element.inert = isVisible; });
}

function setLoginError(message = '') {
  document.querySelector('#login-error').textContent = message;
}

async function getCurrentUserRole() {
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  if (!data.user) return 'staff';
  const profiles = await dbSelect('profiles', {
    select: 'role',
    where: { id: data.user.id },
    limit: 1,
  });
  return profiles[0]?.role === 'admin' ? 'admin' : 'staff';
}

function applyRoleUI(role) {
  currentUserRole = role === 'admin' ? 'admin' : 'staff';
  const isStaff = currentUserRole === 'staff';
  const badge = document.querySelector('#badge-role');
  badge.textContent = isStaff ? 'Staff (Read-only)' : 'Admin';
  badge.classList.toggle('admin', !isStaff);
  badge.classList.toggle('staff', isStaff);
  document.body.classList.toggle('role-staff', isStaff);

  const restrictedControls = [
    '#position-form button[type="submit"]',
    '#employee-form button[type="submit"]',
    '#payroll-form button[type="submit"]',
    '#btn-hitung-semua',
    '[data-position-edit]', '[data-position-delete]',
    '[data-employee-edit]', '[data-employee-delete]',
    '[data-payroll-edit]', '[data-payroll-delete]',
    '[data-paid]', '[data-history-paid]', '[data-history-slip]',
  ].join(',');
  document.querySelectorAll(restrictedControls).forEach((control) => {
    control.classList.toggle('hidden', isStaff);
  });
  return currentUserRole;
}

async function refreshCurrentUserRole() {
  try {
    applyRoleUI(await getCurrentUserRole());
  } catch (error) {
    console.warn('Role profile tidak dapat diperbarui:', error.message);
  }
}

function stopRoleRefresh() {
  if (roleRefreshTimer) window.clearInterval(roleRefreshTimer);
  roleRefreshTimer = null;
}

function startRoleRefresh() {
  stopRoleRefresh();
  roleRefreshTimer = window.setInterval(refreshCurrentUserRole, 30000);
}

async function initAuth() {
  setLoginVisibility(true);
  if (!authListenerRegistered) {
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.setTimeout(() => {
        stopRoleRefresh();
        applyRoleUI('staff');
        setLoginVisibility(true);
      }, 0);
    });
    authListenerRegistered = true;
  }

  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      document.querySelector('#login-email').focus();
      return;
    }
    setLoginError();
    applyRoleUI(await getCurrentUserRole());
    startRoleRefresh();
    setLoginVisibility(false);
    changeSection('dashboard');
  } catch (error) {
    setLoginError(error.message || 'Sesi tidak dapat diverifikasi. Coba masuk kembali.');
    document.querySelector('#login-email').focus();
  }
}

async function handleLogin(email, password) {
  const button = document.querySelector('#login-submit');
  const spinner = button.querySelector('.login-spinner');
  const label = button.querySelector('span:first-child');
  setLoginError();
  button.disabled = true;
  spinner.classList.remove('hidden');
  label.textContent = 'Memeriksa akun...';

  try {
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    applyRoleUI(await getCurrentUserRole());
    startRoleRefresh();
    document.querySelector('#login-password').value = '';
    setLoginVisibility(false);
    changeSection('dashboard');
    return true;
  } catch (error) {
    setLoginError(error.message || 'Email atau password tidak valid.');
    return false;
  } finally {
    button.disabled = false;
    spinner.classList.add('hidden');
    label.textContent = 'Masuk';
  }
}

async function handleLogout() {
  const { error } = await db.auth.signOut();
  if (error) {
    toast(error.message || 'Gagal keluar dari akun.', true);
    return;
  }
  stopRoleRefresh();
  applyRoleUI('staff');
  document.querySelector('#login-password').value = '';
  setLoginError();
  setLoginVisibility(true);
  document.querySelector('#login-email').focus();
}

document.querySelector('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  handleLogin(form.elements.email.value, form.elements.password.value);
});
document.querySelector('#btn-logout').addEventListener('click', () => {
  handleLogout().catch((error) => toast(error.message, true));
});
window.addEventListener('focus', refreshCurrentUserRole);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !document.body.classList.contains('auth-locked')) refreshCurrentUserRole();
});

function toast(message, isError = false) {
  const region = document.querySelector('#toast-region');
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 3000);
}

function showLoading(isLoading) {
  pending = Math.max(0, pending + (isLoading ? 1 : -1));
  document.querySelector('#loading-overlay').classList.toggle('show', pending > 0);
}

function showError(error) {
  const message = error?.message || 'Permintaan Supabase gagal.';
  const status = document.querySelector('#api-status');
  if (status) status.textContent = 'Koneksi Supabase gagal';
  document.querySelectorAll('td.empty').forEach((cell) => {
    cell.textContent = message;
    cell.classList.add('api-error-cell');
  });
  toast(message, true);
}

async function withLoading(action) {
  showLoading(true);
  try {
    const result = await action();
    const status = document.querySelector('#api-status');
    if (status) status.textContent = 'Supabase terhubung';
    document.querySelector('.status-dot')?.classList.add('connected');
    return result;
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    showLoading(false);
  }
}

function rupiahValue(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(`${raw.startsWith('-') ? '-' : ''}${digits}`) : 0;
}

function formatRupiah(input) {
  input.value = digitsFormat.format(rupiahValue(input.value));
}

document.querySelectorAll('[data-money]').forEach((input) => {
  input.addEventListener('focus', () => { input.value = String(rupiahValue(input.value) || ''); });
  input.addEventListener('blur', () => formatRupiah(input));
});

function auditStamp(createdAt, updatedAt) {
  const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const show = (value) => value ? dateFormat.format(new Date(value)) : '-';
  return `<small class="audit-meta">Dibuat ${show(createdAt)} | Diubah ${show(updatedAt)}</small>`;
}

function emptyRow(selector, columns, message) {
  document.querySelector(selector).innerHTML = `<tr><td class="empty" colspan="${columns}">${esc(message)}</td></tr>`;
}

function changeSection(sectionName) {
  const section = document.querySelector(`#section-${sectionName}`);
  if (!section) return;
  document.querySelectorAll('.page-section').forEach((page) => page.classList.toggle('active', page === section));
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.section === sectionName));
  document.querySelector('#sidebar')?.classList.remove('open');
  document.querySelector('#sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  const loaders = { dashboard: loadDashboard, jabatan: loadJabatan, karyawan: loadKaryawan, gaji: loadGaji, hitung: initHitung, riwayat: loadRiwayat };
  loaders[sectionName]?.().catch(() => {});
}

document.querySelectorAll('.nav-btn, [data-section]:not(.nav-btn)').forEach((button) => {
  button.addEventListener('click', () => changeSection(button.dataset.section));
});
document.querySelector('#sidebar-toggle').addEventListener('click', (event) => {
  const sidebar = document.querySelector('#sidebar');
  const open = sidebar.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

async function loadDashboard() {
  await withLoading(async () => {
    const [allEmployees, allPayrolls, allTaxes] = await Promise.all([
      dbSelect('karyawan'), dbSelect('data_gaji_bulanan'), dbSelect('perhitungan_pph21'),
    ]);
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthPayrolls = allPayrolls.filter((row) => Number(row.periode_bulan) === month && Number(row.periode_tahun) === year);
    const monthTaxes = allTaxes.filter((row) => Number(row.periode_bulan) === month && Number(row.periode_tahun) === year);
    document.querySelector('#active-count').textContent = allEmployees.filter((row) => row.status_aktif).length;
    document.querySelector('#payroll-count').textContent = monthPayrolls.length;
    document.querySelector('#tax-total').textContent = money(monthTaxes.reduce((sum, row) => sum + Number(row.pph21_terutang), 0));
    document.querySelector('#pending-count').textContent = monthPayrolls.filter((payroll) => !monthTaxes.some((tax) => Number(tax.gaji_id) === Number(payroll.id))).length;
    await renderRecent();
    const monthlyTaxes = allTaxes.filter((row) => Number(row.periode_tahun) === year);
    const values = Array.from({ length: 12 }, (_, index) => monthlyTaxes.filter((row) => Number(row.periode_bulan) === index + 1).reduce((sum, row) => sum + Number(row.pph21_terutang), 0));
    if (window.Chart) {
      chartInstance?.destroy();
      chartInstance = new Chart(document.querySelector('#tax-chart'), {
        type: 'bar',
        data: { labels: Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(new Date(year, index))), datasets: [{ label: 'PPh 21', data: values, backgroundColor: '#1e40af', borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }
  });
}

async function renderRecent() {
  const [taxes, payrollData, staff] = await Promise.all([dbSelect('perhitungan_pph21'), dbSelect('data_gaji_bulanan'), dbSelect('karyawan')]);
  const recent = taxes.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 6);
  const rows = recent.map((tax) => {
    const payroll = payrollData.find((row) => Number(row.id) === Number(tax.gaji_id));
    const employee = staff.find((row) => Number(row.id) === Number(tax.karyawan_id));
    return { tax, payroll, employee };
  }).filter((row) => row.employee && row.payroll);
  document.querySelector('#recent-body').innerHTML = rows.length ? rows.map(({ tax, payroll, employee }) => `<tr><td>${esc(employee.nama_lengkap)}</td><td>${payroll.periode_bulan}/${payroll.periode_tahun}</td><td>${money(tax.penghasilan_bruto)}</td><td>${money(tax.pph21_terutang)}</td><td><span class="badge ${tax.status_pembayaran === 'belum' ? 'pending' : ''}">${esc(tax.status_pembayaran)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Belum ada perhitungan.</td></tr>';
}

async function loadJabatan() {
  await withLoading(async () => {
    positions = await dbSelect('jabatan', { order: [{ column: 'nama_jabatan' }] });
    const search = document.querySelector('#position-search').value.trim().toLowerCase();
    const rows = positions.filter((row) => row.nama_jabatan.toLowerCase().includes(search));
    document.querySelector('#position-body').innerHTML = rows.length ? rows.map((row) => `<tr><td>${esc(row.nama_jabatan)}${auditStamp(row.created_at, row.updated_at)}</td><td>${esc(row.level)}</td><td>${money(row.gaji_pokok_default)}</td><td>${money(row.tunjangan_jabatan_default)}</td><td class="row-actions"><button class="button secondary small" data-position-edit="${row.id}">Edit</button><button class="button danger small" data-position-delete="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Belum ada data jabatan.</td></tr>';
  });
}

document.querySelector('#position-search').addEventListener('input', () => loadJabatan().catch(() => {}));
document.querySelector('#position-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const row = { nama_jabatan: values.nama_jabatan.trim(), level: values.level, gaji_pokok_default: rupiahValue(values.gaji_pokok_default), tunjangan_jabatan_default: rupiahValue(values.tunjangan_jabatan_default) };
  if (!row.nama_jabatan || row.gaji_pokok_default < 0 || row.tunjangan_jabatan_default < 0) return toast('Periksa nama jabatan dan nilai gaji.', true);
  try {
    await withLoading(() => values.id ? dbUpdate('jabatan', values.id, row) : dbInsert('jabatan', row));
    form.reset(); form.elements.id.value = ''; toast('Jabatan tersimpan.'); await loadJabatan();
  } catch (error) { toast(error.message, true); }
});
document.querySelector('#position-body').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-position-edit]');
  const deleteButton = event.target.closest('[data-position-delete]');
  if (editButton) {
    const row = positions.find((item) => String(item.id) === editButton.dataset.positionEdit);
    const form = document.querySelector('#position-form');
    for (const [key, value] of Object.entries(row)) if (form.elements[key]) form.elements[key].value = value ?? '';
    form.querySelectorAll('[data-money]').forEach(formatRupiah);
  }
  if (deleteButton && confirm('Yakin mau hapus data ini?')) {
    try { await withLoading(() => dbDelete('jabatan', deleteButton.dataset.positionDelete)); toast('Jabatan dihapus.'); await loadJabatan(); }
    catch (error) { toast(error.message, true); }
  }
});

async function loadKaryawan() {
  await withLoading(async () => {
    const [staffRows, jobRows] = await Promise.all([dbSelect('karyawan', { order: [{ column: 'nama_lengkap' }] }), dbSelect('jabatan', { order: [{ column: 'nama_jabatan' }] })]);
    positions = jobRows;
    employees = staffRows.map((employee) => {
      const job = positions.find((row) => Number(row.id) === Number(employee.jabatan_id));
      return { ...employee, nama_jabatan: job?.nama_jabatan || '-', gaji_pokok_default: job?.gaji_pokok_default || 0, tunjangan_jabatan_default: job?.tunjangan_jabatan_default || 0 };
    });
    const form = document.querySelector('#employee-form');
    const selected = form.elements.jabatan_id.value;
    form.elements.jabatan_id.innerHTML = '<option value="">Tanpa jabatan</option>' + positions.map((row) => `<option value="${row.id}">${esc(row.nama_jabatan)}</option>`).join('');
    form.elements.jabatan_id.value = selected;
    const search = document.querySelector('#employee-search').value.trim().toLowerCase();
    const rows = employees.filter((row) => `${row.nama_lengkap} ${row.nik}`.toLowerCase().includes(search));
    document.querySelector('#employee-body').innerHTML = rows.length ? rows.map((row) => `<tr><td>${esc(row.nik)}</td><td>${esc(row.nama_lengkap)}${auditStamp(row.created_at, row.updated_at)}</td><td>${esc(row.nama_jabatan || '-')}</td><td>${esc(row.status_ptkp)}</td><td>${row.status_aktif ? 'Aktif' : 'Nonaktif'}</td><td class="row-actions"><button class="button secondary small" data-employee-edit="${row.id}">Edit</button><button class="button danger small" data-employee-delete="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Belum ada data karyawan.</td></tr>';
  });
}

document.querySelector('#employee-search').addEventListener('input', () => loadKaryawan().catch(() => {}));
document.querySelector('#employee-form').elements.jabatan_id.addEventListener('change', (event) => {
  const job = positions.find((row) => String(row.id) === event.currentTarget.value);
  document.querySelector('#position-suggestion').textContent = job ? `Saran gaji pokok ${money(job.gaji_pokok_default)} dan tunjangan jabatan ${money(job.tunjangan_jabatan_default)}` : '';
});
document.querySelector('#employee-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const row = { nik: values.nik.trim(), npwp: values.npwp || null, nama_lengkap: values.nama_lengkap.trim(), status_ptkp: values.status_ptkp, status_kepegawaian: values.status_kepegawaian, jabatan_id: values.jabatan_id || null, tanggal_masuk: values.tanggal_masuk, status_aktif: form.elements.status_aktif.checked };
  if (row.nik.length < 8 || row.nik.length > 20) return toast('NIK wajib 8-20 karakter.', true);
  if (row.npwp && !/^[0-9]{15,16}$/.test(row.npwp)) return toast('NPWP harus 15-16 digit angka.', true);
  if (employees.some((item) => item.nik === row.nik && String(item.id) !== String(values.id))) return toast('NIK sudah digunakan.', true);
  try {
    await withLoading(() => values.id ? dbUpdate('karyawan', values.id, row) : dbInsert('karyawan', row));
    form.reset(); form.elements.id.value = ''; toast('Karyawan tersimpan.'); await loadKaryawan();
  } catch (error) { toast(error.message, true); }
});
document.querySelector('#employee-body').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-employee-edit]');
  const deleteButton = event.target.closest('[data-employee-delete]');
  if (editButton) {
    const row = employees.find((item) => String(item.id) === editButton.dataset.employeeEdit);
    const form = document.querySelector('#employee-form');
    for (const [key, value] of Object.entries(row)) if (form.elements[key]) form.elements[key].value = value ?? '';
    form.elements.status_aktif.checked = Boolean(row.status_aktif);
  }
  if (deleteButton && confirm('Yakin mau hapus data ini?')) {
    try { await withLoading(() => dbDelete('karyawan', deleteButton.dataset.employeeDelete)); toast('Karyawan dihapus.'); await loadKaryawan(); }
    catch (error) { toast(error.message, true); }
  }
});

async function loadGaji() {
  await withLoading(async () => {
    const [staffRows, jobRows, savedPayrolls] = await Promise.all([dbSelect('karyawan', { where: { status_aktif: true }, order: [{ column: 'nama_lengkap' }] }), dbSelect('jabatan'), dbSelect('data_gaji_bulanan', { order: [{ column: 'periode_tahun', ascending: false }, { column: 'periode_bulan', ascending: false }] })]);
    positions = jobRows;
    employees = staffRows.map((employee) => {
      const job = positions.find((row) => Number(row.id) === Number(employee.jabatan_id));
      return { ...employee, gaji_pokok_default: job?.gaji_pokok_default || 0, tunjangan_jabatan_default: job?.tunjangan_jabatan_default || 0 };
    });
    payrolls = savedPayrolls;
    const select = document.querySelector('#payroll-form').elements.karyawan_id;
    const selected = select.value;
    select.innerHTML = '<option value="">Pilih karyawan aktif</option>' + employees.map((row) => `<option value="${row.id}">${esc(row.nama_lengkap)} | ${esc(row.nik)}</option>`).join('');
    select.value = selected;
    const [staff, taxes] = await Promise.all([dbSelect('karyawan'), dbSelect('perhitungan_pph21')]);
    const rows = payrolls.map((payroll) => ({ payroll, employee: staff.find((row) => Number(row.id) === Number(payroll.karyawan_id)), tax: taxes.find((row) => Number(row.gaji_id) === Number(payroll.id)) }));
    document.querySelector('#payroll-body').innerHTML = rows.length ? rows.map(({ payroll, employee, tax }) => `<tr><td>${esc(employee?.nama_lengkap || '-')}</td><td>${payroll.periode_bulan}/${payroll.periode_tahun}${auditStamp(payroll.created_at, payroll.updated_at)}</td><td>${money(Number(payroll.gaji_pokok) + Number(payroll.tunjangan_tetap) + Number(payroll.tunjangan_tidak_tetap))}</td><td>${tax ? 'Sudah dihitung' : 'Belum dihitung'}</td><td class="row-actions"><button class="button secondary small" data-payroll-edit="${payroll.id}">Edit</button><button class="button danger small" data-payroll-delete="${payroll.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Belum ada data gaji.</td></tr>';
  });
}

document.querySelector('#payroll-form').elements.karyawan_id.addEventListener('change', (event) => {
  const employee = employees.find((row) => String(row.id) === event.currentTarget.value);
  if (!employee) return;
  const job = positions.find((row) => Number(row.id) === Number(employee.jabatan_id));
  document.querySelector('#salary-suggestion').textContent = job ? `Saran gaji pokok ${money(job.gaji_pokok_default)} dan tunjangan jabatan ${money(job.tunjangan_jabatan_default)}` : '';
  const amount = document.querySelector('#payroll-form').elements.gaji_pokok;
  if (job) { amount.value = job.gaji_pokok_default; formatRupiah(amount); }
});
document.querySelector('#payroll-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const fields = ['gaji_pokok', 'tunjangan_tetap', 'tunjangan_tidak_tetap', 'potongan_bpjs_kesehatan', 'potongan_bpjs_jht', 'potongan_bpjs_jp'];
  const row = { karyawan_id: Number(values.karyawan_id), periode_bulan: Number(values.periode_bulan), periode_tahun: Number(values.periode_tahun) };
  for (const field of fields) row[field] = rupiahValue(values[field]);
  if (fields.some((field) => row[field] < 0)) return toast('Nominal gaji dan potongan tidak boleh negatif.', true);
  try {
    await withLoading(() => values.id ? dbUpdate('data_gaji_bulanan', values.id, row) : dbInsert('data_gaji_bulanan', row));
    form.reset(); form.elements.id.value = ''; toast('Data gaji tersimpan.'); await loadGaji();
  } catch (error) { toast(error.message, true); }
});
document.querySelector('#payroll-body').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-payroll-edit]');
  const deleteButton = event.target.closest('[data-payroll-delete]');
  if (editButton) {
    const row = payrolls.find((item) => String(item.id) === editButton.dataset.payrollEdit);
    const form = document.querySelector('#payroll-form');
    for (const [key, value] of Object.entries(row)) if (form.elements[key]) form.elements[key].value = value ?? '';
    form.querySelectorAll('[data-money]').forEach(formatRupiah);
  }
  if (deleteButton && confirm('Yakin mau hapus data ini?')) {
    try { await withLoading(() => dbDelete('data_gaji_bulanan', deleteButton.dataset.payrollDelete)); toast('Data gaji dihapus.'); await loadGaji(); }
    catch (error) { toast(error.message, true); }
  }
});

async function initHitung() {
  const monthField = document.querySelector('#hitung-bulan');
  const yearField = document.querySelector('#hitung-tahun');
  if (!monthField.value) monthField.value = String(new Date().getMonth() + 1);
  if (!yearField.value) yearField.value = String(new Date().getFullYear());
  await loadExistingCalculations();
}

async function loadExistingCalculations() {
  const month = Number(document.querySelector('#hitung-bulan').value);
  const year = Number(document.querySelector('#hitung-tahun').value);
  if (!month || !year) return;
  await withLoading(async () => {
    const taxes = await dbSelect('perhitungan_pph21', {
      select: '*, karyawan(nama_lengkap,nik,status_ptkp,npwp)',
      where: [
        { column: 'periode_bulan', operator: 'eq', value: month },
        { column: 'periode_tahun', operator: 'eq', value: year },
      ],
      order: [{ column: 'id' }],
    });
    renderCalculations(taxes.map((tax) => ({ ...tax, ...(Array.isArray(tax.karyawan) ? tax.karyawan[0] : tax.karyawan), faktor_npwp: (Array.isArray(tax.karyawan) ? tax.karyawan[0] : tax.karyawan)?.npwp ? 1 : 1.2 })));
  });
}

function renderCalculations(rows) {
  document.querySelector('#tabel-hitung').innerHTML = rows.length ? rows.map((row) => `<tr><td>${esc(row.nama_lengkap)}</td><td>${row.periode_bulan}/${row.periode_tahun}</td><td>${money(row.penghasilan_bruto)}</td><td>TER ${esc(row.kategori_ter)}</td><td>${(Number(row.tarif_ter) * 100).toLocaleString('id-ID')}%</td><td>${money(row.pph21_normal)}</td><td>${row.faktor_npwp === 1.2 ? '1.2x' : '1x'}</td><td>${money(row.pph21_terutang)}</td><td>${esc(row.status_pembayaran)}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">Belum ada perhitungan pada periode ini.</td></tr>';
}

document.querySelector('#hitung-bulan').addEventListener('change', () => loadExistingCalculations().catch(() => {}));
document.querySelector('#hitung-tahun').addEventListener('change', () => loadExistingCalculations().catch(() => {}));
document.querySelector('#btn-hitung-semua').addEventListener('click', async () => {
  const monthInput = document.querySelector('#hitung-bulan').value;
  const yearInput = document.querySelector('#hitung-tahun').value;
  if (!monthInput || !yearInput) return toast('Isi bulan dan tahun terlebih dahulu', true);
  const bulan = Number(monthInput);
  const tahun = Number(yearInput);
  if (!Number.isInteger(bulan) || bulan < 1 || bulan > 11) return toast('Bulan harus di antara 1 dan 11; Desember di luar cakupan.', true);
  if (!Number.isInteger(tahun) || tahun < 2020 || tahun > 2100) return toast('Tahun harus di antara 2020 dan 2100.', true);
  try {
    const hasil = await withLoading(() => hitungSemuaPajak(bulan, tahun));
    console.log('Hasil perhitungan:', hasil);
    if (!hasil.length) {
      document.querySelector('#tabel-hitung').innerHTML = `<tr><td colspan="9" class="empty">Belum ada data gaji untuk periode ${bulan}/${tahun}. Input gaji dulu di menu Input Gaji.</td></tr>`;
      return;
    }
    renderCalculations(hasil);
    toast(`${hasil.length} perhitungan berhasil disimpan.`);
  } catch (error) { toast(error.message, true); }
});
document.querySelector('#tabel-hitung').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-paid]');
  if (!button) return;
  try { await withLoading(() => dbUpdate('perhitungan_pph21', button.dataset.paid, { status_pembayaran: 'sudah' })); toast('Pembayaran ditandai sudah.'); await loadExistingCalculations(); }
  catch (error) { toast(error.message, true); }
});

async function loadRiwayat() {
  await withLoading(async () => {
    const [taxes, allEmployees] = await Promise.all([dbSelect('perhitungan_pph21', { order: [{ column: 'periode_tahun', ascending: false }, { column: 'periode_bulan', ascending: false }, { column: 'id', ascending: false }] }), dbSelect('karyawan')]);
    const search = document.querySelector('#history-name').value.trim().toLowerCase();
    const month = document.querySelector('#history-month').value;
    const year = document.querySelector('#history-year').value;
    historyRows = taxes.map((tax) => ({ ...tax, employee: allEmployees.find((row) => Number(row.id) === Number(tax.karyawan_id)) })).filter((row) => row.employee)
      .filter((row) => !search || `${row.employee.nama_lengkap} ${row.employee.nik}`.toLowerCase().includes(search))
      .filter((row) => !month || Number(row.periode_bulan) === Number(month))
      .filter((row) => !year || Number(row.periode_tahun) === Number(year));
    historyPages = Math.max(1, Math.ceil(historyRows.length / historyLimit));
    historyPage = Math.min(historyPage, historyPages);
    const offset = (historyPage - 1) * historyLimit;
    const currentRows = historyRows.slice(offset, offset + historyLimit);
    document.querySelector('#history-body').innerHTML = currentRows.length ? currentRows.map((row) => `<tr><td>${esc(row.employee.nama_lengkap)}${auditStamp(row.created_at, row.updated_at)}</td><td>${esc(row.employee.nik)}</td><td>${row.periode_bulan}/${row.periode_tahun}</td><td>${esc(row.employee.status_ptkp)}</td><td>${money(row.penghasilan_bruto)}</td><td>TER ${esc(row.kategori_ter)} | ${(Number(row.tarif_ter) * 100).toLocaleString('id-ID')}%</td><td>${money(row.pph21_normal)}</td><td>${money(row.pph21_terutang)}</td><td><span class="badge ${row.status_pembayaran === 'belum' ? 'pending' : ''}">${esc(row.status_pembayaran)}</span></td><td><button class="button secondary small" data-history-slip="${row.karyawan_id}" data-slip-month="${row.periode_bulan}" data-slip-year="${row.periode_tahun}">Cetak Slip</button>${row.status_pembayaran === 'belum' ? ` <button class="button small" data-history-paid="${row.id}">Tandai sudah</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="10" class="empty">Belum ada riwayat yang cocok.</td></tr>';
    document.querySelector('#history-page').textContent = `Halaman ${historyPage} dari ${historyPages} | ${historyRows.length} data`;
    document.querySelector('#history-previous').disabled = historyPage <= 1;
    document.querySelector('#history-next').disabled = historyPage >= historyPages;
  });
}

for (const selector of ['#history-name', '#history-month', '#history-year']) {
  document.querySelector(selector).addEventListener('input', () => { historyPage = 1; loadRiwayat().catch(() => {}); });
}
document.querySelector('#history-previous').addEventListener('click', () => { historyPage = Math.max(1, historyPage - 1); loadRiwayat().catch(() => {}); });
document.querySelector('#history-next').addEventListener('click', () => { historyPage = Math.min(historyPages, historyPage + 1); loadRiwayat().catch(() => {}); });
document.querySelector('#history-body').addEventListener('click', async (event) => {
  const slipButton = event.target.closest('[data-history-slip]');
  if (slipButton) {
    try { await exportSlipGaji(slipButton.dataset.historySlip, slipButton.dataset.slipMonth, slipButton.dataset.slipYear); }
    catch (error) { toast(error.message, true); }
    return;
  }
  const button = event.target.closest('[data-history-paid]');
  if (!button) return;
  try { await withLoading(() => dbUpdate('perhitungan_pph21', button.dataset.historyPaid, { status_pembayaran: 'sudah' })); toast('Pembayaran ditandai sudah.'); await loadRiwayat(); }
  catch (error) { toast(error.message, true); }
});

const PDF_EXPORT_COLORS = {
  navy: [30, 64, 175],
  gold: [245, 158, 11],
  text: [30, 41, 59],
  muted: [100, 116, 139],
  border: [226, 232, 240],
  zebra: [248, 250, 252],
};
const PDF_EXPORT_COMPANY = {
  name: 'PT SINAR ABADI',
  business: 'Distribusi Alat Tulis Kantor',
  address: 'Alamat perusahaan | Indonesia',
  phone: 'Telp: -',
  email: 'Email: -',
};
const pdfSequenceFallback = new Map();
let pdfLogoPngPromise;

function getLogoSABase64() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#B45309"/></linearGradient></defs><circle cx="90" cy="90" r="86" fill="url(#gold)" stroke="#FFFFFF" stroke-width="4"/><text x="90" y="110" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="700" fill="#FFFFFF">SA</text></svg>';
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

async function getPdfLogoPng() {
  if (!pdfLogoPngPromise) {
    pdfLogoPngPromise = (async () => {
      const image = new Image();
      image.src = getLogoSABase64();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 360;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas browser tidak tersedia untuk membuat logo PDF.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    })();
  }
  return pdfLogoPngPromise;
}

async function drawHeader(doc, judulDokumen, nomorDokumen) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await getPdfLogoPng();
  doc.setFillColor(...PDF_EXPORT_COLORS.navy);
  doc.rect(0, 0, pageWidth, 25, 'F');
  doc.addImage(logo, 'PNG', 9, 4, 17, 17);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(PDF_EXPORT_COMPANY.name, pageWidth - 10, 7.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(PDF_EXPORT_COMPANY.business, pageWidth - 10, 12, { align: 'right' });
  doc.text(PDF_EXPORT_COMPANY.address, pageWidth - 10, 16, { align: 'right' });
  doc.text(`${PDF_EXPORT_COMPANY.phone} | ${PDF_EXPORT_COMPANY.email}`, pageWidth - 10, 20, { align: 'right' });
  doc.setFillColor(...PDF_EXPORT_COLORS.gold);
  doc.rect(0, 25, pageWidth, 0.7, 'F');
  doc.setTextColor(...PDF_EXPORT_COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(judulDokumen, 10, 35);
  doc.setTextColor(...PDF_EXPORT_COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Nomor dokumen: ${nomorDokumen}`, pageWidth - 10, 43, { align: 'right' });
  return 50;
}

function drawFooter(doc, halamanSekarang, totalHalaman) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const printed = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  doc.setDrawColor(...PDF_EXPORT_COLORS.gold);
  doc.setLineWidth(0.35);
  doc.line(10, pageHeight - 18, pageWidth - 10, pageHeight - 18);
  doc.setTextColor(...PDF_EXPORT_COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const footerY = pageHeight - 10;
  doc.text(`Dicetak: ${printed}`, 10, footerY);
  doc.text('Dokumen ini digenerate otomatis oleh Sistem SAPT', pageWidth / 2, footerY, { align: 'center' });
  doc.text(`Halaman ${halamanSekarang} dari ${totalHalaman}`, pageWidth - 10, footerY, { align: 'right' });
}

function drawWatermark(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setTextColor(245, 247, 250);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('SAPT SINAR ABADI', pageWidth / 2, pageHeight / 2, { align: 'center', angle: -32 });
}

async function finishBrandedPdf(doc, title, documentNumber, firstPageHeaderDrawn = false) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawWatermark(doc);
    if (!(firstPageHeaderDrawn && pageNumber === 1)) await drawHeader(doc, title, documentNumber);
    drawFooter(doc, pageNumber, pageCount);
  }
}

function nextPdfDocumentNumber(prefix, year, month) {
  const key = `sapt-${prefix}-${year}-${String(month).padStart(2, '0')}`;
  let sequence;
  try {
    sequence = Number(localStorage.getItem(key) || 0) + 1;
    localStorage.setItem(key, String(sequence));
  } catch {
    sequence = (pdfSequenceFallback.get(key) || 0) + 1;
    pdfSequenceFallback.set(key, sequence);
  }
  return `${prefix}/${year}/${String(month).padStart(2, '0')}/${String(sequence).padStart(3, '0')}`;
}

function pdfMoney(value) {
  return money(value).replace(/\u00a0/g, ' ');
}

async function exportPdfRiwayat() {
  if (!window.jspdf?.jsPDF?.API?.autoTable) return toast('Plugin jsPDF AutoTable belum berhasil dimuat.', true);
  const body = document.querySelector('#history-body');
  const renderedRows = [...body.querySelectorAll('tr')].filter((row) => !row.querySelector('.empty')).length;
  const pageOffset = (historyPage - 1) * historyLimit;
  const rows = historyRows.slice(pageOffset, pageOffset + (renderedRows || historyLimit));
  if (!rows.length) return toast('Tidak ada data riwayat untuk diekspor.', true);

  const monthFilter = Number(document.querySelector('#history-month').value);
  const yearFilter = Number(document.querySelector('#history-year').value);
  const latest = rows[0];
  const month = monthFilter || Number(latest.periode_bulan);
  const year = yearFilter || Number(latest.periode_tahun);
  const periods = [...new Set(rows.map((row) => `${row.periode_bulan}/${row.periode_tahun}`))];
  const periodLabel = monthFilter && yearFilter
    ? `${monthFilter}/${yearFilter}`
    : periods.length === 1 ? periods[0] : `${periods[periods.length - 1]} - ${periods[0]}`;
  const documentNumber = nextPdfDocumentNumber('RWT', year, month);
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  const headerY = await drawHeader(doc, 'LAPORAN RIWAYAT PPh 21', documentNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...PDF_EXPORT_COLORS.muted);
  doc.text(`Periode: ${periodLabel}`, 10, 43);
  doc.autoTable({
    startY: headerY + 2,
    margin: { top: headerY + 2, bottom: 23, left: 10, right: 10 },
    head: [['Nama', 'NIK', 'Periode', 'PTKP', 'Bruto', 'Kategori TER', 'Tarif', 'PPh Normal', 'PPh Terutang', 'Status']],
    body: rows.map((row) => [
      row.employee.nama_lengkap,
      row.employee.nik,
      `${row.periode_bulan}/${row.periode_tahun}`,
      row.employee.status_ptkp || '-',
      pdfMoney(row.penghasilan_bruto),
      row.kategori_ter,
      `${(Number(row.tarif_ter) * 100).toLocaleString('id-ID')}%`,
      pdfMoney(row.pph21_normal),
      pdfMoney(row.pph21_terutang),
      row.status_pembayaran,
    ]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', textColor: PDF_EXPORT_COLORS.text, lineColor: PDF_EXPORT_COLORS.border, lineWidth: 0.15 },
    headStyles: { fillColor: PDF_EXPORT_COLORS.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, halign: 'center' },
    alternateRowStyles: { fillColor: PDF_EXPORT_COLORS.zebra },
  });
  await finishBrandedPdf(doc, 'LAPORAN RIWAYAT PPh 21', documentNumber, true);
  doc.save(`riwayat-pph21-${String(month).padStart(2, '0')}-${year}.pdf`);
}

async function exportSlipGaji(karyawanId, periodeBulan, periodeTahun) {
  if (!window.jspdf?.jsPDF?.API?.autoTable) return toast('Plugin jsPDF AutoTable belum berhasil dimuat.', true);
  const employeeId = Number(karyawanId);
  const month = Number(periodeBulan);
  const year = Number(periodeTahun);
  if (!Number.isInteger(employeeId) || !Number.isInteger(month) || !Number.isInteger(year)) throw new Error('Identitas karyawan atau periode slip tidak valid.');

  const [employeeRows, payrollRows] = await Promise.all([
    dbSelect('karyawan', { where: { id: employeeId }, limit: 1 }),
    dbSelect('data_gaji_bulanan', { where: { karyawan_id: employeeId, periode_bulan: month, periode_tahun: year }, limit: 1 }),
  ]);
  const employee = employeeRows[0];
  const payroll = payrollRows[0];
  if (!employee) throw new Error('Data karyawan tidak ditemukan.');
  if (!payroll) throw new Error('Data gaji karyawan pada periode tersebut tidak ditemukan.');

  const [taxRows, positionRows] = await Promise.all([
    dbSelect('perhitungan_pph21', { where: { gaji_id: payroll.id }, limit: 1 }),
    employee.jabatan_id ? dbSelect('jabatan', { where: { id: employee.jabatan_id }, limit: 1 }) : Promise.resolve([]),
  ]);
  const tax = taxRows[0] || {};
  const position = positionRows[0];
  const documentNumber = tax.nomor_slip || nextPdfDocumentNumber('SG', year, month);
  const bruto = Number(payroll.gaji_pokok) + Number(payroll.tunjangan_tetap) + Number(payroll.tunjangan_tidak_tetap);
  const pphTerutang = Number(tax.pph21_terutang || 0);
  const totalPotongan = Number(payroll.potongan_bpjs_kesehatan) + Number(payroll.potongan_bpjs_jht) + Number(payroll.potongan_bpjs_jp) + pphTerutang;
  const gajiBersih = bruto - totalPotongan;
  const doc = new window.jspdf.jsPDF({ orientation: 'portrait' });
  await drawHeader(doc, 'SLIP GAJI KARYAWAN', documentNumber);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...PDF_EXPORT_COLORS.muted);
  doc.text(`Periode: ${month}/${year}`, 10, 43);
  doc.autoTable({
    startY: 52,
    margin: { left: 10, right: 10 },
    body: [
      [{ content: 'Nama', styles: { fontStyle: 'bold' } }, employee.nama_lengkap, { content: 'NIK', styles: { fontStyle: 'bold' } }, employee.nik],
      [{ content: 'Jabatan', styles: { fontStyle: 'bold' } }, position?.nama_jabatan || '-', { content: 'PTKP', styles: { fontStyle: 'bold' } }, employee.status_ptkp || '-'],
      [{ content: 'NPWP', styles: { fontStyle: 'bold' } }, employee.npwp || '-', { content: 'Periode', styles: { fontStyle: 'bold' } }, `${month}/${year}`],
    ],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, textColor: PDF_EXPORT_COLORS.text, lineColor: PDF_EXPORT_COLORS.border, lineWidth: 0.15 },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 67 }, 2: { cellWidth: 20 }, 3: { cellWidth: 'auto' } },
  });
  const incomeItems = [
    `Gaji Pokok: ${pdfMoney(payroll.gaji_pokok)}`,
    `Tunjangan Tetap: ${pdfMoney(payroll.tunjangan_tetap)}`,
    `Tunjangan Tidak Tetap: ${pdfMoney(payroll.tunjangan_tidak_tetap)}`,
    '',
  ];
  const deductionItems = [
    `BPJS Kesehatan: ${pdfMoney(payroll.potongan_bpjs_kesehatan)}`,
    `BPJS JHT: ${pdfMoney(payroll.potongan_bpjs_jht)}`,
    `BPJS JP: ${pdfMoney(payroll.potongan_bpjs_jp)}`,
    `PPh 21: ${pdfMoney(pphTerutang)}`,
  ];
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 7,
    margin: { left: 10, right: 10 },
    head: [['PENERIMAAN', 'PENGURANGAN']],
    body: incomeItems.map((item, index) => [item, deductionItems[index]]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, halign: 'center', valign: 'middle', textColor: PDF_EXPORT_COLORS.text, lineColor: PDF_EXPORT_COLORS.border, lineWidth: 0.15 },
    headStyles: { fillColor: PDF_EXPORT_COLORS.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: PDF_EXPORT_COLORS.zebra },
  });
  const netY = doc.lastAutoTable.finalY + 7;
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_EXPORT_COLORS.gold);
  doc.roundedRect(10, netY, pageWidth - 20, 15, 2, 2, 'F');
  doc.setTextColor(...PDF_EXPORT_COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('GAJI BERSIH', 16, netY + 9.5);
  doc.text(pdfMoney(gajiBersih), pageWidth - 16, netY + 9.5, { align: 'right' });
  doc.autoTable({
    startY: netY + 21,
    margin: { left: 10, right: 10 },
    head: [['RINCIAN PPh 21', 'NILAI']],
    body: [
      ['Bruto', pdfMoney(bruto)],
      ['Kategori TER', tax.kategori_ter || '-'],
      ['Tarif', tax.tarif_ter == null ? '-' : `${(Number(tax.tarif_ter) * 100).toLocaleString('id-ID')}%`],
      ['PPh Terutang', pdfMoney(pphTerutang)],
    ],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, halign: 'center', textColor: PDF_EXPORT_COLORS.text, lineColor: PDF_EXPORT_COLORS.border, lineWidth: 0.15 },
    headStyles: { fillColor: PDF_EXPORT_COLORS.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: PDF_EXPORT_COLORS.zebra },
  });

  const signatureY = Math.max(doc.lastAutoTable.finalY + 14, 226);
  const signatureLineY = Math.min(signatureY + 20, doc.internal.pageSize.getHeight() - 30);
  doc.setTextColor(...PDF_EXPORT_COLORS.text);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('HR Manager', 15, signatureY);
  doc.text('Penerima', pageWidth - 15, signatureY, { align: 'right' });
  doc.setDrawColor(...PDF_EXPORT_COLORS.muted);
  doc.setLineWidth(0.25);
  doc.line(15, signatureLineY, 75, signatureLineY);
  doc.line(pageWidth - 75, signatureLineY, pageWidth - 15, signatureLineY);
  doc.setFontSize(8);
  doc.text('PT Sinar Abadi', 45, signatureLineY + 5, { align: 'center' });
  doc.text(employee.nama_lengkap, pageWidth - 45, signatureLineY + 5, { align: 'center' });
  await finishBrandedPdf(doc, 'SLIP GAJI KARYAWAN', documentNumber, true);
  const safeNik = String(employee.nik).replace(/[^a-zA-Z0-9-]/g, '');
  doc.save(`slip-gaji-${safeNik}-${String(month).padStart(2, '0')}-${year}.pdf`);
}

document.querySelector('#export-pdf').addEventListener('click', async () => {
  try { await exportPdfRiwayat(); }
  catch (error) { toast(error.message || 'PDF riwayat gagal dibuat.', true); }
});
document.querySelector('#export-excel').addEventListener('click', () => {
  if (!window.XLSX || !historyRows.length) return toast('Tidak ada data untuk diekspor.', true);
  const sheet = XLSX.utils.json_to_sheet(historyRows.map((row) => ({ Nama: row.employee.nama_lengkap, NIK: row.employee.nik, Bulan: row.periode_bulan, Tahun: row.periode_tahun, Bruto: row.penghasilan_bruto, Kategori: row.kategori_ter, Tarif: row.tarif_ter, PPh_Normal: row.pph21_normal, PPh_Terutang: row.pph21_terutang, Pembayaran: row.status_pembayaran })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Riwayat');
  XLSX.writeFile(workbook, 'riwayat-pph21.xlsx');
});

function refreshCurrentSection() {
  const activeButton = document.querySelector('.nav-btn.active');
  const section = activeButton?.dataset.section || 'dashboard';
  const sectionLoaders = { dashboard: loadDashboard, jabatan: loadJabatan, karyawan: loadKaryawan, gaji: loadGaji, hitung: initHitung, riwayat: loadRiwayat };
  sectionLoaders[section]().catch(() => {});
}

function showSection(name) {
  const section = document.querySelector(`#section-${name}`);
  if (!section) return;
  document.querySelectorAll('.page-section').forEach((item) => item.classList.toggle('active', item === section));
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.section === name));
  document.querySelector('#sidebar').classList.remove('open');
  refreshCurrentSection();
}

document.querySelectorAll('.nav-btn, [data-section]:not(.nav-btn)').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
document.querySelector('#sidebar-toggle').addEventListener('click', (event) => {
  const open = document.querySelector('#sidebar').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

function initializeCurrencyInputs() {
  document.querySelectorAll('[data-money]').forEach((input) => { if (input.value) formatRupiah(input); });
}
initializeCurrencyInputs();
initAuth();

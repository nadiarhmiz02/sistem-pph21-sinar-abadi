const SUPABASE_URL = 'https://aiknzgnrgebfsnolryua.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JMhcKwO3DnlF9Go3GkaqCQ_4OlCHBYr';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TER_A = [[5400000,0],[5650000,.0025],[5950000,.005],[6300000,.0075],[6750000,.01],[7500000,.0125],[8550000,.015],[9650000,.0175],[10050000,.02],[10350000,.0225],[10700000,.025],[11050000,.03],[11600000,.035],[12500000,.04],[13750000,.05],[15100000,.06],[16950000,.07],[19750000,.08],[24150000,.09],[26450000,.10],[28000000,.11],[30050000,.12],[32400000,.13],[35400000,.14],[39100000,.15],[43850000,.16],[47800000,.17],[51400000,.18],[56300000,.19],[62200000,.20],[68600000,.21],[77500000,.22],[89000000,.23],[103000000,.24],[125000000,.25],[157000000,.26],[206000000,.27],[337000000,.28],[454000000,.29],[550000000,.30],[695000000,.31],[910000000,.32],[1400000000,.33],[Infinity,.34]];
const TER_B = [[6200000,0],[6500000,.0025],[6850000,.005],[7300000,.0075],[9200000,.01],[10700000,.015],[11200000,.02],[12050000,.025],[12950000,.03],[14150000,.04],[15550000,.05],[17050000,.06],[19500000,.07],[22700000,.08],[26600000,.09],[28100000,.10],[30100000,.11],[32600000,.12],[35400000,.13],[38900000,.14],[43000000,.15],[47400000,.16],[51200000,.17],[55800000,.18],[60400000,.19],[66700000,.20],[74500000,.21],[83200000,.22],[95600000,.23],[110000000,.24],[134000000,.25],[169000000,.26],[221000000,.27],[331000000,.28],[454000000,.29],[550000000,.30],[695000000,.31],[910000000,.32],[1400000000,.33],[Infinity,.34]];
const TER_C = [[6600000,0],[6950000,.0025],[7350000,.005],[7800000,.0075],[8850000,.01],[9800000,.0125],[10950000,.015],[11200000,.0175],[12050000,.02],[12950000,.03],[14150000,.04],[15550000,.05],[17050000,.06],[19500000,.07],[22700000,.08],[26600000,.09],[28100000,.10],[30100000,.11],[32600000,.12],[35400000,.13],[38900000,.14],[43000000,.15],[47400000,.16],[51200000,.17],[55800000,.18],[60400000,.19],[66700000,.20],[74500000,.21],[83200000,.22],[95600000,.23],[110000000,.24],[134000000,.25],[169000000,.26],[221000000,.27],[331000000,.28],[454000000,.29],[550000000,.30],[695000000,.31],[910000000,.32],[1400000000,.33],[Infinity,.34]];

async function dbSelect(table, options = {}) {
  const selection = options.select || (options.join ? `*, ${options.join}` : '*');
  let query = db.from(table).select(selection);
  const filters = Array.isArray(options.where)
    ? options.where
    : Object.entries(options.where || {}).map(([column, value]) => ({ column, value }));
  for (const filter of filters) {
    const operator = filter.operator || filter.op || 'eq';
    const value = Object.prototype.hasOwnProperty.call(filter, 'value') ? filter.value : filter.values;
    if (operator === 'eq') query = query.eq(filter.column, value);
    else if (operator === 'in') query = query.in(filter.column, value);
    else if (operator === 'is') query = query.is(filter.column, value);
    else if (typeof query[operator] === 'function') query = query[operator](filter.column, value);
    else throw new Error(`Operator filter tidak didukung: ${operator}`);
  }
  if (options.period) {
    query = query.eq('periode_bulan', options.period.bulan).eq('periode_tahun', options.period.tahun);
  }
  const orderBy = options.order;
  if (typeof orderBy === 'string') query = query.order(orderBy, { ascending: true });
  else if (Array.isArray(orderBy)) {
    for (const order of orderBy) query = query.order(order.column, { ascending: order.ascending !== false });
  }
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function dbInsert(table, row) {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

async function dbUpdate(table, id, row) {
  const { data, error } = await db.from(table).update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function dbDelete(table, id) {
  const { data, error } = await db.from(table).delete().eq('id', id).select('id');
  if (error) throw error;
  return Boolean(data && data.length);
}

function getKategoriTER(status_ptkp) {
  if (['TK/0', 'TK/1', 'K/0'].includes(status_ptkp)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(status_ptkp)) return 'B';
  if (status_ptkp === 'K/3') return 'C';
  throw new Error('Status PTKP tidak valid.');
}

function getTarifTER(kategori, bruto) {
  const tables = { A: TER_A, B: TER_B, C: TER_C };
  const table = tables[kategori];
  if (!table) throw new Error('Kategori TER tidak valid.');
  const bracket = table.find(([batas]) => Number(bruto) <= batas);
  return bracket ? bracket[1] : table[table.length - 1][1];
}

function hitungPPh21(bruto, status_ptkp, punyaNPWP) {
  const kategori = getKategoriTER(status_ptkp);
  const tarif = getTarifTER(kategori, bruto);
  const pphNormal = Math.round(Number(bruto) * tarif);
  const pphFinal = punyaNPWP ? pphNormal : Math.round(pphNormal * 1.2);
  return { kategori, tarif, pphNormal, pphFinal };
}

async function hitungSemuaPajak(bulan, tahun) {
  const month = Number(bulan);
  const year = Number(tahun);
  if (!Number.isInteger(month) || month < 1 || month > 11) throw new Error('Pilih bulan Januari sampai November.');
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Tahun harus di antara 2020 dan 2100.');
  const dataGaji = await dbSelect('data_gaji_bulanan', {
    select: '*, karyawan(status_ptkp,npwp,nama_lengkap)',
    period: { bulan: month, tahun: year },
    order: [{ column: 'id' }],
  });
  console.log('Jumlah gaji ditemukan:', dataGaji.length);
  const hasil = [];
  const periodRows = await dbSelect('perhitungan_pph21', { period: { bulan: month, tahun: year } });
  const slipSequences = periodRows.map((row) => Number(String(row.nomor_slip || '').match(/\/(\d{3,})$/)?.[1] || 0));
  let nextSlipSequence = Math.max(0, ...slipSequences) + 1;

  for (const gaji of dataGaji) {
    const karyawan = Array.isArray(gaji.karyawan) ? gaji.karyawan[0] : gaji.karyawan;
    if (!karyawan) continue;
    const bruto = Number(gaji.gaji_pokok) + Number(gaji.tunjangan_tetap) + Number(gaji.tunjangan_tidak_tetap);
    const tax = hitungPPh21(bruto, karyawan.status_ptkp, Boolean(karyawan.npwp));
    const hasilBaru = {
      gaji_id: gaji.id,
      karyawan_id: gaji.karyawan_id,
      periode_bulan: month,
      periode_tahun: year,
      penghasilan_bruto: bruto,
      kategori_ter: tax.kategori,
      tarif_ter: tax.tarif,
      pph21_normal: tax.pphNormal,
      pph21_terutang: tax.pphFinal,
    };

    const dataLama = await dbSelect('perhitungan_pph21', { where: { gaji_id: gaji.id } });
    const existing = dataLama[0];
    let nomorSlip = existing?.nomor_slip;
    if (!nomorSlip) {
      nomorSlip = `SG/${year}/${String(month).padStart(2, '0')}/${String(nextSlipSequence).padStart(3, '0')}`;
      nextSlipSequence += 1;
    }
    const payload = {
      ...hasilBaru,
      nomor_slip: nomorSlip,
      status_pembayaran: existing?.status_pembayaran || 'belum',
    };
    const tersimpan = existing
      ? await dbUpdate('perhitungan_pph21', existing.id, payload)
      : await dbInsert('perhitungan_pph21', payload);
    hasil.push({ ...tersimpan, ...payload, nama_lengkap: karyawan.nama_lengkap, nik: karyawan.nik, status_ptkp: karyawan.status_ptkp, jabatan_id: gaji.karyawan_id, npwp: karyawan.npwp, faktor_npwp: karyawan.npwp ? 1 : 1.2 });
  }

  console.log('Hasil perhitungan:', hasil);
  return hasil;
}

const PDF_PALET = {
  primary: [30, 64, 175],
  primaryDark: [30, 58, 138],
  accent: [245, 158, 11],
  accentDark: [180, 83, 9],
  background: [248, 250, 252],
  border: [226, 232, 240],
  text: [30, 41, 59],
  muted: [100, 116, 139],
};
const PDF_COMPANY = {
  name: 'PT SINAR ABADI',
  address: 'Alamat perusahaan | Indonesia',
  phone: 'Telp: -',
  email: 'Email: -',
};
const PDF_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="86" fill="#F59E0B"/><circle cx="90" cy="90" r="78" fill="#1E40AF"/><text x="90" y="108" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="700" fill="#F59E0B">SA</text></svg>';

async function createPdfLogo() {
  const svgBase64 = btoa(PDF_LOGO_SVG);
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${svgBase64}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 180;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function drawHeader(doc, logoPng) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_PALET.primary);
  doc.rect(0, 0, pageWidth, 25, 'F');
  if (logoPng) doc.addImage(logoPng, 'PNG', 8, 3.5, 18, 18);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(PDF_COMPANY.name, pageWidth - 10, 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(PDF_COMPANY.address, pageWidth - 10, 13, { align: 'right' });
  doc.text(`${PDF_COMPANY.phone} | ${PDF_COMPANY.email}`, pageWidth - 10, 18, { align: 'right' });
  doc.setFillColor(...PDF_PALET.accent);
  doc.rect(0, 25, pageWidth, 2, 'F');
}

function drawWatermark(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setTextColor(245, 247, 250);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('SAPT SINAR ABADI', pageWidth / 2, pageHeight / 2, { align: 'center', angle: -32 });
}

function drawFooter(doc, pageNumber, pageCount) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...PDF_PALET.accent);
  doc.setLineWidth(0.7);
  doc.line(10, pageHeight - 18, pageWidth - 10, pageHeight - 18);
  doc.setTextColor(...PDF_PALET.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const printed = new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  doc.text(`Dicetak: ${printed}`, 10, pageHeight - 12);
  doc.text(`Halaman ${pageNumber} dari ${pageCount}`, pageWidth - 10, pageHeight - 12, { align: 'right' });
  doc.text('Dokumen ini digenerate otomatis oleh Sistem SAPT Sinar Abadi', pageWidth / 2, pageHeight - 6, { align: 'center' });
}

function finishPdf(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageNumber, pageCount);
  }
}

async function exportPdfRiwayat() {
  const taxes = await dbSelect('perhitungan_pph21', { order: [{ column: 'periode_tahun', ascending: false }, { column: 'periode_bulan', ascending: false }] });
  const employees = await dbSelect('karyawan');
  const rows = taxes.map((tax) => ({ ...tax, employee: employees.find((employee) => Number(employee.id) === Number(tax.karyawan_id)) })).filter((row) => row.employee);
  if (!rows.length) throw new Error('Belum ada riwayat perhitungan untuk diekspor.');

  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  const logo = await createPdfLogo();
  doc.setTextColor(...PDF_PALET.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('LAPORAN RIWAYAT PPh 21', 14, 37);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const periods = [...new Set(rows.map((row) => `${row.periode_bulan}/${row.periode_tahun}`))];
  doc.text(`Periode: ${periods.length === 1 ? periods[0] : `${periods[periods.length - 1]} - ${periods[0]}`}`, 14, 43);
  doc.text(`Nomor dokumen: RPT-${Date.now()}`, 14, 48);
  doc.autoTable({
    startY: 54,
    head: [['Nama', 'NIK', 'Periode', 'PTKP', 'Bruto', 'Kategori', 'Tarif', 'PPh Normal', 'PPh Terutang', 'Status']],
    body: rows.map((row) => [row.employee.nama_lengkap, row.employee.nik, `${row.periode_bulan}/${row.periode_tahun}`, row.employee.status_ptkp, money(row.penghasilan_bruto), row.kategori_ter, `${(Number(row.tarif_ter) * 100).toFixed(2)}%`, money(row.pph21_normal), money(row.pph21_terutang), row.status_pembayaran]),
    styles: { font: 'helvetica', fontSize: 7, textColor: PDF_PALET.text, lineColor: PDF_PALET.border, lineWidth: 0.15 },
    headStyles: { fillColor: PDF_PALET.primary, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: PDF_PALET.background },
    columnStyles: { 4: { halign: 'right', font: 'courier' }, 6: { halign: 'right', font: 'courier' }, 7: { halign: 'right', font: 'courier' }, 8: { halign: 'right', font: 'courier' } },
    didDrawPage: () => { drawWatermark(doc); drawHeader(doc, logo); },
  });
  finishPdf(doc);
  doc.save(`laporan-riwayat-pph21-${Date.now()}.pdf`);
}

async function exportSlipGaji(karyawanId, periode) {
  const [tahun, bulan] = String(periode).includes('-') ? String(periode).split('-') : [null, null];
  const month = Number(bulan);
  const year = Number(tahun);
  const payroll = (await dbSelect('data_gaji_bulanan', { where: { karyawan_id: Number(karyawanId), periode_bulan: month, periode_tahun: year }, limit: 1 }))[0];
  if (!payroll) throw new Error('Data gaji karyawan pada periode tersebut tidak ditemukan.');
  const employee = (await dbSelect('karyawan', { where: { id: Number(karyawanId) }, limit: 1 }))[0];
  if (!employee) throw new Error('Data karyawan tidak ditemukan.');
  const tax = (await dbSelect('perhitungan_pph21', { where: { gaji_id: payroll.id }, limit: 1 }))[0];
  if (!tax) throw new Error('Hitung pajak periode ini terlebih dahulu untuk membuat slip.');
  const position = employee.jabatan_id ? (await dbSelect('jabatan', { where: { id: employee.jabatan_id }, limit: 1 }))[0] : null;
  const nomorSlip = tax.nomor_slip || `SG/${year}/${String(month).padStart(2, '0')}/---`;
  const bruto = Number(payroll.gaji_pokok) + Number(payroll.tunjangan_tetap) + Number(payroll.tunjangan_tidak_tetap);
  const deductions = Number(payroll.potongan_bpjs_kesehatan) + Number(payroll.potongan_bpjs_jht) + Number(payroll.potongan_bpjs_jp) + Number(tax.pph21_terutang);
  const net = bruto - deductions;
  const doc = new jspdf.jsPDF({ orientation: 'portrait' });
  const logo = await createPdfLogo();
  drawWatermark(doc);
  drawHeader(doc, logo);
  doc.setTextColor(...PDF_PALET.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('SLIP GAJI', 14, 38);
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  doc.text(`Nomor slip: ${nomorSlip}`, 14, 45);
  doc.text(`Periode: ${month}/${year}`, 14, 51);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nama: ${employee.nama_lengkap}`, 14, 62);
  doc.text(`NIK: ${employee.nik}`, 14, 68);
  doc.text(`Jabatan: ${position?.nama_jabatan || '-'}`, 14, 74);
  doc.text(`Status PTKP: ${employee.status_ptkp}`, 14, 80);
  doc.autoTable({
    startY: 88,
    head: [['Penerimaan', 'Jumlah', 'Pengurangan', 'Jumlah']],
    body: [
      ['Gaji pokok', money(payroll.gaji_pokok), 'BPJS Kesehatan', money(payroll.potongan_bpjs_kesehatan)],
      ['Tunjangan tetap', money(payroll.tunjangan_tetap), 'BPJS JHT', money(payroll.potongan_bpjs_jht)],
      ['Tunjangan tidak tetap', money(payroll.tunjangan_tidak_tetap), 'BPJS JP', money(payroll.potongan_bpjs_jp)],
      ['', '', 'PPh 21', money(tax.pph21_terutang)],
    ],
    styles: { font: 'helvetica', fontSize: 9, textColor: PDF_PALET.text, lineColor: PDF_PALET.border, lineWidth: 0.15 },
    headStyles: { fillColor: PDF_PALET.primary, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', font: 'courier' }, 3: { halign: 'right', font: 'courier' } },
    didDrawPage: () => { drawWatermark(doc); drawHeader(doc, logo); },
  });
  const totalY = doc.lastAutoTable.finalY + 10;
  doc.setFillColor(...PDF_PALET.accent);
  doc.roundedRect(14, totalY, 182, 15, 2, 2, 'F');
  doc.setTextColor(...PDF_PALET.primaryDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('GAJI BERSIH', 19, totalY + 9.5);
  doc.setFont('courier', 'bold');
  doc.text(money(net), 191, totalY + 9.5, { align: 'right' });
  doc.setTextColor(...PDF_PALET.text);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Rincian PPh 21: bruto ${money(tax.penghasilan_bruto)} | TER ${tax.kategori_ter} ${(Number(tax.tarif_ter) * 100).toFixed(2)}% | terutang ${money(tax.pph21_terutang)}`, 14, totalY + 24);
  doc.line(105, totalY + 48, 150, totalY + 48);
  doc.line(160, totalY + 48, 195, totalY + 48);
  doc.text('HR', 127, totalY + 53, { align: 'center' });
  doc.text('Penerima', 177, totalY + 53, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(...PDF_PALET.muted);
  doc.text('Dokumen digenerate otomatis oleh SAPT Sinar Abadi.', 105, totalY + 62, { align: 'center' });
  finishPdf(doc);
  doc.save(`slip-gaji-${year}-${String(month).padStart(2, '0')}-${employee.nik}.pdf`);
}

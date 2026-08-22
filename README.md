# Stok Ayam Gepuk 🍗

Aplikasi web sederhana untuk bantu update stok bahan yang perlu dibeli setiap 2 hari untuk usaha ayam gepuk. Tidak butuh internet atau instalasi — cukup buka `index.html` di HP atau laptop.

## Cara pakai

1. Buka file `index.html` di browser HP (Chrome/Safari). Bisa juga di-host gratis lewat GitHub Pages supaya ada link tetap yang bisa dibuka dari HP kapan saja.
2. Tab **Belanja**: untuk tiap bahan, isi kolom **Sisa** (stok yang masih ada sekarang). Kolom **Target** adalah jumlah yang mau tersedia untuk 2 hari ke depan — bisa diedit sesuai kebutuhan tokomu.
3. Aplikasi otomatis menghitung berapa yang perlu dibeli (Target − Sisa) untuk tiap bahan.
4. Tekan **Buat Daftar Belanja** di bawah untuk lihat daftar rapi per kategori. Bisa langsung **Kirim WhatsApp** ke supplier atau **Salin Teks**.
5. Setelah belanja, tekan **✔ Sudah Belanja / Tandai Selesai** — stok otomatis dianggap penuh kembali dan tanggal belanja berikutnya (2 hari lagi) otomatis terhitung.
6. Tab **Riwayat** menyimpan catatan belanja sebelumnya. Tab **Pengaturan** untuk atur siklus hari, nomor WA supplier, dan backup/impor data.

## Fitur

- Daftar bahan default yang relevan untuk ayam gepuk: ayam & protein, sembako & minyak, bumbu basah & sambal, lalapan & sayur, minuman & kemasan, gas & operasional — semua bisa ditambah/dihapus sesuai kebutuhan.
- Penghitungan otomatis kebutuhan beli berdasarkan target stok 2 hari dikurangi sisa stok.
- Notifikasi visual saat sudah waktunya belanja lagi.
- Daftar belanja siap kirim ke WhatsApp supplier.
- Riwayat belanja tersimpan otomatis.
- Backup/impor data lewat file JSON supaya data tidak hilang kalau ganti HP.

Semua data tersimpan langsung di browser (localStorage) — tidak perlu server atau akun.

# Jentik Debu ✨

Ekstensi Chrome: jentikkan jari, kamu berubah jadi debu dan hilang dari kamera.
Jentikkan lagi untuk muncul kembali. Bisa dipakai di Google Meet, Zoom (versi web),
Microsoft Teams (web), Discord web, dan situs lain yang membuka kamera lewat browser.

## Cara pasang

1. Ekstrak `jentik-debu.zip` ke folder yang tidak akan kamu hapus.
2. Buka `chrome://extensions` di Chrome.
3. Nyalakan **Developer mode** (pojok kanan atas).
4. Klik **Load unpacked**, lalu pilih folder `jentik-debu` hasil ekstrak.
5. Halaman uji akan terbuka otomatis. Coba dulu di situ.

Kalau halaman meeting sudah terbuka sebelum ekstensi dipasang, **muat ulang halamannya**.

## Cara pakai

1. **Nyalakan kamera** di meeting (atau di halaman lobi/preview).
2. Klik ikon Jentik Debu → **Rekam latar**. Kamu punya 5 detik untuk keluar dari frame.
   Ekstensi memotret ruangan kosong. Latar ini disimpan dan dipakai lagi di semua situs.
3. Kembali ke depan kamera, lalu **jentikkan jari** di dekat mikrofon.
   Bisa juga tekan **Alt+Shift+S**, atau klik **Jentik sekarang** di popup.
4. Jentikkan lagi untuk muncul kembali, atau atur supaya kamu muncul otomatis.

Hanya kamu yang melihat hitungan mundur dan notifikasi kecil di layar.
Peserta lain cuma melihat videonya.

## Supaya hasilnya rapi

- **Kamera jangan bergerak.** Kalau kamera bergeser, rekam ulang latar kosong.
- **Cahaya tetap.** Lampu yang menyala/mati atau matahari yang berubah bisa membuat latar "bocor".
- Matikan efek bawaan aplikasi meeting (blur latar, latar virtual, pencahayaan otomatis).
  Efek itu bekerja *setelah* Jentik Debu dan bisa saling bertabrakan.
- Baju yang warnanya beda dari dinding membuat badan terpisah lebih bersih.
- Kalau ada bagian badan yang tertinggal saat hilang, turunkan **Pemisah badan & latar** di popup.

## Soal mikrofon

Untuk mendengar jentikan, ekstensi membuka mikrofon sendiri dengan filter peredam suara dimatikan,
karena filter itu biasanya ikut meredam bunyi jentikan.
Suara **tidak dikirim ke mana pun**; ekstensi hanya menganalisis suara itu di komputermu.
Akibatnya, ikon mikrofon di tab tetap menyala walaupun kamu sedang mute di meeting.
Kalau tidak mau, matikan **Deteksi suara jentikan jari** di popup dan pakai Alt+Shift+S.

Tepuk tangan, ketukan meja, atau satu ketikan keras kadang terdeteksi sebagai jentikan.
Ketikan beruntun sudah disaring. Atur **Sensitivitas jentikan** sesuai ruanganmu.

## Cara kerjanya (singkat)

- `src/inject.js` mengait `getUserMedia` di halaman. Track kamera diganti dengan track olahan
  (MediaStreamTrackProcessor/Generator). Selama kamu terlihat, frame diteruskan apa adanya,
  jadi kualitasnya tidak turun dan tidak ada beban GPU.
- Saat jentikan, badan dipisahkan dari latar dengan membandingkan frame dengan foto latar kosong.
  Proses ini berjalan di WebGL dan tidak memakai model AI atau server.
  Badan lalu dipecah jadi puluhan ribu partikel yang tertiup angin dan berubah warna jadi abu.
- `src/bridge.js` menyimpan latar & pengaturan. `src/background.js` menangani pintasan keyboard.

## Batasan

- Hanya untuk aplikasi meeting **versi browser**. Aplikasi desktop (Zoom/Teams terpasang) tidak terpengaruh.
- Kalau ukuran/rasio kamera berubah (ganti kamera atau resolusi), rekam ulang latar.
- Aplikasi yang memproses kamera di Web Worker dengan cara khusus mungkin tidak terpengaruh.
  Kalau tidak jalan di situs tertentu, muat ulang halamannya dan nyalakan ulang kamera.

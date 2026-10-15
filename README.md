# FTP Masters

Windows için FTP / FTPS / SFTP site yöneticisi ve dosya aktarım istemcisi. CuteFTP'nin yaptığı işi, [SSH Master](https://github.com/goktalay/sshmasters) ile ortak tasarımda yapar.

## İndirme

Derlenmiş exe'ler [Releases](https://github.com/goktalay/ftpmasters/releases) sayfasındadır:

- `FTP-Masters-Setup-x.y.z.exe` — kurulum
- `FTP-Masters-Portable-x.y.z.exe` — kurulumsuz, tek dosya

## Özellikler

- **Ana ekran:** açılışta boş, temiz bir ekran ve **Yeni** kartı. Kaydedilen her site bir kart olur. Kartlar **klasörlere** sürüklenip bırakılabilir (iç içe klasörler). Arama (Ctrl+F) ve çift tıkla bağlanma da var.
- **Site formu** (CuteFTP "Site Properties" sekmeleriyle):
  - **Genel:** etiket, sunucu adresi, port, kullanıcı, şifre, giriş yöntemi (Normal / Anonim), SFTP için şifre veya özel anahtar, klasör, renk, notlar
  - **Eylemler:** bağlanınca geçilecek uzak/yerel klasör, **son kaldığım klasöre git**, gezinme önbelleği (oturum boyunca / her zaman / hiç), yüklemede ad kuralı (koru / küçük harf / büyük harf)
  - **Tür:** protokol — FTP, FTPS Implicit (990), FTPS AUTH SSL, FTPS AUTH TLS, SFTP (SSH2); aktarım türü (ikili / ASCII / otomatik), sunucu saat dilimi farkı
  - **Seçenekler:** genel ayarları kullan veya siteye özel; tekrar deneme sayısı, bekleme süresi, **aynı anda en fazla aktarım**, aynı adlı dosya kuralı (üzerine yaz / yeniden adlandır / atla), dosya adı kodlaması (UTF-8 / ASCII / otomatik)
  - Kaydetmeden önce **Bağlantıyı dene**.
- **Site penceresi** (karta çift tıklayınca ayrı pencerede açılır):
  - **Sol — Bilgisayarım:** Windows dosya yöneticisi. Hızlı erişim ve sürücüler. Genişliği sürüklenerek değişir, Ctrl+B ile tamamen kapanıp açılır. Sağ tık → **Yükle**: seçili dosya/klasörler sunucudaki açık klasöre yüklenir.
  - **Orta — Sunucu:** uzak klasörler ve dosyalar. Sağ tık → **İndir**: soldaki açık Windows klasörüne iner. Yeniden adlandırma, silme ve yeni klasör de burada.
  - Paneller arasında ve Windows Gezgini'nden **sürükle-bırak**.
  - **Sağ — Aktarımlar:** her indirme/yükleme bir **ağaç** olarak görünür; klasörler iç içe açılır. Sütunlar **Ad · Boyut · İlerleme · Durum** başlıktan genişletilip daraltılır. Klasörlerin boyutu ve yüzdesi alt dosyalarının toplamıdır. İptal, yeniden dene ve bitenleri temizle seçenekleri var. Ctrl+J ile aç/kapat.
- **Ayarlar:** Gece / Gündüz / Sistem teması (üst çubuktaki güneş/ay düğmesiyle de değişir), Türkçe / İngilizce, **en yüksek hız sınırı** (KB/s, istenirse açılır; tüm aktarımların toplam hızını sınırlar), genel aktarım varsayılanları.
- **Mastertool hesabı:** uygulama SSH Master ile aynı Mastertool hesabıyla (e-posta ve şifre) açılır, "Beni hatırla" ile oturum saklanır, çevrimdışıyken son oturumla yerel sitelerle çalışır. Kayıt, şifremi unuttum ve hesap sayfaları [ftpmasters.com](https://ftpmasters.com) üzerinden açılır.
- **Uçtan uca şifreli senkron:** siteler, klasörler ve genel ayarlar AES-256-GCM ile şifrelenip hesaba yedeklenir; anahtar şifrenizden cihazda türetilir (PBKDF2 + HKDF), sunucu içeriği okuyamaz. SFTP özel anahtarları içerikleriyle taşınır. Yerel klasörler, son klasörler ve panel düzeni her cihazda ayrı kalır. Ayarlar › Hesap ve senkronizasyon'dan kapatılabilir ya da sunucu kopyası silinebilir.
- **Yeni sürüm bildirimi:** yeni sürüm çıkınca ana pencerede şerit görünür; indirme ftpmasters.com hesabınızdandır.
- **Güvenlik:** şifreler Windows DPAPI (Electron `safeStorage`) ile şifrelenir. SFTP host anahtarı ilk bağlantıda kaydedilir, değişirse bağlantı reddedilir. Yerelde silme Geri Dönüşüm Kutusu'na taşır.

Veriler `%APPDATA%\FTP Masters\store.json` içinde tutulur.

## Geliştirme

```bash
npm install
npm start
```

## Exe derleme

```bash
npm run dist
```

`dist/` altında kurulum ve taşınabilir exe oluşur. İkonu değiştirmek için `build/icon.svg` dosyasını düzenleyip `npm run icon` çalıştırın.

## Sürüm yayınlama

Yeni sürüm için bir etiket göndermek yeterli. GitHub Actions exe'leri derleyip Release'e ekler:

```bash
git tag v1.0.1
```

```bash
git push origin v1.0.1
```

Sürüm numarası etiketten alınır, `package.json`'ı elle değiştirmek gerekmez.

Etiketle yayınlanan sürüm ayrıca ftpmasters.com'a yüklenir (`scripts/upload-ftpmasters.sh`, parçalı; depo secret'ı `FTPM_RELEASE_KEY`). Sözleşme: goktalay/fabrika-yonetim › docs/ftpmasters-api.md.

## Bilinen sınırlar

- FTP veri bağlantısı yalnızca pasif moddadır (PASV/EPSV). Aktif (PORT) mod desteklenmez.
- Proxy / SOCKS ve MD4/MD5/OTP şifre korumaları henüz yok.

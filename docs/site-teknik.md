# FTP Masters — Teknik bilgi föyü

Sürüm 1.3.0 kaynak kodundan (goktalay/ftpmasters, `d7b8d97`) derlenmiştir. Burada yalnız kodda bulunan özellikler yer alır.

## Sistem gereksinimleri

| | |
| --- | --- |
| İşletim sistemi | Windows 10 / Windows 11, 64 bit (x64) |
| Kurulum | NSIS kurulum (`FTP-Masters-Setup-<sürüm>.exe`) veya taşınabilir tek exe (`FTP-Masters-Portable-<sürüm>.exe`) |
| Kurulum klasörü | Tüm kullanıcılar: `C:\Program Files\Mastertool\FTP Masters` · yalnız bu kullanıcı: `%LOCALAPPDATA%\Programs\Mastertool\FTP Masters` (kurulumda değiştirilebilir) |
| Başlat menüsü | Master Tool › FTP Masters |
| Disk alanı | Kurulu hâli yaklaşık 270 MB |
| Hesap | Mastertool hesabı gerekir (SSH Master ile aynı hesap) |
| İnternet | İlk giriş ve senkron için gerekir; “Beni hatırla” ile sonraki açılışlar çevrimdışı da yerel sitelerle çalışır |
| Veri konumu | `%APPDATA%\FTP Masters` (siteler, ayarlar; şifreler şifreli) |

## Teknoloji

| Bileşen | Sürüm | Görevi |
| --- | --- | --- |
| Electron | 33.4.11 | Masaüstü uygulama çatısı |
| Chromium | 130.0.6723.191 | Arayüz motoru (Electron içinde) |
| Node.js | 20.18.3 | Ağ ve dosya işlemleri (Electron içinde) |
| basic-ftp | 5.3.1 | FTP ve FTPS istemcisi |
| ssh2 | 1.17.0 | SFTP (SSH2) istemcisi |
| electron-builder | 25.1.8 | Kurulum ve taşınabilir exe derlemesi |

- Arayüz çerçevesiz, saf JavaScript ve CSS ile yazılmıştır; tasarım SSH Master ile ortaktır.
- Sürümler GitHub Actions'ta etiketten otomatik derlenir; exe'ler GitHub Releases'a ve ftpmasters.com'a yüklenir (SHA-256 doğrulamasıyla).

## Protokoller

| Protokol | Varsayılan port | Ayrıntı |
| --- | --- | --- |
| FTP | 21 | Düz metin komut ve veri bağlantısı |
| FTPS — Implicit | 990 | Bağlantı baştan TLS ile şifrelenir |
| FTPS — Explicit, AUTH TLS | 21 | Düz bağlantı `AUTH TLS` ile şifreliye geçer |
| FTPS — Explicit, AUTH SSL | 21 | Düz bağlantı `AUTH SSL` ile şifreliye geçer |
| SFTP | 22 | SSH2 üzerinden dosya aktarımı |

- **TLS:** TLS 1.2 ve TLS 1.3 (Chromium/BoringSSL varsayılanları). FTPS'te veri kanalı da korunur (`PBSZ 0`, `PROT P`).
- **Veri bağlantısı (FTP/FTPS):** yalnız pasif mod — önce `EPSV`, olmazsa `PASV`. Aktif mod (`PORT`) yoktur.
- **FTP kimlik doğrulama:** kullanıcı adı + şifre veya anonim giriş.
- **SFTP kimlik doğrulama:** şifre, klavye etkileşimli (keyboard-interactive) veya özel anahtar dosyası (isteğe bağlı anahtar parolasıyla).
- **Aktarım türü:** İkili (`TYPE I`), ASCII (`TYPE A`) ya da Otomatik — Otomatik'te metin uzantıları (txt, html, css, js, json, xml, php, csv, ini, md, sh, py, sql, svg, log, .htaccess vb.) ASCII, diğerleri ikili aktarılır. Genel ayar veya site başına seçilir.
- **Dosya adı kodlaması:** UTF-8 (`OPTS UTF8 ON`), ASCII (Latin-1) ya da Otomatik.
- **Sunucu saat dilimi farkı:** −14 … +14 saat; listedeki dosya saatleri buna göre kaydırılır.
- **Gezinme önbelleği:** oturum boyunca, uygulama açık kaldıkça ya da hiç (site başına).
- **Yüklemede ad kuralı:** büyük/küçük harfi koru, küçük harfe ya da büyük harfe çevir.

## Güvenlik

- **Kayıtlı şifreler:** site şifreleri ve anahtar parolaları Windows DPAPI ile (Electron `safeStorage`) şifrelenerek saklanır; arayüz katmanına hiç gönderilmez.
- **Mastertool girişi:** şifre sunucuya gönderilmez. İstemci PBKDF2-SHA256 (sunucunun verdiği tuz ve 310.000 tekrar) ile anahtar türetir; sunucuya yalnız bu anahtardan türetilen doğrulama özeti gider. Oturum anahtarı yalnız “Beni hatırla” seçiliyse DPAPI ile saklanır.
- **Uçtan uca şifreli senkron:** siteler, klasörler ve genel ayarlar AES-256-GCM ile cihazda şifrelenir. Anahtar HKDF-SHA256 ile şifrenizden cihazda türetilir; sunucu içeriği okuyamaz. SFTP özel anahtarları içerikleriyle taşınır, yeni cihazda dosyaya yazılır. Yerel klasörler ve panel düzeni senkronlanmaz.
- **SFTP host anahtarı:** ilk bağlantıda sunucunun SHA-256 parmak izi kaydedilir; sonra değişirse bağlantı reddedilir.
- **FTPS sertifikaları:** kendinden imzalı sertifikalar da kabul edilir; sertifika zinciri doğrulanmaz.
- **Silme:** yerel dosyalar Geri Dönüşüm Kutusu'na taşınır; sunucuda silme her zaman onay ister.
- **Uygulama yalıtımı:** arayüz Node.js'e doğrudan erişemez (context isolation, `nodeIntegration` kapalı), içerik güvenlik politikası yalnız yerel kaynaklara izin verir; dış bağlantılar varsayılan tarayıcıda açılır.

## Performans ve sınırlar

| | |
| --- | --- |
| Eşzamanlı aktarım | Site başına 1–20 (varsayılan 4). FTP'de her aktarım ayrı bağlantı açar; SFTP'de tek SSH bağlantısı paylaşılır. |
| Hız sınırı | İsteğe bağlı, KB/s cinsinden; tüm pencerelerdeki tüm aktarımların toplamına uygulanır, değişiklik anında geçerlidir |
| Yeniden deneme | 0–99 deneme (varsayılan 3), denemeler arası 0–3600 sn (varsayılan 10); sunucu “550” ile reddederse yeniden denenmez |
| Aynı adlı hedef | Üzerine yaz, otomatik yeniden adlandır (`ad (1).uzantı`) ya da atla |
| Büyük dosyalar | Akış hâlinde aktarılır (dosya belleğe alınmaz); uygulamada boyut sınırı yoktur. Yarım kalan aktarıma kaldığı yerden devam yoktur; iptal edilen yarım dosya silinir. |
| Klasör aktarımı | Klasörler taranırken dosyalar sıraya girer; aktarım ağacı yalnız görünen satırları çizer (binlerce dosyada akıcı) |
| Zaman aşımları | FTP/FTPS bağlantısı 30 sn · SFTP bağlantısı 20 sn · hesap API'si 20 sn |
| Bağlantıyı canlı tutma | Gezinme bağlantısı 45 sn'de bir yoklanır; SSH bağlantısında 20 sn'lik keepalive |
| Senkron | Değişiklikten 3 sn sonra ve açıkken 5 dakikada bir; kütüphane en çok 5 MB; silinen kayıtlar 30 gün izlenir |

## Klavye kısayolları

**Ana pencere**

| Kısayol | İşlev |
| --- | --- |
| Ctrl+F | Sitelerde ara (Esc temizler) |
| Ctrl+N | Yeni site |
| Enter | Seçili siteye bağlan |
| F2 | Seçili siteyi düzenle |
| Delete | Seçili siteyi sil |
| Backspace | Üst klasöre dön |

**Site penceresi**

| Kısayol | İşlev |
| --- | --- |
| Ctrl+B | Bilgisayarım panelini aç/kapat |
| Ctrl+J | Aktarımlar panelini aç/kapat |
| F5 | Listeyi yenile |
| Enter | Klasöre gir / dosyayı aktar |
| Backspace | Üst klasör |
| F2 | Yeniden adlandır |
| Delete | Sil (yerelde Geri Dönüşüm Kutusu'na) |
| Ctrl+A | Tümünü seç |
| Ctrl+tık / Shift+tık | Çoklu seçim / aralık seçimi |
| ↑ ↓ (Shift ile) | Satırlar arasında gezin (seçimi genişlet) |
| Aktarım ağacında ← → | Klasörü daralt / genişlet |
| Aktarım ağacında Delete | Süren aktarımı iptal et ya da biteni listeden kaldır |

Ayrıca paneller arasında ve Windows Gezgini'nden sunucuya sürükle-bırak desteklenir.

## İçe / dışa aktarım

- FileZilla, CuteFTP veya başka istemcilerden site içe aktarma **yoktur**; dosyaya dışa aktarma da yoktur.
- Siteler Mastertool hesabıyla uçtan uca şifreli senkronlanarak cihazlar arasında taşınır.

## Diller

Türkçe, English, Français, Deutsch, Español, العربية (sağdan sola), 中文 (Basitleştirilmiş), Русский. İlk açılışta Windows dili seçilir; listede yoksa İngilizce. Arapçada pencere sağdan sola dönerken yollar, adresler ve boyutlar soldan sağa kalır.

## Sürüm geçmişi

| Sürüm | Tarih | Öne çıkanlar |
| --- | --- | --- |
| 1.0.0 | 15.10.2026 | İlk sürüm: site kartları ve klasörler; FTP, FTPS (Implicit, AUTH SSL, AUTH TLS), SFTP; Bilgisayarım + sunucu + aktarım ağacı; eşzamanlı aktarım, tekrar deneme, global hız sınırı; Gece/Gündüz teması; Türkçe ve İngilizce |
| 1.1.0 | 15.10.2026 | Mastertool hesabıyla giriş, “Beni hatırla”, uçtan uca şifreli site senkronu, yeni sürüm bildirimi |
| 1.2.0 | 15.10.2026 | Animasyonlu Mastertool düğmesi |
| 1.3.0 | 16.10.2026 | 8 dil, varsayılan Sistem teması, bölümlü Ayarlar (Genel · Hesap · Aktarımlar · Hakkında), Windows açılışında başlatma, Mastertool kurulum klasörü ve Başlat › Master Tool |

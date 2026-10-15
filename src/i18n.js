// Çeviri motoru ve sözlükler. Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
// SSH Master ile aynı yapı. Yeni metin eklerken "tr" ve "en"e ekleyin; eksik anahtarlar İngilizceye,
// o da yoksa anahtarın kendisine düşer.
(function (root) {
  'use strict';

  const LANGUAGES = {
    tr: { name: 'Türkçe', dir: 'ltr' },
    en: { name: 'English', dir: 'ltr' },
  };

  const STRINGS = {};

  // ---------------------------------------------------------------------------
  STRINGS.tr = {
    'common.cancel': 'İptal', 'common.save': 'Kaydet', 'common.create': 'Oluştur', 'common.ok': 'Tamam',
    'common.delete': 'Sil', 'common.giveUp': 'Vazgeç', 'common.open': 'Aç', 'common.edit': 'Düzenle',
    'common.rename': 'Yeniden adlandır', 'common.refresh': 'Yenile', 'common.newFolder': 'Yeni klasör',
    'common.copyPath': 'Yolu kopyala', 'common.move': 'Taşı', 'common.moveEllipsis': 'Taşı…', 'common.show': 'Göster',
    'common.choose': 'Seç…', 'common.connect': 'Bağlan', 'common.new': 'Yeni', 'common.newName': 'Yeni ad',
    'common.folderName': 'Klasör adı',

    'app.searchPh': 'Sitelerde ara…  (Ctrl+F)', 'app.newConn': 'Yeni site', 'app.settings': 'Ayarlar',
    'app.stats': '{c} site · {f} klasör', 'app.welcome': 'Hoş geldiniz', 'app.results': '“{q}” için sonuçlar',
    'app.all': 'Tüm siteler', 'app.welcomeHint': 'İlk FTP / SFTP sitenizi oluşturun.<br>Sunucu bilgilerini girin, bağlantıyı test edin ve kaydedin.',
    'app.folders': 'Klasörler', 'app.connections': 'Siteler', 'app.dblHint': 'Bağlanmak için karta çift tıklayın',
    'app.noMatch': 'Eşleşen site bulunamadı.', 'app.folderCount': '{n} site',
    'app.newConnHere': 'Bu klasörde yeni site', 'app.newSubfolder': 'Alt klasör oluştur', 'app.keyTag': 'Anahtar',
    'app.lastDir': 'Son klasör', 'app.lastDirTag': 'son klasör', 'app.duplicate': 'Kopyasını oluştur',
    'app.moveToFolder': 'Klasöre taşı…', 'app.resetLastDir': 'Son klasörü sıfırla', 'app.connMoved': 'Site taşındı',
    'app.folderIntoSelf': 'Klasör kendi içine taşınamaz', 'app.folderPh': 'Örn. Müşteriler', 'app.renameFolder': 'Klasörü yeniden adlandır',
    'app.deleteFolder': 'Klasörü sil', 'app.deleteFolderMsg': '<b>{name}</b> klasörü silinsin mi?',
    'app.deleteFolderConns': '<br>İçindeki {n} site üst klasöre taşınacak.', 'app.rootFolder': 'Ana dizin (klasörsüz)',
    'app.moveTitle': '“{name}” taşı', 'app.targetFolder': 'Hedef klasör', 'app.deleteConn': 'Siteyi sil',
    'app.deleteConnMsg': '<b>{name}</b> ({target}) sitesi silinsin mi?',

    'form.titleNew': 'Yeni site', 'form.titleEdit': 'Site özellikleri: {name}',
    'form.tabGeneral': 'Genel', 'form.tabActions': 'Eylemler', 'form.tabType': 'Tür', 'form.tabOptions': 'Seçenekler',
    'form.name': 'Etiket (görünen ad)', 'form.namePh': 'Örn. Şirket web sitesi', 'form.host': 'Sunucu adresi',
    'form.hostPh': 'ftp.ornek.com veya 192.168.1.10', 'form.port': 'Port', 'form.user': 'Kullanıcı adı',
    'form.password': 'Şifre', 'form.pwSaved': '•••••••• (kayıtlı, değiştirmek için yazın)',
    'form.loginMethod': 'Giriş yöntemi', 'form.loginNormal': 'Normal', 'form.loginAnon': 'Anonim',
    'form.auth': 'SFTP kimlik doğrulama', 'form.privateKey': 'Özel anahtar', 'form.keyFile': 'Özel anahtar dosyası',
    'form.passphrase': 'Anahtar parolası', 'form.passSaved': '(kayıtlı)', 'form.passEmpty': 'Yoksa boş bırakın',
    'form.folder': 'Klasör', 'form.color': 'Renk', 'form.comments': 'Notlar',
    'form.remoteDir': 'Bağlanınca bu uzak klasöre geç', 'form.localDir': 'Bağlanınca bu yerel klasöre geç',
    'form.localDirPh': 'Örn. C:\\Projeler\\site', 'form.lastDir': 'Son kaldığım klasöre git',
    'form.lastDirHint': 'Açıkken site, en son çalıştığınız sunucu ve bilgisayar klasörleriyle açılır (yukarıdaki klasörlerin yerine).',
    'form.lastDirNow': 'Şu an:', 'form.cache': 'Gezinmede önbellek kullanımı',
    'form.cacheSession': 'Oturum boyunca önbellek kullan', 'form.cacheAlways': 'Her zaman önbellek kullan (uygulama açık kaldıkça)',
    'form.cacheNever': 'Önbellek kullanma (her seferinde yeniden listele)',
    'form.uploadCase': 'Yüklerken dosya ve klasör adlarına uygulanacak kural', 'form.casePreserve': 'Büyük/küçük harfi koru',
    'form.caseLower': 'Küçük harfe çevir', 'form.caseUpper': 'Büyük harfe çevir',
    'form.test': 'Bağlantıyı dene', 'form.saveConnect': 'Kaydet ve bağlan', 'form.connecting': 'Bağlanılıyor…',
    'form.testOk': 'Bağlantı başarılı', 'form.testFail': 'Bağlantı kurulamadı', 'form.homeDir': 'Başlangıç klasörü: {dir}',
    'form.remoteDirMissing': 'Uyarı: belirtilen uzak klasör açılamadı.', 'form.hostKey': 'SSH host anahtarı (SHA256): {fp}',
    'form.saved': 'Site kaydedildi', 'form.changesSaved': 'Değişiklikler kaydedildi',

    'type.protocol': 'Protokol', 'type.ftp': 'FTP (standart dosya aktarım protokolü)',
    'type.ftpsImplicit': 'FTP — TLS/SSL (Implicit, port 990)', 'type.ftpsSsl': 'FTP — SSL (AUTH SSL, Explicit)',
    'type.ftpsTls': 'FTP — TLS/SSL (AUTH TLS, Explicit)', 'type.sftp': 'SFTP — SSH2 (Güvenli Kabuk)',
    'type.note.ftp': 'Komut ve veri bağlantıları için standart FTP kullanılır; şifre ve dosyalar şifrelenmeden (düz metin) gönderilir.',
    'type.note.ftps-implicit': 'Bağlantı en baştan TLS/SSL ile şifrelenir (genellikle port 990). Komutlar ve veriler korunur.',
    'type.note.ftps-ssl': 'Düz FTP ile bağlanıp AUTH SSL komutuyla şifreli oturuma geçilir. Komutlar ve veriler korunur.',
    'type.note.ftps-tls': 'Düz FTP ile bağlanıp AUTH TLS komutuyla şifreli oturuma geçilir (en yaygın FTPS türü).',
    'type.note.sftp': 'SSH üzerinden şifreli dosya aktarımı (port 22). Şifre veya özel anahtarla giriş yapılır; sunucu host anahtarı ilk bağlantıda kaydedilir.',
    'type.transferType': 'Aktarım türü', 'type.binary': 'İkili (Binary)', 'type.ascii': 'ASCII (metin)',
    'type.auto': 'Otomatik (metin dosyaları ASCII)', 'type.useGlobal': 'Genel ayarı kullan ({v})',
    'type.dataConn': 'Veri bağlantısı', 'type.passive': 'Pasif (PASV / EPSV)',
    'type.timezone': 'Sunucu saat dilimi farkı', 'type.tzNone': 'Fark yok', 'type.tzHours': 'saat',
    'type.timezoneHint': 'Sunucunun listelediği dosya saatleri bu kadar kaydırılarak gösterilir.',

    'opt.siteOptions': 'Siteye özel ayarlar', 'opt.useGlobal': 'Tüm seçenekler için genel ayarları kullan',
    'opt.custom': 'Bu siteye özel ayarlar kullan', 'opt.retry': 'Tekrar deneme sayısı',
    'opt.retryDelay': 'Denemeler arası bekleme (sn)', 'opt.maxConcurrent': 'Aynı anda en fazla aktarım',
    'opt.conflict': 'Hedefte aynı adlı dosya varsa', 'opt.conflictOverwrite': 'Üzerine yaz',
    'opt.conflictRename': 'Otomatik yeniden adlandır (ad (1).uzantı)', 'opt.conflictSkip': 'Atla',
    'opt.encoding': 'Dosya adı kodlaması', 'opt.encAuto': 'Otomatik',

    'set.title': 'Ayarlar', 'set.appearance': 'Görünüm', 'set.theme': 'Tema', 'set.themeDark': 'Gece',
    'set.themeLight': 'Gündüz', 'set.themeSystem': 'Sistem', 'set.language': 'Dil',
    'set.toLight': 'Gündüz temasına geç', 'set.toDark': 'Gece temasına geç',
    'set.speed': 'Hız sınırı', 'set.speedOn': 'En yüksek aktarım hızını sınırla',
    'set.speedHint': 'Açıkken tüm sitelerdeki indirme ve yüklemelerin toplam hızı bu değeri geçmez.',
    'set.speedMax': 'En yüksek hız', 'set.transfers': 'Aktarımlar (genel ayarlar)', 'set.saved': 'Ayarlar kaydedildi',

    'site.local': 'Bilgisayarım', 'site.remote': 'Sunucu', 'site.transfers': 'Aktarımlar',
    'site.toggleLocal': 'Bilgisayarım panelini aç/kapat (Ctrl+B)', 'site.toggleTransfers': 'Aktarımlar panelini aç/kapat (Ctrl+J)',
    'site.reconnect': 'Yeniden bağlan', 'site.places': 'Hızlı erişim ve sürücüler', 'site.up': 'Üst klasör (Backspace)',
    'site.home': 'Başlangıç klasörü', 'site.colName': 'Ad', 'site.colSize': 'Boyut', 'site.colDate': 'Değiştirilme',
    'site.loading': 'Yükleniyor…', 'site.emptyDir': 'Bu klasör boş',
    'site.desktop': 'Masaüstü', 'site.downloads': 'İndirilenler', 'site.documents': 'Belgeler', 'site.homeDir': 'Kullanıcı klasörü',
    'site.openExplorer': 'Gezgin\'de aç', 'site.openFile': 'Varsayılan uygulamayla aç', 'site.showExplorer': 'Gezgin\'de göster',
    'site.upload': 'Yükle (Upload)', 'site.uploadN': '{n} öğeyi yükle (Upload)', 'site.uploadTo': 'Hedef: {dir}',
    'site.download': 'İndir (Download)', 'site.downloadN': '{n} öğeyi indir (Download)', 'site.downloadTo': 'Hedef: {dir}',
    'site.trash': 'Geri Dönüşüm Kutusu\'na taşı', 'site.trashOk': 'Taşı', 'site.trashOne': '<b>{name}</b> Geri Dönüşüm Kutusu\'na taşınsın mı?',
    'site.trashMany': '{n} öğe Geri Dönüşüm Kutusu\'na taşınsın mı?', 'site.mkdirFail': 'Klasör oluşturulamadı',
    'site.renameFail': 'Yeniden adlandırılamadı', 'site.deleteFail': 'Silinemedi', 'site.deleteTitle': 'Sunucudan sil',
    'site.delOne': '<b>{name}</b> dosyası sunucudan kalıcı olarak silinsin mi?',
    'site.delDirOne': '<b>{name}</b> klasörü ve tüm içeriği sunucudan kalıcı olarak silinsin mi?',
    'site.delMany': '{n} öğe (klasörler tüm içerikleriyle) sunucudan kalıcı olarak silinsin mi?',
    'site.deleting': 'Siliniyor…', 'site.deleted': 'Silindi', 'site.items': '{n} öğe', 'site.offline': 'Bağlı değil',
    'site.limit': 'Hız sınırı: {v}', 'site.noLimit': 'Hız sınırı yok', 'site.limitTitle': 'Hız sınırını ayarla',
    'site.connectFail': 'Sunucuya bağlanılamadı: {msg}', 'site.connectFailTitle': 'Bağlantı kurulamadı',
    'site.state.connected': 'Bağlı', 'site.state.connecting': 'Bağlanılıyor…', 'site.state.disconnected': 'Bağlantı yok',

    'tr.colName': 'Ad', 'tr.colSize': 'Boyut', 'tr.colProgress': 'İlerleme', 'tr.colStatus': 'Durum',
    'tr.empty': 'Henüz aktarım yok.\nBir dosyaya veya klasöre sağ tıklayıp İndir / Yükle seçin ya da paneller arasında sürükleyin.',
    'tr.queued': 'Sırada', 'tr.active': 'Aktarılıyor', 'tr.done': 'Tamamlandı', 'tr.doneFiles': '{n} dosya tamam',
    'tr.error': 'Hata', 'tr.cancelled': 'İptal edildi', 'tr.skipped': 'Atlandı (mevcut)', 'tr.scanning': 'Taranıyor… {n} dosya',
    'tr.retrying': 'Tekrar denenecek…', 'tr.cancel': 'İptal et', 'tr.cancelDir': 'Klasör aktarımını iptal et',
    'tr.cancelAll': 'Tüm aktarımları iptal et', 'tr.cancelAllMsg': 'Süren ve sıradaki tüm aktarımlar iptal edilsin mi?',
    'tr.cancelAllOk': 'Tümünü iptal et', 'tr.retry': 'Yeniden dene', 'tr.showLocal': 'Gezgin\'de göster',
    'tr.showRemote': 'Sunucuda göster', 'tr.copyError': 'Hata mesajını kopyala', 'tr.remove': 'Listeden kaldır',
    'tr.removeRoot': 'Bu aktarımı listeden kaldır', 'tr.clearDone': 'Bitenleri temizle', 'tr.activeN': '{n} aktarım sürüyor',
    'tr.downloadDone': 'İndirme tamamlandı', 'tr.uploadDone': 'Yükleme tamamlandı', 'tr.downloadFailed': 'İndirme tamamlanamadı: {name}',
    'tr.uploadFailed': 'Yükleme tamamlanamadı: {name}', 'tr.failedFiles': '{n} dosya aktarılamadı',

    'main.errAuth': 'Giriş başarısız: kullanıcı adı veya şifre hatalı.',
    'main.errRefused': 'Bağlantı reddedildi: port kapalı veya sunucu çalışmıyor.',
    'main.errTimeout': 'Zaman aşımı: sunucuya ulaşılamadı.', 'main.errDns': 'Sunucu adresi çözümlenemedi (DNS).',
    'main.errUnreach': 'Sunucuya ağ üzerinden erişilemiyor.', 'main.errReset': 'Sunucu bağlantıyı kapattı.',
    'main.errNotFound': 'Dosya veya klasör bulunamadı.', 'main.errPerm': 'Erişim izni yok.',
    'main.err550': 'Sunucu işlemi reddetti (550): {msg}', 'main.err553': 'Dosya adı sunucu tarafından kabul edilmedi (553).',
    'main.errTls': 'TLS/SSL hatası — protokolü veya portu kontrol edin. ({msg})',
    'main.errHostKey': 'Sunucunun host anahtarı değişmiş! Kayıtlı: {old}, gelen: {new}. Güvenlik için bağlantı reddedildi.',
    'main.errConnNotFound': 'Site bulunamadı', 'main.errNoSession': 'Sunucuya bağlı değil',
    'main.errHost': 'Sunucu adresi gerekli.', 'main.errUser': 'Kullanıcı adı gerekli (veya Anonim girişi seçin).',
    'main.pickKey': 'Özel anahtar dosyası seçin', 'main.copySuffix': ' (kopya)',
    'main.closeActive': 'Süren aktarımlar var. Pencere kapatılırsa iptal edilecekler.', 'main.closeAnyway': 'Yine de kapat',
  };

  // ---------------------------------------------------------------------------
  STRINGS.en = {
    'common.cancel': 'Cancel', 'common.save': 'Save', 'common.create': 'Create', 'common.ok': 'OK',
    'common.delete': 'Delete', 'common.giveUp': 'Cancel', 'common.open': 'Open', 'common.edit': 'Edit',
    'common.rename': 'Rename', 'common.refresh': 'Refresh', 'common.newFolder': 'New folder',
    'common.copyPath': 'Copy path', 'common.move': 'Move', 'common.moveEllipsis': 'Move…', 'common.show': 'Show',
    'common.choose': 'Browse…', 'common.connect': 'Connect', 'common.new': 'New', 'common.newName': 'New name',
    'common.folderName': 'Folder name',

    'app.searchPh': 'Search sites…  (Ctrl+F)', 'app.newConn': 'New site', 'app.settings': 'Settings',
    'app.stats': '{c} sites · {f} folders', 'app.welcome': 'Welcome', 'app.results': 'Results for “{q}”',
    'app.all': 'All sites', 'app.welcomeHint': 'Create your first FTP / SFTP site.<br>Enter the server details, test the connection and save.',
    'app.folders': 'Folders', 'app.connections': 'Sites', 'app.dblHint': 'Double-click a card to connect',
    'app.noMatch': 'No matching sites.', 'app.folderCount': '{n} sites',
    'app.newConnHere': 'New site in this folder', 'app.newSubfolder': 'New subfolder', 'app.keyTag': 'Key',
    'app.lastDir': 'Last folder', 'app.lastDirTag': 'last folder', 'app.duplicate': 'Duplicate',
    'app.moveToFolder': 'Move to folder…', 'app.resetLastDir': 'Reset last folder', 'app.connMoved': 'Site moved',
    'app.folderIntoSelf': 'A folder cannot be moved into itself', 'app.folderPh': 'e.g. Customers', 'app.renameFolder': 'Rename folder',
    'app.deleteFolder': 'Delete folder', 'app.deleteFolderMsg': 'Delete the folder <b>{name}</b>?',
    'app.deleteFolderConns': '<br>Its {n} sites will be moved to the parent folder.', 'app.rootFolder': 'Top level (no folder)',
    'app.moveTitle': 'Move “{name}”', 'app.targetFolder': 'Target folder', 'app.deleteConn': 'Delete site',
    'app.deleteConnMsg': 'Delete the site <b>{name}</b> ({target})?',

    'form.titleNew': 'New site', 'form.titleEdit': 'Site properties: {name}',
    'form.tabGeneral': 'General', 'form.tabActions': 'Actions', 'form.tabType': 'Type', 'form.tabOptions': 'Options',
    'form.name': 'Label', 'form.namePh': 'e.g. Company website', 'form.host': 'Host address',
    'form.hostPh': 'ftp.example.com or 192.168.1.10', 'form.port': 'Port', 'form.user': 'Username',
    'form.password': 'Password', 'form.pwSaved': '•••••••• (saved, type to change)',
    'form.loginMethod': 'Login method', 'form.loginNormal': 'Normal', 'form.loginAnon': 'Anonymous',
    'form.auth': 'SFTP authentication', 'form.privateKey': 'Private key', 'form.keyFile': 'Private key file',
    'form.passphrase': 'Key passphrase', 'form.passSaved': '(saved)', 'form.passEmpty': 'Leave empty if none',
    'form.folder': 'Folder', 'form.color': 'Color', 'form.comments': 'Comments',
    'form.remoteDir': 'When connected, switch to this remote folder', 'form.localDir': 'When connected, switch to this local folder',
    'form.localDirPh': 'e.g. C:\\Projects\\site', 'form.lastDir': 'Go to the folder where I left off',
    'form.lastDirHint': 'When on, the site opens in the server and computer folders you last worked in (instead of the folders above).',
    'form.lastDirNow': 'Now:', 'form.cache': 'Caching for navigation',
    'form.cacheSession': 'Use cache during session', 'form.cacheAlways': 'Always use cache (while the app is open)',
    'form.cacheNever': 'Never use cache (always list again)',
    'form.uploadCase': 'When uploading, apply this rule to file and folder names', 'form.casePreserve': 'Preserve case',
    'form.caseLower': 'Lowercase', 'form.caseUpper': 'Uppercase',
    'form.test': 'Test connection', 'form.saveConnect': 'Save and connect', 'form.connecting': 'Connecting…',
    'form.testOk': 'Connection successful', 'form.testFail': 'Could not connect', 'form.homeDir': 'Start folder: {dir}',
    'form.remoteDirMissing': 'Warning: the remote folder could not be opened.', 'form.hostKey': 'SSH host key (SHA256): {fp}',
    'form.saved': 'Site saved', 'form.changesSaved': 'Changes saved',

    'type.protocol': 'Protocol', 'type.ftp': 'FTP (standard File Transfer Protocol)',
    'type.ftpsImplicit': 'FTP with TLS/SSL (Implicit, port 990)', 'type.ftpsSsl': 'FTP with SSL (AUTH SSL, Explicit)',
    'type.ftpsTls': 'FTP with TLS/SSL (AUTH TLS, Explicit)', 'type.sftp': 'SFTP using SSH2 (Secure Shell)',
    'type.note.ftp': 'Uses the industry standard FTP protocol for both command and data connections in a non-secure (plain-text) fashion.',
    'type.note.ftps-implicit': 'The connection is encrypted with TLS/SSL from the start (usually port 990). Commands and data are protected.',
    'type.note.ftps-ssl': 'Connects with plain FTP and switches to an encrypted session with AUTH SSL. Commands and data are protected.',
    'type.note.ftps-tls': 'Connects with plain FTP and switches to an encrypted session with AUTH TLS (the most common FTPS type).',
    'type.note.sftp': 'Encrypted file transfer over SSH (port 22). Log in with a password or private key; the host key is saved on first connect.',
    'type.transferType': 'Transfer type', 'type.binary': 'Binary', 'type.ascii': 'ASCII (text)',
    'type.auto': 'Auto (text files as ASCII)', 'type.useGlobal': 'Use global setting ({v})',
    'type.dataConn': 'Data connection', 'type.passive': 'Passive (PASV / EPSV)',
    'type.timezone': 'Server time zone offset', 'type.tzNone': 'No offset', 'type.tzHours': 'hours',
    'type.timezoneHint': 'File times listed by the server are shifted by this amount.',

    'opt.siteOptions': 'Site specific options', 'opt.useGlobal': 'Use global settings for all options',
    'opt.custom': 'Use settings specific to this site', 'opt.retry': 'Retry attempts',
    'opt.retryDelay': 'Delay between retries (s)', 'opt.maxConcurrent': 'Max concurrent transfers',
    'opt.conflict': 'If a file with the same name exists', 'opt.conflictOverwrite': 'Overwrite',
    'opt.conflictRename': 'Auto-rename (name (1).ext)', 'opt.conflictSkip': 'Skip',
    'opt.encoding': 'Filename encoding', 'opt.encAuto': 'Auto',

    'set.title': 'Settings', 'set.appearance': 'Appearance', 'set.theme': 'Theme', 'set.themeDark': 'Night',
    'set.themeLight': 'Day', 'set.themeSystem': 'System', 'set.language': 'Language',
    'set.toLight': 'Switch to day theme', 'set.toDark': 'Switch to night theme',
    'set.speed': 'Speed limit', 'set.speedOn': 'Limit the maximum transfer speed',
    'set.speedHint': 'When on, the combined speed of all downloads and uploads across all sites stays below this value.',
    'set.speedMax': 'Maximum speed', 'set.transfers': 'Transfers (global settings)', 'set.saved': 'Settings saved',

    'site.local': 'My computer', 'site.remote': 'Server', 'site.transfers': 'Transfers',
    'site.toggleLocal': 'Show/hide My computer (Ctrl+B)', 'site.toggleTransfers': 'Show/hide Transfers (Ctrl+J)',
    'site.reconnect': 'Reconnect', 'site.places': 'Quick access and drives', 'site.up': 'Parent folder (Backspace)',
    'site.home': 'Start folder', 'site.colName': 'Name', 'site.colSize': 'Size', 'site.colDate': 'Modified',
    'site.loading': 'Loading…', 'site.emptyDir': 'This folder is empty',
    'site.desktop': 'Desktop', 'site.downloads': 'Downloads', 'site.documents': 'Documents', 'site.homeDir': 'User folder',
    'site.openExplorer': 'Open in Explorer', 'site.openFile': 'Open with default app', 'site.showExplorer': 'Show in Explorer',
    'site.upload': 'Upload', 'site.uploadN': 'Upload {n} items', 'site.uploadTo': 'Target: {dir}',
    'site.download': 'Download', 'site.downloadN': 'Download {n} items', 'site.downloadTo': 'Target: {dir}',
    'site.trash': 'Move to Recycle Bin', 'site.trashOk': 'Move', 'site.trashOne': 'Move <b>{name}</b> to the Recycle Bin?',
    'site.trashMany': 'Move {n} items to the Recycle Bin?', 'site.mkdirFail': 'Could not create folder',
    'site.renameFail': 'Could not rename', 'site.deleteFail': 'Could not delete', 'site.deleteTitle': 'Delete from server',
    'site.delOne': 'Permanently delete the file <b>{name}</b> from the server?',
    'site.delDirOne': 'Permanently delete the folder <b>{name}</b> and everything in it from the server?',
    'site.delMany': 'Permanently delete {n} items (folders with all their contents) from the server?',
    'site.deleting': 'Deleting…', 'site.deleted': 'Deleted', 'site.items': '{n} items', 'site.offline': 'Not connected',
    'site.limit': 'Speed limit: {v}', 'site.noLimit': 'No speed limit', 'site.limitTitle': 'Set speed limit',
    'site.connectFail': 'Could not connect to the server: {msg}', 'site.connectFailTitle': 'Connection failed',
    'site.state.connected': 'Connected', 'site.state.connecting': 'Connecting…', 'site.state.disconnected': 'Disconnected',

    'tr.colName': 'Name', 'tr.colSize': 'Size', 'tr.colProgress': 'Progress', 'tr.colStatus': 'Status',
    'tr.empty': 'No transfers yet.\nRight-click a file or folder and choose Download / Upload, or drag between the panels.',
    'tr.queued': 'Queued', 'tr.active': 'Transferring', 'tr.done': 'Finished', 'tr.doneFiles': '{n} files finished',
    'tr.error': 'Error', 'tr.cancelled': 'Cancelled', 'tr.skipped': 'Skipped (exists)', 'tr.scanning': 'Scanning… {n} files',
    'tr.retrying': 'Will retry…', 'tr.cancel': 'Cancel', 'tr.cancelDir': 'Cancel folder transfer',
    'tr.cancelAll': 'Cancel all transfers', 'tr.cancelAllMsg': 'Cancel all running and queued transfers?',
    'tr.cancelAllOk': 'Cancel all', 'tr.retry': 'Retry', 'tr.showLocal': 'Show in Explorer',
    'tr.showRemote': 'Show on server', 'tr.copyError': 'Copy error message', 'tr.remove': 'Remove from list',
    'tr.removeRoot': 'Remove this transfer from list', 'tr.clearDone': 'Clear finished', 'tr.activeN': '{n} transfers running',
    'tr.downloadDone': 'Download finished', 'tr.uploadDone': 'Upload finished', 'tr.downloadFailed': 'Download incomplete: {name}',
    'tr.uploadFailed': 'Upload incomplete: {name}', 'tr.failedFiles': '{n} files failed',

    'main.errAuth': 'Login failed: wrong username or password.',
    'main.errRefused': 'Connection refused: the port is closed or the server is not running.',
    'main.errTimeout': 'Timed out: the server could not be reached.', 'main.errDns': 'Could not resolve the host name (DNS).',
    'main.errUnreach': 'The server is unreachable on the network.', 'main.errReset': 'The server closed the connection.',
    'main.errNotFound': 'File or folder not found.', 'main.errPerm': 'Permission denied.',
    'main.err550': 'The server refused the operation (550): {msg}', 'main.err553': 'The server did not accept the file name (553).',
    'main.errTls': 'TLS/SSL error — check the protocol or port. ({msg})',
    'main.errHostKey': 'The server host key has changed! Saved: {old}, received: {new}. The connection was refused for security.',
    'main.errConnNotFound': 'Site not found', 'main.errNoSession': 'Not connected to the server',
    'main.errHost': 'Host address is required.', 'main.errUser': 'Username is required (or choose Anonymous login).',
    'main.pickKey': 'Choose a private key file', 'main.copySuffix': ' (copy)',
    'main.closeActive': 'Transfers are still running. They will be cancelled if you close this window.', 'main.closeAnyway': 'Close anyway',
  };

  // ---------------------------------------------------------------------------
  // Dil kodunu (ör. "tr-TR") desteklenen bir dile çevirir
  function resolveLanguage(code) {
    const c = String(code || '').toLowerCase().split(/[-_]/)[0];
    return LANGUAGES[c] ? c : 'en';
  }

  function createT(lang) {
    const dict = STRINGS[lang] || STRINGS.en;
    return function t(key, vars) {
      let s = dict[key] ?? STRINGS.en[key] ?? key;
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
      return s;
    };
  }

  const api = { LANGUAGES, STRINGS, resolveLanguage, createT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof self !== 'undefined' ? self : this);

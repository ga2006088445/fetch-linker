### daily-task

GAMER_COOKIE => 巴哈登入後的 cookie, 需要有其 `BAHAENUR` & `BAHARUNE` & `cf_clearance`
其中 `cf_clearance` 是防止被認為是自動化, 應該與 IP 有相關, 所以需要使用 SOCKS5 方式取得其主機 IP 對應的 `cf_clearance`, 請利用 `SOCKS5_PROXY` 讓工具與瀏覽器由同一台主機發送

### daily-task-by-pwd

GAMER_USERNAME => 帳號
GAMER_PASSWORD => 密碼
GAMER_COOKIE => `cf_clearance` 還是需要, 可透過查看 `https://ani.gamer.com.tw/ajax/animeGetQuestion.php`, 請利用 `SOCKS5_PROXY` 讓工具與瀏覽器由同一台主機發送


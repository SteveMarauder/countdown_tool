# CDTT × AI 賽事倒數計時器

正式部署架構：GitHub Pages 前台＋Cloudflare Workers API＋D1 SQLite。
視覺沿用原 assets 中的台中夜景與 Logo：深藍 `#04101A`、青 `#55DEF8`、紫 `#7C72FF`、金 `#F3C675`。

## 本機預覽

需要 Node.js 24（或支援內建 SQLite 的 Node.js 22.13 以上）。

```powershell
npm run dev
```

開啟 http://127.0.0.1:8787 。本機不用安裝套件即可執行與測試。
另開 PowerShell，在專案根目錄建立自己的本機帳戶：

```powershell
powershell -File scripts/Setup-Admin.ps1 -Local
```

密碼至少 12 字元，以隱藏輸入讀取，不會寫入程式、網頁或命令列參數。
本機資料保存在 `work/local.sqlite`，重啟後保留賽事與帳戶。
本機時間 API 刻意使用電腦時間，頁面標示本機測試；正式 Worker 才使用外部 UTC 校時。

## 正式部署

### 1. Cloudflare 後端

```powershell
npm install
npx wrangler login
npx wrangler d1 create contest-clock
```

將回傳的 `database_id` 填入 `wrangler.toml`。
將 `ALLOWED_ORIGINS` 改成 GitHub Pages 的來源，例如 `https://steve.github.io`（沒有儲存庫路徑、沒有結尾斜線）。
多個前台來源用逗號分隔；只允許實際使用的網址。

```powershell
npm run db:migrate
powershell -File scripts/Setup-Admin.ps1
npx wrangler d1 execute contest-clock --remote --file=work/admin.sql
npm run deploy:api
```

也可以執行 `powershell -File scripts/Setup-Admin.ps1 -Publish`，在隱藏輸入密碼後直接匯入正式 D1。

`work/admin.sql` 只有鹽值與密碼雜湊；檔案不會提交或發布。匯入後可以自行刪除。
重跑帳戶建立並匯入會更新該帳戶密碼，撤銷該帳戶既有登入。
每個管理者使用不同帳戶，才能辨識操作紀錄。
SQL schema 為非破壞性初始化，重新執行不會把進行中的賽事重設。

### 2. GitHub 前台

將 Worker 部署回傳的 HTTPS 網址填入 `public/config.js`：

```javascript
window.CLOCK_CONFIG = {
  apiBase: "https://cdtt-contest-clock.YOUR-SUBDOMAIN.workers.dev",
  pollMs: 5000,
  syncMs: 60000
};
```

將完整專案提交至 GitHub 儲存庫的 `main` 分支。
進入 Settings → Pages → Source，選擇 GitHub Actions。
再進入 Settings → Secrets and variables → Actions → Variables，新增 `CLOCK_API_URL`，值為 Worker 的 HTTPS 來源網址。
工作流程會自動用這個變數產生正式前台設定，覆蓋公開目錄的本機預設。
未設定 `CLOCK_API_URL` 時只執行測試，不發布尚未連接後端的前台。
設定好後到 Actions 手動執行 Deploy competition clock to GitHub Pages。
內附 `.github/workflows/pages.yml` 會先測試，再只發布 `public/`。
後端、管理者帳戶與本機資料不在公開前台目錄內。
GitHub 儲存庫根目錄必須直接包含 `package.json`、`public/`、`.github/`。

若 Worker 使用自訂網域，請同步調整 `public/index.html` 的 CSP `connect-src`，加入該後端的 HTTPS 來源。
修改離線資源清單／不相容版本時，同時更新 `public/sw.js` 的 CACHE 版本。
D1 定時清理由 Worker cron 每 15 分鐘移除到期登入與舊登入限制。

## 現場操作

1. 開啟前台，確認已連線與 UTC 已校準。
2. 管理者登入後輸入賽事名稱、說明、小時／分鐘／秒並儲存。
3. 可指定台北時間的截止日期與時間；留空會從按下開始時倒數設定時長。
4. 「開始」需要確認；「暫停」保留剩餘時間，「繼續」重新计算截止時間。
5. 修改進行中賽事的時長必須先「重設」。重設會清除目前進度。
6. 全螢幕按鈕適合投影，最後 5 分鐘和時間到會切換金色提示。

多個管理者同時操作會檢查版本；較晚且使用舊設定的操作會被拒絕並更新畫面。
設定通常於 5 秒內傳達到其他顯示器。這不是同步硬體秒表，網路延遲會造成短暫差異。
操作結果若因斷線未知，程式會先重讀狀態，不會自動重送開始／重設指令。
管理登入 token 只存在分頁記憶體，重整後重新登入；有效期 8 小時，登出會撤銷。

## 計時與容錯

- 資料庫儲存絕對 UTC 截止時間；剩餘時間＝截止時間−目前校準 UTC。
- Worker 每分鐘最多更新一次外部時間參考，透過 HTTPS 向 WorldTimeAPI `Etc/UTC` 取樣。
- 外部回應超時、無效或與平台時間偏差超過 10 秒時，回退 Cloudflare UTC，畫面會說明。
- 前台每分鐘取三個樣本，採用往返延遲最短者並補償半個往返時間。
- 校準後使用 `performance.now()` 單調時鐘，修改電腦日期不影響已開啟畫面的倒數。
- 暫時斷線仍依最後截止時間繼續倒數；自動重連後再次取得資料庫與 UTC。
- 網頁首次成功載入後，Service Worker 保存畫面與素材，GitHub 故障時可回退離線畫面。
- 離線重新開啟只能使用電腦時間＋上次偏移量估算，明確標示待校準；恢復連線才重新確認。
- 回到背景分頁、電腦喚醒及重新上線皆會觸發校時。
- 頁面顯示的 ±ms 是網路取樣估計，並非經認證的 UTC 絕對準確度。

此設計可恢復倒數狀態，不能防止 GitHub、Cloudflare 或網路本身發生故障，也無法在完全離線時得知另一位管理者的操作。
HTTPS 校時不是直接 NTP/PTP，也沒有 UTC 認證或毫秒級同步保證。
正式賽事前請在實際投影電腦測試斷網、重新整理、重連、系統休眠與多台顯示器；首次載入失敗且無快取時無法顯示。
資料庫刪除、帳戶遺失或瀏覽器清除快取不屬於前台可自動恢復範圍。建議赛前匯出資料庫備份並準備備用裝置。

## 驗證

```powershell
npm test
```

涵蓋截止時間恢復、系統時間改動、168 小時邊界、暫停／繼續、指定截止時間、未登入拒絕、來源限制、登入／登出、登入頻率限制、並行版本衝突及管理操作紀錄。
測試使用實際 SQLite；仍需部署後驗證 Cloudflare D1、外部校時供應者、CORS 與 GitHub Pages 的整合。

## 官方參考

- [GitHub Pages 靜態網站說明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Cloudflare D1 Worker API](https://developers.cloudflare.com/d1/worker-api/)
- [Cloudflare Wrangler 設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [WorldTimeAPI](https://worldtimeapi.org/)

# 星旅日誌 Startrail Calendar — V2.1 Discord 公告版

FF14 朋友專屬共用行事曆：手機優先的星空冒險風網站，支援 Google 登入、好友邀請、開團、+1／取消、候補、可複選坦／補／輸出職業、主揪正式排位、4／8／24 人隊伍總覽，及複製活動名單到 Discord。

## 目前狀態

- 本次 **V2.1 的程式碼與模擬測試已完成**；你原本的 V2.0.1 網站已在 Vercel 運作，但此份 V2.1 ZIP **還沒有更新至你的 GitHub 或 Vercel**，因此也沒有使用你的 Firebase 與 Discord 機器人做真實連線測試。
- `public/demo.html` 是原本 V1.2 的單機互動原型，可先看外觀；`public/index.html` 是要部署的 V2.0 正式資料版。
- Google 登入成功後，每次寫入由伺服器驗證身份，Firebase Admin SDK 處理 Firestore。私人活動不由瀏覽器直接存取資料庫。
- 每次操作後立即重新載入，平常每 30 秒（且沒有開啟編輯視窗時）刷新一次。**不是 Firestore 即時監聽**。Discord **發送／編輯公告**已加入本次 V2.1 程式；Discord 內直接 +1 尚未加入。

## 你已經完成的設定

Firebase 專案：`startrail-calendar`；Web App 已建立。仍需確認 Authentication 的 Google 登入與 Firestore Database 已啟用。

## 1. 在 Firebase 建立伺服器憑證

1. Firebase Console → **專案設定（齒輪）** → **服務帳戶 Service accounts**。
2. **產生新的私密金鑰**，取得 JSON 檔。
3. 請保密：**不要貼到聊天室、不要上傳到 GitHub、不要放進 `public/`，也不要把它寫進前端 `auth.js`。**
4. 這份 JSON **只放入 Vercel 專案環境變數** `FIREBASE_SERVICE_ACCOUNT_JSON`。注意整段 JSON 需維持合法格式。若複製 JSON 原文，`private_key` 的 `\\n` 跳脫字元應保留。
5. 環境變數 `OWNER_EMAIL` 設定為**你自己用來登入 Firebase Google 的 Gmail 地址**，網站第一次登入時才會把該帳號建成管理員；請勿填成其他人的 Email。

## 2. 部署到 Vercel

1. 把整個 `startrail-calendar-v2` 資料夾（**不含任何密鑰**）上傳到一個私人或公開的 GitHub repository。
2. Vercel → Add New Project → Import 該 repository。
3. Framework Preset 選 **Other**；Root Directory 選專案根目錄，Output Directory 使用 `public`。若 Vercel 自動辨識 `vercel.json`，請以該設定為準。
4. Vercel → Settings → Environment Variables 新增：

   | 變數 | 值 |
   |---|---|
   | `FIREBASE_PROJECT_ID` | `startrail-calendar` |
   | `OWNER_EMAIL` | 你的 Google 電子郵件 |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase 下載的完整服務帳戶 JSON，**私密** |

5. 重新 Deploy。這些變數只應用在 Vercel 伺服器函式，**不能命名成公開前端的環境變數**。
6. Firebase → Authentication → Settings → Authorized domains：加入 Vercel 實際部署的**完整網域**（例如 `startrail-calendar.vercel.app`，以你自己的網址為準），否則 Google 登入可能顯示 `auth/unauthorized-domain`。
7. Firebase → Firestore → Rules：貼上專案中的 `firestore.rules`，並按 Publish。**不要**改成任何人都能讀寫。

**重要**：`OWNER_EMAIL` 和服務帳戶憑證設定好之前，伺服器不會自動給任何人管理員權限。

## 3. 第一次使用與邀請朋友

1. 使用 `OWNER_EMAIL` 對應的 Google 帳號登入部署好的網址；第一次會自動建成管理員。
2. 個人資料 → 管理好友邀請 → 輸入朋友的 **Google Email** → 新增邀請。
3. 把網站網址傳給朋友；**邀請操作不會自動寄信**。
4. 朋友以相同 Google Email 登入後，就能建立活動與 +1。未受邀的 Google 帳號無法讀取活動。
5. 預先用兩個不同帳號實測：建立活動、+1、取消、額滿候補、主揪排位、停用成員。

## 4. 在電腦上本機測試（選用）

使用 Node.js 22 以上：

```sh
npm install
cp .env.example .env.local
# 編輯 .env.local 寫入真正值；千萬不要提交到版本控制
node --env-file=.env.local server.mjs
```

接著打開 http://localhost:3000 。如果 Google 登入提示未授權網域，請在 Firebase Authentication > Authorized domains 加入 `localhost`。`npm run test` 可不需連線 Firebase 就先測試核心業務邏輯。

## 檔案結構

```text
public/index.html       真正好友共享網站（V1.2 視覺延續）
public/auth.js          Firebase Web SDK Google 登入（公開設定）
public/demo.html        舊版可互動原型（僅模擬）
api/route.js            Vercel 伺服器 API：驗證 + 邀請 + Firestore
api/domain.js           報名、候補、職業志願與排位規則
firestore.rules         禁止直接以網頁 SDK 讀取/寫入資料
server.mjs              本機測試 HTTP Server
.env.example            部署環境變數範例（沒有真的私密金鑰）
test/domain.test.js     邏輯測試
```

## 已知限制與後續

- 目前活動清單最多載入最新 250 筆；適合小型好友群組。將來可加入分頁和範圍查詢。
- 現在靠**每 30 秒輪詢**同步更新；未來可改成推送 / 實時訂閱。
- 角色暱稱修改後，活動清單會從 `members` 讀取最新暱稱，主揪、報名、候補和 Discord 複製文字在下次載入（自己儲存後立即載入，其他人最多約 30 秒）時一併更新；不修改歷史活動原始紀錄。
- 24 人團採 3 坦 / 6 補 / 15 輸出總覽，不做三隊獨立的聯盟分組。日後可增加 A/B/C 隊。
- 如果職業志願被修改，與新志願不符的既有排位會取消。
- 主揪建立活動後會自動算在報名名額內，且不能直接退出自己的團。
- 目前無自動寄送 Email、Discord 內直接 +1、行事曆訂閱或自動活動提醒。
- **安全性**：公開 Firebase `apiKey` 非伺服器密鑰；真正需要保密的是服務帳戶金鑰。請勿對外洩漏服務帳戶金鑰。
- Firebase Admin SDK 具有伺服器特權，可略過 Firestore Security Rules；因此所有授權均由 `api/route.js` 驗證。

## 無法直接雙擊正式版 HTML

正式版 `public/index.html` 需要 HTTPS 網站、Firebase 登入和 `/api/route` 伺服器函式；不可像舊版一樣只雙擊 HTML 就完成雲端報名。只有 `demo.html` 是離線介面展示。


## V2.0.1 修正：暱稱與活動名稱保持一致

**修正問題**：舊版在建立活動和 +1 時會把角色暱稱複製到 `events`，更新個人暱稱只修改 `members`，造成首頁活動卡片、活動詳情、候補和正式隊伍仍顯示舊名字。

**修正方式**：`api/route.js` 的 `list` 操作以事件中的成員 ID 查詢 `members` 的最新暱稱；只為顯示結果覆蓋舊名字，不覆寫事件、排位或報名資料。已存在的活動不必重建。沒有對應會員資料時保留原存的顯示名稱。

**升級現有 GitHub/Vercel 網站**：請保持原本的 `startrail-calendar-v2` 專案根目錄，用此版取代 `api/route.js`、`api/domain.js`（測試可一併上傳 `test/domain.test.js`），提交 GitHub 後 Vercel 通常會自動重新部署。不需要更改 Firebase 環境變數，也**不需要重新產生任何私密金鑰**。部署成功後，先修改個人暱稱，再重新整理活動首頁、月曆和詳情確認；可以用第二個好友帳號檢查同步。

**資料庫讀取說明**：這種讀取時合併姓名的方式會多讀取活動中涉及的會員文件；目前專為小型好友群組設計，原有每 30 秒輪詢方式未變。規模變大時應改成快取、會員名稱版本控制或分離的會員資料訂閱。


## V2.1：莫古力 Discord 自動公告（本次新增）

### 目前功能

- 每當好友新增活動時，網站成功儲存 Firestore，伺服器就用 Discord Bot 在指定頻道發公告。
- 已公告的活動在修改內容、取消、有人 +1／取消、變更職業志願、主揪排位時，**編輯同一則訊息**，不重複新增公告。
- 公告有活動名稱、開始／結束時間（台灣）、主揪最新 FF14 暱稱、集合地點、報名／候補人數，以及已安排坦補打的統計。
- 點 Discord 公告標題會開網站的對應活動詳情；朋友仍需要 Google 登入和受邀權限。
- 只有主揪與管理員能在活動詳情點擊「☁️ 重新同步 Discord 公告」，用於 Discord 暫時斷線或公告被刪的情況。
- Discord 失敗時**網站開團與報名不回滾**；畫面會顯示可重新同步，失敗資訊紀錄於 `discordAnnouncements`。
- `allowed_mentions` 關閉所有提及，使用者的說明文字不能藉此呼叫 @everyone。

### 直接更新已經使用的 Vercel 專案（不要新建專案）

1. 先確定 Vercel → Settings → Environment Variables 的 **Production** 已有兩個值：
   - `DISCORD_CHANNEL_ID`：活動公告頻道 ID（純數字）
   - `DISCORD_BOT_TOKEN`：Discord Developer Portal → Bot 取得的 Token（私密，不要放入 GitHub）
2. 從**完整 ZIP** 內，把以下檔案放回你既有 GitHub `Startrail-Calendar/startrail-calendar-v2/` 的**相同相對路徑**：
   - `api/discord.js` **新增檔**
   - `api/route.js` **取代舊檔**（包含前一版暱稱同步修復，不會退版）
   - `public/index.html` **取代舊檔**（新增活動詳情深連結與手動重新同步）
   - `vercel.json` **取代舊檔**（API 函式的執行時間最多 30 秒）
   - 其他檔案如 `package.json`、`test/discord.test.js`、`README.md` 可以一起更新，方便未來維護。
3. 在 GitHub 提交變更（Commit changes）；確認 Vercel → Deployments 中**新的部署**狀態為 Ready。環境變數只有重新部署後才會生效。
4. 進入星旅日誌，建立一場名叫「莫古力公告測試」的活動；到 Discord `#星旅活動公告` 查看是否出現訊息。
5. 回到網站，修改測試活動名稱／按 +1，確認 Discord 的**原本同一則**訊息更新。最後取消測試活動，確認公告標記已取消。

### 如果沒有收到公告

- 先確認 Vercel 是**最近一次新部署**（有新 commit），不能只新增環境變數。
- 確認 `DISCORD_CHANNEL_ID` 是文字頻道的 ID，而不是伺服器 ID。
- 確認 Bot 在該頻道具有 View Channel、Send Messages、Embed Links 權限。
- 進入活動詳情，用主揪帳號按「重新同步 Discord 公告」；操作不會重複報名。
- 如果還是不行，檢查 Vercel → Logs，搜尋 `Startrail Discord announcement:`，可以看到 HTTP 錯誤碼（不會記錄 Token）。
- `Discord HTTP 403` 常見是機器人權限不足；`404` 可能是無效頻道 ID 或舊公告被刪；`401` 常見是 Bot Token 無效。

### 注意

此版**不提供 Discord 中直接 +1 按鈕**，也**不要求**在 Discord Developer Portal 填寫 Interactions Endpoint URL；Discord 後端使用 REST API 主動發送公告，不需要機器人在線上保持 Gateway 連線。尚未連接真實 Discord／Firebase（沒有你的金鑰），已透過不連網的程式測試模擬發送與同步。

一般情況下避免重複公告：Firestore 記錄每場活動的 Discord message ID；`nonce` 搭配 Discord 的短期重複檢查。若 Discord 已成功發送但 Firestore 在記錄結果時長時間失敗，仍有極小的重複風險。

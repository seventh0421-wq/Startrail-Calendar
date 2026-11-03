# 星旅日誌 Startrail Calendar — V2.0 Beta

FF14 朋友專屬共用行事曆：手機優先的星空冒險風網站，支援 Google 登入、好友邀請、開團、+1／取消、候補、可複選坦／補／輸出職業、主揪正式排位、4／8／24 人隊伍總覽，及複製活動名單到 Discord。

## 目前狀態

- 已完成**程式碼和純邏輯測試**；**尚未部署**，也**尚未連線至你的 Firebase 專案**（因為沒有你的伺服器憑證）。
- `public/demo.html` 是原本 V1.2 的單機互動原型，可先看外觀；`public/index.html` 是要部署的 V2.0 正式資料版。
- Google 登入成功後，每次寫入由伺服器驗證身份，Firebase Admin SDK 處理 Firestore。私人活動不由瀏覽器直接存取資料庫。
- 每次操作後立即重新載入，平常每 30 秒（且沒有開啟編輯視窗時）刷新一次。**不是 Firestore 即時監聽**。Discord Bot 也尚未接入。

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
- 角色暱稱修改後，不會即時改寫所有歷史活動中的舊名字。新報名使用更新後暱稱。
- 24 人團採 3 坦 / 6 補 / 15 輸出總覽，不做三隊獨立的聯盟分組。日後可增加 A/B/C 隊。
- 如果職業志願被修改，與新志願不符的既有排位會取消。
- 主揪建立活動後會自動算在報名名額內，且不能直接退出自己的團。
- 目前無自動寄送 Email、Discord Bot、行事曆訂閱或自動活動提醒。
- **安全性**：公開 Firebase `apiKey` 非伺服器密鑰；真正需要保密的是服務帳戶金鑰。請勿對外洩漏服務帳戶金鑰。
- Firebase Admin SDK 具有伺服器特權，可略過 Firestore Security Rules；因此所有授權均由 `api/route.js` 驗證。

## 無法直接雙擊正式版 HTML

正式版 `public/index.html` 需要 HTTPS 網站、Firebase 登入和 `/api/route` 伺服器函式；不可像舊版一樣只雙擊 HTML 就完成雲端報名。只有 `demo.html` 是離線介面展示。

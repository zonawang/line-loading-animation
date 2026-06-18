# 🔮 LINE Crystal Astrology Expert Bot - 本次新增功能說明

本專案已完成最新階段的升級開發，完美整合 Google ADK、Gemini 2.5 Flash 多模態分析、Google Cloud Firestore 與 LINE Messaging API。以下為本次新增之核心特色功能與雲端架構設計說明。

---

## 🌟 本次新增核心特色功能

### 1. 🪐 動態守護神頭像與暱稱切換 (Deity Icon Switch)
* **智慧偵測切換**：機器人會依據當下諮詢的主題（如事業、愛情、財運），自動在回覆最開頭帶入守護神標記（如 `[DEITY: ATHENA]`、`[DEITY: VENUS]`、`[DEITY: FORTUNE]`、`[DEITY: COSMOS]`）。
* **動態 Sender 變更**：系統在向 LINE 發送訊息前，會主動解析標記並移除，同時將 LINE 訊息的 `sender.name` 與 `sender.iconUrl` 動態變更為對應的守護神暱稱與專屬頭像（雅典娜、維納斯、莫伊萊、艾蓮）。
* **靜態資源本機託管**：頭像圖檔（`雅典娜.png`、`維納斯.png`、`莫伊萊.png`）直接託管於專案根目錄下，透過 Express 靜態路由 `/static` 動態產出對外網址，實現零外鏈依賴。

### 2. 💬 智慧引導快速回覆 (Smart Quick Replies)
* **上下文追問生成**：每次老師回答完畢後，系統會自動呼叫 Gemini 2.5 Flash，依據回答的上下文，站在使用者立場即時設計出 3 個最具吸引力的相關追問問題。
* **字數嚴格適配**：生成的追問問題嚴格限制在 20 個字以內（適配 LINE Quick Reply 按鈕標籤限制），並轉換為 `message` 動作按鈕，呈現在對話框底部，引導使用者點擊繼續深入諮詢。

### 3. 🧠 中繁體中文優化的 Firestore 永久記憶體 (Chinese Firestore Memory)
* **Firestore 永久儲存**：自製 `ChineseFirestoreMemoryService`，取代原本易隨容器重啟而遺忘的記憶體，將使用者對話與上傳的水晶分析紀錄刻入 Cloud Firestore。
* **中繁體中文分詞檢索**：徹底解決 ADK 內建 `InMemoryMemoryService` 僅支援英文分詞的 Bug，實作基於 Traditional Chinese 與特定水晶占星高頻詞彙（如：占卜、運勢、粉晶、紫水晶、黃水晶、綠幽靈、生日）的模糊比對與關聯檢索，讓 AI 永遠記得使用者的生日與水晶配置。

### 4. 📸 水晶多模態影像鑑定 (細緻圖像識別)
* **影像自動下載**：當使用者發送水晶照片時，系統會經由 LINE Messaging Blob API 下載影像，轉換為 Base64。
* **脈輪與五行解讀**：送至 Gemini 2.5 Flash 進行精細外觀、脈輪與五行共振特徵的鑑定，並自動調用前述的 Firestore 星盤記憶，進行與個人磁場契合度的一對一解讀。

---

## 💡 關鍵雲端架構注意事項 (重要)

### 📌 為什麼 Webhook 必須使用「同步 `Promise.all`」？
在部署至 Google Cloud Run 時，必須特別注意其 CPU 分配機制：
* **Cloud Run CPU 限制機制 (CPU Throttling)**：
  Cloud Run 預設使用的是 **「僅在請求處理期間分配 CPU」**。如果 Webhook 路由採取 `res.send('OK')` 秒回 LINE，而把分析與回覆放在背景非同步執行，**Cloud Run 會在回覆發出的瞬間將容器的 CPU 限制降到接近 0**。
* **解決「沒有反應」問題**：
  這會造成背景的 Gemini 占星呼叫與 Firestore 讀寫完全卡死或運作極度緩慢。因此，本專案將 Webhook 改回穩定的同步 `Promise.all` 處理：
  ```javascript
  Promise.all(req.body.events.map((event) => handleEvent(event, req)))
    .then((result) => res.json(result))
  ```
  這能確保在 Gemini 處理（約 2~3 秒）期間，CPU 始終獲得 100% 完整分配，保證 LINE 訊息能以最快速度完成回覆。

---

## 🛠️ 本地開發與部署設定

### 1. 執行環境
* **Node.js**：推薦 Node 22 以上（本專案已在 `node:22-alpine` 容器下，透過 `--experimental-require-module` 解決 CJS 同步載入 ESM 的載入問題）。

### 2. 環境變數 (`.env`)
```env
PORT=8080
LINE_CHANNEL_SECRET=您的_Channel_Secret
LINE_CHANNEL_ACCESS_TOKEN=您的_Channel_Access_Token
GCP_PROJECT=您的_GCP_專案ID
GCP_LOCATION=us-central1
VERTEX_AI_MODEL=gemini-2.5-flash
GITHUB_TOKEN=您的_GitHub_Token
```

### 3. 一鍵部署至 Cloud Run
```bash
gcloud run deploy line-echo-bot \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --update-env-vars="GCP_PROJECT=您的_GCP_專案ID,GCP_LOCATION=us-central1,VERTEX_AI_MODEL=gemini-2.5-flash"
```

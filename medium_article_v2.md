# 🔮 LINE Bot 互動體驗優化實錄：打造動態智慧追問 Quick Reply 與專屬圖文選單

在開發 LINE Bot 聊天機器人時，我們常遇到一個挑戰：即使後端串接了強大的大語言模型，用戶在看完一段詳細的分析後，常因為不知道接下來該如何繼續追問，導致對話就此中斷。

為了解決這種「被動式一問一答」的互動僵局，並提升整體的用戶體驗，本次開發任務我們專注於優化兩個核心方向：

1. **動態智慧追問（Quick Reply）**：根據每次的對話脈絡，動態生成三個最貼近用戶需求的追問選項。
2. **專業圖文選單（Rich Menu）**：配置手繪卡牌風格的圖文選單，提供直達「使用指南」與 GitHub 專案的快捷入口。

在實作與部署的過程中，我們遇到了三個關於 API 限制、圖片壓縮及變數作用域的技術挑戰。以下為本次攻克難題與順利上線的技術實踐實錄。

---

📸 **[ 建議在此處插入優化前後的 LINE Bot 互動對比圖，例如：Quick Reply 膠囊按鈕與 Rich Menu 實際手機畫面 ]**

---

## 🧩 第一關：Gemini 動態追問與 LINE 20 字膠囊限制

在對話式 UI 中，用戶常面臨「接下來該問什麼」的瓶頸。為了主動引導對話，我們利用 Gemini 的推理能力，在產生主要回覆後，即時分析上下文並生成三個最具相關性的口語化追問。

然而，在串接 LINE API 時，我們遇到了硬性限制：

> **LINE API 規定：Quick Reply 按鈕的標籤（Label）字數限制，最大只能容納 20 個字！**

若產生的文字超出此限制，API 將會回傳錯誤並拒絕發送訊息，導致使用者手機上無法正常顯示追問按鈕。

### 💡 解決方案：Prompt 限制與程式碼雙重截斷

為了解決這項限制，我們採取了雙重防禦機制：

#### 1. 在 Prompt 中限制字數
我們在發送給 Gemini 的指令（Prompt）中，特別加入了嚴格的字數緊箍咒：
```text
每個追問問題必須非常簡短、口語，且嚴格限制在 20 個字以內。
```

#### 2. 在 JavaScript 程式碼中進行防禦性截斷
為了防止模型偶爾超出字數，我們在程式碼中加上了強制的安全截斷與整理邏輯：
```javascript
const quickReplies = questions.map(q => {
  // 強制限制在 20 字內，並去除多餘空格
  const cleanLabel = q.trim().substring(0, 20);
  return {
    type: 'action',
    action: {
      type: 'message',
      label: cleanLabel,
      text: cleanLabel
    }
  };
});
```

這項調整確保了 Quick Reply 能夠穩定呈現，用戶只需點擊即可順暢延續話題。

---

## 🧩 第二關：手繪選單與突破 LINE 1MB 上限挑戰

為了提升視覺質感，我們設計了一張手繪卡牌風格的圖文選單圖片 `123.png`。

這張圖的佈局設計為：
* **左半部**：水晶使用指南（點擊即直出說明書）
* **右半部**：Zona AI 學習實驗室（點擊直接跳轉至 GitHub 專案網址）

📸 **[ 建議在此處插入手繪卡牌風格的圖文選單設計圖 123.png ]**

### 💡 衝突診斷：Nginx 413 Request Entity Too Large 與 1MB 限制

由於原始設計圖檔（`123.png`）採用高解析度格式，檔案大小達 8.1 MB。即使縮放至 LINE 規格的 2500x1686 像素，PNG 格式大小仍高達 7.5 MB。上傳時，LINE API 回傳了 `413 Request Entity Too Large` 錯誤，因為 LINE 的 Rich Menu 圖片上傳上限為 **1 MB**。

### 💡 解決方案：sips 轉檔壓縮與自動化註冊腳本

我們利用 macOS 內建的 `sips`（Scriptable Image Processing System）工具，將圖片轉為 JPEG 格式並設定品質參數，在兼顧清晰度的前提下將檔案大小精準壓縮至 **955 KB**，順利通過 1MB 限制：

```bash
sips -s format jpeg -s formatOptions 70 -z 1686 2500 123.png --out richmenu_resized.jpg
```

同時，我們撰寫了自動化配置腳本 `create-rich-menu.js`，利用 Node 22 原生的 `fetch` API，完成選單創建、圖片上傳及設定預設選單的完整流程，提高了部署效率：

```javascript
// create-rich-menu.js 核心邏輯片段
const response = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(richMenuDefinition)
});
```

---

## 🧩 第三關：排查 JavaScript let 區塊作用域引起的響應異常

為了優化回應速度並節省 Token 支出，我們在 Webhook 端設計了攔截機制：當偵測到用戶傳送「使用指南」時，系統將跳過 LLM 處理，直接回傳預設的說明訊息。然而在實際測試中，點擊該按鈕後 Bot 卻無任何回應。

### 💡 衝突診斷：let 變數的 Block Scope 限制

檢視 Cloud Run 伺服器日誌後，發現系統拋出了 `ReferenceError: isGuide is not defined` 錯誤。原因在於以下程式碼中的變數宣告方式：

```javascript
try {
  let isGuide = false; // ❌ 宣告在 try 區塊內！
  if (userMessage === '使用指南') {
    isGuide = true;
    responseText = "🔮 歡迎使用水晶占星助理！...";
  }
} catch (err) {
  console.error(err);
}

// ❌ 報錯！isGuide 在 try 區塊外部無法被存取
if (isGuide) { 
  await replyMessage(replyToken, responseText);
}
```

在 JavaScript 中，使用 `let` 宣告的變數具有**區塊作用域（Block Scope）**。變數 `isGuide` 被宣告在 `try` 區塊內部，當我們在 `try-catch` 結構外部引用該變數時，便會觸發 `ReferenceError`，導致 Webhook 在發送回覆前異常中斷。

### 💡 解決方案：變數提升至函式層級

我們將變數宣告移至 `handleEvent` 函式的最上層，修正了作用域問題，使「使用指南」功能能夠以極低延遲且免 LLM 運算的方式穩定運作：

```javascript
let responseText = '';
let isGuide = false; // ✅ 正確宣告在函式層級！

try {
  if (userMessage === '使用指南') {
    isGuide = true;
    responseText = "🔮 歡迎使用水晶占星助理！...";
  }
} catch (err) {
  console.error(err);
}

if (isGuide) {
  await replyToLine(replyToken, responseText); // 0 毫秒極速直出！
}
```

---

## 💬 結語：人機協作推動高效開發

回顧本次從「動態智慧追問」到「圖文選單優化」的開發歷程，人機協同模式再次展現了其在解決實務問題上的高效性：

* **AI 負責輔助技術實現與問題診斷**：包括提供 `sips` 壓縮參數、編寫 API 配置腳本、以及快速定位 JavaScript 的區塊作用域 Bug。
* **開發者負責架構設計與用戶體驗把關**：包括追問流程的設計、圖文選單的佈局邏輯、以及字數防禦機制的覆核。

這種開發模式讓開發者能夠跳脫繁瑣的指令記憶，更專注於產品邏輯的建構與使用者體驗的雕琢。

---

本專案的完整程式碼、安全配置、1MB 影像壓制方案與 Gemini Quick Reply 實作已全數備份至最新 GitHub 倉庫：https://github.com/zonawang/line-quick-reply.git

如果您對建立自己的智慧型 LINE 機器人或與 AI 協同開發感興趣，歡迎隨時與我交流！

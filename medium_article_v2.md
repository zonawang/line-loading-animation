# 🔮 LINE Bot 互動感拉滿！打造動態智慧追問 Quick Reply 與專屬手繪圖文選單實錄

你有沒有過這種體驗：好不容易開發出一個具有長效記憶、說話溫慢知性的 LINE Bot 水晶占星助理，但使用者在看完一段落落長、充滿智慧的星座水晶分析後，常常不知道下一步該問什麼，只能回句「謝謝」或「好喔」，對話就此冷場中斷？

身為一個對使用者體驗有著極致追求的開發者，這怎麼行！

為了打破這種「被動一問一答」的僵局，今天我與我的 AI 神隊友 Antigravity 再次聯手，為我們的水晶占星助理進行了一場驚艷的「外觀與互動雙重進化」！我們的目標是：
1. **動態智慧追問（Quick Reply）**：主動出擊！根據每一次的占卜與分析結果，動態為使用者生成 3 個最想繼續追問的個性化問題膠囊。
2. **專屬手繪圖文選單（Rich Menu）**：配置一張全新手繪質感卡牌風格的圖文選單，左側一鍵直達「使用指南」，右側無縫跳轉到我們的 GitHub 實驗室。

然而，就在我們擼起袖子準備大幹一場時，命運又在短短一小時內，無情地給我們出了三道全新的技術難題。以下是我們逐一攻克、成功將程式碼 Push 部署上線的真實技術實錄！

---

## 🧩 第一關：拒絕被動對話！Gemini 動態追問與 LINE 20 字膠囊限制

聊天機器人最容易遇到的瓶頸就是「話不投機半句多」，使用者看完一輪分析後往往大腦一片空白，不知道該怎麼繼續跟 AI 深入對談。

### 💡 解決方案：動態生成 3 個智慧追問問題

我們決定利用 Gemini 的強大推理能力。在水晶占星助理產生專業回覆後，系統會自動將回覆內容與對話上下文即時送進第二輪快速推理。我們設計了極為苛刻的 Prompt，要求 Gemini 站在「使用者的主觀角度」，動態設想三個最貼切、最自然的口語化追問。

然而，當我們開開心心地準備將問題渲染到 LINE 畫面時，卻立刻撞上了 LINE API 的硬體鐵壁：

> _❌_ **LINE API 規定：Quick Reply 按鈕的標籤（Label）字數限制，最大只能容納 20 個字！**

只要任何一個追問問題多出一個字，整批 Quick Reply 就會被 LINE API 拒絕發送，導致使用者手機畫面上什麼都出不來。

### 💡 雙重保險：AI 緊箍咒 + 程式碼強制截斷

為了解決這個嚴格的 20 字限制，我們在後端加上了「AI 限制 + 程式碼雙重保險」：

1. **在 Prompt 中下達硬性限制**：
   ```text
   每個追問問題必須非常簡短、口語，且嚴格限制在 20 個字以內。
   ```
2. **在 JavaScript 程式碼中進行強制截斷與清理**：
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

有了這套雙重保險，每個追問膠囊按鈕都能完美、圓潤地在使用者手機螢幕底部浮現，使用者只需輕輕一按，就能流暢地繼續跟 AI 深入對談！

---

## 🧩 第二關：大圖上傳失敗？手繪選單與突破 LINE 1MB 上限挑戰

有了動態追問，我們接著為 Bot 換上全新的視覺門面。我們精心設計了一張具有手繪神秘感卡牌質感的超美圖文選單 `123.png`。

這張圖的佈局非常直覺：
* **左半部**：水晶使用指南（點擊即直出說明書）
* **右半部**：Zona AI 學習實驗室（點擊直接跳轉至 GitHub 專案網址）

### 💡 衝突診斷：nginx 的 `413 Request Entity Too Large`

這張美輪美奐的 `123.png` 原圖解析度極高，檔案大小高達 **8.1 MB**！
即便我們使用縮放工具將其調整成 LINE 標準的 Large 尺寸 (2500x1686)，因為 PNG 是無損壓縮，檔案大小依然有 **7.5 MB**。

當我們開心地呼叫 LINE API 準備上傳這張圖文選單圖片時，伺服器卻無情地彈回了 `413 Request Entity Too Large` 的錯誤。

> _ADK / LINE Server 警告：圖文選單圖片大小上限為 **1 MB**，且格式必須為 JPEG 或 PNG。_

### 💡 解決方案：極致無損壓縮與一鍵註冊腳本

AI 助理這時開出了一帖影像處理的黑科技藥方——利用 macOS 內建的 `sips`（Scriptable Image Processing System）指令，進行極致的 JPEG 格式轉換與品質壓縮：

```bash
sips -s format jpeg -s formatOptions 70 -z 1686 2500 123.png --out richmenu_resized.jpg
```

這行黑科技指令在**肉眼完全看不出畫質損耗**的情況下，將 8.1 MB 的巨圖精準壓縮到了 **955 KB**，完美低於 1MB 上限！

隨後，我們寫了一個專屬的自動化配置腳本 `create-rich-menu.js`，使用 Node 22 原生支援的 `fetch` API，完成了「一鍵註冊選單 -> 上傳 JPEG 圖片 -> 設定為全球預設」的完整三部曲：

```javascript
// create-rich-menu.js 片段
const response = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(richMenuDefinition)
});
```

直接打通 LINE 圖文選單配置，讓手繪卡牌選單正式上線！

---

## 🧩 第三關：點選無反應？捉拿 JavaScript `let` 區塊作用域的隱藏 Bug

為了節省 Gemini 的 Token 開銷並提升響應速度，我們在後端做了快捷攔截：當使用者點選圖文選單左側發送「使用指南」時，Bot 會直接從程式碼中直出精美版的使用說明，完全不經過 LLM 運算。

然而，當部署上線測試時，點擊選單左側「使用指南」，Bot 卻一片死寂，完全沒有反應。

### 💡 程式碼除錯：被 `let` 軟禁的作用域

AI 助理冷靜地調閱了日誌，立刻鎖定了這個看似簡單卻致命的變數作用域（Scoping）Bug：

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

// ❌ 報錯！isGuide 在 try 區塊外部根本不存在！
if (isGuide) { 
  await replyMessage(replyToken, responseText);
}
```

在 JavaScript 中，`let` 具有嚴格的**區塊作用域（Block Scope）**。宣告在 `try` 區塊內的 `isGuide`，在區塊外部引用時會直接觸發 `ReferenceError: isGuide is not defined`。

這導致整個 Webhook 在發送回覆前就因錯誤中斷崩潰，難怪手機畫面上毫無反應！

### 💡 解決方案：作用域提昇（Scope Hoisting）

我們迅速進行了程式碼重構，將 `isGuide` 提昇至 `handleEvent` 函式層級，確保它在整個事件處理流程中都能被安全存取：

```javascript
let responseText = '';
let isGuide = false; // ✅ 正確宣告在函式層級！

try {
  if (userMessage === '使用指南') {
    isGuide = true;
    responseText = "🔮 歡迎使用水晶占星助理！...";
  }
  // ... 其他 logic
} catch (err) {
  console.error(err);
}

if (isGuide) {
  await replyToLine(replyToken, responseText); // 0 毫秒極速直出！
}
```

重新部署後，Bug 瞬間消逝，使用指南功能以 **0 毫秒延遲、0 Token 消耗** 的完美姿態正式上線！

---

## 💬 結語：人機協作，讓創意的火花即刻落地

回顧這整趟從「智慧動態追問」到「手繪圖文選單極致壓制」的升級實錄。這整趟與 AI 協同開發助理 Antigravity 展開的深度進化之旅，徹底展現了「人機協同」的極致魅力：

* **AI 負責攻堅複雜的底層技術與影像處理**：從 20 字膠囊限制截斷、`sips` 影像壓制、LINE Rich Menu 動態上傳，到作用域 Bug 的快速定位。
* **人類負責雕琢靈魂與產品體驗**：包括對圖文選單按鈕的佈局、對文字極致的細緻把關、以及使用者互動心流的設計。

在有 AI 輔助的開發新時代，我們不再需要花費大量時間去死記生硬的工具指令或通訊協定，而是能將精力集中在「如何清晰表達邏輯與創意」。

---

本專案的完整程式碼、安全配置、1MB 影像壓制方案與 Gemini Quick Reply 實作已全數 Push 備份至最新 GitHub 倉庫：https://github.com/zonawang/line-quick-reply.git

如果您對建立自己的智慧型 LINE 機器人或與 AI 協同開發感興趣，歡迎隨時與我交流！

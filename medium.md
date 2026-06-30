# ⏳ 避坑實錄：手把手用 LINE 載入動畫與 Serverless 去重機制，拯救 LLM 機器人的「等待焦慮」！

大家哈囉！如果你曾經用 LINE Bot 接過 OpenAI 或 Google Gemini 等大型語言模型（LLM），你一定懂那種痛：**LLM 生成回答動不動就要 5 到 15 秒，在等待的這段時間裡，聊天視窗一片死寂，使用者常常以為機器人當機了，就開始瘋狂重複點按或洗版。**

為了解決這個「等待焦慮」，我決定在我的智慧占星水晶 Bot 裡，加上 LINE 官方最新的 **`showLoadingAnimation` (載入中動畫)** 功能。

本以為這是一件「呼叫個 API 就收工」的簡單小事，沒想到在與我的 AI 隊友 **Google Antigravity** 一起開發部署到 Google Cloud Run 的過程中，我們竟然連續踩進了兩個讓人抓狂的神奇大坑：
1. **「動畫確實出現了，但機器人卻從此人間蒸發、再也不回話！」**
2. **「機器人終於回話了，但回完話之後，那個載入動畫怎麼又跑出來閃爍？」**

這篇文章就用最白話的開發實錄，帶大家看看我們是怎麼一步步抓出幕後黑手，並用一套「連線保持 + 雙重快取阻斷」的黃金架構完美收尾的！

---

## 🕳️ 踩坑一：動畫出現了，但... 機器人從此人間蒸發？

一開始，我興高采烈地呼叫了 LINE 官方的 `showLoadingAnimation` API，這個功能非常精緻，會在對話視窗最上方顯示如同真人打字般的「讀取中/正在輸入...」動態氣泡，最長可以顯示 15 秒，而且只要一發送真正的回覆，動畫就會自動消失，簡直是完美的使用者體驗！

程式碼寫好後，我做了一個「聰明」的直覺設定：
> 「既然 LLM 運算很花時間，為了防止 LINE 官方伺服器判定超時，我應該在收到 Webhook 的第一時間，就立刻回傳 `200 OK` 給 LINE，然後讓機器人在背景慢慢跑 Gemini 運算，最後再用 `replyToken` 回覆就好啦！」

結果一上傳到 Cloud Run 測試，悲劇發生了：
* **手機畫面上確實出現了流暢的打字動畫！**
* **但是... 動畫閃了 15 秒後自動消失，機器人卻半個字都沒回。**
* 查看後端日誌，竟然噴出了一堆 `Invalid reply token` 的錯誤。

### 🔍 幕後黑手：Serverless 的「CPU 凍結詛咒」
在 Google Cloud Run 這種無伺服器（Serverless）平台上，有一個硬核的運行機制：
**只要你的 Node.js 路由回傳了 `res.send('OK')`，Cloud Run 就會判定這次的 HTTP 請求已經結束。為了幫你省錢省資源，它會瞬間把這個容器實例的 CPU 資源「降到趨近於零」（也就是凍結起來）！**

這意味著，我剛剛自作聰明放在背景跑的 Gemini 非同步運算，直接在背景被「按了暫停鍵」。直到下一個使用者的訊息進來「喚醒」容器時，它才會繼續動，但此時上一個請求的 `replyToken` 早就過期了，這就是為什麼機器人直接人間蒸發的原因。

### 🛠️ 解決方法：按住連線不放 (Connection Holding)
我們絕對不能提早回傳 `200 OK`！必須在 `/webhook` 路由中，使用 `Promise.all` **強行按住 HTTP 連線不放**，等 Gemini 運算完、回覆訊息成功送出後，才心滿意足地回傳 200。這能確保 Cloud Run 在這十幾秒內，一直分給我們 100% 的滿載 CPU 動能！

---

## 🕳️ 踩坑二：回話成功了，但動畫怎麼又跑出來「鞭屍」？

解決了第一個坑之後，機器人終於可以順利、溫暖地回覆水晶分析了。此時我又發現了另一個超詭異的 bug：
* **我上傳一張水晶照片，打字動畫順利出現。**
* **過了大約 8 秒，機器人吐出了非常精準的分析，打字動畫順利消失。**
* **但是！回覆完過了 1、2 秒，打字動畫竟然「又莫名其妙地在手機上閃爍了起來」！**

這簡直太靈異了！我明明都已經回覆完了，為什麼打字動畫還會重複出現？

### 🔍 幕後黑手：LINE 的 5 秒超時重試機制
原來，這就是我們「按住連線不放」所帶來的副作用。

LINE 官方規定：**當 Webhook 發送出去後，如果 5 秒內沒有收到回應（也就是我們為了等 Gemini 跑完而按住連線），LINE 伺服器就會判定「這次發送失敗了」，並在接下來自動發送最多 3 次一模一樣的重試請求（Retry）。**

這下尷尬了：
1. 第一個請求還在等 Gemini 跑（已跑了 5 秒，顯示了動畫）。
2. 第二個重試請求抵達！因為是全新請求，它又跑了一次 `handleEvent`，**又呼叫了一次顯示動畫**，並且在背景也跑起了第二個重複的 Gemini。
3. 即使第一個請求跑完並成功回覆、關閉了動畫，**遲到的第二個重試請求依然在背景運作，並再次觸發了顯示動畫**，甚至還會因為重複回覆而報錯！

### 🛠️ 解決方法：記憶體雙快取去重阻斷 (Double-Set Deduplication)
為了解決這個重試轟炸，我和 Antigravity 設計了一套防護機制。我們在伺服器記憶體中放了兩個 Set 快取：
* `activeEvents`：記錄**正在處理中**的 Webhook 事件 ID。
* `completedEvents`：記錄**已經順利回覆完畢**的事件 ID。

當 Webhook 事件進來時，我們進行三重攔截：

```javascript
const eventId = event.webhookEventId;

if (eventId) {
  // 1. 如果這個事件之前已經完整處理並回覆過了，直接回覆並忽視這個重試
  if (completedEvents.has(eventId)) {
    console.log(`⚠️ [去重] 事件已完成過，直接拋棄重試。`);
    return 'OK';
  }

  // 2. 如果同一個事件正在處理中（這代表是 5 秒超時後 LINE 發過來的重試）！
  // 我們「立刻回傳 200 OK」給重試請求並拋棄它，堵住 LINE 的嘴，防止它繼續重試！
  if (activeEvents.has(eventId)) {
    console.log(`⚠️ [去重] 事件正在處理中，立即回覆 OK 並拋棄此重試請求。`);
    return 'OK';
  }

  // 3. 首次進來的正常請求，標記為處理中
  activeEvents.add(eventId);
}
```

這個邏輯的精妙之處在於：**原本的請求我們繼續按住不放（維持 CPU），而對於因為超時而衝進來的重試請求，我們則用快取識別，並且「立刻秒回 200 OK」將其拋棄。**

如此一來，不但 Cloud Run 的 CPU 資源全程拉滿，LINE 伺服器也被我們安撫得妥妥貼貼，再也不會觸發重複的載入動畫，更不會浪費任何 Gemini API Token！

---

## 🚀 終極程式碼實現

在 `/webhook` 路由中，精簡後的實作逻辑如下，非常直觀白話：

```javascript
const activeEvents = new Set();
const completedEvents = new Set();

// 每 10 分鐘清空一次去重快取，避免記憶體爆掉
setInterval(() => {
  activeEvents.clear();
  completedEvents.clear();
}, 600000);

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(
      req.body.events.map(async (event) => {
        const eventId = event.webhookEventId;

        if (eventId) {
          if (completedEvents.has(eventId)) return 'OK'; // 已完成，直接拋棄
          if (activeEvents.has(eventId)) return 'OK';    // 正在跑，秒回 OK 阻斷重試
          activeEvents.add(eventId);
        }

        try {
          // 呼叫主邏輯（裡面包含 showLoadingAnimation 與 Gemini 呼叫）
          const result = await handleEvent(event, req);
          
          if (eventId) completedEvents.add(eventId); // 成功後標記為已完成
          return result;
        } finally {
          if (eventId) activeEvents.delete(eventId); // 跑完就移出處理中
        }
      })
    );

    res.json(results); // 安全回覆
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});
```

在 `handleEvent` 開頭，只要一行就能帥氣地開啟載入動畫：
```javascript
// 顯示 15 秒打字動畫，發送 replyMessage 時會自動消失
await client.showLoadingAnimation({ chatId: userId, loadingSeconds: 15 });
```

---

## 🏆 收穫成果

經過這次硬核踩坑與優化，我們的智慧水晶 Bot 迎來了脫胎換骨的流暢體驗：
* **打字指示器即時反饋**：用戶點擊按鈕或發送相片，手機立刻跳出亮眼的打字氣泡，毫無遲滯。
* **100% 穩定不漏回**：Cloud Run 的 CPU 活力全開，徹底告別非同步任務被強制中斷的冷宮詛咒。
* **零重疊跳閃**：即使 Gemini 的圖片辨識花了 12 秒，中間 LINE 發動了兩次超時重試，後端也會瞬間將其優雅阻斷丟棄，用戶最終只會收到 1 次精準的回覆。

如果你也正在開發 LLM 驅動的 LINE 機器人，或者正為 Serverless 的冷啟動與非同步處理抓破腦袋，這套**「連線保持 + 雙重快取去重 + 載入動畫」**的黃金公式絕對是你的終極救星！

---

### 📂 專案開源與完整程式碼
本專案的完整程式碼、Dockerfile、設定檔案及防重複防護邏輯已全面開源至 GitHub。歡迎點擊下方連結進行 Star、Fork 或深入研究：

👉 **GitHub 儲存庫：[https://github.com/zonawang/line-loading-animation](https://github.com/zonawang/line-loading-animation)**

如果您在部署或使用過程中遇到任何技術細節問題，也歡迎在儲存庫中發起 Issue 與我們一起探討交流！✨

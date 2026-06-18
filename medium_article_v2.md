# 🔮 LINE Bot 靈魂與體驗雙重升級：動態守護神分身、20 字 AI 智慧追問與 Cloud Run 背景 CPU 凍結踩坑實錄

自從與我的 AI 神隊友 **Google Antigravity** 展開合作以來，我們的 LINE 智慧水晶占星助理已經經歷了多次進化。從最初的「看圖說故事」多模態大腦，到整合 Cloud Firestore 的長效永久記憶，我們不斷在提升 AI 助理的擬真度與互動感。

在上一階段的 Flex Message 卡片實驗中，雖然圖卡設計得非常精美，但在實際互動中，我們發現 LINE 的 Flex Layout Schema 在欄位格式上有著極其嚴格的格式校驗（不允許自訂頭像樣式，且極易因為格式錯誤被 LINE 拒絕接收）。

於是這一次，我與 Antigravity 決定「返璞歸真」——**拋棄繁瑣的 Flex Message 框架，改用極致擬真的「動態守護神分身切換」與「AI 智慧追問（Quick Reply）」，在純文字的流暢閱讀體驗中，打造最有溫度的占星療癒感。**

以下是我們在短短幾小時內，攜手攻克四大技術難關的合作實錄。

---

## 🧩 第一關：動態守護神頭像切換與本機靜態託管 (Deity Icon Switch)

我們希望占星機器人不要像冷冰冰的複讀機，而是能根據使用者諮詢的主題，主動化身為不同的星曜守護神：
* 當問及事業、決策時，變身為 **「智慧守護神 雅典娜」**（深藍色系）；
* 當問及桃花、人際時，變身為 **「金星守護神 維納斯」**（粉色系）；
* 當問及整體運勢與逆行時，變身為 **「命運之輪 莫伊萊」**（金色系）；
* 其他綜合解析則回歸預設的 **「星曜導師 艾蓮」**。

為了解決這個需求，Antigravity 幫我設計了**雙重切換機制**：

1. **語意標記偵測**：我們在 Gemini 2.5 Flash 的系統提示詞（System Instruction）中加入規範，讓 AI 自動在回覆內容的最開頭輸出標記（例如 `[DEITY: ATHENA]`）。
2. **動態 Sender 轉換**：後端程式在發送訊息前，會利用正則表達式解析並移除該標記，隨後將其轉化為 LINE 訊息協定中的 `sender` 屬性，動態置換對話視窗中的暱稱與頭像。

```javascript
// 動態切換 Sender 暱稱與頭像
const replyMessage = {
  type: 'text',
  text: responseText,
  sender: {
    name: DEITY_CONFIG[deity].name,
    iconUrl: iconUrl
  }
};
```

為了讓守護神的頭像（`雅典娜.png`、`維納斯.png`、`莫伊萊.png`）穩定對外服務，我們不使用不穩定的外部圖床，而是直接由 Express 靜態託管本機檔案路由 `/static`，並在 Webhook 觸發時動態抓取請求的 Host 產出完整的實體 HTTPS 連結，實現完美的零外鏈依賴託管。

---

## 🧩 第二關：突破膠囊限制的 20 字 AI 智慧追問 (Quick Reply)

當占星師給出一段深度的分析回覆後，使用者往往不知道下一步該問什麼。

為了解決這個問題，我們在對話框底部設計了動態的「快速回覆按鈕（Quick Replies）」。但這帶來了一個嚴苛的限制：**LINE 的 Quick Reply 按鈕標籤，限制每個選項最多只能容納 20 個字。**

如果只是將 AI 的長句直接塞進去，按鈕會因為截斷而顯得殘缺。我對 Antigravity 說：

> 💬 **「請幫我寫一個 generator，讓 Gemini 根據老師的回覆，生成 3 個最有可能的追問問題，並嚴格限制在 20 個字以內。」**

Antigravity 寫出了一個專屬的追問生成器（Follow-Up Generator），透過精準的 Prompt 規範，讓 Gemini 2.5 Flash 以非 markdown 的乾淨 JSON 陣列格式輸出 3 個站在使用者立場的口語化提問（例如：「我想看粉晶的照片」、「如何搭配綠幽靈？」），並在後端做 `.substring(0, 20)` 的雙重保險截斷，完美消除了按鈕字數超出的安全隱患。

---

## 🧩 第三關：解決 Cloud Run 背景 CPU 凍結造成的「沒反應」羅生門

在之前的架構優化中，我們為了避免 LINE 伺服器因為對話生成時間過長（Gemini 分析有時需要 3-4 秒）而判定逾時並發動 Webhook 重試，設計了一個看似非常完美的「非同步背景處理方案」：
* 收到 Webhook 請求後，立刻向 LINE 秒回 HTTP 200 `OK`。
* 將 Gemini 分析、Firestore 寫入、LINE API 回覆等非同步承諾丟到 Express 背景繼續執行。

**然而部署上去後，機器人卻出現了嚴重的「沒有反應」羅生門。**

在排查日誌後，我們發現了一條詭異的線索：有些使用者的訊息竟然卡了將近 4 分鐘才收到回覆。這時，Antigravity 發揮了強大的架構排查能力，幫我指出了 Google Cloud Run 的關鍵機制：

> 💡 **Cloud Run CPU 限制機制 (CPU Throttling)**：
> Cloud Run 預設使用的是「僅在請求處理期間分配 CPU（CPU is only allocated during request processing）」。這意味著，一旦我們的 Webhook 路由執行了 `res.send('OK')` 並回傳，Cloud Run 會認為該次請求已經處理完畢，**瞬間將該容器實例的 CPU 資源配額降到接近 0！**

這導致我們丟在背景執行的非同步工作完全卡死。直到數分鐘後有其他使用者發送新訊息或新部署觸發容器喚醒，之前的背景執行緒才會「抽空」繼續執行。

**解決方案**：
我們決定返璞歸真，將 Webhook 路由完全復原為同步的 `Promise.all` 等待：

```javascript
app.post('/webhook', line.middleware(config), (req, res) => {
  // 保持同步等待，確保 Cloud Run 分配 100% CPU 資源至對話完全結束
  Promise.all(req.body.events.map((event) => handleEvent(event, req)))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('❌ Error handling events:', err);
      res.status(500).end();
    });
});
```

雖然這樣會稍微延遲 Webhook 的回應時間，但因為 Gemini 2.5 Flash 本身效能極佳（通常 2~3 秒內即可完成），同步等待能確保 Cloud Run 在整個運算與回覆過程中**維持 100% 全速 CPU 運算**，訊息傳送後在 2 秒內就能流暢回覆，完全解決了 Hang 住的難題！

---

## 🧩 第四關：中繁體字分詞 Firestore 永久記憶與 Push 憑證問題

有了穩定的執行環境，我們還針對 Firestore 永久對話記憶（`ChineseFirestoreMemoryService`）進行了 Traditional Chinese 的深度優化。

因為 ADK 內建的記憶庫檢索只針對英文單字進行正則切分，這會導致中文的「占卜」、「生日」等詞彙無法被精準比對。我們實作了**高頻中文水晶占星關鍵字匹配器**（針對：粉晶、黃水晶、天秤座等高頻詞），確保機器人能完美跨回合記憶使用者的生日星座與擁有的水晶收藏。

最後，在將所有最新的開發結晶 Push 到 GitHub 倉庫時，我們又遇到了 macOS 金鑰圈（Keychain）不允許背景非互動式 TTY 存取的問題。

對此，我直接生成了 GitHub 具有 repo 權限的 Personal Access Token，並由 Antigravity 將其寫入系統全域變數 `~/.zshrc`：

```zsh
export GITHUB_TOKEN=ghp_...
```

透過這種安全的 Token 憑證傳遞，我們免去了每次 Git Push 都要手動輸入密碼的繁瑣，順利將今天的完美代碼推播至 GitHub 倉庫中！

---

## 💬 結語

這次與我的 AI 隊友 **Google Antigravity** 的合作，讓我深刻體會到「好產品不一定需要最炫技的 UI，最適合的架構與最流暢的體驗才是關鍵」。

我們主動放棄了欄位嚴格且不具備 Sender 自訂頭像靈活性的 Flex Message，轉而利用**標準文字結合動態守護神變身、以及 20 字極速追問**，反而創造出了更有沉浸感、更有溫度的互動體驗。同時，這次 Cloud Run CPU 凍結的踩坑經驗，也為我們在無伺服器（Serverless）架構下開發 API 提供了極具價值的技術儲備。

如果您也對打造這款有溫度、會認人、還會七十二變的水晶占星機器人感興趣，歡迎參考我們最新一期的開源程式碼！

🔗 **專案 GitHub 倉庫**：https://github.com/zonawang/line-icon-switch.git

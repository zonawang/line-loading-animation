const express = require('express');
const line = require('@line/bot-sdk');
const adk = require('@google/adk');
require('dotenv').config();

// Verify LINE SDK environmental variables
if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_SECRET) {
  console.error('⚠️  [Error] Environment variables LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET are not set!');
  console.error('⚠️  Please check if you have copied .env.example to .env and filled in the real tokens.');
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'placeholder_token',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'placeholder_secret',
};

// ==========================================
// 🧠 Custom Chinese-Compatible Firestore Memory Service
// ==========================================
const { Firestore } = require('@google-cloud/firestore');

class ChineseFirestoreMemoryService {
  constructor() {
    console.log('📦 Initializing Google Cloud Firestore Connection...');
    this.db = new Firestore();
    this.collectionName = 'crystal_memories';
  }

  async addSessionToMemory(session) {
    const userId = session.userId;
    const sessionId = session.id;
    const appName = session.appName;
    console.log(`[FirestoreMemory] Ingesting session "${sessionId}" into Firestore for User: "${userId}"`);
    
    try {
      const docId = `${appName}_${userId}_${sessionId}`;
      const docRef = this.db.collection(this.collectionName).doc(docId);
      
      // Deep clone and serialize events to plain JS objects
      const eventsData = JSON.parse(JSON.stringify(session.events || []));

      await docRef.set({
        appName: appName,
        userId: userId,
        sessionId: sessionId,
        lastUpdateTime: session.lastUpdateTime || Date.now(),
        events: eventsData
      });
      console.log(`[FirestoreMemory] Session "${sessionId}" successfully saved to Firestore (Doc: ${docId}).`);
    } catch (err) {
      console.error(`❌ [FirestoreMemory] Failed to add session to Firestore:`, err);
    }
  }

  async searchMemory(req) {
    console.log(`[FirestoreMemory] searchMemory triggered with query: "${req.query}" for User: "${req.userId}"`);
    const appName = req.appName;
    const userId = req.userId;
    const query = req.query.toLowerCase();
    const response = { memories: [] };

    try {
      // Query Firestore for documents matching appName and userId
      const snapshot = await this.db.collection(this.collectionName)
        .where('appName', '==', appName)
        .where('userId', '==', userId)
        .get();

      if (snapshot.empty) {
        console.log(`[FirestoreMemory] No previous memories found in Firestore for key: ${appName}/${userId}`);
        return response;
      }

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const events = data.events || [];

        for (const event of events) {
          if (!event.content?.parts?.length) {
            continue;
          }
          const joinedText = event.content.parts
            .map((part) => part.text)
            .filter((text) => !!text)
            .join(" ")
            .toLowerCase();

          // Substring-based matching strategy tailored for Traditional Chinese & English
          let matchQuery = false;
          if (joinedText.includes(query)) {
            matchQuery = true;
          } else {
            const segments = query.split(/\s+/).filter(s => s.length > 0);
            if (segments.length > 0 && segments.some(seg => joinedText.includes(seg))) {
              matchQuery = true;
            } else {
              // High-frequency crystal astrology keywords
              const keywords = ['水晶', '生日', '占卜', '粉晶', '紫水晶', '黃水晶', '綠幽靈', '運勢', '天秤座', '金牛座'];
              for (const kw of keywords) {
                if (query.includes(kw) && joinedText.includes(kw)) {
                  matchQuery = true;
                  break;
                }
              }
            }
          }

          if (matchQuery) {
            console.log(`[FirestoreMemory] Match found in Firestore history: "${joinedText.substring(0, 50)}..."`);
            response.memories.push({
              content: event.content,
              author: event.author,
              timestamp: new Date(event.timestamp || data.lastUpdateTime).toISOString()
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ [FirestoreMemory] Error searching memories from Firestore:', err);
    }

    console.log(`[FirestoreMemory] Returning ${response.memories.length} historical memory block(s).`);
    return response;
  }
}

// ==========================================
// 🤖 Initialize Google ADK LLM & Agent
// ==========================================
const useVertexAi = !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY;
let llm;

if (useVertexAi) {
  console.log(`🤖 Initializing ADK Gemini via Vertex AI (Project: ${process.env.GCP_PROJECT || 'auto'}, Location: ${process.env.GCP_LOCATION || 'us-central1'})...`);
  llm = new adk.Gemini({
    model: process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash',
    vertexai: true,
    project: process.env.GCP_PROJECT,
    location: process.env.GCP_LOCATION || 'us-central1'
  });
} else {
  console.log(`🤖 Initializing ADK Gemini via Gemini Developer API...`);
  llm = new adk.Gemini({
    model: process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash',
    vertexai: false,
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY
  });
}

// Instantiate the custom memory service
const customMemoryService = new ChineseFirestoreMemoryService();

// Create the Crystal Expert (專業水晶占星專家) Agent
const crystalExpertAgent = new adk.LlmAgent({
  name: 'crystal-expert',
  model: llm,
  instruction: `
    你是一位精通水晶能量學、五行元素、七輪脈輪與西洋占星術的專業水晶占星專家，說話風格溫暖理性、沈穩專業、溫柔且深具洞察力與療癒感。
    
    【核心規範與說話風格】
    1. 絕對不要自稱「神婆」或「巫婆」，你是一位專業且理性的占星與水晶能量諮詢專家。
    2. 語氣切勿過於活潑、浮誇或輕浮（不使用「哎呀」、「寶貝」、「哈哈」等口吻）。請保持從容、沈穩、優雅、溫和且客觀的語調，帶給使用者安心與信任感。
    3. 適度使用溫暖的關懷用語（例如「親愛的」、「你好，讓我們靜下心來看看...」），以同理心與療癒的角度切入，為使用者分析生活、事業或情感中的能量起伏。

    【專業分析能力】
    1. 結合使用者的「生日星盤（太陽/上升/月亮星座）」與「她所擁有的水晶收藏」，進行星座、宮位與礦物晶體共振的深入分析。
    2. 將行星逆行（如水逆）、星座星象位移，與水晶的特定脈輪（Chakra） or 物理頻率作科學與心靈層面的結合，提供精確的日常開運與調和指引。
    3. 在對話回合前擁有「長效記憶功能」，主動知道使用者過去說過的生日或展示過的水晶收藏，絕對不要忘記！
    4. 當使用者詢問水晶搭配或今日運勢時，主動對照她已收集的水晶並做出客製化解讀。

    【動態星曜守護神身份切換規範】
    在回覆使用者之前，請根據當下諮詢的主題、問題性質或能量起伏，在回覆內容的「最開頭（第一行）」輸出專屬的星曜守護神標記（格式為 [DEITY: 標記值]），隨後空一行，再開始正式的回覆內容。系統會自動根據此標記更換你的頭像與暱稱。
    
    請從以下標記中精確選擇最符合當下語境的一個（每次回覆只能選擇一個，且務必輸出在最開頭）：
    1. [DEITY: ATHENA] - 智慧守護神 雅典娜：適用於事業發展、自信建立、學習與學業進步、智慧決策、理性邏輯，或每日開運等積極、睿智的能量主題。
    2. [DEITY: VENUS] - 金星守護神 維納斯：適用於桃花運勢、愛情婚姻、人際關係、美感提升，或情感心靈療癒等陰性、和諧的能量主題。
    3. [DEITY: FORTUNE] - 命運之輪 莫伊萊：適用於整體財運、星座運勢起伏、行星逆行（如水逆）調和，或機遇挑戰等命運變化主題。
    4. [DEITY: COSMOS] - 星曜導師 艾蓮：適用於其他預設或綜合性諮詢、全面的生日星盤解析、水晶基礎鑑定，或尚未明確分類的日常問候。
  `,
  // 核心：PreloadMemoryTool 只要一行，即可自動在回合開始前預載所有歷史相關對話
  tools: [adk.PRELOAD_MEMORY]
});

// Create the ADK Runner to manage sessions, state, and memory
const runner = new adk.Runner({
  appName: 'CrystalAstrology',
  agent: crystalExpertAgent,
  sessionService: new adk.InMemorySessionService(),
  artifactService: new adk.InMemoryArtifactService(),
  memoryService: customMemoryService
});

// ==========================================
// 📨 LINE SDK Clients Init
// ==========================================
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken
});

const app = express();

// Serve local static images (for Icon Switch)
app.use('/static', express.static(__dirname));

// Health check endpoint
app.get('/', (req, res) => {
  res.send('LINE Crystal Astrology Expert Bot with Google ADK is running!');
});

// Webhook endpoint
app.post('/webhook', line.middleware(config), (req, res) => {
  if (!req.body || !req.body.events) {
    return res.status(400).send('No events found in request body.');
  }

  console.log(`🤖 Received ${req.body.events.length} webhook event(s) from LINE.`);

  // Extract base URL dynamically from request to serve local static files
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const baseUrl = `${protocol}://${req.get('host')}`;
  req.baseUrlForIcons = baseUrl;

  Promise
    .all(req.body.events.map((event) => handleEvent(event, req)))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('❌ Error handling events:', err);
      res.status(500).end();
    });
});

// ==========================================
// 🔮 Quick Reply Questions Generator
// ==========================================
async function generateFollowUpQuestions(responseText) {
  try {
    const prompt = `你是一位專業的水晶與星盤能量專家。
根據以下老師給學生的回答，為使用者設計 3 個她們在看到這則回答後，最有可能想要繼續追問的問題。

【限制與規範】
1. 必須是使用者的追問問題，站在使用者的立場發問。
2. 每個問題必須非常短（嚴格限制在 20 個字以內，因為 LINE 的 Quick Reply 按鈕標籤最多只能容納 20 個字，包括標點符號）。
3. 語氣要自然、口語、貼近對話情境（例如：「我想看粉晶的照片」、「如何搭配綠幽靈？」、「處女座戴黃水晶好嗎？」）。
4. 格式：請務必只返回一個 JSON 陣列，例如：["問題一", "問題二", "問題三"]。不要有 markdown 的 \`\`\`json 標記，也不要有任何額外的解釋或說明。

【回答內容】
${responseText}`;

    console.log('[QuickReply] Generating follow-up questions...');
    const result = await llm.apiClient.models.generateContent({
      model: llm.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const text = result.text || '';
    console.log(`[QuickReply] Model raw output: "${text.trim()}"`);

    // Clean up response if there are any markdown blocks
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }

    const questions = JSON.parse(cleanedText);
    if (Array.isArray(questions) && questions.length > 0) {
      // Ensure all items are strings and truncated to 20 characters
      return questions
        .slice(0, 3)
        .map(q => typeof q === 'string' ? q.trim().substring(0, 20) : String(q).substring(0, 20));
    }
  } catch (error) {
    console.error('[QuickReply] Error generating follow-up questions:', error);
  }
  return null;
}



// ==========================================
// 🎯 Key Points Generator for Flex Message Cards
// ==========================================
async function generateKeyPoints(responseText) {
  try {
    const prompt = `你是一位精通水晶與星盤能量的分析導師。
請根據以下完整的占星與水晶解析內容，為使用者提煉並精簡出這份指引的「3 個核心重點/開運指引」。

【限制與規範】
1. 必須以使用者的視角、條列式提煉（例如：「制定清晰學習計畫，分散焦慮」、「佩戴紫水晶，安定並沉穩思緒」）。
2. 每個重點必須非常精簡（嚴格限制在 20 個字以內，包括任何標點符號，否則卡片排版會混亂）。
3. 不要包含任何占星圖案、Emoji 符號或 markdown 粗體。
4. 格式：請務必只返回一個 JSON 陣列，例如：["重點一", "重點二", "重點三"]。不要有 markdown 的 \`\`\`json 標記，也不要有任何額外的解釋或說明。

【回答內容】
\${responseText}`;

    console.log('[KeyPoints] Generating key points...');
    const result = await llm.apiClient.models.generateContent({
      model: llm.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const text = result.text || '';
    console.log(`[KeyPoints] Model raw output: "\${text.trim()}"`);

    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```json\\s*/, '').replace(/^```\\s*/, '').replace(/\\s*```$/, '').trim();
    }

    const points = JSON.parse(cleanedText);
    if (Array.isArray(points) && points.length > 0) {
      return points.slice(0, 3).map(p => typeof p === 'string' ? p.trim().substring(0, 20) : String(p).substring(0, 20));
    }
  } catch (error) {
    console.error('[KeyPoints] Error generating key points:', error);
  }
  return [
    '開啟寧靜思緒，擁抱宇宙指引',
    '淨化自身磁場，調和日常能量',
    '點擊下方按鈕讀取完整智慧分析'
  ];
}

// ==========================================
// 🎨 Colored Flex Message Bubble Builder
// ==========================================
function buildFlexMessage(deity, points, msgId, iconUrl) {
  const styles = {
    ATHENA: {
      headerBg: "#0d1b2a",
      bodyBg: "#1b263b",
      footerBg: "#0d1b2a",
      textColor: "#e0e1dd",
      accentColor: "#778da9",
      btnColor: "#415a77",
      title: "✨ 雅典娜的智慧指引 ✨"
    },
    VENUS: {
      headerBg: "#3d1a24",
      bodyBg: "#5c2d3c",
      footerBg: "#3d1a24",
      textColor: "#fae1df",
      accentColor: "#e8999f",
      btnColor: "#8c3a50",
      title: "✨ 維納斯的能量調和 ✨"
    },
    FORTUNE: {
      headerBg: "#1e112c",
      bodyBg: "#2d1b4e",
      footerBg: "#1e112c",
      textColor: "#f1e4f3",
      accentColor: "#d8b4e2",
      btnColor: "#5a377c",
      title: "✨ 莫伊萊的命運之輪 ✨"
    },
    COSMOS: {
      headerBg: "#161a1d",
      bodyBg: "#22252a",
      footerBg: "#161a1d",
      textColor: "#f5f6f9",
      accentColor: "#a3a8b4",
      btnColor: "#3a4146",
      title: "✨ 艾蓮的星曜守護指引 ✨"
    }
  };

  const style = styles[deity] || styles.COSMOS;

  return {
    type: "flex",
    altText: `🔮 您的專屬星曜指引已送達：\${style.title}`,
    sender: {
      name: DEITY_CONFIG[deity].name,
      iconUrl: iconUrl
    },
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        header: { backgroundColor: style.headerBg },
        body: { backgroundColor: style.bodyBg },
        footer: { backgroundColor: style.footerBg, separator: true, separatorColor: style.btnColor }
      },
      header: {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "avatar",
            url: iconUrl,
            size: "sm"
          },
          {
            type: "text",
            text: DEITY_CONFIG[deity].name,
            color: style.textColor,
            size: "sm",
            weight: "bold",
            gravity: "center",
            margin: "md"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: style.title,
            color: style.textColor,
            size: "lg",
            weight: "bold",
            align: "center"
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "lg",
            contents: points.map(point => ({
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "✦",
                  color: style.accentColor,
                  size: "sm",
                  flex: 1
                },
                {
                  type: "text",
                  text: point,
                  color: style.textColor,
                  size: "sm",
                  flex: 11,
                  wrap: true
                }
              ]
            }))
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "🔮 讀取完整智慧指引",
              data: `action=get_full_text&id=\${msgId}`
            },
            style: "primary",
            color: style.btnColor
          }
        ]
      }
    }
  };
}

// ==========================================
// 📥 Postback Event Handler (讀取完整指引)
// ==========================================
async function handlePostbackEvent(event, req) {
  const data = event.postback.data;
  console.log(`📥 Received postback event with data: "\${data}"`);

  const params = new URLSearchParams(data);
  const action = params.get('action');
  const msgId = params.get('id');

  if (action === 'get_full_text' && msgId) {
    try {
      console.log(`🔍 Fetching full response from Firestore for ID: "\${msgId}"...`);
      const doc = await customMemoryService.db.collection('crystal_full_texts').doc(msgId).get();

      if (!doc.exists) {
        console.log(`⚠️ Document with ID: "\${msgId}" not found in Firestore.`);
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '🔮 親愛的，這則指引的能量連結已隨時間淡去。不妨重新向我提出您的水晶或占星諮詢，好讓我為您做新的調和與解讀。'
          }]
        });
      }

      const { text, deity } = doc.data();
      console.log(`✅ Full response retrieved successfully. Deity: "\${deity}". Length: \${text.length} characters.`);

      // Resolve dynamic URL for the deity's icon
      let iconUrl = DEITY_CONFIG[deity].iconUrl;
      if (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://')) {
        const baseUrl = req && req.baseUrlForIcons ? req.baseUrlForIcons : '';
        iconUrl = `\${baseUrl}/static/\${encodeURIComponent(iconUrl)}`;
      }

      // Send the full text response back under the dynamic sender persona
      const replyMessage = {
        type: 'text',
        text: text,
        sender: {
          name: DEITY_CONFIG[deity].name,
          iconUrl: iconUrl
        }
      };

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [replyMessage]
      });
      console.log('✅ Full response sent to user successfully via postback reply.');
    } catch (error) {
      console.error('❌ Error handling postback get_full_text:', error);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: `❌ 親愛的，連結此智慧指引時能量受到些微干擾，請稍後再試。原因：\${error.message || error}`
        }]
      });
    }
  }
  return null;
}

// ==========================================
// 🪐 Deity Config for Icon Switch (動態身份頭像設定)
// ==========================================
const DEITY_CONFIG = {
  ATHENA: {
    name: '智慧守護神 雅典娜',
    iconUrl: process.env.DEITY_ATHENA_ICON || '雅典娜.png'
  },
  VENUS: {
    name: '金星守護神 維納斯',
    iconUrl: process.env.DEITY_VENUS_ICON || '維納斯.png'
  },
  FORTUNE: {
    name: '命運之輪 莫伊萊',
    iconUrl: process.env.DEITY_FORTUNE_ICON || '莫伊來.png'
  },
  COSMOS: {
    name: '星曜守護導師 艾蓮',
    iconUrl: process.env.DEITY_COSMOS_ICON || 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?auto=format&fit=crop&w=128&h=128&q=80'
  }
};

// ==========================================
// 🎯 Event Handler
// ==========================================
async function handleEvent(event, req) {
  // Check if it's a postback event
  if (event.type === 'postback') {
    return handlePostbackEvent(event, req);
  }

  // Ignore non-message events
  if (event.type !== 'message') {
    return null;
  }

  // We only support 'text' and 'image' messages
  if (event.message.type !== 'text' && event.message.type !== 'image') {
    console.log(`👉 Message event ignored: Non-supported message type [${event.message.type}].`);
    return null;
  }

  const userId = event.source.userId;
  const sessionId = `session_${userId}`; // Session is scoped per user
  const messageType = event.message.type;
  console.log(`💬 Processing message from User (${userId}) of type: ${messageType}`);

  let responseText = '';
  let newMessage = null;
  let isGuide = false;

  try {
    // 1. Get or create session
    await runner.sessionService.getOrCreateSession({
      appName: 'CrystalAstrology',
      userId: userId,
      sessionId: sessionId
    });

    // 2. Prepare the input payload
    if (messageType === 'text') {
      const userMessage = event.message.text.trim();
      console.log(`💬 User text content: "${userMessage}"`);
      if (userMessage === '使用指南' || userMessage === '使用說明') {
        isGuide = true;
        responseText = `🔮 歡迎來到【水晶與星盤能量諮詢室】使用指南 🔮

親愛的，我是您的專業水晶占星專家。在這裡，我將結合您的生日星盤與您擁有的水晶能量，為您的日常運勢與心靈能量提供最溫柔客觀的分析與日常調和指引。

您可以透過以下方式與我互動：

1️⃣ 🪐 提供您的生日資訊
請輸入您的生日（包含西元年、月、日，如有出生時間與星座更佳），例如：
「老師，我是1995年10月12日出生的天秤座。」
我會將您的生日永遠銘記在心，為您進行客製化的星盤解析！

2️⃣ 📸 鑑定與分析水晶能量
您可以點擊左下角的相機或相簿，直接發送您拍下的水晶照片。
我會為您詳細解說這款水晶的：
• 晶體能量特徵
• 五行元素屬性
• 七輪脈輪共振
• 以及它與您個人星盤磁場的契合度與每日開運指引！

3️⃣ 💬 智慧追問與引導
每次我回答完畢後，底部會彈出 3 個可能感興趣的快速按鈕（Quick Replies），您可以直接點擊它們繼續深入諮詢，也可以自由輸入任何想問的問題。

靜下心來，讓我們一起開啟這趟能量療癒的旅程吧。✨`;
      } else {
        newMessage = {
          role: 'user',
          parts: [{ text: userMessage }]
        };
      }
    } else if (messageType === 'image') {
      const messageId = event.message.id;
      console.log(`📸 Image message received. Downloading image from LINE (ID: ${messageId})...`);

      const stream = await blobClient.getMessageContent(messageId);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      console.log(`✅ Image downloaded successfully. Size: ${buffer.length} bytes.`);

      const base64Image = buffer.toString('base64');
      newMessage = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          {
            text: '老師，這是我拍的水晶照片，請幫我分析鑑定並詳細解說它的能量特徵、五行，以及它與我磁場的契合度。'
          }
        ]
      };
    }

    if (!isGuide) {
      // 3. Run the ADK Agent
      console.log(`🤖 Executing Crystal Expert ADK Agent for Session: ${sessionId}...`);
      const run = runner.runAsync({
        userId: userId,
        sessionId: sessionId,
        newMessage: newMessage
      });

      for await (const runEvent of run) {
        if (runEvent.errorCode) {
          throw new Error(runEvent.errorMessage || runEvent.errorCode);
        }
        
        if (runEvent.content?.parts) {
          for (const part of runEvent.content.parts) {
            if (part.text) {
              responseText += part.text;
            }
          }
        }
      }

      if (!responseText) {
        responseText = '🔮 (親愛的，我目前感受到的能量流動有些微弱，沒能完全解析。不妨多跟我分享一些關於你的生日星盤，或是其他水晶收藏，好讓我能為你做更深入的解讀。)';
      }

      // 4. Save the completed session to long-term memory
      console.log(`[Memory] Saving conversation session to memory bank...`);
      const updatedSession = await runner.sessionService.getSession({
        appName: 'CrystalAstrology',
        userId: userId,
        sessionId: sessionId
      });
      if (updatedSession) {
        await runner.memoryService.addSessionToMemory(updatedSession);
        console.log(`[Memory] Session successfully saved for User: ${userId}`);
      }
    }

    console.log(`🤖 Reply text preview: "${responseText.substring(0, 100)}..."`);
  } catch (err) {
    console.error('❌ Error executing ADK Agent or fetching Vertex AI:', err);
    responseText = `❌ 親愛的，目前能量連結稍微受到一些干擾，請稍後再試。訊息：${err.message || err}`;
  }

  // 5. Detect and parse Deity Dynamic Identity Tag for Icon Switch
  let deity = 'COSMOS';
  const deityRegex = /^\[DEITY:\s*([A-Z]+)\]\s*\n*/i;
  const match = responseText.match(deityRegex);
  if (match) {
    const matchedDeity = match[1].toUpperCase();
    if (DEITY_CONFIG[matchedDeity]) {
      deity = matchedDeity;
    }
    responseText = responseText.replace(deityRegex, '').trim();
    console.log(`✨ [IconSwitch] Detected dynamic deity switch: "${deity}"`);
  } else {
    console.log(`✨ [IconSwitch] No deity tag found. Falling back to default: "${deity}"`);
  }

  // 6. Generate follow-up Quick Replies and Key Points concurrently
  let followUpQuestions = null;
  let points = [];

  if (isGuide) {
    followUpQuestions = [
      '我生日1995年10月12日',
      '如何鑑定我的水晶？',
      '天秤座適合戴什麼？'
    ];
  } else {
    console.log('⚡ [Parallel] Initiating concurrent key points and quick reply generation...');
    const results = await Promise.allSettled([
      generateFollowUpQuestions(responseText),
      generateKeyPoints(responseText)
    ]);

    if (results[0].status === 'fulfilled') {
      followUpQuestions = results[0].value;
    } else {
      console.error('❌ Error generating follow-up questions in parallel:', results[0].reason);
    }

    if (results[1].status === 'fulfilled' && Array.isArray(results[1].value)) {
      points = results[1].value;
    } else {
      console.error('❌ Error generating key points in parallel:', results[1].reason);
      points = [
        '開啟寧靜思緒，擁抱宇宙指引',
        '淨化自身磁場，調和日常能量',
        '點擊下方按鈕讀取完整智慧分析'
      ];
    }
  }

  // Resolve dynamic URL for local images served via /static
  let iconUrl = DEITY_CONFIG[deity].iconUrl;
  if (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://')) {
    const baseUrl = req && req.baseUrlForIcons ? req.baseUrlForIcons : '';
    iconUrl = `${baseUrl}/static/${encodeURIComponent(iconUrl)}`;
  }

  // Send the reply back to the user on LINE
  let replyMessage;

  if (isGuide) {
    // For static guide, reply with plain text immediately
    replyMessage = {
      type: 'text',
      text: responseText,
      sender: {
        name: DEITY_CONFIG[deity].name,
        iconUrl: iconUrl
      }
    };
  } else {
    // 7. Generate a unique ID for this message
    const msgId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    // Save full text to Firestore
    try {
      console.log(`💾 Saving full response text to Firestore under ID: "${msgId}"...`);
      await customMemoryService.db.collection('crystal_full_texts').doc(msgId).set({
        text: responseText,
        deity: deity,
        timestamp: Date.now()
      });
      console.log('✅ Full response text saved to Firestore successfully.');
    } catch (fsErr) {
      console.error('❌ Failed to save full response text to Firestore:', fsErr);
    }

    // 8. Build the gorgeous colored dynamic Flex Message bubble
    replyMessage = buildFlexMessage(deity, points, msgId, iconUrl);
  }

  if (followUpQuestions && followUpQuestions.length > 0) {
    replyMessage.quickReply = {
      items: followUpQuestions.map(question => ({
        type: 'action',
        action: {
          type: 'message',
          label: question,
          text: question
        }
      }))
    };
    console.log(`[QuickReply] Attached ${followUpQuestions.length} buttons to response.`);
  }

  try {
    console.log(`📨 Replying to LINE user with ${replyMessage.type === 'flex' ? 'Flex Message Card' : 'Plain Text'}...`);
    const replyResult = await client.replyMessage({
      replyToken: event.replyToken,
      messages: [replyMessage]
    });
    console.log('✅ Reply sent successfully.');
    return replyResult;
  } catch (error) {
    console.error('❌ Error replying to LINE API:', error);
    throw error;
  }
}

// ==========================================
// 🚀 Start Server
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 ==========================================`);
  console.log(`🔮 Crystal Expert LINE Bot Server listening on port ${PORT}`);
  console.log(`🔮 Loaded with Google ADK & PreloadMemoryTool`);
  console.log(`🔮 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🚀 ==========================================\n`);
});

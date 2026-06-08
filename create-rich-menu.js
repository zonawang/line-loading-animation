const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!ACCESS_TOKEN || ACCESS_TOKEN.startsWith('your_')) {
  console.error('❌ Error: LINE_CHANNEL_ACCESS_TOKEN is not set or is still a placeholder in .env!');
  process.exit(1);
}

const richMenuConfig = {
  size: {
    width: 2500,
    height: 1686
  },
  selected: true,
  name: "Crystal Astrology Rich Menu",
  chatBarText: "精靈選單",
  areas: [
    {
      bounds: {
        x: 0,
        y: 0,
        width: 1250,
        height: 1686
      },
      action: {
        type: "message",
        text: "使用指南"
      }
    },
    {
      bounds: {
        x: 1250,
        y: 0,
        width: 1250,
        height: 1686
      },
      action: {
        type: "uri",
        uri: "https://github.com/zonawang/zona-ai-learning-lab"
      }
    }
  ]
};

async function run() {
  try {
    console.log('🚀 [1/3] Creating Rich Menu on LINE...');
    
    const createResponse = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(richMenuConfig)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create rich menu: ${createResponse.status} ${errorText}`);
    }

    const createData = await createResponse.json();
    const richMenuId = createData.richMenuId;
    console.log(`✅ Rich Menu created successfully! ID: ${richMenuId}`);

    console.log('\n🚀 [2/3] Uploading Rich Menu image...');
    const imagePath = path.join(__dirname, 'richmenu_resized.jpg');
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found at path: ${imagePath}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const uploadResponse = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'image/jpeg'
      },
      body: imageBuffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload rich menu image: ${uploadResponse.status} ${errorText}`);
    }

    console.log('✅ Rich Menu image uploaded successfully!');

    console.log('\n🚀 [3/3] Setting this Rich Menu as default...');
    const setDefaultResponse = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      }
    });

    if (!setDefaultResponse.ok) {
      const errorText = await setDefaultResponse.text();
      throw new Error(`Failed to set default rich menu: ${setDefaultResponse.status} ${errorText}`);
    }

    console.log('✅ Rich Menu set as default for all users!');
    console.log('\n🎉 ALL STEPS COMPLETED SUCCESSFULLY! 🎉');
  } catch (error) {
    console.error('\n❌ Error occurred:', error.message);
    process.exit(1);
  }
}

run();

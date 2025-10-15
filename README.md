# TREKKER-MD-Session-Generator
- Fork, Star and Edit as you wish
- Deploy to your favourite hosting server eg Heroku or Render or self hosting
- This is what I use in my **[Session Site](https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev)** so don't ask for more...

<details>
<summary>SAMPLE USAGE IN BOT</summary>
   
```js
// 1. IN YOUR LIB OR SOMEWHERE YOU LIKE:
const fs = require('fs'),
      path = require('path'), 
      axios = require('axios'),
      sessionDir = path.join(__dirname, 'session'),
      credsPath = path.join(sessionDir, 'creds.json'),
      createDirIfNotExist = dir => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

createDirIfNotExist(sessionDir);

const SESSIONS_BASE_URL = 'https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev'; // Your Backend Url Here
const SESSIONS_API_KEY = ''; // Must Match one of your Backened ApiKeys

async function loadSession() {
  try {
    if (!config.SESSION_ID) {
      console.log('No SESSION_ID Provided - Using QR Code Authentication');
      return true;
    }

    const credsId = config.SESSION_ID;

    if (!credsId.startsWith('TREKKER~')) {
      console.log('Invalid SESSION_ID: It must start with "TREKKER~"');
      return false;
    }

    const sessionDir = path.join(__dirname, '../session');
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const response = await axios.get(`${SESSIONS_BASE_URL}/api/downloadCreds.php/${credsId}`, {
      headers: {
        'x-api-key': SESSIONS_API_KEY
      }
    });

    if (!response.data.credsData) {
      throw new Error('No sessionData Received from Server');
    }

    const credsPath = path.join(sessionDir, 'creds.json');
    fs.writeFileSync(credsPath, JSON.stringify(response.data.credsData), 'utf8');
    console.log('Session Loaded ✅');
    return response.data.credsData;
  } catch (error) {
    console.error('Error loading session:', error.response?.data || error.message);
    return null;
  }
}

module.exports = { loadSession }


// 2. IN YOUR BOT START FILE(INDEX.JS/CLIENT.JS):
const { loadSession } = require("./lib");
// Other things....
async function ConnectTrekkerToWA() {
  await loadSession();
console.log('⏱️ Connecting TREKKER-MD ⏱️')
const { state, saveCreds } = await useMultiFileAuthState(__dirname + '/session/')
var { version, isLatest } = await fetchLatestBaileysVersion()

const Trekker = TrekkerConnect({
        logger: P({ level: 'silent' }),
        printQRInTerminal: !config.SESSION_ID, // Continue your functions......


```

</details>

<details>
<summary>MORE INFO</summary>
   
<strong>NB:<strong/> This repo also generates session ID for all bots using trekker-baileys/whiskeysockets/baileys but with ***mongodb*** storage.
[![-----------------------------------------------------](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/colored.png)](#table-of-contents)
<br/>WEB - PAIR CODE FOR BOTS WITH TREKKER-MD-BAILEYS
[![-----------------------------------------------------](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/colored.png)](#table-of-contents)
<p align="center">
   <a href="https://github.com/mauricegift">
    <img src="https://files.catbox.moe/52699c.jpg" width="500">
     
</a>
 <p align="center"><img src="https://profile-counter.glitch.me/{mauricegift}/count.svg" alt="TREKKER-MD:: Visitor's Count" /></p>

</details>



[`ℹ️Contact Owner`](https://t.me/trekkermd_)
 <br>
<a href='https://github.com/mauricegift/gifted-pair-code/fork' target="_blank">
    <img alt='FORK REPO' src='https://img.shields.io/badge/-FORK REPO-black?style=for-the-badge&logo=github&logoColor=white'/>
</a>



<details>
<summary>DEPLOYMENT</summary>
 
<a href='https://dashboard.heroku.com/new?template=https://github.com/mauricegift/gifted-pair-code' target="_blank"><img alt='HEROKU DEPLOY' src='https://img.shields.io/badge/-HEROKU DEPLOY-black?style=for-the-badge&logo=heroku&logoColor=white'/>
 <br>
<a href='https://dashboard.render.com' target="_blank">
    <img alt='DEPLOY TO RENDER' src='https://img.shields.io/badge/-DEPLOY TO RENDER-black?style=for-the-badge&logo=render&logoColor=white'/>
</a>
 <br>
<a href='https://app.koyeb.com' target="_blank">
    <img alt='DEPLOY TO KOYEB' src='https://img.shields.io/badge/-DEPLOY TO KOYEB-black?style=for-the-badge&logo=koyeb&logoColor=white'/>
</a>

</details>

[`HERE'S AN EXAMPLE OUTPUT`](https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev)
# `Owner`

 <a href="https://t.me/trekkermd_"><img src="https://i.postimg.cc/0Nrf4fxL/IMG-20250419-131400-618.jpg" width="250" height="250" alt="Trekker Tech"/></a>

   

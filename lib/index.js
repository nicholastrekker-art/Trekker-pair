require('dotenv').config();
const fs = require('fs').promises; 
const { MongoClient } = require('mongodb');

let mongoClient;
let isConnecting = false;

async function connectMongoDB() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not set');
    }
    
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
        return mongoClient.db('sessions');
    }
    
    if (isConnecting) {
        while (isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return mongoClient.db('sessions');
    }
    
    try {
        isConnecting = true;
        mongoClient = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4
        });
        
        await mongoClient.connect();
        return mongoClient.db('sessions');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        mongoClient = null;
        throw error;
    } finally {
        isConnecting = false;
    }
}

function giftedId(num = 22) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  
  for (let i = 0; i < num; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  
  return result;
}

// Import sessionStorage from pair.js (we'll need to export it)
const sessionStorage = new Map();

async function downloadCreds(sessionId) {  
  try {
    // Validate Base64 format
    try {
      Buffer.from(sessionId, 'base64').toString();
    } catch (e) {
      throw new Error('Invalid SESSION_ID: Must be valid Base64 format');
    }

    // Get from local storage instead of MongoDB
    const sessionData = sessionStorage.get(sessionId);
    
    if (!sessionData?.credsData) {
      throw new Error('No sessionData found in local storage');
    }

    // Decode Base64 back to JSON
    const decodedCreds = Buffer.from(sessionData.credsData, 'base64').toString('utf8');
    return JSON.parse(decodedCreds);
  } catch (error) {
    console.error('Download Error:', error.message);
    throw error;
  }
}

// Function to access sessionStorage from other modules
function getSessionStorage() {
  return sessionStorage;
}

async function removeFile(filePath) {
  try {
    await fs.access(filePath);
    await fs.rm(filePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Remove Error:', error.message);
    }
    return false;
  }
}

module.exports = { 
  downloadCreds, 
  removeFile, 
  giftedId,
  getSessionStorage
};

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors");
const twilio = require('twilio');
// const stripe = require('stripe')(functions.config().stripe.secret_key); // Commented out to fix deployment error
const axios = require('axios');
const sql = require('mssql');
// const { freshbooksToken } = require('./freshbooksToken'); // Temporarily commented out to fix deployment

// Load environment variables from .env file
require('dotenv').config();

// Define allowed origins for all functions
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://bible-search-frontend.vercel.app',
  'https://bible-search-frontend-git-main-sparedes88s-projects.vercel.app',
  'https://iglesiatech.app',
  'https://www.iglesiatech.app',
  'https://churchadmin.app',
  'https://www.churchadmin.app'
];

// Create a reusable CORS handler function
const handleCors = (req, res) => {
  const origin = req.headers.origin;
  
  // Check if the origin is in our allowed list
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    // For requests from unknown origins, set a wildcard
    res.set('Access-Control-Allow-Origin', '*');
  }
  
  // Set other CORS headers
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept, X-Requested-With');
  res.set('Access-Control-Allow-Credentials', 'true');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  
  return false;
};

// Initialize Firebase Admin SDK with default credentials
if (!admin.apps.length) {
  admin.initializeApp();
}

// SQL Server Configuration
const sqlConfig = {
  user: process.env.SQL_USER || functions.config().sql?.user,
  password: process.env.SQL_PASSWORD || functions.config().sql?.password,
  server: process.env.SQL_SERVER || functions.config().sql?.server,
  port: parseInt(process.env.SQL_PORT || functions.config().sql?.port) || 1433,
  database: process.env.SQL_DATABASE || functions.config().sql?.database,
  options: {
    encrypt: true, // Use encryption
    trustServerCertificate: true, // For local development
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// SQL Server connection pool
let sqlPool = null;

// Initialize SQL Server connection pool
async function getSqlPool() {
  if (!sqlPool) {
    try {
      sqlPool = await sql.connect(sqlConfig);
      console.log('✅ Connected to SQL Server');
    } catch (error) {
      console.error('❌ SQL Server connection error:', error);
      throw error;
    }
  }
  return sqlPool;
}

// Helper function to execute SQL queries
async function executeQuery(query, params = []) {
  try {
    const pool = await getSqlPool();
    const request = pool.request();
    
    // Add parameters if provided
    params.forEach((param, index) => {
      request.input(`param${index}`, param);
    });
    
    const result = await request.query(query);
    return result.recordset;
  } catch (error) {
    console.error('❌ SQL Query error:', error);
    throw error;
  }
}

// Initialize Twilio client (only if credentials are available)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID || functions.config().twilio?.account_sid) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID || functions.config().twilio?.account_sid,
    process.env.TWILIO_AUTH_TOKEN || functions.config().twilio?.auth_token
  );
}

const corsHandler = cors({origin: true});

exports.sendNotification = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("🔵 Received request at sendNotification");

    if (req.method !== "POST") {
      console.log("❌ Invalid request method:", req.method);
      return res.status(405).send({error: "Only POST method allowed"});
    }

    try {
      const {tokens, title, body, data} = req.body;
      console.log("🔹 Payload received:", {tokens, title, body, data});

      if (!tokens || tokens.length === 0) {
        return res.status(400).json(
            {success: false, error: "No tokens provided"},
        );
      }

      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log("✅ Notification sent successfully:", response);
      res.status(200).json({success: true, response});
    } catch (error) {
      console.error("❌ Error sending notification:", error);
      res.status(500).json({success: false, error: error.message});
    }
  });
});

exports.sendSMS = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { to, message, churchId, senderId, memberName, visitorId, visitorName, messageId, clientMessageId } = req.body;

      if (!to || !message) {
        return res.status(400).json({
          error: "Missing required parameters"
        });
      }

      console.log("Sending SMS message:", {
        to,
        message: message.substring(0, 30) + (message.length > 30 ? "..." : ""),
        churchId,
        senderId,
        visitorId: visitorId || "none",
        messageId: messageId || clientMessageId || "none"
      });

      // Send SMS via Twilio
      const result = await twilioClient.messages.create({
        to,
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER || functions.config().twilio?.phone_number
      });

      console.log("SMS sent successfully, Twilio SID:", result.sid);

      // Prepare the base message data
      const messageData = {
        to,
        message,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: senderId,
        status: 'sent',
        twilioMessageId: result.sid,
        twilioSid: result.sid,
        direction: 'outbound'
      };

      // If this is a visitor message
      if (visitorId) {
        console.log(`Saving visitor message to churches/${churchId}/visitorMessages for visitor ${visitorId}`);
        
        // Add visitor-specific fields
        const visitorMessageData = {
          ...messageData,
          visitorId,
          visitorName: visitorName || "Visitor",
          senderName: memberName || "Church Admin"
        };
        
        // Determine which document to update or create
        let messageDocRef;
        if (messageId) {
          messageDocRef = admin.firestore().doc(`churches/${churchId}/visitorMessages/${messageId}`);
          await messageDocRef.update({
            ...visitorMessageData,
            status: 'sent',
            twilioMessageId: result.sid
          });
        } else {
          messageDocRef = await admin.firestore().collection(`churches/${churchId}/visitorMessages`).add(visitorMessageData);
        }
        
        console.log(`Visitor message saved with ID: ${messageDocRef.id}`);
      } 
      // If this is a member message
      else {
        console.log(`Saving member message to churches/${churchId}/messages`);
        
        // Add member-specific fields
        const memberMessageData = {
          ...messageData,
          memberName: memberName || "Member",
          memberId: req.body.memberId
        };
        
        // Save to the general messages collection
        await admin.firestore().collection(`churches/${churchId}/messages`).add(memberMessageData);
      }

      // Also save to the global messages collection for tracking
      await admin.firestore().collection('messages').add({
        ...messageData,
        churchId,
        memberId: req.body.memberId,
        visitorId: visitorId,
        visitorName: visitorName,
        memberName: memberName,
        clientMessageId: clientMessageId
      });

      res.status(200).json({
        success: true,
        messageId: result.sid
      });
    } catch (error) {
      console.error('Error sending SMS:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Add a Twilio webhook endpoint to handle SMS responses
exports.smsWebhook = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("📩 Received SMS webhook request:", req.body);
    
    try {
      // Extract the message data from the Twilio webhook
      const {
        From: from,
        To: to,
        Body: body,
        MessageSid: sid,
        SmsSid: smsSid
      } = req.body;
      
      if (!from || !body) {
        console.error("Missing required webhook parameters");
        return res.status(400).send('Missing parameters');
      }
      
      console.log(`Received SMS response from ${from} with content: ${body}`);
      
      // Format the from phone number consistently 
      const formattedPhone = from.startsWith('+') ? from : `+1${from.replace(/\D/g, '')}`;
      
      // Look up which church this belongs to
      let churchId = null;
      let memberId = null;
      let visitorId = null;
      
      // First, check in the church messages collection
      const churchesRef = admin.firestore().collection('churches');
      const churchesSnapshot = await churchesRef.get();
      
      // Search through all churches for matching phone number
      for (const churchDoc of churchesSnapshot.docs) {
        const currentChurchId = churchDoc.id;
        
        // Check members first
        const membersRef = admin.firestore().collection('users');
        const memberSnapshot = await membersRef
          .where('phone', '==', formattedPhone.replace(/^\+1/, ''))
          .where('churchId', '==', currentChurchId)
          .limit(1)
          .get();
        
        if (!memberSnapshot.empty) {
          memberId = memberSnapshot.docs[0].id;
          churchId = currentChurchId;
          console.log(`Found member: ${memberId}, church: ${churchId}`);
          break;
        }
        
        // Then check visitors
        const visitorsRef = admin.firestore().collection(`visitors/${currentChurchId}/visitors`);
        const visitorSnapshot = await visitorsRef
          .where('phone', '==', formattedPhone.replace(/^\+1/, ''))
          .limit(1)
          .get();
        
        if (!visitorSnapshot.empty) {
          visitorId = visitorSnapshot.docs[0].id;
          churchId = currentChurchId;
          console.log(`Found visitor: ${visitorId}, church: ${churchId}`);
          break;
        }
      }
      
      // Fallback: check previous messages
      if (!churchId) {
        const messagesRef = admin.firestore().collection('messages');
        const messagesSnapshot = await messagesRef
          .where('to', '==', formattedPhone)
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();
        
        if (!messagesSnapshot.empty) {
          const recentMessage = messagesSnapshot.docs[0].data();
          churchId = recentMessage.churchId;
          memberId = recentMessage.memberId;
          visitorId = recentMessage.visitorId;
          console.log(`Matched response to previous message: church: ${churchId}, member: ${memberId}, visitor: ${visitorId}`);
        }
      }
      
      if (!churchId) {
        console.log("Could not determine church for this message. Storing in general collection only.");
      }
      
      // Store the message in Firestore
      const messageData = {
        from: formattedPhone,
        to,
        message: body,
        direction: 'inbound',
        status: 'received',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        twilioSid: sid || smsSid,
        isRead: false // Mark as unread for admin
      };
      
      if (churchId) {
        messageData.churchId = churchId;
      }
      
      if (memberId) {
        messageData.memberId = memberId;
        messageData.senderId = memberId; // Mark the sender as the member
      }
      
      if (visitorId) {
        messageData.visitorId = visitorId;
        messageData.senderId = visitorId; // Mark the sender as the visitor
      }
      
      // Store in main messages collection
      const messageRef = await admin.firestore().collection('messages').add(messageData);
      console.log("Stored inbound message in messages collection with ID:", messageRef.id);
      
      // If we have a churchId, also store in church subcollection and update unread counters
      if (churchId) {
        // Store the message in the appropriate collection
        if (memberId) {
          // For members, store in the church messages collection
          await admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .add(messageData);
          console.log(`Stored member message in churches/${churchId}/messages`);
          
          // Also store in the user's messages subcollection
          await admin.firestore()
            .collection(`users/${memberId}/messages`)
            .add(messageData);
          console.log(`Stored message in users/${memberId}/messages`);
          
          // Update the unread counter for members
          const unreadMembersRef = admin.firestore()
            .doc(`churches/${churchId}/adminConnect/members`);
          
          try {
            // Use a transaction to atomically update the counter
            await admin.firestore().runTransaction(async (transaction) => {
              const unreadDoc = await transaction.get(unreadMembersRef);
              const unreadData = unreadDoc.exists ? unreadDoc.data() : {};
              
              // Increment the counter for this member
              const currentCount = unreadData[memberId] || 0;
              unreadData[memberId] = currentCount + 1;
              
              if (unreadDoc.exists) {
                transaction.update(unreadMembersRef, unreadData);
              } else {
                transaction.set(unreadMembersRef, unreadData);
              }
            });
            
            console.log(`Updated unread counter for member ${memberId}`);
          } catch (error) {
            console.error("Error updating member unread counter:", error);
          }
        } else if (visitorId) {
          // For visitors, store in the visitorMessages collection
          await admin.firestore()
            .collection(`churches/${churchId}/visitorMessages`)
            .add(messageData);
          console.log(`Stored visitor message in churches/${churchId}/visitorMessages`);
          
          // Update the unread counter specifically for visitor messages
          try {
            // First, get all unread messages for this visitor
            const visitorMsgsRef = admin.firestore()
              .collection(`churches/${churchId}/visitorMessages`);
            
            const unreadMsgsQuery = query(
              visitorMsgsRef,
              where('visitorId', '==', visitorId),
              where('isRead', '==', false)
            );
            
            const unreadSnap = await admin.firestore().getCountFromServer(unreadMsgsQuery);
            const unreadCount = unreadSnap.data().count;
            
            // Store the count in the visitors unread counter map
            const visitorsUnreadRef = admin.firestore()
              .doc(`churches/${churchId}/adminConnect/visitors`);
            
            await admin.firestore().runTransaction(async (transaction) => {
              const visitorsDoc = await transaction.get(visitorsUnreadRef);
              const visitorsData = visitorsDoc.exists ? visitorsDoc.data() : {};
              
              visitorsData[visitorId] = unreadCount;
              
              if (visitorsDoc.exists) {
                transaction.update(visitorsUnreadRef, visitorsData);
              } else {
                transaction.set(visitorsUnreadRef, visitorsData);
              }
            });
            
            console.log(`Updated unread counter for visitor ${visitorId} to ${unreadCount}`);
          } catch (error) {
            console.error("Error updating visitor unread counter:", error);
          }
        } else {
          // If we don't know the source, store in general messages collection
          await admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .add(messageData);
          console.log(`Stored message from unknown source in churches/${churchId}/messages`);
        }
      }
      
      // Return a TwiML response (Twilio expects this)
      res.set('Content-Type', 'text/xml');
      res.send(`
        <Response>
        </Response>
      `);
    } catch (error) {
      console.error("Error processing SMS webhook:", error);
      res.status(500).send('Error processing request');
    }
  });
});

// Add a function to check Twilio directly for messages
exports.checkTwilioMessages = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    console.log("📱 Checking Twilio for messages");
    
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    
    try {
      const { phoneNumber, churchId, memberId, visitorId } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Missing phone number"
        });
      }
      
      // Format phone number for Twilio (add +1 for US numbers if needed)
      const formattedPhone = phoneNumber.startsWith('+') ? 
        phoneNumber : 
        `+1${phoneNumber.replace(/\D/g, '')}`;
        
      console.log(`Checking messages for phone: ${formattedPhone}, churchId: ${churchId}, memberId: ${memberId || 'none'}, visitorId: ${visitorId || 'none'}`);
      
      // Get messages from Twilio API
      const messages = await twilioClient.messages.list({
        // Look for messages sent to or from this number in the last 7 days
        to: formattedPhone,
        limit: 20
      });
      
      // Also get messages sent from this number
      const inboundMessages = await twilioClient.messages.list({
        from: formattedPhone,
        limit: 20
      });
      
      // Combine and filter messages
      const allMessages = [...messages, ...inboundMessages];
      
      // Remove duplicates (same SID)
      const uniqueMessages = [];
      const seenSids = new Set();
      
      allMessages.forEach(message => {
        if (!seenSids.has(message.sid)) {
          seenSids.add(message.sid);
          uniqueMessages.push({
            sid: message.sid,
            body: message.body,
            from: message.from,
            to: message.to,
            direction: message.direction,
            status: message.status,
            dateSent: message.dateSent
          });
        }
      });
      
      console.log(`Found ${uniqueMessages.length} messages for ${formattedPhone}`);
      
      // Store these messages in Firestore if they're not already there
      const messagesRef = admin.firestore().collection('messages');
      const messagesSnapshot = await messagesRef
        .where('twilioSid', 'in', uniqueMessages.slice(0, 10).map(m => m.sid))
        .get();
      
      // Find which messages are already in the database
      const existingSids = new Set();
      messagesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.twilioSid) {
          existingSids.add(data.twilioSid);
        }
      });
      
      // Store any new messages
      const batch = admin.firestore().batch();
      let newMessageCount = 0;
      
      for (const message of uniqueMessages) {
        // Skip if already in database
        if (existingSids.has(message.sid)) continue;
        
        // Determine if this is inbound or outbound relative to the user
        const isInbound = message.from === formattedPhone;
        
        // Create the base message data
        const baseMessageData = {
          from: message.from,
          to: message.to,
          body: message.body,
          message: message.body,
          twilioSid: message.sid,
          twilioMessageId: message.sid,
          direction: isInbound ? 'inbound' : 'outbound',
          status: message.status,
          timestamp: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
          sentAt: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
          churchId: churchId,
          source: 'twilio-api'
        };
        
        // Add message to the main messages collection
        const newMessageRef = messagesRef.doc();
        batch.set(newMessageRef, baseMessageData);
        
        // Also store in appropriate subcollection based on whether this is for a visitor or a member
        if (visitorId) {
          // For visitors, add to visitorMessages collection
          const visitorData = {
            ...baseMessageData,
            visitorId: visitorId
          };
          
          const visitorMessageRef = admin.firestore()
            .collection(`churches/${churchId}/visitorMessages`)
            .doc();
            
          batch.set(visitorMessageRef, visitorData);
        } else if (memberId) {
          // For members, add to members collection
          const memberData = {
            ...baseMessageData,
            memberId: memberId
          };
          
          const memberMessageRef = admin.firestore()
            .collection(`churches/${churchId}/messages`)
            .doc();
            
          batch.set(memberMessageRef, memberData);
        }
        
        newMessageCount++;
      }
      
      // Commit the batch if there are new messages
      if (newMessageCount > 0) {
        await batch.commit();
        console.log(`Added ${newMessageCount} new messages to database`);
      }
      
      // Return all messages to the client
      res.status(200).json({
        success: true,
        messages: uniqueMessages
      });
    } catch (error) {
      console.error("Error checking Twilio messages:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Create a Stripe payment intent for processing payments
exports.createPaymentIntent = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { amount, churchId, currency = 'usd', description, metadata = {} } = req.body;
    
    if (!amount || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: amount and churchId"
      });
    }
    
    console.log(`Creating payment intent for church: ${churchId}, amount: ${amount}`);
    
    // Get church payment configuration from Firestore (if needed)
    admin.firestore().collection('churches').doc(churchId).get()
      .then(async (churchDoc) => {
        if (!churchDoc.exists) {
          return res.status(404).json({
            success: false,
            error: "Church not found"
          });
        }
        
        const churchData = churchDoc.data();
        
        // Create a payment intent with Stripe
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(parseFloat(amount)), // Stripe requires integer in smallest currency unit (cents)
          currency: currency,
          metadata: {
            churchId,
            type: metadata.type || 'balance_recharge',
            ...metadata
          },
          description: description || `Payment for ${churchData.name || 'Church'}`,
          // Add automatic payment methods to make it work with modern Stripe integrations
          automatic_payment_methods: {
            enabled: true,
          },
        });
        
        // Log the payment intent creation in Firestore for tracking
        await admin.firestore().collection(`churches/${churchId}/paymentIntents`).add({
          paymentIntentId: paymentIntent.id,
          amount: amount,
          status: paymentIntent.status,
          created: admin.firestore.FieldValue.serverTimestamp(),
          metadata: paymentIntent.metadata
        });
        
        console.log(`Created payment intent: ${paymentIntent.id} for $${amount/100}`);
        
        // Return the client secret to the client
        res.status(200).json({
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });
      })
      .catch(error => {
        console.error("Error creating payment intent:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Confirm a payment and update the church balance
exports.confirmPayment = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { paymentIntentId, churchId } = req.body;
    
    if (!paymentIntentId || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: paymentIntentId and churchId"
      });
    }
    
    console.log(`Confirming payment: ${paymentIntentId} for church: ${churchId}`);
    
    // Retrieve the payment intent from Stripe to verify its status
    stripe.paymentIntents.retrieve(paymentIntentId)
      .then(async (paymentIntent) => {
        if (paymentIntent.status !== 'succeeded') {
          console.error(`Payment ${paymentIntentId} has not succeeded. Status: ${paymentIntent.status}`);
          return res.status(400).json({
            success: false,
            error: `Payment has not succeeded. Current status: ${paymentIntent.status}`
          });
        }
        
        // Verify the payment is for this church
        if (paymentIntent.metadata.churchId !== churchId) {
          console.error(`Payment ${paymentIntentId} does not belong to church ${churchId}`);
          return res.status(403).json({
            success: false,
            error: "Payment does not belong to this church"
          });
        }
        
        // Get the church document
        const churchRef = admin.firestore().collection('churches').doc(churchId);
        const churchDoc = await churchRef.get();
        
        if (!churchDoc.exists) {
          return res.status(404).json({
            success: false,
            error: "Church not found"
          });
        }
        
        // Update the church balance
        const amount = paymentIntent.amount / 100; // Convert from cents to dollars
        const currentBalance = churchDoc.data().balance || 0;
        const newBalance = currentBalance + amount;
        
        // Update the payment intent record in Firestore for tracking
        const paymentIntentsRef = admin.firestore().collection(`churches/${churchId}/paymentIntents`);
        const paymentIntentQuery = await paymentIntentsRef
          .where('paymentIntentId', '==', paymentIntentId)
          .limit(1)
          .get();
        
        if (!paymentIntentQuery.empty) {
          await paymentIntentQuery.docs[0].ref.update({
            status: paymentIntent.status,
            updated: admin.firestore.FieldValue.serverTimestamp(),
            balanceUpdated: true
          });
        }
        
        // Update the church balance in a transaction to ensure consistency
        await admin.firestore().runTransaction(async (transaction) => {
          // Get the church document again in the transaction
          const churchDocInTx = await transaction.get(churchRef);
          
          if (!churchDocInTx.exists) {
            throw new Error("Church document not found in transaction");
          }
          
          const currentBalanceInTx = churchDocInTx.data().balance || 0;
          const newBalanceInTx = currentBalanceInTx + amount;
          
          // Update the balance
          transaction.update(churchRef, { 
            balance: newBalanceInTx,
            lastBalanceUpdate: admin.firestore.FieldValue.serverTimestamp()
          });
          
          // Add a balance history record
          const historyRef = admin.firestore().collection(`churches/${churchId}/balanceHistory`).doc();
          transaction.set(historyRef, {
            amount: amount,
            type: 'credit',
            source: 'payment',
            paymentIntentId: paymentIntentId,
            balanceBefore: currentBalanceInTx,
            balanceAfter: newBalanceInTx,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            description: `Payment processed via Stripe`
          });
        });
        
        console.log(`Updated balance for church ${churchId} by +$${amount}`);
        
        // Return success
        res.status(200).json({
          success: true,
          newBalance: newBalance
        });
      })
      .catch(error => {
        console.error("Error confirming payment:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a function to get SMS responses for a specific phone number
exports.getSMSResponses = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  try {
    const { phone, churchId, visitorId } = req.query;
    
    if (!phone || !churchId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: phone and churchId"
      });
    }
    
    console.log(`Fetching SMS responses for phone: ${phone}, church: ${churchId}, visitor: ${visitorId || 'unknown'}`);
    
    // Format phone number consistently (ensure it has +1 for US numbers)
    const formattedPhone = phone.startsWith('+') ? 
      phone : 
      `+1${phone.replace(/\D/g, '')}`;
    
    // Get recent messages from Twilio API
    const twilioMessages = twilioClient.messages.list({
      // Look for messages to or from this number
      to: formattedPhone,
      limit: 20
    });
    
    // Also get messages sent from this number
    const inboundMessages = twilioClient.messages.list({
      from: formattedPhone,
      limit: 20
    });
    
    // Execute both promises in parallel
    Promise.all([twilioMessages, inboundMessages])
      .then(async ([toMessages, fromMessages]) => {
        // Combine and filter messages
        const allMessages = [...toMessages, ...fromMessages];
        
        // Remove duplicates (same SID)
        const uniqueMessages = [];
        const seenSids = new Set();
        
        allMessages.forEach(message => {
          if (!seenSids.has(message.sid)) {
            seenSids.add(message.sid);
            uniqueMessages.push({
              sid: message.sid,
              body: message.body,
              from: message.from,
              to: message.to,
              direction: message.direction,
              status: message.status,
              dateSent: message.dateSent
            });
          }
        });
        
        console.log(`Found ${uniqueMessages.length} messages for ${formattedPhone}`);
        
        // Check for existing messages to avoid duplicates
        const messagesRef = admin.firestore().collection('messages');
        const existingSidsQuery = await messagesRef
          .where('twilioSid', 'in', uniqueMessages.slice(0, 10).map(m => m.sid))
          .get();
        
        const existingSids = new Set();
        existingSidsQuery.forEach(doc => {
          const data = doc.data();
          if (data.twilioSid) {
            existingSids.add(data.twilioSid);
          }
        });
        
        // Store any new messages
        const batch = admin.firestore().batch();
        let newMessageCount = 0;
        
        // Process new messages
        for (const message of uniqueMessages) {
          // Skip if already in database
          if (existingSids.has(message.sid)) continue;
          
          // Determine if this is inbound or outbound relative to the user
          const isInbound = message.from === formattedPhone;
          
          // Create message data structure
          const messageData = {
            from: message.from,
            to: message.to,
            message: message.body,
            body: message.body,
            twilioSid: message.sid,
            direction: isInbound ? 'inbound' : 'outbound',
            status: message.status,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            timestamp: admin.firestore.Timestamp.fromDate(new Date(message.dateSent)),
            isRead: false,
            churchId: churchId
          };
          
          // Add the visitorId if provided
          if (visitorId) {
            messageData.visitorId = visitorId;
            messageData.senderId = isInbound ? visitorId : 'admin';
          }
          
          // Store in main messages collection
          const newMessageRef = messagesRef.doc();
          batch.set(newMessageRef, messageData);
          
          // Store in visitor messages collection if visitorId is provided
          if (visitorId) {
            const visitorMessageRef = admin.firestore()
              .collection(`churches/${churchId}/visitorMessages`)
              .doc();
              
            batch.set(visitorMessageRef, messageData);
          }
          
          newMessageCount++;
        }
        
        // Commit the batch if there are new messages
        if (newMessageCount > 0) {
          await batch.commit();
          console.log(`Added ${newMessageCount} new messages to database`);
        }
        
        // Return the messages to the client
        res.status(200).json({
          success: true,
          messages: uniqueMessages,
          newMessages: newMessageCount
        });
      })
      .catch(error => {
        console.error("Error fetching Twilio messages:", error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      });
  } catch (error) {
    console.error("Error in getSMSResponses:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Analyze leadership potential using OpenAI
 */
exports.analyzeLeadership = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { data, prompt } = req.body;
      
      if (!data || !prompt) {
        return res.status(400).json({ error: 'Missing required data or prompt in request body' });
      }
      
      // Get OpenAI API key from environment variables
      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ 
          error: 'OpenAI API key not configured',
          fallback: true,
          potentialLeaders: generateSimulatedLeadershipData(data)
        });
      }
      
      // Call OpenAI API
      try {
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are an AI assistant that analyzes church data to identify potential leaders. Respond with valid JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Parse JSON response from OpenAI
        const content = openaiResponse.data.choices[0].message.content;
        const parsedContent = JSON.parse(content);
        
        // Add analysis metadata
        const analysisResult = {
          ...parsedContent,
          analysisDate: new Date().toISOString(),
          source: 'openai'
        };
        
        // Store the analysis in Firestore for future reference
        if (data.churchId) {
          const db = admin.firestore();
          await db.collection('churches').doc(data.churchId).collection('leadershipAnalyses').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            data: analysisResult
          });
        }
        
        return res.status(200).json(analysisResult);
      } catch (openAIError) {
        console.error('OpenAI API Error:', openAIError);
        return res.status(200).json({
          potentialLeaders: generateSimulatedLeadershipData(data),
          analysisDate: new Date().toISOString(),
          source: 'simulation',
          error: 'Used fallback data due to OpenAI API error'
        });
      }
    } catch (error) {
      console.error('Server Error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Analyze location data using OpenAI
 */
exports.analyzeLocations = functions.https.onRequest((req, res) => {
  if (handleCors(req, res)) return;

  corsHandler(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }

      const { data, prompt } = req.body;
      
      if (!data || !prompt) {
        return res.status(400).json({ error: 'Missing required data or prompt in request body' });
      }
      
      // Get OpenAI API key from environment variables
      const openAIApiKey = functions.config().openai?.apikey || process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        console.error('OpenAI API key not configured');
        return res.status(500).json({ 
          error: 'OpenAI API key not configured',
          fallback: true,
          recommendedLocations: generateSimulatedLocationData(data)
        });
      }
      
      // Call OpenAI API
      try {
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are an AI assistant that analyzes church location data to recommend new church plant locations. Respond with valid JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 2048,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Parse JSON response from OpenAI
        const content = openaiResponse.data.choices[0].message.content;
        const parsedContent = JSON.parse(content);
        
        // Add analysis metadata
        const analysisResult = {
          ...parsedContent,
          analysisDate: new Date().toISOString(),
          source: 'openai'
        };
        
        // Store the analysis in Firestore for future reference
        if (data.churchId) {
          const db = admin.firestore();
          await db.collection('churches').doc(data.churchId).collection('locationAnalyses').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            data: analysisResult
          });
        }
        
        return res.status(200).json(analysisResult);
      } catch (openAIError) {
        console.error('OpenAI API Error:', openAIError);
        return res.status(200).json({
          recommendedLocations: generateSimulatedLocationData(data),
          analysisDate: new Date().toISOString(),
          source: 'simulation',
          error: 'Used fallback data due to OpenAI API error'
        });
      }
    } catch (error) {
      console.error('Server Error:', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});

/**
 * Generate simulated leadership data for fallback purposes
 */
function generateSimulatedLeadershipData(analysisData) {
  const topLeaders = [];
  const members = analysisData.members || [];
  for (let i = 0; i < Math.min(8, members.length); i++) {
    const member = members[i];
    const score = 70 + Math.floor(Math.random() * 25);
    const strengths = [
      ...(member.skills?.slice(0, 2) || []),
      ...(member.professions?.slice(0, 1) || [])
    ];
    if (strengths.length === 0) {
      strengths.push("Communication", "Organization");
    }
    const potentialRoles = [];
    if (member.skills?.includes('teaching') || member.skills?.includes('education')) {
      potentialRoles.push("Bible Study Teacher");
    }
    if (member.skills?.includes('leadership') || member.professions?.includes('Management')) {
      potentialRoles.push("Ministry Leader");
    }
    if (member.skills?.includes('music') || member.skills?.includes('singing')) {
      potentialRoles.push("Worship Team Leader");
    }
    if (potentialRoles.length === 0) {
      potentialRoles.push(
        ["Small Group Leader", "Youth Leader", "Discipleship Mentor", "Pastoral Candidate"][Math.floor(Math.random() * 4)]
      );
    }
    const developmentPlans = [
      `Complete advanced leadership training and mentor with current ${potentialRoles[0]}.`,
      `Assign to assistant ${potentialRoles[0]} role with increasing responsibility over 6 months.`,
      `Pair with experienced leader for 3-month mentorship and enroll in seminary courses.`,
      `Start with leading a small team and provide public speaking training.`
    ];
    topLeaders.push({
      id: member.id,
      name: member.name,
      leadershipScore: score,
      strengths: strengths,
      potentialRoles: potentialRoles,
      developmentPlan: developmentPlans[Math.floor(Math.random() * developmentPlans.length)]
    });
  }
  const visitors = analysisData.visitors || [];
  if (visitors.length > 0) {
    for (let i = 0; i < Math.min(2, visitors.length); i++) {
      const visitor = visitors[i];
      const score = 65 + Math.floor(Math.random() * 15);
      const strengths = [
        ...(visitor.skills?.slice(0, 2) || []),
        ...(visitor.professions?.slice(0, 1) || [])
      ];
      if (strengths.length === 0) {
        strengths.push("Communication", "Community Building");
      }
      const potentialRoles = ["New Visitor Liaison", "Community Outreach Coordinator"];
      topLeaders.push({
        id: visitor.id,
        name: visitor.name,
        isVisitor: true,
        leadershipScore: score,
        strengths: strengths,
        potentialRoles: potentialRoles,
        developmentPlan: "Start membership process and invite to new leader orientation. Offer opportunities to serve in outreach activities."
      });
    }
  }
  topLeaders.sort((a, b) => b.leadershipScore - a.leadershipScore);
  return topLeaders;
}

/**
 * Generate simulated location data for fallback purposes
 */
function generateSimulatedLocationData(analysisData) {
  const members = analysisData.members || [];
  const visitors = analysisData.visitors || [];
  const memberCities = [...new Set(
    members
      .filter(m => m.address?.city)
      .map(m => m.address.city)
  )];
  const visitorCities = [...new Set(
    visitors
      .filter(v => v.address?.city)
      .map(v => v.address.city)
  )];
  const allCities = [...memberCities, ...visitorCities];
  const cityCounts = allCities.reduce((acc, city) => {
    acc[city] = (acc[city] || 0) + 1;
    return acc;
  }, {});
  let recommendedLocations = [];
  if (Object.keys(cityCounts).length >= 3) {
    const sortedCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([city]) => city);
    recommendedLocations = sortedCities.map(city => {
      const memberCount = members.filter(m => m.address?.city === city).length;
      const visitorCount = visitors.filter(v => v.address?.city === city).length;
      const visitorRatio = memberCount > 0 ? visitorCount / memberCount : 0;
      const growthPotential = visitorRatio > 1.5 ? "high" : (visitorRatio > 0.8 ? "medium" : "low");
      const languages = new Set();
      members
        .filter(m => m.address?.city === city && m.languages?.length > 0)
        .forEach(m => m.languages.forEach(lang => languages.add(lang)));
      visitors
        .filter(v => v.address?.city === city && v.languages?.length > 0)
        .forEach(v => v.languages.forEach(lang => languages.add(lang)));
      const languageInsight = languages.size > 1 
        ? `Multilingual community with ${Array.from(languages).join(', ')} speakers.` 
        : '';
      return {
        area: `${city}`,
        justification: `Strong concentration of ${memberCount} members and ${visitorCount} visitors. ${
          visitorCount > memberCount ? 'High visitor-to-member ratio indicates growth potential.' : 
          'Established member base provides leadership for a new campus.'
        }`,
        initialFocus: visitorCount > memberCount ? "Community Outreach and Visitor Integration" : "Discipleship and Leadership Development",
        memberConcentration: memberCount,
        visitorConcentration: visitorCount,
        growthPotential: growthPotential,
        demographicInsights: languageInsight || "No specific demographic insights available with current data."
      };
    });
  } else {
    recommendedLocations = [
      {
        area: "Northeast District",
        justification: "High concentration of 24 visitors with only 8 members indicates untapped potential. Many visitors travel 15+ miles to attend main campus.",
        initialFocus: "Community Outreach and Young Families Ministry",
        memberConcentration: 8,
        visitorConcentration: 24,
        growthPotential: "high",
        demographicInsights: "Growing young professional demographic with young families."
      },
      {
        area: "West Side Community",
        justification: "Strong base of 18 members already meeting in home groups. Growing population center with new housing developments.",
        initialFocus: "Small Groups and Discipleship",
        memberConcentration: 18,
        visitorConcentration: 12,
        growthPotential: "medium",
        demographicInsights: "Middle-income families with school-age children."
      },
      {
        area: "South County",
        justification: "Significant distance (25+ miles) from main campus with 15 members and 10 visitors currently commuting. University nearby provides growth opportunity.",
        initialFocus: "Young Adult Ministry and College Outreach",
        memberConcentration: 15,
        visitorConcentration: 10,
        growthPotential: "high",
        demographicInsights: "College students and recent graduates. Diverse international population."
      },
      {
        area: "Downtown Area",
        justification: "Urban core with diverse population. 7 members and 14 visitors from this area with emerging leadership potential.",
        initialFocus: "Multicultural Ministry and Community Service",
        memberConcentration: 7,
        visitorConcentration: 14,
        growthPotential: "medium",
        demographicInsights: "Diverse working professionals, multiple language groups, some socioeconomic needs."
      }
    ];
    return recommendedLocations;
  }
}

// ==========================================
// SQL SERVER BRIDGE FUNCTIONS
// ==========================================

// Get all tables from SQL Server database
exports.getSqlTables = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const query = `
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;
    
    const tables = await executeQuery(query);
    res.json({
      success: true,
      tables: tables,
      count: tables.length
    });
  } catch (error) {
    console.error('Error fetching SQL tables:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table schema/columns
exports.getTableSchema = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { tableName, schema = 'dbo' } = req.query;
  
  if (!tableName) {
    return res.status(400).json({
      success: false,
      error: 'Table name is required'
    });
  }
  
  try {
    const query = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @param0 AND TABLE_SCHEMA = @param1
      ORDER BY ORDINAL_POSITION
    `;
    
    const columns = await executeQuery(query, [tableName, schema]);
    res.json({
      success: true,
      table: tableName,
      schema: schema,
      columns: columns
    });
  } catch (error) {
    console.error('Error fetching table schema:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table data with pagination
exports.getTableData = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { tableName, schema = 'dbo', page = 1, limit = 100, orderBy, orderDir = 'ASC' } = req.query;
  
  if (!tableName) {
    return res.status(400).json({
      success: false,
      error: 'Table name is required'
    });
  }
  
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM [${schema}].[${tableName}]`;
    const countResult = await executeQuery(countQuery);
    const totalRecords = countResult[0].total;
    
    // Get data with pagination
    let dataQuery = `SELECT * FROM [${schema}].[${tableName}]`;
    
    if (orderBy) {
      dataQuery += ` ORDER BY [${orderBy}] ${orderDir}`;
    }
    
    dataQuery += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    
    const data = await executeQuery(dataQuery);
    
    res.json({
      success: true,
      table: tableName,
      schema: schema,
      data: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalRecords: totalRecords,
        totalPages: Math.ceil(totalRecords / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching table data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Execute custom SQL query (READ-ONLY for safety)
exports.executeSqlQuery = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  const { query, params = [] } = req.body;
  
  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'SQL query is required'
    });
  }
  
  // Basic security check - only allow SELECT statements
  if (!query.trim().toUpperCase().startsWith('SELECT')) {
    return res.status(403).json({
      success: false,
      error: 'Only SELECT queries are allowed for security reasons'
    });
  }
  
  try {
    const result = await executeQuery(query, params);
    res.json({
      success: true,
      query: query,
      result: result,
      rowCount: result.length
    });
  } catch (error) {
    console.error('Error executing SQL query:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get database overview
exports.getDatabaseOverview = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    // Get table counts
    const tableQuery = `
      SELECT 
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        SUM(p.rows) as row_count
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN sys.tables st ON t.TABLE_NAME = st.name
      LEFT JOIN sys.partitions p ON st.object_id = p.object_id AND p.index_id IN (0,1)
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    `;
    
    const tables = await executeQuery(tableQuery);
    
    // Get database info
    const dbInfoQuery = `
      SELECT 
        DB_NAME() as database_name,
        @@VERSION as sql_version,
        GETDATE() as current_time
    `;
    
    const dbInfo = await executeQuery(dbInfoQuery);
    
    res.json({
      success: true,
      database: dbInfo[0],
      tables: tables,
      totalTables: tables.length,
      totalRecords: tables.reduce((sum, table) => sum + (table.row_count || 0), 0)
    });
  } catch (error) {
    console.error('Error fetching database overview:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

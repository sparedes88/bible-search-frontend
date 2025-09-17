const { db, admin } = require("./firebaseAdmin");  // Import Firestore instance

// Function to add a user to a chat
async function addUserToChat(userId, chatId) {
    try {
        await db.collection("chat_members")
            .doc(chatId)
            .collection("users")
            .doc(userId)
            .set({
                userId: userId,
                chatId: chatId,
                joinedAt: admin.firestore.FieldValue.serverTimestamp()  // Auto timestamp
            });

        console.log(`✅ User ${userId} added to chat ${chatId}`);
    } catch (error) {
        console.error("❌ Error adding user to chat:", error);
    }
}

// Run the function to test
addUserToChat("user123", "chat456");

import { auth, db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

// 🔥 Register User & Assign Role
export const registerUser = async (email, password, name, churchId, role) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Save user details in Firestore
    await setDoc(doc(db, "users", user.uid), {
      email,
      name,
      churchId,  // Assign user to a church
      role,  // Assign role (member, leader, admin, global_admin)
    });

    return user;
  } catch (error) {
    throw error;
  }
};

// 🔥 Login User & Fetch Role
export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Fetch user role & church ID from Firestore
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      return { ...user, role: userData.role, churchId: userData.churchId };
    } else {
      throw new Error("User data not found");
    }
  } catch (error) {
    throw error;
  }
};

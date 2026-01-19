import React, { useState, useEffect } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { auth, db } from "../firebase";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs, limit, setDoc } from "firebase/firestore";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";
import "./Register.css";
import ChurchHeader from "./ChurchHeader";
import "../styles/LoginStyles.css";

const Login = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [retryCount, setRetryCount] = useState(0);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginDisabled, setLoginDisabled] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [rememberMe, setRememberMe] = useState(true);
  
  // Extract return URL from query parameters if present
  const urlParams = new URLSearchParams(location.search);
  const returnUrl = urlParams.get('returnUrl');

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setError(null);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setError("❌ Sin conexión a Internet - Por favor revisa tu conexión");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Cooldown timer for rate limiting
  useEffect(() => {
    let timer;
    if (loginDisabled && cooldownTime > 0) {
      timer = setInterval(() => {
        setCooldownTime(prevTime => {
          if (prevTime <= 1) {
            clearInterval(timer);
            setLoginDisabled(false);
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [loginDisabled, cooldownTime]);

  // Check if input is an email or phone number
  const isEmail = (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  // Format phone number for consistency
  const formatPhoneNumber = (value) => {
    if (!value) return value;
    
    // Remove all non-digits
    const digitsOnly = value.replace(/[^\d]/g, "");
    
    if (digitsOnly.length === 11 && digitsOnly.charAt(0) === '1') {
      return digitsOnly.substring(1);
    }
    
    return digitsOnly;
  };

  const checkIfAdminEmail = (email) => {
    const emailLower = email.toLowerCase();
    return emailLower.includes('admin') || 
           emailLower.endsWith('@iglesiatech.app') || 
           emailLower.endsWith('@churchadmin.app');
  };

  const findUserByPhone = async (formattedPhone) => {
    try {
      const usersRef = collection(db, "users");
      let foundUser = null;
      
      const phoneFields = ["phone", "phoneNumber", "mobilePhone"];
      
      for (const field of phoneFields) {
        if (foundUser) break;
        
        const q = query(usersRef, where(field, "==", formattedPhone), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          foundUser = {
            ...querySnapshot.docs[0].data(),
            id: querySnapshot.docs[0].id
          };
        }
      }
      
      return foundUser;
    } catch (err) {
      console.error("Phone lookup error:", err);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Clear previous errors
    setError("");
    
    if (!isOnline) {
      setError("❌ Sin conexión a Internet - Por favor revisa tu conexión");
      return;
    }

    if (!identifier || !password) {
      setError("Por favor ingrese su correo electrónico/teléfono y contraseña");
      return;
    }

    if (loginDisabled) {
      setError(`❌ Demasiados intentos. Por favor espere ${cooldownTime} segundos.`);
      return;
    }

    setLoading(true);
    
    try {
      // Set persistence based on rememberMe checkbox
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      
      // We'll always use Firebase Authentication directly
      try {
        // If identifier is an email, use it directly
        // If it's a phone number, we'll look up the email first
        let loginEmail = identifier;
        
        // If it's not an email (likely a phone number), try to find matching user
        if (!isEmail(identifier)) {
          const foundUser = await findUserByPhone(formatPhoneNumber(identifier));
          if (!foundUser) {
            setError("❌ No se encontró ninguna cuenta con este número de teléfono");
            setLoading(false);
            return;
          }
          
          if (!foundUser.email) {
            setError("❌ La cuenta encontrada no tiene correo electrónico asociado");
            setLoading(false);
            return;
          }
          
          loginEmail = foundUser.email;
        }
        
        // Now we have an email (either directly or from phone lookup)
        // Proceed with Firebase Auth login
        const userCredential = await signInWithEmailAndPassword(
          auth,
          loginEmail.trim(),
          password
        );
        
        // Check user access
        const user = userCredential.user;
        
        // Special handling for global admin emails
        const isAdminEmail = checkIfAdminEmail(loginEmail);
        
        // For admin emails, skip checking Firestore
        if (isAdminEmail) {
          console.log("Admin email detected, bypassing Firestore check");
          
          // Redirect to return URL if it exists, otherwise to profile
          if (returnUrl) {
            navigate(returnUrl);
          } else {
            navigate(`/organization/${id}/mi-perfil`);
          }
        } else {
          // Normal user - check church access in Firestore
          await checkUserChurchAccess(user.uid);
        }
      } catch (err) {
        handleAuthError(err);
      }
    } catch (err) {
      console.error("Login error:", err);
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  // Centralized error handler
  const handleAuthError = (err) => {
    console.error("Authentication error:", err);
    
    let errorMessage = "❌ ";
    let cooldown = 0;
    
    switch (err.code) {
      case "auth/network-request-failed":
        errorMessage += "Error de conexión. Por favor revisa tu conexión a Internet.";
        break;
      case "auth/user-not-found":
        errorMessage += "Usuario no encontrado. Verifique su correo electrónico o teléfono.";
        break;
      case "auth/invalid-credential":
        errorMessage += "Credenciales inválidas. Verifique su correo electrónico/teléfono y contraseña.";
        cooldown = 5; // Small cooldown to prevent brute force
        break;
      case "auth/wrong-password":
        errorMessage += "Contraseña incorrecta. Por favor intente nuevamente.";
        cooldown = 5;
        break;
      case "auth/too-many-requests":
        errorMessage += "Demasiados intentos. Su cuenta ha sido temporalmente bloqueada.";
        cooldown = 60; // 1 minute cooldown
        break;
      case "auth/user-disabled":
        errorMessage += "Esta cuenta ha sido deshabilitada. Contacte al administrador.";
        break;
      case "auth/invalid-email":
        errorMessage += "Formato de correo electrónico inválido.";
        break;
      default:
        errorMessage += err.message || "Error desconocido. Por favor intente más tarde.";
    }
    
    setError(errorMessage);
    
    // Implement cooldown if needed
    if (cooldown > 0) {
      setLoginDisabled(true);
      setCooldownTime(cooldown);
    }
    
    // Track retry count for network issues
    if (err.code === "auth/network-request-failed") {
      setRetryCount(prev => prev + 1);
    }
  };

  // Check user church access
  const checkUserChurchAccess = async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);
      
      console.log("User document exists:", userDoc.exists());
      console.log("User ID being checked:", userId);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log("User data retrieved:", userData);

        // Check if user is global_admin, admin, or matches church ID
        if (
          userData.role === "global_admin" ||
          userData.role === "admin" ||
          String(userData.churchId) === String(id)
        ) {
          // Redirect to return URL if it exists, otherwise to profile
          if (returnUrl) {
            navigate(returnUrl);
          } else {
            navigate(`/organization/${id}/mi-perfil`);
          }
        } else {
          throw new Error("Usuario no tiene permiso para acceder a esta iglesia");
        }
      } else {
        // Special case: If the email indicates it's a admin or global admin
        // For example, if email contains admin or ends with specific domains
        const user = auth.currentUser;
        const email = user?.email || identifier;
        
        if (email) {
          const emailLower = email.toLowerCase();
          const isLikelyAdmin = emailLower.includes('admin') || 
                                emailLower.endsWith('@iglesiatech.app') || 
                                emailLower.endsWith('@churchadmin.app');
                                
          if (isLikelyAdmin) {
            console.log("This appears to be an admin account without a Firestore record");
            
            // For these special accounts, we'll grant access directly
            // We can't create the document due to permission issues, but we can let them in
            if (returnUrl) {
              navigate(returnUrl);
            } else {
              navigate(`/organization/${id}/mi-perfil`);
            }
            return;
          }
        }
        
        // For normal users, we require a Firestore record
        throw new Error("Usuario no encontrado en Firestore. Contacte al administrador.");
      }
    } catch (err) {
      console.error("Church access check error:", err);
      setError(`❌ ${err.message}`);
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!identifier) {
      setError("Por favor, introduzca primero su dirección de correo electrónico.");
      return;
    }

    if (!isEmail(identifier)) {
      setError("Por favor, ingrese un correo electrónico válido para restablecer su contraseña.");
      return;
    }

    try {
      setIsLoading(true);
      const resetUrl = `${window.location.origin}/organization/${id}/login`;

      await sendPasswordResetEmail(auth, identifier.trim(), {
        url: resetUrl,
        handleCodeInApp: false,
      });

      setResetEmailSent(true);
      setError(null);
      setTimeout(() => {
        setResetEmailSent(false);
      }, 5000);
    } catch (error) {
      console.error("Password reset error:", error);
      setError("No se pudo enviar el correo electrónico de restablecimiento. Verifique su dirección.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container" style={{...commonStyles.container, paddingLeft: 0, paddingRight: 0, overflowX: "hidden"}}>
      {/* Back Button */}
      <div style={{display:"flex", justifyContent:"space-between", paddingLeft: "15px", paddingRight: "15px"}}>
        <button
          onClick={() => navigate('/')}
          style={commonStyles.backButton}
        >
          ⬅ Volver
        </button>
        <button
          onClick={() => navigate(`/organization/${id}/church-app`)}
          style={{...commonStyles.backButtonLink, width:"140px"}}
        >
          Church App ➞
        </button>
      </div>

      {id && <ChurchHeader id={id} applyShadow={false} />}

      {/* Network Status */}
      {!isOnline && (
        <div className="network-status offline">
          <span>📡 Sin conexión</span>
        </div>
      )}

      {/* Login Box */}
      <div className="login-container">
        <h2>Iniciar Sesión</h2>

        {error && <p style={{ color: "red" }}>{error}</p>}

        {loginDisabled && cooldownTime > 0 && (
          <div style={{
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            padding: "10px",
            borderRadius: "4px",
            marginBottom: "15px",
            textAlign: "center"
          }}>
            Por favor espere {cooldownTime} segundos antes de intentar nuevamente.
          </div>
        )}

        {retryCount >= 2 && (
          <div
            style={{
              backgroundColor: "#FEF3C7",
              color: "#92400E",
              padding: "8px",
              borderRadius: "4px",
              marginBottom: "10px",
              fontSize: "14px",
            }}
          >
            ⚠️ Detectamos problemas de conexión. Por favor:
            <ul style={{ marginLeft: "20px", marginTop: "5px" }}>
              <li>Verifica tu conexión a Internet</li>
              <li>Intenta de nuevo en unos momentos</li>
              <li>Si el problema persiste, contacta al soporte</li>
            </ul>
          </div>
        )}

        {/* Email Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="text"
            placeholder="Correo Electrónico o Número de Teléfono"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="form-field"
            disabled={loginDisabled}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="form-field"
            disabled={loginDisabled}
          />
          
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ marginRight: '8px' }}
              disabled={loginDisabled}
            />
            <label htmlFor="rememberMe" style={{ fontSize: '14px' }}>
              Mantener sesión iniciada
            </label>
          </div>
          
          <button 
            type="submit" 
            className="loging-btn" 
            disabled={loading || loginDisabled}
          >
            {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
          </button>
        </form>

        <button
          onClick={() => navigate(`/organization/${id}/register`)}
          className="form-field"
          style={{ marginTop: "20px" }}
          disabled={loginDisabled}
        >
          No tienes cuenta? Regístrate
        </button>

        {resetEmailSent ? (
          <p style={{ color: "green", marginTop: "30px" }}>
            ✅ ¡El correo electrónico de restablecimiento se envió
            correctamente!
          </p>
        ) : (
          <button
            onClick={handleForgotPassword}
            disabled={isLoading || loginDisabled}
            style={{
              backgroundColor: "transparent",
              border: "none",
              color: "blue",
              cursor: loginDisabled ? "not-allowed" : "pointer",
              opacity: loginDisabled ? 0.7 : 1,
              marginTop: '15px'
            }}
          >
            {isLoading
              ? "Enviando correo electrónico..."
              : "¿Has olvidado tu contraseña?"}
          </button>
        )}
      </div>
    </div>
  );
};

export default Login;

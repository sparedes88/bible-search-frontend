import React, { useState, useEffect } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";
import "./Register.css"; // Import the CSS file
import ChurchHeader from "./ChurchHeader";
// import { getChurchData } from "../api/church";

// const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

const Register = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [dob, setDob] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [sex, setSex] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Validation functions
  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const isValidPhoneNumber = (phone) => {
    // Accept phone numbers with optional country code, 
    // can have spaces, dashes or parentheses
    const phoneRegex = /^(\+?\d{1,3}[-\s]?)?\(?[\d\s-]{6,14}\)?$/;
    return phoneRegex.test(phone);
  };
  
  const isValidPassword = (password) => {
    // At least 6 characters
    return password.length >= 6;
  };
  
  const isValidAge = (birthDate) => {
    if (!birthDate) return false;
    const today = new Date();
    const birth = new Date(birthDate);
    
    // Invalid date
    if (isNaN(birth.getTime())) return false;
    
    // Birth date in future
    if (birth > today) return false;
    
    // Calculate age
    const age = today.getFullYear() - birth.getFullYear();
    const monthDifference = today.getMonth() - birth.getMonth();
    
    // If birth month hasn't occurred this year yet
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) {
      return age - 1 >= 13; // Minimum age is 13
    }
    
    return age >= 13; // Minimum age is 13
  };

  // useEffect(() => {
  //   const fetchChurchData = async () => {
  //     try {
  //       const data = await getChurchData(id);
  //       if (data) {
  //         setChurch(data);
  //       }
  //     } catch (error) {
  //       console.error("Error fetching church:", error);
  //       setError("❌ Error cargando los datos de la iglesia.");
  //     }
  //   };

  //   fetchChurchData();
  // }, [id]);
  const handleRegister = async (e) => {
    e.preventDefault();

    // Check if all fields are filled
    if (
      !name ||
      !lastName ||
      !phoneNumber ||
      !dob ||
      !maritalStatus ||
      !sex ||
      !email ||
      !password ||
      !confirmPassword
    ) {
      setError("❌ Todos los campos son obligatorios.");
      return;
    }

    // Validate email format
    if (!isValidEmail(email)) {
      setError("❌ Por favor ingresa un correo electrónico válido.");
      return;
    }

    // Validate phone number
    if (!isValidPhoneNumber(phoneNumber)) {
      setError("❌ Por favor ingresa un número de teléfono válido.");
      return;
    }

    // Validate password strength
    if (!isValidPassword(password)) {
      setError("❌ La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    // Validate password confirmation
    if (password !== confirmPassword) {
      setError("❌ Las contraseñas no coinciden.");
      return;
    }

    // Validate date of birth
    if (!isValidAge(dob)) {
      setError("❌ Debes tener al menos 13 años para registrarte.");
      return;
    }

    // if (!church || !church.id || !church.name) {
    //   setError("❌ Error: No se encontró la iglesia. Intenta de nuevo.");
    //   return;
    // }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        name,
        lastName,
        phoneNumber,
        dob,
        maritalStatus,
        sex,
        email,
        churchId: id,
        role: "member",
      });

      setSuccess("✅ Registro exitoso. Redirigiendo al inicio de sesión...");
      setTimeout(() => navigate(`/church/${id}/login`), 2000);
    } catch (error) {
      console.error("❌ Error registering:", error);
      setError("❌ Error registrando usuario. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };
  const validateStep1 = () => {
    let valid = true;
    let errorMessage = "";

    // Name validation
    if (!name) {
      errorMessage = "❌ Por favor ingresa tu nombre.";
      document.getElementById("name").style.borderColor = "red";
      valid = false;
    } else if (name.length < 2) {
      errorMessage = "❌ El nombre debe tener al menos 2 caracteres.";
      document.getElementById("name").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("name").style.borderColor = "";
    }

    // Last name validation
    if (!lastName) {
      errorMessage = "❌ Por favor ingresa tu apellido.";
      document.getElementById("lastName").style.borderColor = "red";
      valid = false;
    } else if (lastName.length < 2) {
      errorMessage = "❌ El apellido debe tener al menos 2 caracteres.";
      document.getElementById("lastName").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("lastName").style.borderColor = "";
    }

    // Phone number validation
    if (!phoneNumber) {
      errorMessage = "❌ Por favor ingresa tu número de teléfono.";
      document.getElementById("phoneNumber").style.borderColor = "red";
      valid = false;
    } else if (!isValidPhoneNumber(phoneNumber)) {
      errorMessage = "❌ Por favor ingresa un número de teléfono válido.";
      document.getElementById("phoneNumber").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("phoneNumber").style.borderColor = "";
    }

    // Date of birth validation
    if (!dob) {
      errorMessage = "❌ Por favor ingresa tu fecha de nacimiento.";
      document.getElementById("dob").style.borderColor = "red";
      valid = false;
    } else if (!isValidAge(dob)) {
      errorMessage = "❌ Debes tener al menos 13 años para registrarte.";
      document.getElementById("dob").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("dob").style.borderColor = "";
    }

    // Marital status validation
    if (!maritalStatus) {
      errorMessage = "❌ Por favor selecciona tu estado civil.";
      document.getElementById("maritalStatus").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("maritalStatus").style.borderColor = "";
    }

    // Sex validation
    if (!sex) {
      errorMessage = "❌ Por favor selecciona tu sexo.";
      document.getElementById("sex").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("sex").style.borderColor = "";
    }

    if (!valid) {
      setError(errorMessage);
    } else {
      setError("");
    }
    
    return valid;
  };
  const validateStep2 = () => {
    let valid = true;
    let errorMessage = "";
    
    // Email validation
    if (!email) {
      errorMessage = "❌ Por favor ingresa tu correo electrónico.";
      document.getElementById("email").style.borderColor = "red";
      valid = false;
    } else if (!isValidEmail(email)) {
      errorMessage = "❌ Por favor ingresa un correo electrónico válido.";
      document.getElementById("email").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("email").style.borderColor = "";
    }
    
    // Password validation
    if (!password) {
      errorMessage = "❌ Por favor ingresa una contraseña.";
      document.getElementById("password").style.borderColor = "red";
      valid = false;
    } else if (!isValidPassword(password)) {
      errorMessage = "❌ La contraseña debe tener al menos 6 caracteres.";
      document.getElementById("password").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("password").style.borderColor = "";
    }
    
    // Confirm password validation
    if (!confirmPassword) {
      errorMessage = "❌ Por favor confirma tu contraseña.";
      document.getElementById("confirmPassword").style.borderColor = "red";
      valid = false;
    } else {
      document.getElementById("confirmPassword").style.borderColor = "";
    }
    
    // Password match validation
    if (password && confirmPassword && password !== confirmPassword) {
      errorMessage = "❌ Las contraseñas no coinciden.";
      document.getElementById("password").style.borderColor = "red";
      document.getElementById("confirmPassword").style.borderColor = "red";
      valid = false;
    } else if (password && confirmPassword) {
      document.getElementById("password").style.borderColor = "";
      document.getElementById("confirmPassword").style.borderColor = "";
    }
    
    if (!valid) {
      setError(errorMessage);
    } else {
      setError("");
    }
    
    return valid;
  };

  const renderStep1 = () => (
    <div>
      <label className="form-label">Detalles Personales</label>
      <input
        type="text"
        id="name"
        placeholder="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="form-field"
      />
      <input
        type="text"
        id="lastName"
        placeholder="Apellido"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        required
        className="form-field"
      />
      <input
        type="text"
        id="phoneNumber"
        placeholder="Número de Teléfono"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        required
        className="form-field"
      />
      <label className="form-label">Fecha de Nacimiento</label>
      <input
        type="date"
        id="dob"
        placeholder="Fecha de Nacimiento"
        value={dob}
        onChange={(e) => setDob(e.target.value)}
        required
        className="form-field"
      />
      <select
        id="maritalStatus"
        value={maritalStatus}
        onChange={(e) => setMaritalStatus(e.target.value)}
        required
        className="form-field"
      >
        <option value="">Estado Civil</option>
        <option value="Soltero">Soltero</option>
        <option value="Casado">Casado</option>
        <option value="Divorciado">Divorciado</option>
        <option value="Viudo">Viudo</option>
        <option value="Otro">Otro</option>
      </select>
      <select
        id="sex"
        value={sex}
        onChange={(e) => setSex(e.target.value)}
        required
        className="form-field"
      >
        <option value="">Sexo</option>
        <option value="Masculino">Masculino</option>
        <option value="Femenino">Femenino</option>
      </select>
      <button
        type="button"
        onClick={() => validateStep1() && setStep(2)}
        className="register-btn"
      >
        Siguiente
      </button>
    </div>
  );

  const renderStep2 = () => (
    <div>
      <label className="form-label">Correo electrónico y contraseña</label>
      <input
        type="email"
        id="email"
        placeholder="Correo Electrónico"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="form-field"
      />
      <input
        type="password"
        id="password"
        placeholder="Contraseña"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        className="form-field"
      />
      <input
        type="password"
        id="confirmPassword"
        placeholder="Confirmar Contraseña"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        className="form-field"
      />
      {password !== confirmPassword && (
        <p style={{ color: "red" }}>❌ Las contraseñas no coinciden.</p>
      )}
      <button
        type="button"
        onClick={() => setStep(1)}
        className="register-btn"
        style={{ marginBottom: "12px" }}
      >
        Atrás
      </button>
      <button type="submit" disabled={loading} className="loging-btn">
        {loading ? "Registrando usuario..." : "Registrarse"}
      </button>
    </div>
  );

  return (
    <div style={commonStyles.container}>
      <button
        onClick={() => navigate(`/church/${id}/login`)}
        style={commonStyles.backButton}
      >
        ⬅ Volver
      </button>
      <ChurchHeader id={id} applyShadow={false} />

      <h2 style={{ marginTop: "-30px" }}>Registrar usuario</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {success && <p style={{ color: "green" }}>{success}</p>}

      <form onSubmit={handleRegister} className="register-form">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
      </form>
    </div>
  );
};

export default Register;

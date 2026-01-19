import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate, useParams } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api"; // ✅ Ensure correct import
import commonStyles from "../pages/commonStyles"; // ✅ Ensure correct import
import "./pages.responsive.css";

const Login = () => {
  const { id } = useParams(); // Get church ID from URL
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [church, setChurch] = useState(null);

  // Debug: Check if `id` is being passed
  useEffect(() => {
    console.log("Login Page - Church ID:", id);
  }, [id]);

  // Fetch church data (same as ChurchInfo.js)
  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setLoading(true);
      try {
        console.log(`Fetching church data for ID: ${id}`);
        const churchData = await searchChurchById(id);
        setChurch(churchData);
        console.log("Fetched Church Data:", churchData);
      } catch (error) {
        console.error("Error fetching church info:", error);
      }
      setLoading(false);
    };
    fetchData();
  }, [id]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/mi-perfil"); // Redirect to profile after login
    } catch (err) {
      setError("❌ Error: Invalid credentials. Please try again.");
    }
  };

  return (
    <div style={commonStyles.container}>
      {/* Debug: Show ID */}
      <p style={{ color: "red" }}>Debug ID: {id || "No ID found"}</p>

      {/* Banner (Same logic as ChurchInfo.js) */}
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={300} />}
      </div>

      {/* Logo (Same logic as ChurchInfo.js) */}
      <div style={commonStyles.logoContainer}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      {/* Login Box */}
      <div className="login-container">
        <h2 className="login-title">Iniciar Sesión</h2>
        <p className="login-subtitle">Ingrese sus credenciales para continuar</p>

        {error && <p className="login-error">{error}</p>}

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Correo Electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="login-input"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="login-input"
          />
          <button type="submit" className="login-button">Iniciar Sesión</button>
        </form>

        <p className="login-footer">
          ¿No tienes cuenta? <span onClick={() => navigate("/register")} className="login-link">Regístrate</span>
        </p>
      </div>
    </div>
  );
};

export default Login;
